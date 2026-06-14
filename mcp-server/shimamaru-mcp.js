#!/usr/bin/env node
/*
 * shimamaru-mcp.js  ―  しままるタスクの MCP サーバ（stdio / JSON-RPC 2.0）
 *
 * 外部AI（Claude Desktop / Claude Code / Codex など）から、しままるのタスクを
 * 追加・完了・一覧・ルーティン設定・統計参照できるようにする MCP サーバです。
 * 依存ライブラリ不要（Node標準のみ）。
 *
 * データはアプリの「バックアップ/復元」と同じJSON形式で読み書きします:
 *   { "app": "...", "exportedAt": "...", "tasks": [...], "game": {...} }
 * 既定の保存先: ./shimamaru-data.json （環境変数 SHIMAMARU_DATA で変更可）
 * アプリ側からエクスポートしたJSONをこのパスに置けば、AIがそれを操作 →
 * アプリの「📥 ふくげん」で取り込めば反映されます。
 *
 * 起動: node mcp-server/shimamaru-mcp.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_PATH = process.env.SHIMAMARU_DATA || path.resolve(process.cwd(), 'shimamaru-data.json');
const SERVER_INFO = { name: 'shimamaru-tasks', version: '1.0.0' };
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const PRIORITIES = ['high', 'medium', 'low'];

/* ---------- date utils ---------- */
const pad = n => String(n).padStart(2, '0');
function todayYMD() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseYMD(s) { return new Date(s + 'T00:00:00'); }
function getDaysLeft(dl) { if (!dl) return null; return Math.ceil((parseYMD(dl) - parseYMD(todayYMD())) / 86400000); }

/* ---------- store ---------- */
function ensureTask(t) {
  const created = t.createdAt || Date.now();
  const done = !!t.done;
  return {
    id: t.id || Date.now() + Math.floor(Math.random() * 100000),
    name: t.name || '無題タスク',
    note: t.note || '',
    startDate: t.startDate || todayYMD(),
    deadline: t.deadline || '',
    link: t.link || '',
    repeat: (t.repeat && ['none', 'daily', 'weekly'].includes(t.repeat.type))
      ? { type: t.repeat.type, days: Array.isArray(t.repeat.days) ? t.repeat.days.filter(d => d >= 0 && d <= 6) : [] }
      : { type: 'none', days: [] },
    repeatLastDone: t.repeatLastDone || '',
    priority: PRIORITIES.includes(t.priority) ? t.priority : 'medium',
    done,
    everDone: t.everDone !== undefined ? !!t.everDone : done,
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.map(st => ({
      id: st.id || Date.now() + Math.floor(Math.random() * 100000),
      name: st.name || 'ひなタスク', done: !!st.done,
      everDone: st.everDone !== undefined ? !!st.everDone : !!st.done,
      createdAt: st.createdAt || Date.now()
    })) : [],
    history: Array.isArray(t.history) ? t.history : [],
    createdAt: created,
    updatedAt: t.updatedAt || created
  };
}
function defaultGame() {
  return { xp: 0, coins: 0, streak: { count: 0, best: 0, last: '', freezes: 2 }, hatched: [], owned: { acc: [], decor: [] }, equippedAcc: '', placedDecor: [], stats: { tasksDone: 0, focusDone: 0 }, daily: null, settings: { remindEnabled: false, remindTime: '09:00', lastRemindDate: '' }, lastSeen: '' };
}
let store = { tasks: [], game: defaultGame() };
function load() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
      const tasks = Array.isArray(raw) ? raw : (raw.tasks || []);
      store.tasks = tasks.map(ensureTask);
      store.game = Object.assign(defaultGame(), raw.game || {});
    }
  } catch (e) { /* start empty */ }
}
function save() {
  const payload = { app: 'shimamaru-complete-v3', exportedAt: new Date().toISOString(), tasks: store.tasks, game: store.game };
  fs.writeFileSync(DATA_PATH, JSON.stringify(payload, null, 2));
}

