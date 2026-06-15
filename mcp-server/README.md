# しままるタスク MCP サーバ

外部AI（**Claude Desktop / Claude Code / Codex** など）から、しままるのタスクを
追加・完了・一覧・ルーティン設定・統計参照できる **MCP サーバ**です。
依存ライブラリ不要（Node標準のみ）／stdio・JSON-RPC 2.0。

## データのつながり（重要）

このアプリ本体（`simamaru_memo.html`）はブラウザの **localStorage** で動く静的Webアプリのため、
MCPサーバがブラウザ内データを直接読むことはできません。そこで両者は
**アプリの「バックアップ/復元」と同じJSON形式**のファイルで橋渡しします。

```
{ "app": "...", "exportedAt": "...", "tasks": [ ... ], "game": { ... } }
```

- **アプリ → AI**：アプリの「💾 バックアップ」でJSONを書き出し、そのパスを `SHIMAMARU_DATA` に指定。
- **AI → アプリ**：AIがMCPで操作するとそのJSONが更新される → アプリの「📥 ふくげん」で読み込めば反映。
- ※ リアルタイム同期ではありません（export/importでブリッジ）。常時同期したい場合はバックエンドが必要（今後の拡張）。

既定の保存先は `./shimamaru-data.json`。環境変数 `SHIMAMARU_DATA` で変更できます。

## 動作確認

```bash
node mcp-server/shimamaru-mcp.js     # 標準入出力で待ち受け（Ctrl+Cで終了）
```

## リアルタイム同期サーバと併用（推奨・競合に強い）

同梱の `sync-server` と併用すると、AIの操作がブラウザへ**即反映**され、
ファイルへの二重書き込みによる競合も解消されます。

`SHIMAMARU_SYNC_URL` を指定すると、MCPサーバはファイルではなく同期サーバへ
**HTTP直結**し、各変更を「最新をGET → 変更 → `baseRev`付きPUT →
409なら自動リトライ」する**楽観的並行制御**で保存します（read-modify-write競合を防止）。

```bash
# 1) 同期サーバ
node sync-server/shimamaru-sync.js                       # http://localhost:8787
# 2) MCPサーバ（HTTP直結）
SHIMAMARU_SYNC_URL=http://localhost:8787 node mcp-server/shimamaru-mcp.js
```

`SHIMAMARU_SYNC_URL` 未指定時は従来どおりファイル（`SHIMAMARU_DATA`）モードです。

## クライアント設定

> 同期サーバと併用する場合は、下記の `SHIMAMARU_DATA` の代わりに
> `SHIMAMARU_SYNC_URL=http://localhost:8787` を渡してください。


### Claude Code（CLI）
```bash
claude mcp add shimamaru -e SHIMAMARU_DATA=/abs/path/shimamaru_backup.json \
  -- node /abs/path/mcp-server/shimamaru-mcp.js
```

### Claude Desktop（`claude_desktop_config.json`）
```json
{
  "mcpServers": {
    "shimamaru": {
      "command": "node",
      "args": ["/abs/path/mcp-server/shimamaru-mcp.js"],
      "env": { "SHIMAMARU_DATA": "/abs/path/shimamaru_backup.json" }
    }
  }
}
```

### Codex CLI（`~/.codex/config.toml`）
```toml
[mcp_servers.shimamaru]
command = "node"
args = ["/abs/path/mcp-server/shimamaru-mcp.js"]
env = { SHIMAMARU_DATA = "/abs/path/shimamaru_backup.json" }
```

## 使えるツール（tools）

| ツール | 説明 |
|---|---|
| `list_tasks` | タスク一覧（filter: active/done/all） |
| `get_today` | きょう やるべきタスク（曜日ルーティン考慮） |
| `add_task` | 追加（name, note, deadline, priority, repeat=none/daily/weekly, weekdays[]） |
| `complete_task` | 完了（ID or 名前で指定。ルーティンはきょうの分） |
| `uncomplete_task` | 完了取り消し |
| `update_task` | 編集（name/note/deadline/priority） |
| `delete_task` | 削除 |
| `add_subtask` | ひなタスク追加 |
| `complete_subtask` | ひなタスク完了（全部完了で親も完了） |
| `get_stats` | Lv/XP/木の実/れんぞく/件数 |

タスク完了で XP・木の実・れんぞく日数も加算されるので、アプリ側の育成と整合します。

## 必要環境
- Node.js 18 以上（外部依存なし）

## 例（AIへの指示イメージ）
> 「しままるに『燃えるゴミを出す』を毎週月木の朝タスクで追加して。あと今日のタスク教えて」
