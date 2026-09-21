// Builds the web UI after `pnpm install` so that end users can run `pnpm start`
// without a separate build step. Set KATSU_MAGI_SKIP_BUILD=1 to skip (development).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

if (process.env.KATSU_MAGI_SKIP_BUILD || process.env.CI) {
  console.log("[katsu-magi] postinstall: build skipped");
  process.exit(0);
}
// Skip when a workspace package triggers this hook (only run from the repo root).
if (!existsSync("pnpm-workspace.yaml")) process.exit(0);

const r = spawnSync("pnpm", ["build"], { stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
