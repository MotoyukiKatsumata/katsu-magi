// Bundles the server with esbuild so `node dist/index.js` works without tsx:
// - @katsu-magi/shared (workspace TS source) is bundled in
// - every other dependency stays external (playwright-core, fastify, pino, ...)
// - selector JSON files are copied next to the bundle as a fallback copy
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => d !== "@katsu-magi/shared");

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["src/index.ts", "src/cli.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  external,
  logLevel: "info",
});

cpSync("src/sites/selectors", "dist/selectors", { recursive: true });
console.log("copied selectors -> dist/selectors");
