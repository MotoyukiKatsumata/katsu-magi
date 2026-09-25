import { describe, expect, it } from "vitest";
import type { Session, SessionSummary } from "@katsu-magi/shared";
import { initialState, reducer, type AppState } from "../src/state/reducer";

const session = (id: string, prompts: string[]): Session => ({
  id,
  title: prompts[0] ?? "(無題)",
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
  conversationUrls: { chatgpt: "https://chatgpt.com/c/1" },
  turns: prompts.map((p, i) => ({
    requestId: `r${i}`,
    prompt: p,
    createdAt: "2026-09-25T00:00:00.000Z",
    answers: { chatgpt: { text: `答え ${i}`, status: "done" } },
  })),
});

const summary = (id: string): SessionSummary => ({
  id,
  title: id,
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
  turnCount: 1,
});

/** State as it looks while a live conversation "active" is in progress. */
const onActive = (): AppState =>
  reducer(reducer(initialState, { type: "connected", connected: true }), {
    type: "server",
    msg: {
      type: "state",
      sites: {
        chatgpt: { enabled: true, status: "idle" },
        gemini: { enabled: true, status: "idle" },
        claude: { enabled: true, status: "idle" },
      },
      browser: { running: true, visible: true },
      sessionId: "active",
    },
  });

describe("reducer: history sessions", () => {
  it("resuming a session makes it the active conversation", () => {
    const next = reducer(onActive(), { type: "server", msg: { type: "session", session: session("other", ["古い質問"]), resumed: true } });
    expect(next.sessionId).toBe("other");
    expect(next.viewingSessionId).toBeUndefined();
    expect(next.turns.map((t) => t.prompt)).toEqual(["古い質問"]);
  });

  it("opening a different session without resuming switches to viewing", () => {
    const next = reducer(onActive(), { type: "server", msg: { type: "session", session: session("other", ["古い質問"]), resumed: false } });
    expect(next.viewingSessionId).toBe("other");
    expect(next.sessionId).toBe("active"); // the tabs did not move
  });

  // Regression: this used to disable the prompt bar and leave the "viewing the past" banner up.
  it("opening the session the tabs are already on does not count as viewing", () => {
    const next = reducer(onActive(), { type: "server", msg: { type: "session", session: session("active", ["いまの質問"]), resumed: false } });
    expect(next.viewingSessionId).toBeUndefined();
    expect(next.sessionId).toBe("active");
    expect(next.turns.map((t) => t.prompt)).toEqual(["いまの質問"]);
  });

  // Typing into a past conversation continues it, so the UI stops treating it as read-only.
  it("sending a prompt while viewing a past session leaves viewing mode", () => {
    const viewing = reducer(onActive(), { type: "server", msg: { type: "session", session: session("other", ["古い質問"]), resumed: false } });
    expect(viewing.viewingSessionId).toBe("other");

    const sent = reducer(viewing, { type: "localPrompt", requestId: "r1", prompt: "その続き", sites: ["chatgpt"] });
    expect(sent.viewingSessionId).toBeUndefined();
    expect(sent.turns.map((t) => t.prompt)).toEqual(["古い質問", "その続き"]);
  });

  it("reports a session that could not be found", () => {
    const next = reducer(onActive(), { type: "server", msg: { type: "session", session: null, resumed: false } });
    expect(next.notice).toBeTruthy();
    expect(next.turns).toEqual([]);
  });

  it("keeps the session list", () => {
    const next = reducer(initialState, { type: "server", msg: { type: "sessions", items: [summary("a"), summary("b")] } });
    expect(next.sessions.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("reducer: viewEpoch", () => {
  it("advances when a session fills the columns", () => {
    const before = onActive();
    const after = reducer(before, { type: "server", msg: { type: "session", session: session("other", ["質問"]), resumed: false } });
    expect(after.viewEpoch).toBe(before.viewEpoch + 1);
  });

  it("advances when the columns are cleared", () => {
    const before = onActive();
    expect(reducer(before, { type: "clearTurns" }).viewEpoch).toBe(before.viewEpoch + 1);
  });

  it("does not advance while an answer streams in", () => {
    const withTurn = reducer(onActive(), { type: "localPrompt", requestId: "r1", prompt: "質問", sites: ["chatgpt"] });
    const streamed = reducer(withTurn, { type: "server", msg: { type: "answer", requestId: "r1", site: "chatgpt", text: "途中", done: false } });
    const finished = reducer(streamed, { type: "server", msg: { type: "answer", requestId: "r1", site: "chatgpt", text: "完了", done: true } });
    expect(streamed.viewEpoch).toBe(withTurn.viewEpoch);
    expect(finished.viewEpoch).toBe(withTurn.viewEpoch);
    expect(finished.turns[0]!.answers.chatgpt!.text).toBe("完了");
  });

  it("does not advance when a new prompt is added locally", () => {
    const before = onActive();
    const after = reducer(before, { type: "localPrompt", requestId: "r1", prompt: "質問", sites: ["chatgpt"] });
    expect(after.viewEpoch).toBe(before.viewEpoch);
  });
});
