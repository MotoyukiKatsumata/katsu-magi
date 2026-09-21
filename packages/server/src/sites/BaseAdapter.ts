import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright-core";
import type { SiteId } from "@katsu-magi/shared";
import { dataDir, type Timeouts } from "../config.js";
import type { Logger } from "../logger.js";
import { FirstTokenTimeoutError, GenerationWatcher, WatchCancelledError } from "./GenerationWatcher.js";
import { htmlToMarkdown } from "./html-to-markdown.js";
import { loadSelectors, type SelectorKey, type SiteSelectors } from "./selectors.js";
import { AdapterError, type AnswerChunk, type LlmSiteAdapter, type Readiness, type Reading } from "./types.js";

/**
 * Implements the whole send / watch / extract flow once. Site classes only override hooks
 * (and most differences live in the selector JSON, not in code).
 */
export abstract class BaseAdapter implements LlmSiteAdapter {
  protected page!: Page;
  protected sel: SiteSelectors;
  private readonly watcher: GenerationWatcher;

  constructor(
    public readonly id: SiteId,
    protected readonly timeouts: Timeouts,
    protected readonly log: Logger,
  ) {
    this.sel = loadSelectors(id);
    this.watcher = new GenerationWatcher(timeouts);
  }

  // ------------------------------------------------------------------ lifecycle

  async attach(page: Page): Promise<void> {
    this.page = page;
    this.reloadSelectors();
    if (!this.isOnSite()) {
      await this.goto(this.sel.urls.home);
    }
  }

  async ensureReady(): Promise<Readiness> {
    this.assertPageOpen();
    this.reloadSelectors();
    if (!this.isOnSite()) await this.goto(this.sel.urls.home);

    const input = this.locatorFor("input");
    const login = this.optionalLocator("loginIndicator");
    const challenge = this.optionalLocator("challengeIndicator");

    // Race: whichever of input / login page / challenge shows up first decides.
    let race = input;
    if (login) race = race.or(login);
    if (challenge) race = race.or(challenge);
    try {
      await race.first().waitFor({ state: "visible", timeout: this.timeouts.readyMs });
    } catch {
      // Nothing visible: fall through to URL-based checks below.
    }

    // A visible login control wins even when an (anonymous) composer is also visible: the user
    // wants their own account, not the logged-out trial mode some sites offer.
    const url = this.page.url();
    if (this.isLoginUrl(url) || (login && (await this.anyVisible(login)))) {
      return { state: "needs-login", url };
    }
    if (challenge && (await this.anyVisible(challenge))) {
      return { state: "blocked", reason: "cloudflare", url };
    }
    if (await this.anyVisible(input)) {
      return { state: "ready" };
    }
    this.log.warn({ site: this.id, url, screenshot: await this.screenshot("not-ready") }, "page is neither ready nor a login page");
    return { state: "blocked", reason: "unknown", url };
  }

  /** True when at least one element matched by `loc` is visible (not just the first match). */
  protected async anyVisible(loc: Locator): Promise<boolean> {
    try {
      return (await loc.filter({ visible: true }).count()) > 0;
    } catch {
      return false;
    }
  }

  async newConversation(): Promise<void> {
    this.assertPageOpen();
    this.reloadSelectors();
    await this.goto(this.sel.urls.newChat);
    await this.locatorFor("input").first().waitFor({ state: "visible", timeout: this.timeouts.readyMs }).catch(() => undefined);
  }

