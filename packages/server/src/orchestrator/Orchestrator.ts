import { EventEmitter } from "node:events";
import { SITE_IDS, type ServerMsg, type SiteId, type SiteState, type SiteStatus, type StateMsg } from "@katsu-magi/shared";
import type { BrowserManager } from "../browser/BrowserManager.js";
import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import { AdapterError, type LlmSiteAdapter } from "../sites/types.js";
import { fanout } from "./strategies/fanout.js";

export class BusyError extends Error {
  constructor(public readonly requestId: string) {
    super(`request ${requestId} is still running`);
    this.name = "BusyError";
  }
}

interface InFlight {
  requestId: string;
  controller: AbortController;
}

/**
 * Sits above the adapters: owns per-site status, runs a strategy (Phase 1: fanout) and
 * turns everything into ServerMsg events for the WebSocket layer.
 */
export class Orchestrator extends EventEmitter<{ message: [ServerMsg] }> {
  private readonly sites = new Map<SiteId, SiteState>();
  private inFlight: InFlight | undefined;

  constructor(
    private readonly adapters: Map<SiteId, LlmSiteAdapter>,
    private readonly browser: Pick<BrowserManager, "isRunning" | "isVisible" | "getPage" | "bringToFront" | "setVisible" | "restart">,
    cfg: Pick<Config, "sites">,
    private readonly log: Logger,
  ) {
    super();
    for (const site of SITE_IDS) {
      this.sites.set(site, { enabled: cfg.sites[site].enabled, status: "starting" });
    }
  }

  // ------------------------------------------------------------------ state

  snapshot(): StateMsg {
    const sites = {} as Record<SiteId, SiteState>;
    for (const [id, s] of this.sites) sites[id] = { ...s };
    return {
      type: "state",
      sites,
      browser: { running: this.browser.isRunning(), visible: this.browser.isVisible() },
      ...(this.inFlight ? { busyRequestId: this.inFlight.requestId } : {}),
    };
  }

  isBusy(): boolean {
    return this.inFlight !== undefined;
  }

  enabledSites(): SiteId[] {
    return [...this.sites.entries()].filter(([, s]) => s.enabled).map(([id]) => id);
  }

  setEnabled(site: SiteId, enabled: boolean): void {
    const s = this.sites.get(site);
    if (!s) return;
    s.enabled = enabled;
    this.emit("message", this.snapshot());
  }

  private setStatus(site: SiteId, status: SiteStatus, message?: string): void {
    const s = this.sites.get(site);
    if (!s) return;
    s.status = status;
    if (message === undefined) delete s.message;
    else s.message = message;
    this.emit("message", { type: "siteStatus", site, status, ...(message !== undefined ? { message } : {}) });
  }

  // ------------------------------------------------------------------ lifecycle

  /** Attach every adapter to its tab and probe readiness. Called at boot and after a browser restart. */
  async attachAll(): Promise<void> {
    await Promise.allSettled([...this.adapters.keys()].map((site) => this.attachOne(site)));
    this.emit("message", this.snapshot());
  }

  private async attachOne(site: SiteId): Promise<void> {
    const adapter = this.adapters.get(site);
    if (!adapter) return;
    try {
      const page = await this.browser.getPage(site);
      await adapter.attach(page);
      await this.probe(site);
    } catch (err) {
      this.log.error({ site, err }, "attach failed");
      this.setStatus(site, "error", err instanceof Error ? err.message : String(err));
    }
  }

  /** Re-check readiness (after the user logged in manually, for instance). */
  async retry(site: SiteId): Promise<void> {
    const adapter = this.adapters.get(site);
    if (!adapter) return;
    try {
      // If the tab was closed, get a fresh one.
      const page = await this.browser.getPage(site);
      await adapter.attach(page);
      await this.probe(site);
    } catch (err) {
      this.setStatus(site, "error", err instanceof Error ? err.message : String(err));
    }
  }

