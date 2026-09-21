import { describe, expect, it } from "vitest";
import { FirstTokenTimeoutError, GenerationWatcher, WatchCancelledError, type Snapshot } from "../src/sites/GenerationWatcher.js";
import type { Reading } from "../src/sites/types.js";

const T = { pollMs: 100, stableMs: 300, firstTokenMs: 1000, generationMs: 5000 };

/** Fake clock: every poll advances time by pollMs; readings are consumed in order, last one repeats. */
function makeWatcher(readings: Partial<Reading>[]) {
  let now = 0;
  let i = 0;
  const read = async (): Promise<Reading> => {
    const r = readings[Math.min(i, readings.length - 1)]!;
    i++;
    return { exists: false, text: "", html: "", generating: false, ...r };
  };
  const sleep = async (ms: number) => {
    now += ms;
  };
  const watcher = new GenerationWatcher(T, () => now, sleep);
  return { watcher, read, clock: () => now };
}

async function collect(gen: AsyncIterable<Snapshot>): Promise<Snapshot[]> {
  const out: Snapshot[] = [];
  for await (const s of gen) out.push(s);
  return out;
}

describe("GenerationWatcher", () => {
  it("finishes after the text is stable and generation stopped", async () => {
    const msg = (text: string, generating: boolean) => ({ exists: true, text, html: `<p>${text}</p>`, generating });
    const { watcher, read } = makeWatcher([
      msg("Hel", true),
      msg("Hello", true),
      msg("Hello world", true),
      msg("Hello world", false), // stop button gone, but not yet stable (needs 300ms)
      msg("Hello world", false),
      msg("Hello world", false),
      msg("Hello world", false),
    ]);
    const snaps = await collect(watcher.run(read, new AbortController().signal));
    const last = snaps.at(-1)!;
    expect(last.done).toBe(true);
    expect(last.outcome).toBe("done");
    expect(last.text).toBe("Hello world");
    expect(snaps.filter((s) => !s.done).map((s) => s.text)).toEqual(["Hel", "Hello", "Hello world"]);
  });

  it("does not finish while the stop button flickers off but text keeps changing", async () => {
    const msg = (text: string, generating: boolean) => ({ exists: true, text, html: "", generating });
    const { watcher, read } = makeWatcher([
      msg("a", true),
      msg("a", false), // flicker
      msg("a", false),
      msg("ab", true), // resumed
      msg("abc", true),
      msg("abc", false),
      msg("abc", false),
      msg("abc", false),
      msg("abc", false),
    ]);
    const snaps = await collect(watcher.run(read, new AbortController().signal));
    expect(snaps.at(-1)!.text).toBe("abc");
    expect(snaps.at(-1)!.outcome).toBe("done");
  });

  it("throws FirstTokenTimeoutError when no message appears", async () => {
    const { watcher, read } = makeWatcher([{ exists: false }]);
    await expect(collect(watcher.run(read, new AbortController().signal))).rejects.toBeInstanceOf(FirstTokenTimeoutError);
  });

  it("gives up with a partial answer after the generation timeout", async () => {
    let n = 0;
    const read = async (): Promise<Reading> => ({ exists: true, text: "x".repeat(++n), html: "", generating: true });
    let now = 0;
    const watcher = new GenerationWatcher(T, () => now, async (ms) => void (now += ms));
    const snaps = await collect(watcher.run(read, new AbortController().signal));
    const last = snaps.at(-1)!;
    expect(last.done).toBe(true);
    expect(last.outcome).toBe("timeout-generation");
    expect(last.text.length).toBeGreaterThan(0);
  });

  it("throws WatchCancelledError with the partial text when aborted", async () => {
    const ac = new AbortController();
    let n = 0;
    const read = async (): Promise<Reading> => {
      n++;
      if (n === 3) ac.abort();
      return { exists: true, text: "partial".slice(0, n * 2), html: "", generating: true };
    };
    let now = 0;
    const watcher = new GenerationWatcher(T, () => now, async (ms) => void (now += ms));
    const err = await collect(watcher.run(read, ac.signal)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WatchCancelledError);
    expect((err as WatchCancelledError).partialText).toBe("partia");
  });
});
