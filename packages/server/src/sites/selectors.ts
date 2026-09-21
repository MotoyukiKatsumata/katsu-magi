import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { SiteId } from "@katsu-magi/shared";
import { findRepoRoot } from "../config.js";

const candidates = z.array(z.string().min(1)).min(1);

export const siteSelectorsSchema = z.object({
  urls: z.object({ home: z.string().url(), newChat: z.string().url() }),
  /** Substrings matched against the page URL to detect a login page. */
  loginUrlPatterns: z.array(z.string()).default([]),
  input: candidates,
  sendButton: candidates,
  stopButton: candidates,
  assistantMessage: candidates,
  /** Relative to assistantMessage. Optional: falls back to the message element itself. */
  messageBody: z.array(z.string()).default([]),
  loginIndicator: z.array(z.string()).default([]),
  challengeIndicator: z.array(z.string()).default([]),
  /** Regexes (case-insensitive) matched against alert / page text when no answer arrives. */
  rateLimitPatterns: z.array(z.string()).default([]),
  /** Selectors removed from the answer HTML before markdown conversion. */
  stripFromHtml: z.array(z.string()).default([]),
  /** Attribute on assistantMessage whose value signals completion (e.g. Claude's data-is-streaming="false"). */
  doneAttribute: z.object({ attr: z.string(), value: z.string() }).optional(),
});

export type SiteSelectors = z.infer<typeof siteSelectorsSchema>;

export type SelectorKey =
  | "input"
  | "sendButton"
  | "stopButton"
  | "assistantMessage"
  | "messageBody"
  | "loginIndicator"
  | "challengeIndicator"
  | "stripFromHtml";

/** Must match on an empty, logged-in chat page. (assistantMessage only exists once an answer is on screen.) */
export const REQUIRED_SELECTOR_KEYS: SelectorKey[] = ["input", "sendButton"];
export const ALL_SELECTOR_KEYS: SelectorKey[] = [
  "input",
  "sendButton",
  "stopButton",
  "assistantMessage",
  "messageBody",
  "loginIndicator",
  "challengeIndicator",
  "stripFromHtml",
];

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where the selector JSON files live. Users edit the copies under packages/server/src so those win
 * when present (dev and a git clone); the copy next to the bundle (dist/selectors) is the fallback.
 * KATSU_MAGI_SELECTORS_DIR overrides everything.
 */
export function selectorsDir(): string {
  if (process.env.KATSU_MAGI_SELECTORS_DIR) return path.resolve(process.env.KATSU_MAGI_SELECTORS_DIR);
  const candidates = [
    path.join(findRepoRoot(), "packages", "server", "src", "sites", "selectors"),
    path.join(here, "selectors"), // running from src/sites (tsx) or from dist (bundle)
    path.join(here, "sites", "selectors"),
  ];
  return candidates.find((d) => existsSync(path.join(d, "chatgpt.json"))) ?? candidates[0]!;
}

export function selectorsPath(site: SiteId): string {
  return path.join(selectorsDir(), `${site}.json`);
}

/** Read and validate the selector file. Called on every send() so edits apply without a restart. */
export function loadSelectors(site: SiteId): SiteSelectors {
  const file = selectorsPath(site);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`cannot read selector file ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = siteSelectorsSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid selector file ${file}: ${parsed.error.message}`);
  return parsed.data;
}