  private async probe(site: SiteId): Promise<void> {
    const adapter = this.adapters.get(site)!;
    const ready = await adapter.ensureReady();
    switch (ready.state) {
      case "ready":
        this.setStatus(site, "idle");
        break;
      case "needs-login":
        this.setStatus(site, "needs-login", "Log in in the Chrome window, then press Retry");
        await this.browser.bringToFront(site).catch(() => undefined);
        break;
      case "blocked":
        this.setStatus(site, "blocked", `Blocked (${ready.reason}). Solve the check in the Chrome window, then press Retry`);
        await this.browser.bringToFront(site).catch(() => undefined);
        break;
    }
  }

  onPageClosed(site: SiteId): void {
    this.setStatus(site, "error", "Tab was closed. Press Retry to reopen it");
  }

  onBrowserClosed(): void {
    this.inFlight?.controller.abort();
    for (const site of this.sites.keys()) this.setStatus(site, "error", "Browser closed. Use Restart browser");
    this.emit("message", this.snapshot());
  }

  async restartBrowser(): Promise<void> {
    this.inFlight?.controller.abort();
    await this.browser.restart();
    await this.attachAll();
  }

  async setBrowserVisible(visible: boolean): Promise<void> {
    await this.browser.setVisible(visible);
    this.emit("message", this.snapshot());
  }

  // ------------------------------------------------------------------ conversation

  async newConversation(sites: SiteId[] = this.enabledSites()): Promise<void> {
    if (this.inFlight) throw new BusyError(this.inFlight.requestId);
    await Promise.allSettled(
      sites.map(async (site) => {
        const adapter = this.adapters.get(site);
        if (!adapter) return;
        try {
          await adapter.newConversation();
          await this.probe(site);
        } catch (err) {
          this.setStatus(site, "error", err instanceof Error ? err.message : String(err));
        }
      }),
    );
  }

  async ask(requestId: string, prompt: string, sites: SiteId[]): Promise<void> {
    if (this.inFlight) throw new BusyError(this.inFlight.requestId);
    const targets = sites.filter((s) => this.sites.get(s)?.enabled && this.adapters.has(s));
    if (targets.length === 0) return;

    const controller = new AbortController();
    this.inFlight = { requestId, controller };
    this.emit("message", this.snapshot());

    try {
      await fanout(targets, this.adapters, prompt, controller.signal, {
        onStatus: (site, status) => this.setStatus(site, status),
        onAnswer: (site, text, done) => this.emit("message", { type: "answer", requestId, site, text, done }),
        onError: (site, err) => this.reportError(requestId, site, err),
      });
    } finally {
      this.inFlight = undefined;
      this.emit("message", this.snapshot());
    }
  }

  async cancel(requestId: string): Promise<void> {
    if (!this.inFlight || this.inFlight.requestId !== requestId) return;
    this.inFlight.controller.abort();
  }

  private reportError(requestId: string, site: SiteId, err: AdapterError): void {
    this.log.warn({ site, code: err.code, detail: err.detail }, err.message);
    const statusFor: Partial<Record<AdapterError["code"], SiteStatus>> = {
      NEEDS_LOGIN: "needs-login",
      BLOCKED: "blocked",
      RATE_LIMITED: "rate-limited",
      CANCELLED: "idle",
    };
    const status = statusFor[err.code] ?? "error";
    const message =
      err.code === "SELECTOR_NOT_FOUND"
        ? `selector "${err.detail.selectorKey}" not found - run: pnpm katsu-magi selectors:check ${site}`
        : err.code === "CANCELLED"
          ? undefined
          : err.message;
    this.setStatus(site, status, message);
    this.emit("message", {
      type: "error",
      site,
      requestId,
      code: err.code,
      message: message ?? err.message,
      ...(err.detail.selectorKey ? { selectorKey: err.detail.selectorKey } : {}),
    });
    if (status === "needs-login" || status === "blocked") {
      void this.browser.bringToFront(site).catch(() => undefined);
    }
  }
}