/* ---------- task helpers ---------- */
function isRecurring(t) { return t.repeat && t.repeat.type !== 'none'; }
function isScheduledToday(t) {
  if (!isRecurring(t)) return true;
  if (t.repeat.type === 'daily') return true;
  if (t.repeat.type === 'weekly') return (t.repeat.days || []).includes(new Date().getDay());
  return true;
}
function isActiveNow(t) { return !t.done && isScheduledToday(t); }
function repeatLabel(rep) {
  if (!rep || rep.type === 'none') return '';
  if (rep.type === 'daily') return 'まいにち';
  if (rep.type === 'weekly') { const ds = (rep.days || []).slice().sort((a, b) => a - b); return ds.length === 7 ? 'まいにち' : '毎週' + ds.map(d => WEEKDAYS[d]).join(''); }
  return '';
}
function taskProgress(t) { const s = t.subtasks || []; if (!s.length) return t.done ? 100 : 0; return Math.round(s.filter(x => x.done).length / s.length * 100); }
function findTask(ref) {
  if (ref === undefined || ref === null) return null;
  const byId = store.tasks.find(t => String(t.id) === String(ref));
  if (byId) return byId;
  const exact = store.tasks.find(t => t.name === ref);
  if (exact) return exact;
  const low = String(ref).toLowerCase();
  return store.tasks.find(t => t.name.toLowerCase().includes(low)) || null;
}
function taskLine(t) {
  const p = { high: '🔴', medium: '🟡', low: '🟢' }[t.priority] || '🟡';
  const bits = [`${t.done ? '✅' : '⬜'} [${t.id}] ${t.name}`, p];
  if (isRecurring(t)) bits.push('🔁' + repeatLabel(t.repeat));
  if (t.deadline) { const d = getDaysLeft(t.deadline); bits.push(`締切${t.deadline}(${d === 0 ? '今日' : d < 0 ? '超過' : 'あと' + d + '日'})`); }
  if (t.subtasks.length) bits.push(`進捗${taskProgress(t)}%(🐣${t.subtasks.filter(s => s.done).length}/${t.subtasks.length})`);
  return bits.join(' ');
}

/* ---------- tools ---------- */
const TOOLS = [
  { name: 'list_tasks', description: 'タスク一覧を取得する。filter で active(未完了・きょう該当)/done(完了)/all を切替。', inputSchema: { type: 'object', properties: { filter: { type: 'string', enum: ['active', 'done', 'all'], description: '既定 active' }, limit: { type: 'number', description: '最大件数(既定50)' } } } },
  { name: 'get_today', description: 'きょう やるべきタスク（未完了・きょうの曜日に該当するもの）を取得する。', inputSchema: { type: 'object', properties: {} } },
  { name: 'add_task', description: 'タスクを追加する。', inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, note: { type: 'string' }, deadline: { type: 'string', description: 'YYYY-MM-DD' }, startDate: { type: 'string', description: 'YYYY-MM-DD' }, priority: { type: 'string', enum: PRIORITIES }, repeat: { type: 'string', enum: ['none', 'daily', 'weekly'], description: 'くりかえし' }, weekdays: { type: 'array', items: { type: 'number' }, description: 'weekly時の曜日 0=日..6=土' } } } },
  { name: 'complete_task', description: 'タスクを完了にする（ルーティンはきょうの分を完了）。', inputSchema: { type: 'object', required: ['task'], properties: { task: { type: 'string', description: 'タスクID または 名前' } } } },
  { name: 'uncomplete_task', description: 'タスクの完了を取り消す。', inputSchema: { type: 'object', required: ['task'], properties: { task: { type: 'string' } } } },
  { name: 'update_task', description: 'タスクを編集する（指定したフィールドのみ）。', inputSchema: { type: 'object', required: ['task'], properties: { task: { type: 'string' }, name: { type: 'string' }, note: { type: 'string' }, deadline: { type: 'string' }, priority: { type: 'string', enum: PRIORITIES } } } },
  { name: 'delete_task', description: 'タスクを削除する。', inputSchema: { type: 'object', required: ['task'], properties: { task: { type: 'string' } } } },
  { name: 'add_subtask', description: 'ひなタスク（サブタスク）を追加する。', inputSchema: { type: 'object', required: ['task', 'name'], properties: { task: { type: 'string' }, name: { type: 'string' } } } },
  { name: 'complete_subtask', description: 'ひなタスクを完了にする。', inputSchema: { type: 'object', required: ['task', 'subtask'], properties: { task: { type: 'string' }, subtask: { type: 'string', description: 'サブタスクID または 名前' } } } },
  { name: 'get_stats', description: 'しままるのレベル/XP/木の実/れんぞく日数とタスク件数を取得する。', inputSchema: { type: 'object', properties: {} } }
];

