import type { Reading } from "./types.js";

export interface WatcherTimeouts {
  pollMs: number;
  stableMs: number;
  firstTokenMs: number;
  generationMs: number;
}

export type WatcherOutcome = "done" | "timeout-generation";

export interface Snapshot {
  text: string;
  html: string;
  done: boolean;
  /** Set on the final snapshot only. */
  outcome?: WatcherOutcome;
}

export class FirstTokenTimeoutError extends Error {
  constructor() {
    super("no answer appeared before the first-token timeout");
    this.name = "FirstTokenTimeoutError";
  }
}

export class WatchCancelledError extends Error {
  constructor(public readonly partialText: string) {
    super("generation watch cancelled");
    this.name = "WatchCancelledError";
  }
}

/**
 * Polls `read()` until the answer is complete.
 *
 * Done when ALL hold: the message exists, `generating` is false, and the text has been
 * unchanged for `stableMs` and is non-empty. Stop-button-only detection is not enough
 * (ChatGPT hides it briefly between tool calls); stability-only is not enough (long
 * "thinking" pauses). The combination is robust.
 *
 * Pure logic: `now` and `sleep` are injectable so tests can run with a fake clock.
 */
export class GenerationWatcher {
  constructor(
    private readonly t: WatcherTimeouts,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void> = defaultSleep,
  ) {}

  async *run(read: () => Promise<Reading>, signal: AbortSignal): AsyncGenerator<Snapshot> {
    const started = this.now();
    let lastText = "";
    let lastHtml = "";
    let lastChangeAt = started;
    let seenMessage = false;
    let lastEmitted: string | undefined;

    for (;;) {
      if (signal.aborted) throw new WatchCancelledError(lastText);

      const r = await read();
      const t = this.now();

      if (r.exists) {
        seenMessage = true;
        if (r.text !== lastText) {
          lastText = r.text;
          lastChangeAt = t;
        }
        lastHtml = r.html;
        if (lastText !== lastEmitted && lastText.length > 0) {
          lastEmitted = lastText;
          yield { text: lastText, html: lastHtml, done: false };
        }
        const stable = t - lastChangeAt >= this.t.stableMs;
        if (!r.generating && stable && lastText.length > 0) {
          yield { text: lastText, html: lastHtml, done: true, outcome: "done" };
          return;
        }
      } else if (t - started >= this.t.firstTokenMs) {
        throw new FirstTokenTimeoutError();
      }

      if (t - started >= this.t.generationMs) {
        // Give up but hand back whatever was captured.
        yield { text: lastText, html: lastHtml, done: true, outcome: "timeout-generation" };
        return;
      }

      // A message container that exists but stays empty for the whole first-token window is
      // also treated as "no first token" (some sites render an empty bubble immediately).
      if (seenMessage && lastText.length === 0 && t - started >= this.t.firstTokenMs) {
        throw new FirstTokenTimeoutError();
      }

      await this.sleep(this.t.pollMs, signal);
    }
  }
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const id = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
