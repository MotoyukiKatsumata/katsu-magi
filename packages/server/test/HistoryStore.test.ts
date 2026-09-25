import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StoredTurn } from "@katsu-magi/shared";
import { HistoryStore, summarise } from "../src/history/HistoryStore.js";

const silentLog = { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLog; } } as never;

let dir: string;
let store: HistoryStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "katsu-history-"));
  store = new HistoryStore(dir, silentLog);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function turn(prompt: string, text: string): StoredTurn {
  return {
    requestId: `r-${prompt}`,
    prompt,
    createdAt: new Date().toISOString(),
    answers: { chatgpt: { text, status: "done" } },
  };
}

describe("HistoryStore", () => {
  it("creates a session and lists it", () => {
    const s = store.create("first");
    expect(store.list().map((x) => x.id)).toEqual([s.id]);
    expect(store.get(s.id)?.turns).toEqual([]);
  });

  it("appends turns and names the session after the first prompt", () => {
    const s = store.create("(新しい会話)");
    store.appendTurn(s.id, turn("What is Playwright?", "a browser automation library"));
    store.appendTurn(s.id, turn("And Puppeteer?", "another one"));

    const loaded = store.get(s.id)!;
    expect(loaded.turns).toHaveLength(2);
    expect(loaded.turns[1]!.answers.chatgpt!.text).toBe("another one");
    expect(loaded.title).toBe("What is Playwright?");
    expect(store.list()[0]!.turnCount).toBe(2);
  });

  it("stores conversation urls for resuming", () => {
    const s = store.create("x");
    store.setConversationUrls(s.id, { chatgpt: "https://chatgpt.com/c/1" });
    store.setConversationUrls(s.id, { claude: "https://claude.ai/chat/2" });
    expect(store.get(s.id)!.conversationUrls).toEqual({
      chatgpt: "https://chatgpt.com/c/1",
      claude: "https://claude.ai/chat/2",
    });
  });

  it("renames and deletes", () => {
    const s = store.create("x");
    store.rename(s.id, "調べもの");
    expect(store.list()[0]!.title).toBe("調べもの");
    store.remove(s.id);
    expect(store.list()).toEqual([]);
    expect(store.get(s.id)).toBeUndefined();
  });

  it("lists the most recently updated session first", () => {
    const a = store.create("a");
    const b = store.create("b");
    store.appendTurn(a.id, turn("later", "x"));
    expect(store.list().map((x) => x.id)).toEqual([a.id, b.id]);
  });

  it("rebuilds a corrupt index from the session files", () => {
    const s = store.create("keep me");
    store.appendTurn(s.id, turn("hello", "hi"));
    writeFileSync(path.join(dir, "index.json"), "{ this is not json", "utf8");

    const fresh = new HistoryStore(dir, silentLog);
    expect(fresh.list().map((x) => x.id)).toEqual([s.id]);
    expect(fresh.list()[0]!.turnCount).toBe(1);
  });

  it("ignores ids that are not uuids instead of touching other paths", () => {
    expect(store.get("../../etc/passwd")).toBeUndefined();
    store.remove("../../etc/passwd");
  });

  it("writes readable json", () => {
    const s = store.create("x");
    const raw = readFileSync(path.join(dir, `${s.id}.json`), "utf8");
    expect(JSON.parse(raw).id).toBe(s.id);
  });
});

describe("summarise", () => {
  it("takes the first non-empty line", () => {
    expect(summarise("\n\n  hello there\nmore")).toBe("hello there");
  });
  it("truncates long prompts", () => {
    expect(summarise("x".repeat(80))).toBe(`${"x".repeat(40)}…`);
  });
});