  async cancel(): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    const stop = this.locatorFor("stopButton").first();
    if (await stop.isVisible().catch(() => false)) {
      await stop.click({ timeout: 2_000 }).catch(() => undefined);
    }
  }

  conversationUrl(): string | undefined {
    if (!this.page || this.page.isClosed()) return undefined;
    const url = this.page.url();
    return url === this.sel.urls.newChat || url === this.sel.urls.home ? undefined : url;
  }

  // ------------------------------------------------------------------ send

  async *send(prompt: string, signal: AbortSignal): AsyncIterable<AnswerChunk> {
    this.assertPageOpen();
    this.reloadSelectors();

    const ready = await this.ensureReady();
    if (ready.state === "needs-login") throw new AdapterError("NEEDS_LOGIN", this.id, "login required", { url: ready.url });
    if (ready.state === "blocked") throw new AdapterError("BLOCKED", this.id, `blocked (${ready.reason})`, { url: ready.url });

    const before = await this.countAssistant();
    await this.typePrompt(prompt);
    await this.submit();
    this.log.debug({ site: this.id, before }, "prompt submitted");

    let lastText = "";
    try {
      for await (const snap of this.watcher.run(() => this.readAnswer(before), signal)) {
        lastText = snap.text;
        if (!snap.done) {
          yield { text: snap.text, done: false };
          continue;
        }
        const markdown = this.toMarkdown(snap.html, snap.text);
        if (snap.outcome === "timeout-generation") {
          throw new AdapterError("TIMEOUT_GENERATION", this.id, "generation did not finish in time", { partialText: markdown });
        }
        yield { text: markdown, done: true };
        return;
      }
    } catch (err) {
      if (err instanceof WatchCancelledError) {
        await this.cancel();
        throw new AdapterError("CANCELLED", this.id, "cancelled", { partialText: err.partialText });
      }
      if (err instanceof FirstTokenTimeoutError) {
        const limit = await this.detectRateLimit();
        if (limit) throw new AdapterError("RATE_LIMITED", this.id, limit);
        throw new AdapterError("TIMEOUT_FIRST_TOKEN", this.id, "no answer appeared", {
          url: this.page.url(),
          screenshot: await this.screenshot("first-token"),
        });
      }
      if (err instanceof AdapterError) throw err;
      if (this.page.isClosed()) throw new AdapterError("PAGE_CLOSED", this.id, "tab was closed", { partialText: lastText });
      throw new AdapterError("UNKNOWN", this.id, err instanceof Error ? err.message : String(err), { partialText: lastText });
    }
  }

  // ------------------------------------------------------------------ hooks (override per site when needed)

  protected async typePrompt(prompt: string): Promise<void> {
    const input = await this.locate("input");
    await input.click({ timeout: 5_000 });
    try {
      await input.fill(prompt, { timeout: 5_000 });
    } catch {
      // Some contenteditable editors reject fill(); fall back to typing through the keyboard.
      await this.page.keyboard.press("Control+A");
      await this.page.keyboard.insertText(prompt);
    }
  }

  /** Always click the send button: Enter inserts a newline on some sites. */
  protected async submit(): Promise<void> {
    const button = await this.locate("sendButton");
    await button.click({ timeout: 5_000 });
  }

  protected async countAssistant(): Promise<number> {
    const sel = await this.firstMatching("assistantMessage");
    if (!sel) return 0;
    return this.page.locator(sel).count();
  }

  /** One page.evaluate per poll: cheaper than several round-trips. */
  protected async readAnswer(index: number): Promise<Reading> {
    const msgSel = (await this.firstMatching("assistantMessage")) ?? this.sel.assistantMessage.join(", ");
    const bodySel = this.sel.messageBody.join(", ");
    const stopSel = this.sel.stopButton.join(", ");
    const stripSel = this.sel.stripFromHtml.join(", ");
    const doneAttr = this.sel.doneAttribute ?? null;

    return this.page.evaluate(
      ({ msgSel, bodySel, stopSel, stripSel, doneAttr, index }) => {
        const messages = document.querySelectorAll(msgSel);
        const msg = messages[index] as HTMLElement | undefined;
        if (!msg) return { exists: false, text: "", html: "", generating: true };
        const body = (bodySel ? (msg.querySelector(bodySel) as HTMLElement | null) : null) ?? msg;

        // Is a generation still running? Stop button visible, or the site's own "streaming" attribute.
        const stop = stopSel ? (document.querySelector(stopSel) as HTMLElement | null) : null;
        const stopVisible = !!stop && stop.getClientRects().length > 0;
        let generating = stopVisible;
        if (doneAttr) {
          const v = msg.getAttribute(doneAttr.attr);
          if (v !== null) generating = v !== doneAttr.value || stopVisible;
        }

        // HTML for the final markdown conversion: strip UI chrome on a detached clone.
        let html = body.innerHTML ?? "";
        if (stripSel) {
          const clone = body.cloneNode(true) as HTMLElement;
          clone.querySelectorAll(stripSel).forEach((el) => el.remove());
          html = clone.innerHTML;
        }
        return { exists: true, text: body.innerText ?? "", html, generating };
      },
      { msgSel, bodySel, stopSel, stripSel, doneAttr, index },
    );
  }

  protected toMarkdown(html: string, fallbackText: string): string {
    try {
      const md = htmlToMarkdown(html);
      return md.length > 0 ? md : fallbackText.trim();
    } catch (err) {
      this.log.warn({ site: this.id, err }, "markdown conversion failed; using plain text");
      return fallbackText.trim();
    }
  }

  // ------------------------------------------------------------------ helpers

  protected reloadSelectors(): void {
    try {
      this.sel = loadSelectors(this.id);
    } catch (err) {
      this.log.error({ site: this.id, err }, "selector reload failed; keeping previous selectors");
    }
  }

  protected isOnSite(): boolean {
    const home = new URL(this.sel.urls.home);
    let current: URL;
    try {
      current = new URL(this.page.url());
    } catch {
      return false;
    }
    return current.hostname === home.hostname;
  }

  protected isLoginUrl(url: string): boolean {
    return this.sel.loginUrlPatterns.some((p) => url.includes(p));
  }

  protected async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  protected locatorFor(key: SelectorKey): Locator {
    return this.page.locator(this.sel[key].join(", "));
  }

  protected optionalLocator(key: SelectorKey): Locator | undefined {
    return this.sel[key].length > 0 ? this.locatorFor(key) : undefined;
  }

  /** First candidate selector that currently matches at least one element, or undefined. */
  protected async firstMatching(key: SelectorKey): Promise<string | undefined> {
    for (const candidate of this.sel[key]) {
      if ((await this.page.locator(candidate).count()) > 0) return candidate;
    }
    return undefined;
  }

  /** Resolve a required element, trying candidates in order; throws SELECTOR_NOT_FOUND with diagnostics. */
  protected async locate(key: SelectorKey, timeoutMs = 5_000): Promise<Locator> {
    const candidates = this.sel[key];
    const deadline = Date.now() + timeoutMs;
    do {
      for (const candidate of candidates) {
        const loc = this.page.locator(candidate).first();
        if (await loc.isVisible().catch(() => false)) return loc;
      }
      await this.page.waitForTimeout(150);
    } while (Date.now() < deadline);

    throw new AdapterError("SELECTOR_NOT_FOUND", this.id, `selector "${key}" not found on ${this.id}`, {
      selectorKey: key,
      candidates: [...candidates],
      url: this.page.url(),
      screenshot: await this.screenshot(key),
    });
  }

  protected async detectRateLimit(): Promise<string | undefined> {
    if (this.sel.rateLimitPatterns.length === 0) return undefined;
    const text = await this.page
      .evaluate(() => {
        const alerts = Array.from(document.querySelectorAll('[role="alert"], [role="status"], [aria-live]'))
          .map((e) => (e as HTMLElement).innerText)
          .join("\n");
        return alerts || document.body.innerText.slice(-4000);
      })
      .catch(() => "");
    for (const p of this.sel.rateLimitPatterns) {
      const m = new RegExp(p, "i").exec(text);
      if (m) return m[0];
    }
    return undefined;
  }

  protected async screenshot(tag: string): Promise<string | undefined> {
    try {
      const dir = path.join(dataDir(), "logs");
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = path.join(dir, `${stamp}-${this.id}-${tag}.png`);
      await this.page.screenshot({ path: file, fullPage: false });
      return file;
    } catch {
      return undefined;
    }
  }

  private assertPageOpen(): void {
    if (!this.page) throw new AdapterError("UNKNOWN", this.id, "adapter not attached to a page");
    if (this.page.isClosed()) throw new AdapterError("PAGE_CLOSED", this.id, "tab was closed");
  }
}
