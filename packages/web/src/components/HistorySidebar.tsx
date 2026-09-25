import { useState } from "react";
import type { SessionSummary } from "@katsu-magi/shared";

interface Props {
  open: boolean;
  sessions: SessionSummary[];
  activeId?: string | undefined;
  viewingId?: string | undefined;
  busy: boolean;
  onToggle: () => void;
  onOpen: (id: string, resume: boolean) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

/** Day headings, newest first: "今日", "昨日", then the date. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const days = Math.floor((startOfDay(today) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return "今日";
  if (days === 1) return "昨日";
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
}
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

export function HistorySidebar({ open, sessions, activeId, viewingId, busy, onToggle, onOpen, onDelete, onRename }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        title="履歴を開く"
        className="flex w-8 shrink-0 flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-white py-3 text-xs text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      >
        <span aria-hidden>▶</span>
        <span className="[writing-mode:vertical-rl]">履歴</span>
      </button>
    );
  }

  let lastDay = "";
  return (
    <aside className="flex w-64 shrink-0 flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">履歴</h2>
        <span className="text-xs text-zinc-400">{sessions.length}</span>
        <button type="button" onClick={onToggle} title="履歴を閉じる" className="ml-auto text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          ◀ 閉じる
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {sessions.length === 0 && <p className="px-1 text-xs text-zinc-400">まだ会話がありません。</p>}
        {sessions.map((s) => {
          const day = dayLabel(s.updatedAt);
          const heading = day !== lastDay ? day : null;
          lastDay = day;
          const isActive = s.id === activeId;
          const isViewing = s.id === viewingId;
          return (
            <div key={s.id}>
              {heading && <p className="mt-3 mb-1 px-1 text-[11px] font-medium text-zinc-400">{heading}</p>}
              <div
                className={`group rounded-lg px-2 py-1.5 ${
                  isViewing
                    ? "bg-indigo-100 dark:bg-indigo-950/60"
                    : isActive
                      ? "bg-emerald-50 dark:bg-emerald-950/40"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                {editing === s.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => {
                      if (draft.trim()) onRename(s.id, draft.trim());
                      setEditing(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="w-full rounded border border-indigo-400 bg-transparent px-1 py-0.5 text-sm outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpen(s.id, false)}
                    onDoubleClick={() => {
                      setDraft(s.title);
                      setEditing(s.id);
                    }}
                    title={`${s.title}\nダブルクリックで名前を変更`}
                    className="block w-full truncate text-left text-sm"
                  >
                    {s.title}
                  </button>
                )}
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400">
                  <span>{timeLabel(s.updatedAt)}</span>
                  <span>{s.turnCount} 往復</span>
                  {isActive && <span className="text-emerald-600 dark:text-emerald-400">表示中の会話</span>}
                  <span className="ml-auto flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                    {!isActive && (
                      <button type="button" disabled={busy} onClick={() => onOpen(s.id, true)} className="hover:text-indigo-600 disabled:opacity-40">
                        再開
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`「${s.title}」を履歴から削除します。各サイト側の会話は残ります。`)) onDelete(s.id);
                      }}
                      className="hover:text-rose-600"
                    >
                      削除
                    </button>
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
