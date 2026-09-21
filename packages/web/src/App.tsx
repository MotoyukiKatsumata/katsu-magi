import { SITE_IDS, type SiteId } from "@katsu-magi/shared";
import { PromptBar } from "./components/PromptBar";
import { ResizeHandle } from "./components/ResizeHandle";
import { SiteColumn } from "./components/SiteColumn";
import { Toolbar } from "./components/Toolbar";
import { useColumnWidths } from "./state/useColumnWidths";
import { useMagiSocket } from "./ws/useMagiSocket";

export function App() {
  const { state, send, dispatch } = useMagiSocket();
  const { widths, containerRef, startDrag, reset } = useColumnWidths(SITE_IDS.length);
  const busy = state.busyRequestId !== undefined;
  const enabled = SITE_IDS.filter((s) => state.sites[s].enabled);

  const onSend = (text: string) => {
    const requestId = crypto.randomUUID();
    dispatch({ type: "localPrompt", requestId, prompt: text, sites: enabled });
    send({ type: "prompt", requestId, text, sites: enabled });
  };

  const onCancel = () => {
    if (state.busyRequestId) send({ type: "cancel", requestId: state.busyRequestId });
  };

  const onNewConversation = () => {
    if (state.turns.length > 0 && !window.confirm("Start a new conversation on every enabled site? The current thread stays open in Chrome but is cleared here.")) {
      return;
    }
    dispatch({ type: "clearTurns" });
    send({ type: "newConversation" });
  };

  const onToggleSite = (site: SiteId, on: boolean) => send({ type: "setSiteEnabled", site, enabled: on });
  const onRetry = (site: SiteId) => send({ type: "retry", site });

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
            dismiss
          </button>
        </div>
      )}

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
                busy={busy}
                onToggle={(on) => onToggleSite(site, on)}
                onRetry={() => onRetry(site)}
              />
            </div>
            {i < SITE_IDS.length - 1 && <ResizeHandle onPointerDown={startDrag(i)} onReset={reset} />}
          </div>
        ))}
      </main>

      <PromptBar busy={busy} disabled={enabled.length === 0 || !state.connected} onSend={onSend} onCancel={onCancel} />
    </div>
  );
}
