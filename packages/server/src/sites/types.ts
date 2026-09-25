import type { Page } from "playwright-core";
import type { SiteId } from "@katsu-magi/shared";

export type Readiness =
  | { state: "ready" }
  | { state: "needs-login"; url: string }
  | { state: "blocked"; reason: "cloudflare" | "captcha" | "unknown"; url: string };

/** `text` is always the full answer captured so far (a snapshot), never a delta. */
export interface AnswerChunk {
  text: string;
  done: boolean;
}

export interface LlmSiteAdapter {
  readonly id: SiteId;
  /** Bind the tab; navigate to the site's home if the tab is elsewhere. */
  attach(page: Page): Promise<void>;
  ensureReady(): Promise<Readiness>;
  newConversation(): Promise<void>;
  /** Reopen a past conversation by its URL, so follow-up prompts continue it. */
  openConversation(url: string): Promise<void>;
  send(prompt: string, signal: AbortSignal): AsyncIterable<AnswerChunk>;
  /** Click the site's stop button if a generation is running. */
  cancel(): Promise<void>;
  /** URL of the current conversation, if the site exposes one. */
  conversationUrl(): string | undefined;
}

export type AdapterErrorCode =
  | "NEEDS_LOGIN"
  | "BLOCKED"
  | "RATE_LIMITED"
  | "SELECTOR_NOT_FOUND"
  | "TIMEOUT_FIRST_TOKEN"
  | "TIMEOUT_GENERATION"
  | "PAGE_CLOSED"
  | "CANCELLED"
  | "UNKNOWN";

export interface AdapterErrorDetail {
  selectorKey?: string | undefined;
  candidates?: string[] | undefined;
  url?: string | undefined;
  screenshot?: string | undefined;
  /** Partial answer captured before the failure, if any. */
  partialText?: string | undefined;
}

export class AdapterError extends Error {
  constructor(
    public readonly code: AdapterErrorCode,
    public readonly site: SiteId,
    message: string,
    public readonly detail: AdapterErrorDetail = {},
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export function isAdapterError(err: unknown): err is AdapterError {
  return err instanceof AdapterError;
}

/** What one `readAnswer()` poll observed in the page. */
export interface Reading {
  exists: boolean;
  text: string;
  html: string;
  generating: boolean;
  /** "visible" or "hidden": a hidden tab that also stops producing text points at throttling. */
  visibility?: string;
}
