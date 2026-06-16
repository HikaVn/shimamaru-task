# しままるタスク リアルタイム同期サーバ

ブラウザのアプリ本体と、MCP経由のAI操作を **リアルタイムに同期**するための軽量サーバです。
依存ライブラリ不要（Node標準のみ）。

```
            ┌──────────────┐   PUT /api/state    ┌─────────────────┐
   ブラウザ │ simamaru_memo │ ──────────────────▶ │                 │
   (アプリ) │   .html       │ ◀── SSE /events ─── │  sync-server    │
            └──────────────┘    （即プッシュ）    │  (このサーバ)    │
                                                  │  ＝ JSONファイル │
            ┌──────────────┐   同じJSONを読み書き │  を所有/監視     │
   AI       │  MCP server   │ ◀──────────────────▶│                 │
 (Claude等) │               │   fs.watchで検知    └─────────────────┘
            └──────────────┘
```

- ブラウザでタスクを変更 → サーバへ即PUT → 他の画面へ即反映
- **AIがMCPで同じJSONファイルを書き換え → サーバが`fs.watch`で検知 → ブラウザへ即プッシュ**
- アプリは**デュアルモード**：このサーバから配信されると自動で同期モード。
  GitHub Pages等の単体配信ではこれまで通りオフライン（localStorage）動作。

## 起動

```bash
node sync-server/shimamaru-sync.js
# → http://localhost:8787/simamaru_memo.html を開く（自動で「🔄 同期オン」）
```

環境変数:
- `PORT` … 待受ポート（既定 8787）
- `SHIMAMARU_DATA` … データファイル（既定 `<repo>/shimamaru-data.json`）
- `SHIMAMARU_ROOT` … 配信ルート（既定 リポジトリ直下）

## MCP（AI操作）と一緒に使う

同じデータファイルを指す形で MCP サーバを起動すれば、AIの操作がブラウザに即反映されます。

```bash
# 1) 同期サーバ
SHIMAMARU_DATA=$PWD/shimamaru-data.json node sync-server/shimamaru-sync.js

# 2) MCP サーバ（同じファイルを指定）
SHIMAMARU_DATA=$PWD/shimamaru-data.json node mcp-server/shimamaru-mcp.js
```

→ AIが `add_task` などを実行 → ファイル更新 → 同期サーバが検知 → ブラウザが即更新。

## エンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/health` | `{ ok, rev }` |
| GET | `/api/state` | `{ rev, tasks, game }` |
| PUT/POST | `/api/state` | `{ tasks, game, baseRev? }` を保存し他クライアントへ配信。`baseRev` が現在revと不一致なら **409 ＋ 最新state**（楽観的並行制御。MCPのHTTP直結が利用）。`X-Client-Id` で自分宛て除外 |
| GET | `/events` | Server-Sent Events。`event: state` で `{ rev, tasks, game }` をプッシュ |
| GET | `/*` | 静的配信（`/` → `index.html`、アプリ本体・アイコン等） |

## 注意・制限

- 既定は**同じ端末（またはLAN）**でのリアルタイム同期です。
- **複数端末でクラウド同期**したい場合は、このサーバを公開ホストに配置し（HTTPS推奨）、
  アプリもそのサーバから配信してください（同一オリジンなのでCORS/混在コンテンツ不要）。
- 競合は last-write-wins（個人利用前提のシンプル実装）。
- 必要環境: Node.js 18 以上（外部依存なし）。