function xpNeeded(level) { return 40 + level * 20; }
function levelInfo(xp) { let level = 1, rem = xp; while (rem >= xpNeeded(level)) { rem -= xpNeeded(level); level++; if (level > 999) break; } return { level, inLevel: rem, need: xpNeeded(level) }; }
function awardCompletion(t) {
  const g = store.game;
  if (isRecurring(t)) { g.xp += 12; g.coins += 2; } else { g.xp += 18 + Math.min(12, t.subtasks.length * 2); g.coins += 3 + (t.priority === 'high' ? 2 : 0); }
  g.stats.tasksDone = (g.stats.tasksDone || 0) + 1;
  const today = todayYMD();
  if (g.streak.last !== today) {
    const y = new Date(parseYMD(today)); y.setDate(y.getDate() - 1);
    const ymd = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;
    g.streak.count = g.streak.last === ymd ? g.streak.count + 1 : 1;
    g.streak.last = today;
    if (g.streak.count > (g.streak.best || 0)) g.streak.best = g.streak.count;
  }
}

const handlers = {
  list_tasks(a) {
    const filter = a.filter || 'active';
    const limit = a.limit || 50;
    let list = store.tasks.filter(t => filter === 'active' ? isActiveNow(t) : filter === 'done' ? t.done : true);
    list = list.slice(0, limit);
    if (!list.length) return `タスクはありません（filter=${filter}）。`;
    return `タスク ${list.length}件 (filter=${filter}):\n` + list.map(taskLine).join('\n');
  },
  get_today() {
    const list = store.tasks.filter(isActiveNow);
    if (!list.length) return 'きょう やるべきタスクはありません。のんびりしてね🐦';
    return `きょうの おしごと ${list.length}件:\n` + list.map(taskLine).join('\n');
  },
  add_task(a) {
    if (!a.name) throw new Error('name は必須です');
    const repeat = a.repeat && a.repeat !== 'none' ? { type: a.repeat, days: a.repeat === 'weekly' ? (Array.isArray(a.weekdays) && a.weekdays.length ? a.weekdays : [new Date().getDay()]) : [] } : { type: 'none', days: [] };
    const t = ensureTask({ name: a.name, note: a.note || '', deadline: a.deadline || '', startDate: a.startDate || todayYMD(), priority: a.priority || 'medium', repeat });
    store.tasks.push(t); save();
    return `追加したよ🐦\n${taskLine(t)}`;
  },
  complete_task(a) {
    const t = findTask(a.task); if (!t) throw new Error('タスクが見つかりません: ' + a.task);
    if (t.done && !isRecurring(t)) return `すでに完了しているよ: ${t.name}`;
    t.done = true; t.everDone = true; t.updatedAt = Date.now();
    if (isRecurring(t)) t.repeatLastDone = todayYMD();
    awardCompletion(t); save();
    const li = levelInfo(store.game.xp);
    return `完了！🎉 ${t.name}\n（Lv${li.level}・🌰${store.game.coins}・🔥${store.game.streak.count}日）`;
  },
  uncomplete_task(a) {
    const t = findTask(a.task); if (!t) throw new Error('タスクが見つかりません: ' + a.task);
    t.done = false; if (isRecurring(t)) t.repeatLastDone = ''; t.updatedAt = Date.now(); save();
    return `未完了に戻したよ: ${t.name}`;
  },
  update_task(a) {
    const t = findTask(a.task); if (!t) throw new Error('タスクが見つかりません: ' + a.task);
    if (a.name !== undefined) t.name = a.name;
    if (a.note !== undefined) t.note = a.note;
    if (a.deadline !== undefined) t.deadline = a.deadline;
    if (a.priority !== undefined && PRIORITIES.includes(a.priority)) t.priority = a.priority;
    t.updatedAt = Date.now(); save();
    return `更新したよ:\n${taskLine(t)}`;
  },
  delete_task(a) {
    const t = findTask(a.task); if (!t) throw new Error('タスクが見つかりません: ' + a.task);
    store.tasks = store.tasks.filter(x => x.id !== t.id); save();
    return `削除したよ: ${t.name}`;
  },
  add_subtask(a) {
    const t = findTask(a.task); if (!t) throw new Error('タスクが見つかりません: ' + a.task);
    if (!a.name) throw new Error('name は必須です');
    t.subtasks.push({ id: Date.now() + Math.floor(Math.random() * 100000), name: a.name, done: false, everDone: false, createdAt: Date.now() });
    t.updatedAt = Date.now(); save();
    return `ひなタスクを追加したよ🐣: ${a.name}（親: ${t.name}）`;
  },
  complete_subtask(a) {
    const t = findTask(a.task); if (!t) throw new Error('タスクが見つかりません: ' + a.task);
    const st = t.subtasks.find(s => String(s.id) === String(a.subtask)) || t.subtasks.find(s => s.name === a.subtask) || t.subtasks.find(s => s.name.toLowerCase().includes(String(a.subtask).toLowerCase()));
    if (!st) throw new Error('ひなタスクが見つかりません: ' + a.subtask);
    st.done = true; st.everDone = true;
    if (t.subtasks.length && t.subtasks.every(s => s.done)) { if (!t.everDone) { t.everDone = true; } t.done = true; awardCompletion(t); }
    t.updatedAt = Date.now(); save();
    return `ひなタスク完了🐣: ${st.name}（進捗 ${taskProgress(t)}%）`;
  },
  get_stats() {
    const g = store.game; const li = levelInfo(g.xp);
    const active = store.tasks.filter(t => !t.done).length;
    const todayCount = store.tasks.filter(isActiveNow).length;
    return [
      `🐦 しままる Lv${li.level}（XP ${li.inLevel}/${li.need}）`,
      `🌰 木の実: ${g.coins}`,
      `🔥 れんぞく: ${g.streak.count}日（最高 ${g.streak.best || 0}）`,
      `🐣 孵化したひな: ${(g.hatched || []).length}匹`,
      `📋 未完了: ${active}件 / きょうやること: ${todayCount}件 / 合計: ${store.tasks.length}件`
    ].join('\n');
  }
};

