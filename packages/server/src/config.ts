import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SITE_IDS, type SiteId } from "@katsu-magi/shared";

const siteConfigSchema = z.object({ enabled: z.boolean().default(true) });

export const configSchema = z.object({
  port: z.number().int().positive().default(5175),
  browser: z
    .object({
      mode: z.enum(["launch", "connect"]).default("launch"),
      userDataDir: z.string().default(path.join("%LOCALAPPDATA%", "katsu-magi", "chrome-profile")),
      cdpUrl: z.string().url().default("http://127.0.0.1:9222"),
      startMinimized: z.boolean().default(false),
      /** Optional explicit path to chrome.exe. Defaults to Playwright's `channel: "chrome"` lookup. */
      executablePath: z.string().optional(),
    })
    .prefault({}),
  sites: z
    .object({
      chatgpt: siteConfigSchema.prefault({}),
      gemini: siteConfigSchema.prefault({}),
      claude: siteConfigSchema.prefault({}),
    })
    .prefault({}),
  timeouts: z
    .object({
      pollMs: z.number().int().positive().default(300),
      stableMs: z.number().int().positive().default(1500),
      firstTokenMs: z.number().int().positive().default(45_000),
      generationMs: z.number().int().positive().default(240_000),
      readyMs: z.number().int().positive().default(15_000),
    })
    .prefault({}),
});

export type Config = z.infer<typeof configSchema>;
export type BrowserConfig = Config["browser"];
export type Timeouts = Config["timeouts"];

/** Expand %VAR% (Windows) and $VAR / ${VAR} (POSIX) references using process.env. */
export function expandEnv(value: string): string {
  return value
    .replace(/%([^%]+)%/g, (m, name: string) => process.env[name] ?? m)
    .replace(/\$\{([^}]+)\}/g, (m, name: string) => process.env[name] ?? m)
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, name: string) => process.env[name] ?? m);
}

export function findRepoRoot(start = process.cwd()): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

export function resolveConfigPath(): string {
  if (process.env.KATSU_MAGI_CONFIG) return path.resolve(process.env.KATSU_MAGI_CONFIG);
  return path.join(findRepoRoot(), "katsu-magi.config.json");
}

export function loadConfig(configPath = resolveConfigPath()): Config {
  const raw = existsSync(configPath) ? (JSON.parse(readFileSync(configPath, "utf8")) as unknown) : {};
  const cfg = configSchema.parse(raw);
  cfg.browser.userDataDir = path.resolve(expandEnv(cfg.browser.userDataDir));
  if (cfg.browser.executablePath) cfg.browser.executablePath = expandEnv(cfg.browser.executablePath);
  return cfg;
}

export function enabledSites(cfg: Config): SiteId[] {
  return SITE_IDS.filter((id) => cfg.sites[id].enabled);
}

/** Directory for logs, screenshots and state: %LOCALAPPDATA%\katsu-magi */
export function dataDir(): string {
  const base = process.env.LOCALAPPDATA ?? process.env.XDG_DATA_HOME ?? path.join(process.env.HOME ?? ".", ".local", "share");
  return path.join(base, "katsu-magi");
}
