// Builds a portable Windows distribution:
//
//   release/katsu-magi-<version>-win-x64/
//     katsu-magi.cmd            double-click to start
//     katsu-magi-cli.cmd        maintenance commands (selectors:check etc.)
//     README.txt                for the recipient
//     CHANGELOG.md              what changed in this version
//     katsu-magi.config.json    editable settings
//     selectors/*.json          editable site selectors (replace when a site changes its UI)
//     node/node.exe             bundled Node.js runtime
//     app/packages/server/dist  bundled server + cli
//     app/packages/web/dist     built UI
//     app/node_modules          production dependencies (hoisted, no symlinks)
//
// and zips it to release/katsu-magi-<version>-win-x64.zip.
//
// Usage: pnpm package            (set KATSU_MAGI_NODE_VERSION=v22.x.y to pick another Node)
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
if (!existsSync(path.join(root, "pnpm-workspace.yaml"))) {
  console.error("run from the repository root");
  process.exit(1);
}
if (process.platform !== "win32") {
  console.error("this packager currently targets Windows only (needs tar.exe and produces .cmd launchers)");
  process.exit(1);
}

// Windows' own bsdtar reads and writes .zip; GNU tar from Git Bash (which may shadow it on PATH) does not.
const TAR = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const nodeVersion = process.env.KATSU_MAGI_NODE_VERSION ?? process.version; // e.g. v24.18.0
const name = `katsu-magi-${version}-win-x64`;
const release = path.join(root, "release");
const cache = path.join(release, "cache");
const staging = path.join(release, name);
const zipPath = path.join(release, `${name}.zip`);

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  // pnpm is a .cmd on Windows and needs a shell; pass one string so Node does not warn about
  // unescaped args (none of ours contain spaces or quotes).
  const r = opts.shell
    ? spawnSync(`${cmd} ${args.join(" ")}`, { stdio: "inherit", ...opts })
    : spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) {
    console.error(`${cmd} failed with exit code ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

// 1. Build everything.
run("pnpm", ["build"], { shell: true });

// 2. Fresh staging directory.
rmSync(staging, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(path.join(staging, "app", "packages", "server"), { recursive: true });
mkdirSync(path.join(staging, "app", "packages", "web"), { recursive: true });
mkdirSync(path.join(staging, "node"), { recursive: true });
mkdirSync(cache, { recursive: true });

// 3. App code.
cpSync(path.join(root, "packages/server/dist"), path.join(staging, "app/packages/server/dist"), { recursive: true });
cpSync(path.join(root, "packages/web/dist"), path.join(staging, "app/packages/web/dist"), { recursive: true });

// 4. Production dependencies, hoisted into a plain node_modules (zip-friendly, no symlinks).
const serverPkg = JSON.parse(readFileSync(path.join(root, "packages/server/package.json"), "utf8"));
const deps = Object.fromEntries(Object.entries(serverPkg.dependencies).filter(([n]) => !n.startsWith("@katsu-magi/")));
writeFileSync(
  path.join(staging, "app", "package.json"),
  JSON.stringify({ name: "katsu-magi-app", version, private: true, type: "module", dependencies: deps }, null, 2),
);
// A flat node_modules without symlinks/junctions: zip tools and other machines handle it reliably.
// Settings go on the command line because --ignore-workspace (needed: this folder sits inside the
// repo) also makes pnpm skip a local pnpm-workspace.yaml.
run(
  "pnpm",
  [
    "install",
    "--prod",
    "--ignore-scripts",
    "--ignore-workspace",
    "--config.node-linker=hoisted",
    "--config.shamefully-hoist=true",
    "--config.minimum-release-age=0",
  ],
  { cwd: path.join(staging, "app"), shell: true },
);
// Sanity check: a hoisted layout has no symlinks at the top level (pnpm keeps only .pnpm/lock.yaml).
const nm = path.join(staging, "app", "node_modules");
const links = readdirSync(nm).filter((e) => lstatSync(path.join(nm, e)).isSymbolicLink());
if (links.length > 0) {
  console.error(`node_modules is not hoisted; symlinks found: ${links.slice(0, 5).join(", ")}`);
  process.exit(1);
}

// 5. Node runtime (node.exe only) from the official zip, cached under release/cache.
const nodeZip = path.join(cache, `node-${nodeVersion}-win-x64.zip`);
if (!existsSync(nodeZip)) {
  const url = `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-win-x64.zip`;
  console.log(`> download ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`download failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  writeFileSync(nodeZip, Buffer.from(await res.arrayBuffer()));
}
run(TAR, ["-xf", nodeZip, "-C", path.join(staging, "node"), "--strip-components=1", `node-${nodeVersion}-win-x64/node.exe`, `node-${nodeVersion}-win-x64/LICENSE`]);

// 6. Editable files: selectors and config, plus the changelog so recipients can see what changed.
cpSync(path.join(root, "packages/server/src/sites/selectors"), path.join(staging, "selectors"), { recursive: true });
cpSync(path.join(root, "katsu-magi.config.example.json"), path.join(staging, "katsu-magi.config.json"));
cpSync(path.join(root, "CHANGELOG.md"), path.join(staging, "CHANGELOG.md"));

// 7. Launchers.
writeFileSync(
  path.join(staging, "katsu-magi.cmd"),
  [
    // ASCII only: cmd.exe mis-parses multibyte text in batch files under some code pages.
    "@echo off",
    "setlocal",
    'set "ROOT=%~dp0"',
    'set "KATSU_MAGI_CONFIG=%ROOT%katsu-magi.config.json"',
    'set "KATSU_MAGI_SELECTORS_DIR=%ROOT%selectors"',
    "title katsu-magi",
    "echo Starting katsu-magi. Keep this window open (closing it stops katsu-magi).",
    "echo If the UI does not open, browse to http://localhost:5175",
    "echo.",
    '"%ROOT%node\\node.exe" "%ROOT%app\\packages\\server\\dist\\index.js"',
    "if errorlevel 1 (",
    "  echo.",
    "  echo katsu-magi stopped with an error. See the messages above and README.txt.",
    "  pause",
    ")",
    "",
  ].join("\r\n"),
);
writeFileSync(
  path.join(staging, "katsu-magi-cli.cmd"),
  [
    "@echo off",
    "setlocal",
    'set "ROOT=%~dp0"',
    'set "KATSU_MAGI_CONFIG=%ROOT%katsu-magi.config.json"',
    'set "KATSU_MAGI_SELECTORS_DIR=%ROOT%selectors"',
    'if "%~1"=="" (',
    "  echo usage: katsu-magi-cli.cmd ^<command^> [args]   - stop katsu-magi.cmd first",
    "  echo   selectors:check chatgpt      check whether the selectors still match the site",
    "  echo   selectors:probe chatgpt      list candidate elements on the page",
    '  echo   adapter:test chatgpt "hello"  send one prompt to one site',
    "  echo   login                        open the three sites to log in",
    "  pause",
    "  exit /b 1",
    ")",
    '"%ROOT%node\\node.exe" "%ROOT%app\\packages\\server\\dist\\cli.js" %*',
    "pause",
    "",
  ].join("\r\n"),
);

// 8. Recipient README.
writeFileSync(
  path.join(staging, "README.txt"),
  `katsu-magi ${version}  (Windows 64bit 向けポータブル版)
=====================================================

ChatGPT / Gemini / Claude の Web サイトに同じ質問を同時に送り、回答を横に並べて見比べるツールです。
あなたがログインした本物の Chrome を自動操作します。各サービスの契約プランをそのまま使い、追加料金はかかりません。

必要なもの
----------
- Windows 10 / 11
- Google Chrome（インストール済みであること）
- ChatGPT / Gemini / Claude のアカウント

インストールは不要です。Node.js などもこのフォルダに同梱しています。

使い方
------
1. このフォルダを、パスに日本語や空白を含まない場所に置くと安全です（例: C:\\tools\\katsu-magi）。
2. katsu-magi.cmd をダブルクリックします。黒い窓と Chrome が開き、続いてブラウザに katsu-magi の画面が開きます。
   開かない場合はブラウザで http://localhost:5175 を開いてください。
3. 初回は各カラムが「needs login」になります。開いた Chrome の窓で 3 つのサイトにログインし、画面の Retry を押してください。
   ログイン情報は katsu-magi 専用の Chrome プロファイル（%LOCALAPPDATA%\\katsu-magi）に保存され、次回からは不要です。
4. 下の入力欄に質問を書いて Send（または Ctrl+Enter）。3 つのカラムに回答が流れてきます。
5. そのまま追い質問すると、各サイトの同じ会話に送られます。「New conversation」で全サイトの会話を新しくします。
6. 終了するときは黒い窓を閉じてください。Chrome も一緒に閉じます。

うまく動かないとき
------------------
- カラムが「needs login」「blocked」: Chrome の窓でログインや「私はロボットではありません」を済ませ、Retry を押す。
- カラムが「error」で「selector ... not found」と出る: そのサイトの画面構成が変わりました。
  配布元から新しい selectors\\<サイト名>.json を受け取り、このフォルダの selectors\\ 内のファイルを上書きしてください。
  再起動は不要で、次の送信から反映されます。
- 「Chrome could not be started」: katsu-magi 用の Chrome が別に残っています。黒い窓を閉じ、タスクマネージャーで chrome.exe を終了してから再実行してください。
- 設定（ポート番号、待ち時間など）は katsu-magi.config.json で変更できます。
- この版で何が変わったかは CHANGELOG.md に書いてあります。

注意
----
各サービスの利用規約は、Web 画面の自動操作を認めていない場合があります。
このツールは個人が自分のアカウントで、人が操作するのと同じ程度の頻度で使うことを前提にしています。
アカウント制限などのリスクは利用者自身の判断でご利用ください。
`,
);

// 9. Zip (bsdtar on Windows picks the format from the extension).
run(TAR, ["-a", "-c", "-f", zipPath, "-C", release, name]);

const size = statSync(zipPath).size;
console.log(`\ndone: ${zipPath} (${(size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`staging folder: ${staging}`);
