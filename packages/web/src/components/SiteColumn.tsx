import { useEffect, useRef, useState } from "react";
import { SITE_LABELS, type SiteId, type SiteState } from "@katsu-magi/shared";
import type { Turn } from "../state/reducer";
import { Markdown } from "./Markdown";
import { StatusBadge } from "./StatusBadge";

interface Props {
  site: SiteId;
  state: SiteState;
  turns: Turn[];
  /** Changes when the column is refilled with a different conversation. */
  viewEpoch: number;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onRetry: () => void;
}

const NEEDS_ACTION = new Set(["needs-login", "blocked", "error", "rate-limited"]);

export function SiteColumn({ site, state, viewEpoch, turns, busy, onToggle, onRetry }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const streaming = state.status === "streaming" || state.status === "typing";

  // Follow the answer while it streams.
  useEffect(() => {
    if (!streaming) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, streaming]);

  // A conversation was just loaded: show its newest exchange, not the top of the thread.
  // Once more on the next frame, because markdown can still be settling into its final height.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const toBottom = () => {
      el.scrollTop = el.scrollHeight;
    };
    toBottom();
    const id = requestAnimationFrame(toBottom);
    return () => cancelAnimationFrame(id);
  }, [viewEpoch]);

  const lastAnswer = [...turns].reverse().find((t) => t.answers[site]?.text)?.answers[site]?.text;

  const copy = async () => {
    if (!lastAnswer) return;
    await navigator.clipboard.writeText(lastAnswer);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section
      className={`flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border bg-white shadow-sm dark:bg-zinc-900 ${
        state.enabled ? "border-zinc-200 dark:border-zinc-800" : "border-dashed border-zinc-300 opacity-60 dark:border-zinc-700"
      }`}
    >
      <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            className="h-4 w-4 accent-indigo-600"
            checked={state.enabled}
            disabled={busy}
            onChange={(e) => onToggle(e.target.checked)}
          />
          {SITE_LABELS[site]}
        </label>
        <StatusBadge status={state.status} title={state.message} />
        <div className="ml-auto flex items-center gap-1">
          {NEEDS_ACTION.has(state.status) && !busy && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={copy}
            disabled={!lastAnswer}
            className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
            title="Copy the latest answer as markdown"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </header>

      {state.message && (
        <p className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          {state.message}
        </p>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {turns.length === 0 && <p className="text-sm text-zinc-400">No messages yet.</p>}
        {turns.map((turn) => {
          const a = turn.answers[site];
          if (!turn.sites.includes(site)) return null;
          return (
            <article key={turn.requestId} className="space-y-2">
              <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm whitespace-pre-wrap dark:bg-indigo-950/40">{turn.prompt}</div>
              <div className="px-1">
                {a?.text ? <Markdown text={a.text} /> : a?.status === "typing" || a?.status === "streaming" ? (
                  <p className="text-sm text-zinc-400">Waiting for {SITE_LABELS[site]}...</p>
                ) : null}
                {a?.error && (
                  <p className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-300">{a.error}</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
