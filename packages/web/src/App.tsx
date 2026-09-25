import { useState } from "react";
import { SITE_IDS, type SiteId } from "@katsu-magi/shared";
import { HistorySidebar } from "./components/HistorySidebar";
import { PromptBar } from "./components/PromptBar";
import { ResizeHandle } from "./components/ResizeHandle";
import { SiteColumn } from "./components/SiteColumn";
import { Toolbar } from "./components/Toolbar";
import { useColumnWidths } from "./state/useColumnWidths";
import { useMagiSocket } from "./ws/useMagiSocket";

const SIDEBAR_KEY = "katsu-magi.historyOpen.v1";

export function App() {
  const { state, send, dispatch } = useMagiSocket();
  const { widths, containerRef, startDrag, reset } = useColumnWidths(SITE_IDS.length);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) !== "0";
    } catch {
      return true;
    }
  });

  const busy = state.busyRequestId !== undefined;
  const viewing = state.viewingSessionId !== undefined;
  const enabled = SITE_IDS.filter((s) => state.sites[s].enabled);

  const toggleSidebar = () => {
    setSidebarOpen((open) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, open ? "0" : "1");
      } catch {
        // a remembered panel state is not worth failing over
      }
      return !open;
    });
  };

  const onSend = (text: string) => {
    const requestId = crypto.randomUUID();
    dispatch({ type: "localPrompt", requestId, prompt: text, sites: enabled });
    // Typing into a past conversation continues it: the server moves the tabs there first.
    send({
      type: "prompt",
      requestId,
      text,
      sites: enabled,
      ...(state.viewingSessionId ? { resumeSessionId: state.viewingSessionId } : {}),
    });
  };

  const onCancel = () => {
    if (state.busyRequestId) send({ type: "cancel", requestId: state.busyRequestId });
  };

  // No confirmation: the conversation stays in the history, so nothing is lost.
  const onNewConversation = () => {
    dispatch({ type: "clearTurns" });
    send({ type: "newConversation" });
  };

  const backToCurrent = () => {
    dispatch({ type: "clearTurns" });
    if (state.sessionId) send({ type: "openSession", id: state.sessionId, resume: false });
  };

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <Toolbar
        connected={state.connected}
        browserRunning={state.browser.running}
        browserVisible={state.browser.visible}
        busy={busy}
        onNewConversation={onNewConversation}
        onToggleBrowser={() => send({ type: "browser", action: state.browser.visible ? "hide" : "show" })}
        onRestartBrowser={() => send({ type: "browser", action: "restart" })}
      />

      {state.notice && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
          <span className="flex-1">{state.notice}</span>
          <button type="button" className="text-xs underline" onClick={() => dispatch({ type: "dismissNotice" })}>
            閉じる
          </button>
        </div>
      )}

      {viewing && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200">
          <span className="flex-1">過去の会話を表示しています。ここで送信すると、この会話の続きになります。</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => state.viewingSessionId && send({ type: "openSession", id: state.viewingSessionId, resume: true })}
            className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            この会話を再開する
          </button>
          <button type="button" onClick={backToCurrent} className="text-xs underline">
            現在の会話に戻る
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3">
        <HistorySidebar
          open={sidebarOpen}
          sessions={state.sessions}
          activeId={state.sessionId}
          viewingId={state.viewingSessionId}
          busy={busy}
          onToggle={toggleSidebar}
          onOpen={(id, resume) => send({ type: "openSession", id, resume })}
          onDelete={(id) => send({ type: "deleteSession", id })}
          onRename={(id, title) => send({ type: "renameSession", id, title })}
        />

        {/* Columns share the full row; each one's flex-grow is its stored fraction, so the
            dividers (flex-none) simply eat a little of the row and the fractions still hold. */}
        <main ref={(el) => void (containerRef.current = el)} className="flex min-h-0 flex-1 items-stretch">
          {SITE_IDS.map((site, i) => (
            <div key={site} className="contents">
              <div className="flex min-h-0 min-w-0" style={{ flexGrow: widths[i] ?? 1, flexBasis: 0 }}>
                <SiteColumn
                  site={site}
                  state={state.sites[site]}
                  turns={state.turns}
                  viewEpoch={state.viewEpoch}
                  busy={busy}
                  onToggle={(on) => send({ type: "setSiteEnabled", site, enabled: on })}
                  onRetry={() => send({ type: "retry", site })}
                />
              </div>
              {i < SITE_IDS.length - 1 && <ResizeHandle onPointerDown={startDrag(i)} onReset={reset} />}
            </div>
          ))}
        </main>
      </div>

      <PromptBar busy={busy} disabled={enabled.length === 0 || !state.connected} onSend={onSend} onCancel={onCancel} />
    </div>
  );
}
