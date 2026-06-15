#!/usr/bin/env node
/*
 * shimamaru-sync.js  ―  しままるタスクの リアルタイム同期サーバ（依存ゼロ）
 *
 * ・アプリ本体(simamaru_memo.html 等)を配信
 * ・/api/state (GET/PUT) でタスク&育成データを取得/更新
 * ・/events (SSE) で変更をブラウザへ即プッシュ
 * ・データファイル(SHIMAMARU_DATA)を fs.watch し、MCPサーバ等の外部書き換えも検知して配信
 *
 * 起動: node sync-server/shimamaru-sync.js
 *   PORT            待受ポート（既定 8787）
 *   SHIMAMARU_DATA  データファイル（既定 <repo>/shimamaru-data.json … MCPと共有可）
 *   SHIMAMARU_ROOT  配信ルート（既定 リポジトリ直下）
 *
 * ブラウザで http://localhost:8787/simamaru_memo.html を開くと自動で同期モードになります。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8787);
const ROOT = process.env.SHIMAMARU_ROOT || path.resolve(__dirname, '..');
const DATA = process.env.SHIMAMARU_DATA || path.join(ROOT, 'shimamaru-data.json');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

let state = { tasks: [], game: {} };
let rev = 0;
let lastPersistedRaw = '';

function serialize() {
  return JSON.stringify({ app: 'shimamaru-complete-v3', exportedAt: new Date().toISOString(), tasks: state.tasks, game: state.game }, null, 2);
}
function persist() {
  const raw = serialize();
  lastPersistedRaw = raw;
  try { fs.writeFileSync(DATA, raw); } catch (e) { console.error('[sync] write error', e.message); }
}
function loadFromFile() {
  try {
    if (fs.existsSync(DATA)) {
      const raw = fs.readFileSync(DATA, 'utf8');
      const j = JSON.parse(raw);
      state.tasks = Array.isArray(j) ? j : (j.tasks || []);
      state.game = (j && j.game) || {};
      lastPersistedRaw = raw;
      return true;
    }
  } catch (e) { console.error('[sync] load error', e.message); }
  return false;
}

/* ---- SSE clients ---- */
const clients = new Set(); // {res, id}
function sseSend(res, event, dataObj) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(dataObj)}\n\n`);
}
function broadcast(exceptId) {
  const payload = { rev, tasks: state.tasks, game: state.game };
  for (const c of clients) { if (c.id !== exceptId) { try { sseSend(c.res, 'state', payload); } catch (e) {} } }
}

/* ---- file watch (MCP等の外部更新を検知) ---- */
let watchTimer = null;
function startWatch() {
  const dir = path.dirname(DATA);
  const base = path.basename(DATA);
  try {
    // ファイルではなくディレクトリを監視（起動時にファイルが無くてもOK・置換にも強い）
    fs.watch(dir, (event, filename) => {
      if (filename && filename !== base) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        let raw; try { raw = fs.readFileSync(DATA, 'utf8'); } catch (e) { return; }
        if (raw === lastPersistedRaw) return;       // 自分の書き込みは無視
        try {
          const j = JSON.parse(raw);
          state.tasks = Array.isArray(j) ? j : (j.tasks || []);
          state.game = (j && j.game) || {};
          lastPersistedRaw = raw;
          rev++;
          broadcast(null);
          console.error('[sync] external change adopted -> rev', rev);
        } catch (e) { /* 書き込み途中などは無視 */ }
      }, 120);
    });
  } catch (e) { console.error('[sync] watch unavailable:', e.message); }
}

/* ---- helpers ---- */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Client-Id');
}
function sendJSON(res, code, obj) { cors(res); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function readBody(req) { return new Promise((resolve) => { let b = ''; req.on('data', c => { b += c; if (b.length > 8e6) req.destroy(); }); req.on('end', () => resolve(b)); }); }

function serveStatic(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const abs = path.normalize(path.join(ROOT, p));
  if (!abs.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(abs, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  if (url === '/api/health') return sendJSON(res, 200, { ok: true, name: 'shimamaru-sync', rev });
  if (url === '/api/state' && req.method === 'GET') return sendJSON(res, 200, { rev, tasks: state.tasks, game: state.game });
  if (url === '/api/state' && (req.method === 'PUT' || req.method === 'POST')) {
    const body = await readBody(req);
    let j; try { j = JSON.parse(body); } catch (e) { return sendJSON(res, 400, { ok: false, error: 'invalid json' }); }
    if (!Array.isArray(j.tasks)) return sendJSON(res, 400, { ok: false, error: 'tasks[] required' });
    // 楽観的並行制御: baseRev が現在revと不一致なら 409 + 最新stateを返す（baseRev省略時は無条件）
    if (typeof j.baseRev === 'number' && j.baseRev !== rev) {
      return sendJSON(res, 409, { ok: false, error: 'conflict', rev, tasks: state.tasks, game: state.game });
    }
    state.tasks = j.tasks; if (j.game) state.game = j.game;
    rev++; persist();
    broadcast(req.headers['x-client-id'] || null);
    return sendJSON(res, 200, { ok: true, rev });
  }
  if (url === '/events' && req.method === 'GET') {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    const client = { res, id: req.headers['x-client-id'] || ('s' + Math.random().toString(36).slice(2, 8)) };
    clients.add(client);
    sseSend(res, 'state', { rev, tasks: state.tasks, game: state.game }); // 初期同期
    const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
    req.on('close', () => { clearInterval(hb); clients.delete(client); });
    return;
  }
  if (url.startsWith('/api/')) return sendJSON(res, 404, { ok: false, error: 'not found' });
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  return serveStatic(req, res);
});

loadFromFile();
startWatch();
server.listen(PORT, () => {
  console.error(`[shimamaru-sync] http://localhost:${PORT}  (root=${ROOT})`);
  console.error(`[shimamaru-sync] data=${DATA}  tasks=${state.tasks.length}`);
  console.error(`[shimamaru-sync] open: http://localhost:${PORT}/simamaru_memo.html`);
});
