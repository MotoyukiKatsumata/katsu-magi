import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import type { ServerMsg, SiteId } from "@katsu-magi/shared";
import { HistoryStore } from "../src/history/HistoryStore.js";
import { BusyError, Orchestrator } from "../src/orchestrator/Orchestrator.js";
import { AdapterError, type AnswerChunk, type LlmSiteAdapter, type Readiness } from "../src/sites/types.js";

const silentLog = { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLog; } } as never;

class FakeAdapter implements LlmSiteAdapter {
  sent: string[] = [];
  opened: string[] = [];
  newConversations = 0;
  constructor(
    public readonly id: SiteId,
    private readonly behaviour: (prompt: string, signal: AbortSignal) => AsyncIterable<AnswerChunk>,
  ) {}
  async attach(_page: Page) {}
  async ensureReady(): Promise<Readiness> {
    return { state: "ready" };
  }
  async newConversation() {
    this.newConversations++;
  }
  async openConversation(url: string) {
    this.opened.push(url);
  }
  send(prompt: string, signal: AbortSignal) {
    this.sent.push(prompt);
    return this.behaviour(prompt, signal);
  }
  async cancel() {}
  url: string | undefined;
  conversationUrl() {
    return this.url;
  }
}

const fakeBrowser = {
  isRunning: () => true,
  isVisible: () => true,
  getPage: async () => ({}) as Page,
  bringToFront: async () => {},
  setVisible: async () => {},
  restart: async () => {},
};

const cfg = { sites: { chatgpt: { enabled: true }, gemini: { enabled: true }, claude: { enabled: true } } };

