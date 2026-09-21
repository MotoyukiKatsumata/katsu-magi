import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import type { ChildProcess } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import type { SiteId } from "@katsu-magi/shared";
import type { BrowserConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { findChromeExecutable, killChrome, killStaleChrome, spawnChrome } from "./chrome.js";
import { setWindowState } from "./window.js";

export type BrowserEvents = { closed: []; pageClosed: [SiteId] };

/**
 * Owns the Chrome connection and hands out one long-lived tab per site.
 *
 * mode "launch":  we spawn the installed Chrome with a DevTools port and the katsu-magi profile,
 *                 then attach over CDP. Chrome is killed on stop().
 * mode "connect": attach to a Chrome the user started (scripts/start-chrome.cmd); left running on stop().
 *
 * Adapters never learn which mode is active.
 */
export class BrowserManager extends EventEmitter<BrowserEvents> {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private child: ChildProcess | undefined;
  private pages = new Map<SiteId, Page>();
  private visible = true;
  private stopping = false;

  constructor(
    private readonly cfg: BrowserConfig,
    private readonly log: Logger,
  ) {
    super();
  }

  isRunning(): boolean {
    return this.context !== undefined && this.browser?.isConnected() === true;
  }

  isVisible(): boolean {
    return this.visible;
  }

  async start(): Promise<void> {
    if (this.isRunning()) return;

    let cdpUrl = this.cfg.cdpUrl;
    if (this.cfg.mode === "launch") {
      mkdirSync(this.cfg.userDataDir, { recursive: true });
      const executablePath = findChromeExecutable(this.cfg.executablePath);
      // The katsu-magi profile belongs to this process; a Chrome left behind by a hard-killed
      // server would otherwise lock the profile and make the new launch fail.
      const stale = await killStaleChrome(this.cfg.userDataDir);
      if (stale > 0) {
        this.log.warn({ stale }, "killed leftover Chrome processes holding the katsu-magi profile");
        await new Promise((r) => setTimeout(r, 1000));
      }
      this.log.info({ executablePath, userDataDir: this.cfg.userDataDir }, "starting Chrome");
      try {
        const spawned = await spawnChrome({
          executablePath,
          userDataDir: this.cfg.userDataDir,
          startMinimized: this.cfg.startMinimized,
        });
        this.child = spawned.process;
        cdpUrl = spawned.cdpUrl;
      } catch (err) {
        throw new Error(
          `Chrome could not be started with the katsu-magi profile (${this.cfg.userDataDir}). ` +
            `If another Chrome is using that profile, close it (or run "taskkill /IM chrome.exe /F"). ` +
            `Detail: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      this.log.info({ cdpUrl }, "connecting to an already running Chrome");
    }

    try {
      this.browser = await chromium.connectOverCDP(cdpUrl, { timeout: 30_000 });
    } catch (err) {
      if (this.child) killChrome(this.child);
      this.child = undefined;
      throw new Error(
        this.cfg.mode === "connect"
          ? `Could not connect to Chrome at ${cdpUrl}. Start it with scripts/start-chrome.cmd first. (${err instanceof Error ? err.message : String(err)})`
          : `Chrome started but the CDP connection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const ctx = this.browser.contexts()[0];
    if (!ctx) {
      await this.stop();
      throw new Error("Chrome has no default browser context");
    }
    this.context = ctx;
    this.visible = !this.cfg.startMinimized;

    this.browser.once("disconnected", () => {
      if (!this.stopping) this.log.warn("Chrome disconnected");
      this.browser = undefined;
      this.context = undefined;
      this.pages.clear();
      this.emit("closed");
    });
  }

  /** One tab per site, created lazily and reused so each site keeps its conversation. */
  async getPage(site: SiteId): Promise<Page> {
    if (!this.context) throw new Error("browser is not running");
    const existing = this.pages.get(site);
    if (existing && !existing.isClosed()) return existing;

    // Reuse Chrome's initial about:blank tab before opening new ones.
    const taken = new Set(this.pages.values());
    const blank = this.context.pages().find((p) => p.url() === "about:blank" && !taken.has(p));
    const page = blank ?? (await this.context.newPage());
    page.on("close", () => {
      if (this.stopping) return;
      this.log.warn({ site }, "site tab closed");
      if (this.pages.get(site) === page) this.pages.delete(site);
      this.emit("pageClosed", site);
    });
    this.pages.set(site, page);
    return page;
  }

  async setVisible(visible: boolean): Promise<void> {
    if (!this.context) return;
    const page = [...this.pages.values()].find((p) => !p.isClosed()) ?? this.context.pages()[0];
    if (!page) return;
    await setWindowState(this.context, page, visible ? "normal" : "minimized");
    this.visible = visible;
  }

  async bringToFront(site: SiteId): Promise<void> {
    const page = this.pages.get(site);
    if (!page || page.isClosed()) return;
    await this.setVisible(true);
    await page.bringToFront();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    try {
      const browser = this.browser;
      const child = this.child;
      this.browser = undefined;
      this.context = undefined;
      this.child = undefined;
      this.pages.clear();
      // connectOverCDP: close() only drops the connection; the Chrome we spawned is killed explicitly.
      await browser?.close().catch(() => undefined);
      if (child) killChrome(child);
    } finally {
      this.stopping = false;
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await new Promise((r) => setTimeout(r, 1000));
    await this.start();
  }
}
