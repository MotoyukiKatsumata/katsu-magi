import { exec } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BrowserManager } from "./browser/BrowserManager.js";
import { dataDir, loadConfig, resolveConfigPath } from "./config.js";
import { HistoryStore } from "./history/HistoryStore.js";
import { createHttpServer, findWebDist } from "./http.js";
import { logger } from "./logger.js";
import { Orchestrator } from "./orchestrator/Orchestrator.js";
import { createAdapters } from "./sites/registry.js";
import { registerWebSocket } from "./ws/handler.js";

/** Remembers which conversation the tabs were on, so a restart can pick it up again. */
const statePath = () => path.join(dataDir(), "state.json");

function readLastSessionId(): string | undefined {
  try {
    const file = statePath();
    if (!existsSync(file)) return undefined;
    const raw = JSON.parse(readFileSync(file, "utf8")) as { currentSessionId?: unknown };
    return typeof raw.currentSessionId === "string" ? raw.currentSessionId : undefined;
  } catch {
    return undefined;
  }
}

function writeLastSessionId(id: string | undefined): void {
  try {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(statePath(), JSON.stringify({ currentSessionId: id ?? null }, null, 2), "utf8");
  } catch {
    // losing this only costs the auto-resume on the next start
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  logger.info({ config: resolveConfigPath(), mode: cfg.browser.mode, profile: cfg.browser.userDataDir }, "katsu-magi starting");

  // Read this before anything can emit a state message: the first ones carry no session id and
  // would overwrite the record of where the previous run left off.
  const lastSessionId = cfg.history.resumeLastOnStart ? readLastSessionId() : undefined;

  const browser = new BrowserManager(cfg.browser, logger.child({ component: "browser" }));
  const adapters = createAdapters(cfg, logger.child({ component: "adapter" }));
  const history = cfg.history.enabled ? new HistoryStore(path.join(dataDir(), "history"), logger.child({ component: "history" })) : undefined;
  const orch = new Orchestrator(adapters, browser, cfg, logger.child({ component: "orchestrator" }), history);
  orch.on("message", (m) => {
    if (m.type === "state") writeLastSessionId(m.sessionId);
  });

  browser.on("pageClosed", (site) => orch.onPageClosed(site));
  browser.on("closed", () => orch.onBrowserClosed());

  // Start the HTTP server first so the UI can show "starting" while Chrome comes up.
  const app = await createHttpServer(logger);
  registerWebSocket(app, orch, logger.child({ component: "ws" }));
  await app.listen({ port: cfg.port, host: "127.0.0.1" });
  const url = `http://localhost:${cfg.port}`;
  logger.info({ url }, "http server listening");

  try {
    await browser.start();
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    orch.onBrowserClosed();
  }
  if (browser.isRunning()) {
    await orch.attachAll();
    // Put the tabs back on the conversation the previous run ended with, so follow-up prompts
    // continue it instead of starting over.
    if (history && lastSessionId && history.get(lastSessionId)) {
      logger.info({ sessionId: lastSessionId }, "resuming the last conversation");
      await orch
        .openSession(lastSessionId, true)
        .catch((err: unknown) => logger.warn({ err }, "could not resume the last conversation"));
    }
  }

  if (findWebDist() && !process.env.KATSU_MAGI_NO_OPEN) openInDefaultBrowser(url);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await app.close().catch(() => undefined);
    await browser.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

function openInDefaultBrowser(url: string): void {
  const cmd =
    process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => undefined);
}

main().catch((err) => {
  logger.fatal(err);
  process.exit(1);
});
