import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sessionSchema, type Session, type SessionSummary, type SiteId, type StoredTurn } from "@katsu-magi/shared";
import type { Logger } from "../logger.js";

/**
 * Conversation history on disk.
 *
 * One JSON file per session plus an index of summaries, so the sidebar can be filled without
 * reading every conversation. The index is a cache: if it is missing or unreadable it is rebuilt
 * from the session files, which are the real record.
 */
export class HistoryStore {
  private readonly indexPath: string;
  private index: SessionSummary[] | undefined;

  constructor(
    private readonly dir: string,
    private readonly log: Logger,
  ) {
    this.indexPath = path.join(dir, "index.json");
  }

  // ------------------------------------------------------------------ reading

  list(): SessionSummary[] {
    if (!this.index) this.index = this.loadIndex();
    return [...this.index].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): Session | undefined {
    const file = this.sessionPath(id);
    if (!file || !existsSync(file)) return undefined;
    try {
      const parsed = sessionSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
      if (parsed.success) return parsed.data;
      this.log.warn({ id, issue: parsed.error.message }, "history: session file is malformed");
    } catch (err) {
      this.log.warn({ id, err }, "history: cannot read session file");
    }
    return undefined;
  }

  // ------------------------------------------------------------------ writing

  create(title: string): Session {
    const now = new Date().toISOString();
    const session: Session = {
      id: randomUUID(),
      title: title.trim() || "(無題)",
      createdAt: now,
      updatedAt: now,
      turns: [],
      conversationUrls: {},
    };
    this.write(session);
    return session;
  }

  appendTurn(id: string, turn: StoredTurn): void {
    this.mutate(id, (s) => {
      s.turns.push(turn);
      // The first prompt names the conversation until the user renames it.
      if (s.turns.length === 1) s.title = summarise(turn.prompt);
    });
  }

  setConversationUrls(id: string, urls: Partial<Record<SiteId, string>>): void {
    this.mutate(id, (s) => {
      s.conversationUrls = { ...s.conversationUrls, ...urls };
    });
  }

  rename(id: string, title: string): void {
    this.mutate(id, (s) => {
      s.title = title.trim() || s.title;
    });
  }

  remove(id: string): void {
    const file = this.sessionPath(id);
    if (file) rmSync(file, { force: true });
    this.index = this.list().filter((s) => s.id !== id);
    this.writeIndex();
  }

  // ------------------------------------------------------------------ internals

  /** Session ids come from randomUUID, but never trust one from the wire as a path segment. */
  private sessionPath(id: string): string | undefined {
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) return undefined;
    return path.join(this.dir, `${id}.json`);
  }

  private mutate(id: string, fn: (s: Session) => void): void {
    const session = this.get(id);
    if (!session) {
      this.log.warn({ id }, "history: session not found");
      return;
    }
    fn(session);
    session.updatedAt = new Date().toISOString();
    this.write(session);
  }

  private write(session: Session): void {
    mkdirSync(this.dir, { recursive: true });
    const file = this.sessionPath(session.id);
    if (!file) return;
    writeAtomic(file, JSON.stringify(session, null, 2));

    const summary = toSummary(session);
    const rest = this.list().filter((s) => s.id !== session.id);
    this.index = [summary, ...rest];
    this.writeIndex();
  }

  private writeIndex(): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      writeAtomic(this.indexPath, JSON.stringify(this.index ?? [], null, 2));
    } catch (err) {
      this.log.warn({ err }, "history: cannot write the index");
    }
  }

  private loadIndex(): SessionSummary[] {
    try {
      if (existsSync(this.indexPath)) {
        const raw = JSON.parse(readFileSync(this.indexPath, "utf8")) as unknown;
        if (Array.isArray(raw)) return raw.filter(isSummary);
      }
    } catch (err) {
      this.log.warn({ err }, "history: index unreadable, rebuilding from the session files");
    }
    return this.rebuildIndex();
  }

  private rebuildIndex(): SessionSummary[] {
    if (!existsSync(this.dir)) return [];
    const summaries: SessionSummary[] = [];
    for (const entry of readdirSync(this.dir)) {
      if (!entry.endsWith(".json") || entry === "index.json") continue;
      const session = this.get(entry.replace(/\.json$/, ""));
      if (session) summaries.push(toSummary(session));
    }
    this.index = summaries;
    this.writeIndex();
    return summaries;
  }
}

/** Write through a temp file so a crash cannot leave a half-written JSON behind. */
function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, file);
}

function toSummary(s: Session): SessionSummary {
  return { id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, turnCount: s.turns.length };
}

function isSummary(v: unknown): v is SessionSummary {
  const o = v as Partial<SessionSummary> | null;
  return !!o && typeof o.id === "string" && typeof o.title === "string" && typeof o.updatedAt === "string";
}

/** First line of the prompt, trimmed to something that fits the sidebar. */
export function summarise(prompt: string): string {
  const line = prompt.split("\n").find((l) => l.trim()) ?? prompt;
  const t = line.trim();
  return t.length <= 40 ? t : `${t.slice(0, 40)}…`;
}
