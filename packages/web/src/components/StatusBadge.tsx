import type { SiteStatus } from "@katsu-magi/shared";

const STYLES: Record<SiteStatus, { label: string; cls: string; pulse?: boolean }> = {
  starting: { label: "starting", cls: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  idle: { label: "idle", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  "needs-login": { label: "needs login", cls: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-300" },
  blocked: { label: "blocked", cls: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-300" },
  typing: { label: "typing", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300", pulse: true },
  streaming: { label: "streaming", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300", pulse: true },
  done: { label: "done", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  "rate-limited": { label: "rate limited", cls: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-300" },
  error: { label: "error", cls: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-300" },
};

export function StatusBadge({ status, title }: { status: SiteStatus; title?: string | undefined }) {
  const s = STYLES[status];
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}
    >
      {s.pulse && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {s.label}
    </span>
  );
}
