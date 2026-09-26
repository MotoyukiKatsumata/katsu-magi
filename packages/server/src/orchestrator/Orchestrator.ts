import { EventEmitter } from "node:events";
import {
  SITE_IDS,
  type ServerMsg,
  type Session,
  type SiteId,
  type SiteState,
  type SiteStatus,
  type StateMsg,
  type StoredAnswer,
  type StoredTurn,
} from "@katsu-magi/shared";
import type { BrowserManager } from "../browser/BrowserManager.js";
import type { Config } from "../config.js";
import type { HistoryStore } from "../history/HistoryStore.js";
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
  /** The history session the tabs are on. Undefined until the next prompt starts a new one. */
  private sessionId: string | undefined;

  constructor(
    private readonly adapters: Map<SiteId, LlmSiteAdapter>,
    private readonly browser: Pick<BrowserManager, "isRunning" | "isVisible" | "getPage" | "bringToFront" | "setVisible" | "restart">,
    cfg: Pick<Config, "sites">,
    private readonly log: Logger,
    private readonly history?: HistoryStore,
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
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
    };
  }

  currentSessionId(): string | undefined {
    return this.sessionId;
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
    // The next prompt starts a new history session.
    this.sessionId = undefined;
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
    this.emit("message", this.snapshot());
  }

  async ask(requestId: string, prompt: string, sites: SiteId[], resumeSessionId?: string): Promise<void> {
    if (this.inFlight) throw new BusyError(this.inFlight.requestId);
    const targets = sites.filter((s) => this.sites.get(s)?.enabled && this.adapters.has(s));
    if (targets.length === 0) return;

    // Typing into a past conversation the user was only looking at: put the tabs back on it
    // first, so the prompt continues that thread instead of whatever the tabs were showing.
    if (resumeSessionId && resumeSessionId !== this.sessionId) {
      const session = this.history?.get(resumeSessionId);
      if (!session) {
        // Never append to the wrong conversation just because the old one went missing.
        this.emit("message", {
          type: "error",
          requestId,
          code: "SESSION_NOT_FOUND",
          message: "続ける会話が履歴に見つかりませんでした。送信を中止しました。",
        });
        return;
      }
      await this.resumeTabs(session);
      this.sessionId = session.id;
      this.emit("message", this.snapshot());
    }

    const controller = new AbortController();
    this.inFlight = { requestId, controller };
    if (this.history && !this.sessionId) this.sessionId = this.history.create(prompt).id;
    this.emit("message", this.snapshot());

    // Collected while the sites run, then written to history as one turn.
    const answers: Partial<Record<SiteId, StoredAnswer>> = {};
    for (const site of targets) answers[site] = { text: "", status: "typing" };

    try {
      await fanout(targets, this.adapters, prompt, controller.signal, {
        onStatus: (site, status) => {
          this.setStatus(site, status);
          const a = answers[site];
          if (a) a.status = status;
        },
        onAnswer: (site, text, done) => {
          const a = answers[site];
          if (a) {
            a.text = text;
            if (done) a.status = "done";
          }
          this.emit("message", { type: "answer", requestId, site, text, done });
        },
        onError: (site, err) => {
          const a = answers[site];
          if (a) a.error = err.message;
          this.reportError(requestId, site, err);
        },
      });
    } finally {
      this.inFlight = undefined;
      this.saveTurn(requestId, prompt, targets, answers);
      this.emit("message", this.snapshot());
    }
  }

  /** Record the finished turn and where each site's conversation now lives (for resuming). */
  private saveTurn(requestId: string, prompt: string, targets: SiteId[], answers: Partial<Record<SiteId, StoredAnswer>>): void {
    if (!this.history || !this.sessionId) return;
    try {
      for (const site of targets) {
        const a = answers[site];
        // A site's live status is the truth at this point; a cancelled run shows as idle.
        if (a) a.status = this.sites.get(site)?.status ?? a.status;
      }
      const turn: StoredTurn = { requestId, prompt, createdAt: new Date().toISOString(), answers };
      this.history.appendTurn(this.sessionId, turn);

      const urls: Partial<Record<SiteId, string>> = {};
      for (const site of targets) {
        const url = this.adapters.get(site)?.conversationUrl();
        if (url) urls[site] = url;
      }
      if (Object.keys(urls).length > 0) this.history.setConversationUrls(this.sessionId, urls);
      this.emit("message", { type: "sessions", items: this.history.list() });
    } catch (err) {
      this.log.warn({ err }, "history: could not save the turn");
    }
  }

  // ------------------------------------------------------------------ history

  listSessions(): ServerMsg {
    return { type: "sessions", items: this.history?.list() ?? [] };
  }

  /**
   * The conversation the tabs are on, ready to be shown in the columns.
   *
   * A client that connects after the server resumed a conversation (at startup, say) would
   * otherwise see empty columns while the sidebar marks that conversation as the one on display.
   */
  currentSessionMessage(): ServerMsg | undefined {
    const session = this.sessionId ? this.history?.get(this.sessionId) : undefined;
    return session ? { type: "session", session, resumed: true } : undefined;
  }

  /**
   * `resume: false` only returns the stored conversation for viewing.
   * `resume: true` also navigates every site's tab back to that conversation, so the next
   * prompt continues it. Sites with no stored URL fall back to a fresh chat.
   */
  async openSession(id: string, resume: boolean): Promise<{ session: Session | undefined; resumed: boolean }> {
    const session = this.history?.get(id);
    if (!session || !resume) return { session, resumed: false };
    if (this.inFlight) throw new BusyError(this.inFlight.requestId);

    await this.resumeTabs(session);
    this.sessionId = id;
    this.emit("message", this.snapshot());
    // Every client follows the tabs, including ones that were not the requester and ones that
    // connected before the server resumed on its own at startup.
    this.emit("message", { type: "session", session, resumed: true });
    return { session, resumed: true };
  }

  /** Point every enabled site's tab at this conversation. Sites with no stored URL start fresh. */
  private async resumeTabs(session: Session): Promise<void> {
    await Promise.allSettled(
      this.enabledSites().map(async (site) => {
        const adapter = this.adapters.get(site);
        if (!adapter) return;
        const url = session.conversationUrls[site];
        try {
          if (url) await adapter.openConversation(url);
          else await adapter.newConversation();
          await this.probe(site);
        } catch (err) {
          this.setStatus(site, "error", `過去の会話を開けませんでした: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    );
  }

  deleteSession(id: string): ServerMsg {
    this.history?.remove(id);
    if (this.sessionId === id) this.sessionId = undefined;
    return this.listSessions();
  }

  renameSession(id: string, title: string): ServerMsg {
    this.history?.rename(id, title);
    return this.listSessions();
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
