import type { SiteId } from "@katsu-magi/shared";
import type { LlmSiteAdapter } from "../../sites/types.js";
import { AdapterError } from "../../sites/types.js";

export interface RunEvents {
  onStatus(site: SiteId, status: "typing" | "streaming" | "done", message?: string): void;
  onAnswer(site: SiteId, text: string, done: boolean): void;
  onError(site: SiteId, err: AdapterError): void;
}

/**
 * Runs one site to completion, translating adapter output into UI events.
 * Never throws: failures are reported through `onError` so sibling sites keep running.
 * MAGI mode (later) reuses this for its review and synthesis rounds.
 */
export async function runOne(
  site: SiteId,
  adapter: LlmSiteAdapter,
  prompt: string,
  signal: AbortSignal,
  ev: RunEvents,
): Promise<void> {
  ev.onStatus(site, "typing");
  let streaming = false;
  try {
    for await (const chunk of adapter.send(prompt, signal)) {
      if (!streaming) {
        streaming = true;
        ev.onStatus(site, "streaming");
      }
      ev.onAnswer(site, chunk.text, chunk.done);
    }
    ev.onStatus(site, "done");
  } catch (err) {
    const adapterErr =
      err instanceof AdapterError ? err : new AdapterError("UNKNOWN", site, err instanceof Error ? err.message : String(err));
    if (adapterErr.detail.partialText) ev.onAnswer(site, adapterErr.detail.partialText, true);
    ev.onError(site, adapterErr);
  }
}

/** Phase 1 strategy: the same prompt to every site at once, independently. */
export async function fanout(
  sites: SiteId[],
  adapters: Map<SiteId, LlmSiteAdapter>,
  prompt: string,
  signal: AbortSignal,
  ev: RunEvents,
): Promise<void> {
  await Promise.allSettled(
    sites.map((site) => {
      const adapter = adapters.get(site);
      if (!adapter) {
        ev.onError(site, new AdapterError("UNKNOWN", site, `no adapter for ${site}`));
        return Promise.resolve();
      }
      return runOne(site, adapter, prompt, signal, ev);
    }),
  );
}
