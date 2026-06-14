# アイコン生成ツール

しままるアプリ（PWA）のアイコンを作るための手順とツールです。
画像生成は **Codex CLI（Imagegen）** などで行い、サイズ変換はこの `make-icons.js` で行います。

## 1. 画像を生成する（Codex CLI / Imagegen）

お手元の認証済み Codex CLI で、以下のようにお願いしてください。
出力は **正方形・1024×1024 の PNG**、ファイル名は `icon-master.png` でリポジトリ直下に保存します。

```bash
codex "しままる（シマエナガ）のPWAアプリアイコンを作って。1024x1024のPNGで icon-master.png として保存。\
デザイン：パステルピンクのグラデ背景（上 #fde8f2 → 下 #e8629a）に、ふわふわ丸い白いシマエナガを中央配置。\
小さな黒い目、ピンクのほっぺ、オレンジの三角くちばし。フラットで可愛い丸みのあるミニマル。\
maskable対応で被写体は中央80%に収め、隅まで背景を塗る（透明部分なし）。文字・ロゴは入れない。"
```

> ポイント：maskable（角丸/円形にくり抜かれても欠けない）ために、被写体は中央80%に収め、
> 背景は隅まで塗りつぶす（透明なし）と綺麗です。

## 2. 各サイズへ変換する

リポジトリ直下に `icon-master.png` を置いてから:

```bash
node tools/make-icons.js icon-master.png .
```

これで以下が生成されます（`manifest.webmanifest` と `simamaru_memo.html` が参照するファイル名）:

- `icon-192.png` … 192×192（any / maskable）
- `icon-512.png` … 512×512（any / maskable）
- `icon-180.png` … 180×180（iOS apple-touch-icon）
- `favicon-32.png` … 32×32（favicon）

依存ライブラリは不要です（Node標準の `zlib` のみ使用）。
透明部分は `#fde8f2` に合成して不透明化します（maskable向け）。

対応PNG: 8-bit / colorType 0,2,3,4,6 / 非インターレース。
