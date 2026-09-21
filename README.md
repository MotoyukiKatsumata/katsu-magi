# katsu-magi

ChatGPT、Gemini、Claude の **正規 Web サイト** に同じプロンプトを同時に送り、回答を横並びで比較するローカルツールです。
API ではなく、あなたがログイン済みの本物の Chrome を Playwright で操作します。追加課金なしで、各サービスの契約プランをそのまま使えます。

名前はエヴァンゲリオンの MAGI システムから。3 つの独立した知性に同じ問いを投げ、見比べて結論を出すための道具です。

## 仕組み

```
 katsu-magi UI (localhost:5175)
        │  WebSocket
        ▼
 Node サーバー ── Playwright ──▶ 本物の Chrome(専用プロファイル)
                                   ├─ タブ1: chatgpt.com
                                   ├─ タブ2: gemini.google.com
                                   └─ タブ3: claude.ai
```

- サイトごとに 1 タブを開いたままにするので、追い質問は各サイトの **同じ会話** に送られます。
- 「New conversation」で 3 サイトを一括で新しいチャットにします。
- 回答は生成中にストリーミング表示され、完了後に Markdown に整形されます。

## 必要なもの

- Windows 10/11(macOS / Linux でも動く想定ですが未検証)
- Google Chrome(インストール済みのもの)
- Node.js 20 以上
- pnpm(`npm i -g pnpm` または `corepack enable`)
- ChatGPT / Gemini / Claude の各アカウント

## セットアップ

```bash
git clone <this repo> katsu-magi
cd katsu-magi
pnpm install          # Web UI のビルドまで自動で行います
pnpm katsu-magi login # Chrome が開くので 3 サイトにログインし、ターミナルで Enter
pnpm start            # http://localhost:5175 が開きます
```

ログイン情報は `%LOCALAPPDATA%\katsu-magi\chrome-profile` の専用プロファイルに保存され、普段使いの Chrome とは分離されています。

## 使い方

1. 下部の入力欄にプロンプトを書き、**Send**(または Ctrl+Enter)。
2. 3 つのカラムに各サービスの回答が流れてきます。
3. そのまま追い質問すれば、各サイトの同じ会話に送られます。
4. カラム上部のチェックを外すと、そのサイトには送りません。
5. **Copy** で最新回答を Markdown としてコピーできます。

ステータスバッジの意味:

| バッジ | 意味 | 対処 |
|---|---|---|
| idle / done | 正常 | - |
| needs login | ログイン画面が出ている | Chrome 窓でログインし、**Retry** |
| blocked | Cloudflare 等の確認画面 | Chrome 窓で確認を通し、**Retry** |
| rate limited | 利用上限のメッセージを検出 | 時間をおいて再送 |
| error | セレクタ不一致・タブ閉鎖など | メッセージの指示に従う(下記トラブルシュート) |

## 開発

```bash
pnpm dev        # サーバー(:5175, tsx watch)と Vite(:5173)を同時起動
pnpm test       # 単体テスト(vitest)
pnpm typecheck
pnpm build
```

開発中は `http://localhost:5173`(Vite)を開いてください。`/ws` と `/api` はサーバーへプロキシされます。

`tsx watch` の再起動で Chrome のタブが消えるのが煩わしい場合は、`scripts\start-chrome.cmd` で Chrome を先に起動し、設定で `"browser": { "mode": "connect" }` にしてください。サーバーを何度再起動しても会話が維持されます。

## 設定

`katsu-magi.config.example.json` を `katsu-magi.config.json` にコピーして編集します(無ければ既定値で動きます)。環境変数 `KATSU_MAGI_CONFIG` でパスを指定することもできます。

```jsonc
{
  "port": 5175,
  "browser": {
    "mode": "launch",              // "launch"(既定)| "connect"(start-chrome.cmd と併用)
    "userDataDir": "%LOCALAPPDATA%\\katsu-magi\\chrome-profile",
    "cdpUrl": "http://127.0.0.1:9222",
    "startMinimized": false
  },
  "sites": {
    "chatgpt": { "enabled": true },
    "gemini": { "enabled": true },
    "claude": { "enabled": true }
  },
  "timeouts": {
    "pollMs": 300,        // 回答のポーリング間隔
    "stableMs": 1500,     // この時間テキストが変化しなければ完了と判断
    "firstTokenMs": 45000,
    "generationMs": 240000
  }
}
```

## トラブルシュート

### あるサイトだけ動かなくなった(セレクタ不一致)

各サイトの画面構造は予告なく変わります。まず現状を確認します。

```bash
pnpm katsu-magi selectors:check claude
```

