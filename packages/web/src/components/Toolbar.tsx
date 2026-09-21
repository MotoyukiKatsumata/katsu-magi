interface Props {
  connected: boolean;
  browserRunning: boolean;
  browserVisible: boolean;
  busy: boolean;
  onNewConversation: () => void;
  onToggleBrowser: () => void;
  onRestartBrowser: () => void;
}

const btn =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function Toolbar({ connected, browserRunning, browserVisible, busy, onNewConversation, onToggleBrowser, onRestartBrowser }: Props) {
  return (
    <header className="flex flex-wrap items-center gap-2">
      <h1 className="text-lg font-bold tracking-tight">
        katsu-magi
        <span className="ml-2 text-xs font-normal text-zinc-500">ChatGPT / Gemini / Claude, side by side</span>
      </h1>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-rose-500"}`} />
          {connected ? "server connected" : "server disconnected"}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span className={`h-2 w-2 rounded-full ${browserRunning ? "bg-emerald-500" : "bg-rose-500"}`} />
          {browserRunning ? "Chrome running" : "Chrome stopped"}
        </span>
        <button type="button" className={btn} onClick={onToggleBrowser} disabled={!browserRunning}>
          {browserVisible ? "Hide browser" : "Show browser"}
        </button>
        <button type="button" className={btn} onClick={onRestartBrowser} disabled={busy}>
          Restart browser
        </button>
        <button
          type="button"
          onClick={onNewConversation}
          disabled={busy || !browserRunning}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          New conversation
        </button>
      </div>
    </header>
  );
}
