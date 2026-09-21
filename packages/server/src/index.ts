import { exec } from "node:child_process";
import { BrowserManager } from "./browser/BrowserManager.js";
import { loadConfig, resolveConfigPath } from "./config.js";
import { createHttpServer, findWebDist } from "./http.js";
import { logger } from "./logger.js";
import { Orchestrator } from "./orchestrator/Orchestrator.js";
import { createAdapters } from "./sites/registry.js";
import { registerWebSocket } from "./ws/handler.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  logger.info({ config: resolveConfigPath(), mode: cfg.browser.mode, profile: cfg.browser.userDataDir }, "katsu-magi starting");

  const browser = new BrowserManager(cfg.browser, logger.child({ component: "browser" }));
  const adapters = createAdapters(cfg, logger.child({ component: "adapter" }));
  const orch = new Orchestrator(adapters, browser, cfg, logger.child({ component: "orchestrator" }));

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
  if (browser.isRunning()) await orch.attachAll();

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