async function* ok(text: string): AsyncIterable<AnswerChunk> {
  yield { text: text.slice(0, 2), done: false };
  yield { text, done: true };
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(adapters: LlmSiteAdapter[]) {
  const map = new Map(adapters.map((a) => [a.id, a]));
  const dir = mkdtempSync(path.join(tmpdir(), "katsu-orch-"));
  tempDirs.push(dir);
  const history = new HistoryStore(dir, silentLog);
  const orch = new Orchestrator(map, fakeBrowser, cfg, silentLog, history);
  const messages: ServerMsg[] = [];
  orch.on("message", (m) => messages.push(m));
  return { orch, messages, history };
}

describe("Orchestrator", () => {
  it("fans out to all requested sites and streams answers", async () => {
    const { orch, messages } = setup([
      new FakeAdapter("chatgpt", () => ok("gpt answer")),
      new FakeAdapter("claude", () => ok("claude answer")),
    ]);
    await orch.ask("r1", "hello", ["chatgpt", "claude"]);
    const finals = messages.filter((m) => m.type === "answer" && m.done);
    expect(finals.map((m) => (m.type === "answer" ? [m.site, m.text] : null)).sort()).toEqual([
      ["chatgpt", "gpt answer"],
      ["claude", "claude answer"],
    ]);
    expect(orch.snapshot().sites.chatgpt.status).toBe("done");
    expect(orch.snapshot().busyRequestId).toBeUndefined();
  });

  it("a failing site does not block the others", async () => {
    const { orch, messages } = setup([
      new FakeAdapter("chatgpt", () => ok("fine")),
      new FakeAdapter("gemini", async function* () {
        throw new AdapterError("SELECTOR_NOT_FOUND", "gemini", "boom", { selectorKey: "sendButton" });
      }),
    ]);
    await orch.ask("r1", "hello", ["chatgpt", "gemini"]);
    expect(orch.snapshot().sites.chatgpt.status).toBe("done");
    expect(orch.snapshot().sites.gemini.status).toBe("error");
    expect(orch.snapshot().sites.gemini.message).toContain("selectors:check gemini");
    const err = messages.find((m) => m.type === "error");
    expect(err && err.type === "error" && err.selectorKey).toBe("sendButton");
  });

  it("maps login / rate-limit errors to their statuses and keeps partial text", async () => {
    const { orch, messages } = setup([
      new FakeAdapter("claude", async function* () {
        throw new AdapterError("NEEDS_LOGIN", "claude", "login required");
      }),
      new FakeAdapter("gemini", async function* () {
        yield { text: "part", done: false };
        throw new AdapterError("RATE_LIMITED", "gemini", "limit", { partialText: "part" });
      }),
    ]);
    await orch.ask("r1", "hello", ["claude", "gemini"]);
    expect(orch.snapshot().sites.claude.status).toBe("needs-login");
    expect(orch.snapshot().sites.gemini.status).toBe("rate-limited");
    const partial = messages.find((m) => m.type === "answer" && m.site === "gemini" && m.done);
    expect(partial && partial.type === "answer" && partial.text).toBe("part");
  });

  it("rejects a second request while one is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { orch } = setup([
      new FakeAdapter("chatgpt", async function* () {
        await gate;
        yield { text: "late", done: true };
      }),
    ]);
    const first = orch.ask("r1", "hello", ["chatgpt"]);
    await expect(orch.ask("r2", "again", ["chatgpt"])).rejects.toBeInstanceOf(BusyError);
    expect(orch.snapshot().busyRequestId).toBe("r1");
    release();
    await first;
    expect(orch.isBusy()).toBe(false);
  });

  it("skips disabled sites", async () => {
    const gpt = new FakeAdapter("chatgpt", () => ok("x"));
    const gem = new FakeAdapter("gemini", () => ok("y"));
    const { orch } = setup([gpt, gem]);
    orch.setEnabled("gemini", false);
    await orch.ask("r1", "hello", ["chatgpt", "gemini"]);
    expect(gpt.sent).toEqual(["hello"]);
    expect(gem.sent).toEqual([]);
  });

  it("cancel aborts the signal and the site returns to idle", async () => {
    const { orch } = setup([
      new FakeAdapter("chatgpt", async function* (_p, signal) {
        yield { text: "a", done: false };
        await new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true }));
        throw new AdapterError("CANCELLED", "chatgpt", "cancelled", { partialText: "a" });
      }),
    ]);
    const run = orch.ask("r1", "hello", ["chatgpt"]);
    await new Promise((r) => setTimeout(r, 10));
    await orch.cancel("r1");
    await run;
    expect(orch.snapshot().sites.chatgpt.status).toBe("idle");
  });

  it("records each turn and the conversation urls in history", async () => {
    const gpt = new FakeAdapter("chatgpt", () => ok("gpt says"));
    gpt.url = "https://chatgpt.com/c/abc";
    const { orch, history } = setup([gpt]);

    await orch.ask("r1", "first question", ["chatgpt"]);
    await orch.ask("r2", "second question", ["chatgpt"]);

    const sessions = history.list();
    expect(sessions).toHaveLength(1);
    const session = history.get(sessions[0]!.id)!;
    expect(session.turns.map((t) => t.prompt)).toEqual(["first question", "second question"]);
    expect(session.turns[0]!.answers.chatgpt).toMatchObject({ text: "gpt says", status: "done" });
    expect(session.title).toBe("first question");
    expect(session.conversationUrls.chatgpt).toBe("https://chatgpt.com/c/abc");
    expect(orch.snapshot().sessionId).toBe(sessions[0]!.id);
  });

  it("starts a new history session after newConversation", async () => {
    const { orch, history } = setup([new FakeAdapter("chatgpt", () => ok("x"))]);
    await orch.ask("r1", "topic one", ["chatgpt"]);
    await orch.newConversation();
    expect(orch.snapshot().sessionId).toBeUndefined();
    await orch.ask("r2", "topic two", ["chatgpt"]);
    expect(history.list().map((s) => s.title).sort()).toEqual(["topic one", "topic two"]);
  });

  it("resuming a session sends every tab back to its stored conversation", async () => {
    const gpt = new FakeAdapter("chatgpt", () => ok("x"));
    gpt.url = "https://chatgpt.com/c/abc";
    const claude = new FakeAdapter("claude", () => ok("y")); // no url: falls back to a new chat
    const { orch, history } = setup([gpt, claude]);

    await orch.ask("r1", "the old topic", ["chatgpt", "claude"]);
    const id = history.list()[0]!.id;
    await orch.newConversation();
    gpt.opened.length = 0;
    claude.newConversations = 0;

    const { session, resumed } = await orch.openSession(id, true);
    expect(resumed).toBe(true);
    expect(session!.turns[0]!.prompt).toBe("the old topic");
    expect(gpt.opened).toEqual(["https://chatgpt.com/c/abc"]);
    expect(claude.newConversations).toBe(1);
    expect(orch.snapshot().sessionId).toBe(id);
  });

  it("a prompt aimed at a past session moves the tabs there and continues it", async () => {
    const gpt = new FakeAdapter("chatgpt", () => ok("x"));
    gpt.url = "https://chatgpt.com/c/old";
    const { orch, history } = setup([gpt]);

    await orch.ask("r1", "古い話題", ["chatgpt"]);
    const oldId = history.list()[0]!.id;
    await orch.newConversation();
    gpt.opened.length = 0;
    gpt.url = "https://chatgpt.com/c/old";

    // The user was only looking at the old conversation and typed into it.
    await orch.ask("r2", "その続き", ["chatgpt"], oldId);

    expect(gpt.opened).toEqual(["https://chatgpt.com/c/old"]);
    expect(orch.snapshot().sessionId).toBe(oldId);
    expect(history.list()).toHaveLength(1); // continued, not started anew
    expect(history.get(oldId)!.turns.map((t) => t.prompt)).toEqual(["古い話題", "その続き"]);
  });

  it("does not move the tabs when the prompt targets the conversation already open", async () => {
    const gpt = new FakeAdapter("chatgpt", () => ok("x"));
    gpt.url = "https://chatgpt.com/c/cur";
    const { orch, history } = setup([gpt]);

    await orch.ask("r1", "話題", ["chatgpt"]);
    const id = history.list()[0]!.id;
    gpt.opened.length = 0;

    await orch.ask("r2", "続き", ["chatgpt"], id);
    expect(gpt.opened).toEqual([]);
    expect(history.get(id)!.turns).toHaveLength(2);
  });

  it("refuses to send when the conversation to continue is gone", async () => {
    const gpt = new FakeAdapter("chatgpt", () => ok("x"));
    const { orch, messages } = setup([gpt]);

    await orch.ask("r1", "続き", ["chatgpt"], "99999999-9999-4999-8999-999999999999");

    expect(gpt.sent).toEqual([]); // nothing was written to the wrong conversation
    const err = messages.find((m) => m.type === "error");
    expect(err && err.type === "error" && err.code).toBe("SESSION_NOT_FOUND");
  });

  // Regression: the sidebar marked the resumed conversation as shown while the columns stayed
  // empty, because its contents were never sent.
  it("resuming broadcasts the conversation so every client can show it", async () => {
    const gpt = new FakeAdapter("chatgpt", () => ok("x"));
    gpt.url = "https://chatgpt.com/c/abc";
    const { orch, history, messages } = setup([gpt]);

    await orch.ask("r1", "もとの話題", ["chatgpt"]);
    const id = history.list()[0]!.id;
    await orch.newConversation();
    messages.length = 0;

    await orch.openSession(id, true);

    const broadcast = messages.find((m) => m.type === "session");
    expect(broadcast && broadcast.type === "session" && broadcast.resumed).toBe(true);
    expect(broadcast && broadcast.type === "session" && broadcast.session?.turns[0]?.prompt).toBe("もとの話題");
  });

  it("offers the current conversation to a client that connects later", async () => {
    const gpt = new FakeAdapter("chatgpt", () => ok("x"));
    const { orch, history } = setup([gpt]);
    expect(orch.currentSessionMessage()).toBeUndefined();

    await orch.ask("r1", "話題", ["chatgpt"]);
    const msg = orch.currentSessionMessage();
    expect(msg && msg.type === "session" && msg.session?.id).toBe(history.list()[0]!.id);
    expect(msg && msg.type === "session" && msg.resumed).toBe(true);

    await orch.newConversation();
    expect(orch.currentSessionMessage()).toBeUndefined();
  });

  it("opening a session without resuming leaves the tabs alone", async () => {
    const gpt = new FakeAdapter("chatgpt", () => ok("x"));
    gpt.url = "https://chatgpt.com/c/abc";
    const { orch, history } = setup([gpt]);
    await orch.ask("r1", "old", ["chatgpt"]);
    const id = history.list()[0]!.id;
    gpt.opened.length = 0;

    const { session, resumed } = await orch.openSession(id, false);
    expect(resumed).toBe(false);
    expect(session!.turns).toHaveLength(1);
    expect(gpt.opened).toEqual([]);
  });

  it("deleting the active session clears it", async () => {
    const { orch, history } = setup([new FakeAdapter("chatgpt", () => ok("x"))]);
    await orch.ask("r1", "old", ["chatgpt"]);
    const id = history.list()[0]!.id;
    orch.deleteSession(id);
    expect(history.list()).toEqual([]);
    expect(orch.snapshot().sessionId).toBeUndefined();
  });

  it("newConversation resets every enabled site", async () => {
    const gpt = new FakeAdapter("chatgpt", () => ok("x"));
    const cl = new FakeAdapter("claude", () => ok("y"));
    const { orch } = setup([gpt, cl]);
    await orch.newConversation();
    expect(gpt.newConversations).toBe(1);
    expect(cl.newConversations).toBe(1);
  });
});