`MISSING` が出たキーは、`packages/server/src/sites/selectors/<site>.json` の候補配列に新しいセレクタを追加してください。JSON はサーバー再起動なしで次回送信時に再読込されます。新しいセレクタを探すには次を使います。

```bash
pnpm katsu-magi selectors:probe claude   # ページ上の入力欄・aria-label 付きボタン・独自要素を一覧
pnpm katsu-magi selectors:probe claude https://claude.ai/chat/<id>   # 回答のある会話を開いて回答要素を調べる
pnpm katsu-magi inspect claude           # Playwright Inspector の "Pick locator" で要素を選ぶ
```

`selectors:check` は入力欄に 1 文字入れてから判定します(送信ボタンは入力がないと表示されないサイトがあるため)。判定後に文字は消します。

なお `assistantMessage` は回答が 1 つ以上表示されている会話を開いた状態でないと一致しません。

### Gemini がログインしていないのに idle になる

Gemini はログインなしでも使える入力欄を表示することがあります。その状態では匿名モードの回答になるので、`pnpm katsu-magi login` で必ずログインしてください。

失敗時のスクリーンショットは `%LOCALAPPDATA%\katsu-magi\logs\` に保存されます。

### 単体でアダプタを試す

```bash
pnpm katsu-magi adapter:test chatgpt "Reply with exactly: pong"
pnpm katsu-magi adapter:test gemini "自己紹介して" --new --then "今の回答を3行に要約して"
```

### Chrome が起動しない(プロファイルのロック)

katsu-magi のプロファイルを別の Chrome が使っています。その Chrome を閉じるか、`taskkill /IM chrome.exe /F` の後に再実行してください。

### Google にログインできない / 「このブラウザは安全でない可能性があります」

katsu-magi は Playwright にブラウザを起動させず、インストール済みの Chrome を通常の引数で自ら起動して DevTools ポート経由で接続します(`--enable-automation` などのテスト用フラグは付きません)。そのため通常は発生しませんが、出た場合は `mode: "connect"` に切り替えて `scripts\start-chrome.cmd` から起動した Chrome でログインしてください。

### Chrome の実行ファイルが見つからない

既定では `C:\Program Files\Google\Chrome\Application\chrome.exe` などを探します。別の場所にある場合は設定に `"browser": { "executablePath": "..." }` を追加してください。

## 注意事項

- 各サービスの利用規約は、Web UI の自動操作を禁じている場合があります。**個人利用・低頻度・人間のペース** での利用を前提にしており、アカウント制限のリスクはご自身の判断でお願いします。
- ヘッドレスモードは使いません(ボット検知にかかるため)。Chrome の窓は「Hide browser」で最小化できます。

## 配布用 zip の作成(開発者向け)

Node.js や pnpm を入れていない人に渡すときは、ポータブル版の zip を作ります。

```bash
pnpm package
```

`release/katsu-magi-<version>-win-x64.zip` ができます(約 45MB)。中身は次のとおりです。

| ファイル | 役割 |
|---|---|
| `katsu-magi.cmd` | 起動用。ダブルクリックで Chrome と UI が開く |
| `katsu-magi-cli.cmd` | 保守用コマンド(`selectors:check` など)。起動中は使えない |
| `README.txt` | 受け取った人向けの説明 |
| `katsu-magi.config.json` | 設定。編集可 |
| `selectors/*.json` | サイトのセレクタ。サイトの画面が変わったら、ここを新しいファイルで上書きしてもらう(再起動不要) |
| `node/node.exe` | 同梱の Node.js。受け取る側のインストールは不要 |
| `app/` | ビルド済みのサーバーと UI、本番用の依存パッケージ |

受け取る側に必要なのは Windows と Google Chrome だけです。
初回起動時は UI の各カラムが「needs login」になるので、開いた Chrome でログインして Retry を押してもらいます。

Node.js の zip は初回に `release/cache/` にダウンロードして再利用します。同梱する Node.js の版は環境変数 `KATSU_MAGI_NODE_VERSION`(例: `v22.20.0`)で変えられます。

## ドキュメント

- [機能仕様書](docs/functional-spec.md): 何をするかを定める。機能一覧、状態遷移、画面、CLI、設定、非機能要件
- [設計書](docs/design.md): どう作られているかを説明する。設計判断、アーキテクチャ、各層の構造、処理の流れ、プロトコル、ビルド

## 今後(マギモード)

フェーズ 2 では、3 サイトの独立回答をもとに「相互検証 → 統合」を行うマギモードを追加する予定です。`packages/server/src/orchestrator/strategies/` に戦略を 1 つ足すだけで済む構造になっています。

## ライセンス

MIT