/* ---------- JSON-RPC over stdio (newline-delimited) ---------- */
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function replyErr(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

function handle(msg) {
  const { id, method, params } = msg;
  const isReq = id !== undefined && id !== null;
  if (method === 'initialize') {
    return reply(id, { protocolVersion: (params && params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: SERVER_INFO });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return; // notification
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS });
  if (method === 'resources/list') return reply(id, { resources: [] });
  if (method === 'prompts/list') return reply(id, { prompts: [] });
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    const fn = handlers[name];
    if (!fn) return reply(id, { content: [{ type: 'text', text: '不明なツール: ' + name }], isError: true });
    try {
      load(); // 最新の状態で（アプリの復元等と整合）
      const text = fn(args);
      return reply(id, { content: [{ type: 'text', text: String(text) }] });
    } catch (e) {
      return reply(id, { content: [{ type: 'text', text: 'エラー: ' + (e && e.message || e) }], isError: true });
    }
  }
  if (isReq) return replyErr(id, -32601, 'Method not found: ' + method);
}

load();
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    let msg; try { msg = JSON.parse(line); } catch (e) { continue; }
    try { handle(msg); } catch (e) { if (msg && msg.id != null) replyErr(msg.id, -32603, 'Internal error: ' + (e && e.message)); }
  }
});
process.stdin.on('end', () => process.exit(0));
process.stderr.write(`[shimamaru-mcp] ready. data=${DATA_PATH}\n`);
