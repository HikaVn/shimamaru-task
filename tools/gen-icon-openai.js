#!/usr/bin/env node
/*
 * gen-icon-openai.js  ―  Imagegen 機能（OpenAI 画像API / gpt-image-1）
 *
 * 「可愛いシマエナガ」のアプリアイコンを AI 生成し icon-master.png (1024x1024) に保存します。
 * 依存ライブラリ不要（Node標準の https のみ）。Codex Imagegen と同じエンジン(gpt-image-1)を直接利用。
 *
 * 必要な環境:
 *   - 環境変数 OPENAI_API_KEY
 *   - ネットワーク egress 許可リストに api.openai.com を追加
 *     （未許可だと 403 host_not_allowed になります）
 *
 * 使い方:
 *   node tools/gen-icon-openai.js              # 生成して icon-master.png を保存
 *   node tools/gen-icon-openai.js --dry-run    # 送信内容だけ表示（APIは叩かない）
 *   PROMPT="..." node tools/gen-icon-openai.js # プロンプト上書き
 *
 * 生成後:
 *   node tools/make-icons.js icon-master.png . # 各サイズ(192/512/180/32)へ変換
 */
'use strict';
const https = require('https');
const fs = require('fs');

const DEFAULT_PROMPT = [
  '可愛いシマエナガ（白い小鳥）のアプリアイコン。',
  'パステルピンクのグラデーション背景（上 #fde8f2 → 下 #ef82b0）に、',
  'ふわふわ丸い白いシマエナガを中央に大きく配置。',
  '大きめのうるうるした黒い目とハイライト、ピンクのほっぺ、小さなオレンジの三角くちばし、ちょこんとした足。',
  'フラットで可愛いミニマルなキャラクターアイコン。やわらかい影。',
  'maskable対応のため被写体は中央80%に収め、背景は隅まで塗りつぶす（透明部分なし）。',
  '文字・ロゴ・枠は入れない。正方形。'
].join('');

const PROMPT = process.env.PROMPT || DEFAULT_PROMPT;
const DRY = process.argv.includes('--dry-run');
const OUT = 'icon-master.png';

const payload = {
  model: 'gpt-image-1',
  prompt: PROMPT,
  size: '1024x1024',
  quality: 'high',
  background: 'opaque',
  output_format: 'png',
  n: 1
};

if (DRY) {
  console.log('POST https://api.openai.com/v1/images/generations');
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
  console.error('✗ OPENAI_API_KEY が設定されていません。環境変数に設定してください。');
  process.exit(1);
}

function postJSON(body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = https.request({
      method: 'POST',
      hostname: 'api.openai.com',
      path: '/v1/images/generations',
      headers: {
        'Authorization': 'Bearer ' + KEY,
        'Content-Type': 'application/json',
        'Content-Length': data.length
      },
      timeout: 120000
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('request timeout')); });
    req.write(data);
    req.end();
  });
}

(async () => {
  console.log('🎨 gpt-image-1 で シマエナガのアイコンを生成中…');
  let res;
  try { res = await postJSON(payload); }
  catch (e) {
    console.error('✗ リクエスト失敗:', e.message,
      '\n  （api.openai.com が egress 許可リストにあるか確認してください）');
    process.exit(1);
  }
  if (res.status !== 200) {
    console.error('✗ APIエラー HTTP ' + res.status + ':\n' + res.body.slice(0, 800));
    if (/host_not_allowed/.test(res.body)) {
      console.error('  → ネットワーク egress 許可リストに api.openai.com を追加してください。');
    }
    process.exit(1);
  }
  let json;
  try { json = JSON.parse(res.body); } catch (e) { console.error('✗ 応答の解析に失敗'); process.exit(1); }
  const b64 = json && json.data && json.data[0] && json.data[0].b64_json;
  if (!b64) { console.error('✗ 画像データ(b64_json)がありません:\n' + res.body.slice(0, 400)); process.exit(1); }
  fs.writeFileSync(OUT, Buffer.from(b64, 'base64'));
  console.log('✅ ' + OUT + ' を保存しました (' + fs.statSync(OUT).size + ' bytes)');
  console.log('   次に: node tools/make-icons.js ' + OUT + ' .  で各サイズへ変換できます。');
})();
