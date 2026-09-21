import { useCallback, useEffect, useReducer, useRef } from "react";
import { serverMsgSchema, type ClientMsg } from "@katsu-magi/shared";
import { initialState, reducer, type Action, type AppState } from "../state/reducer";

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

export interface MagiSocket {
  state: AppState;
  send: (msg: ClientMsg) => void;
  dispatch: (action: Action) => void;
}

/** Reconnecting WebSocket bound to the app reducer. */
export function useMagiSocket(): MagiSocket {
  const [state, dispatch] = useReducer(reducer, initialState);
  const socketRef = useRef<WebSocket | null>(null);
  const queueRef = useRef<ClientMsg[]>([]);

  useEffect(() => {
    let disposed = false;
    let retryMs = 500;
    let timer: number | undefined;

    const connect = () => {
      const ws = new WebSocket(WS_URL);
      socketRef.current = ws;

      ws.onopen = () => {
        retryMs = 500;
        dispatch({ type: "connected", connected: true });
        ws.send(JSON.stringify({ type: "hello" } satisfies ClientMsg));
        for (const m of queueRef.current.splice(0)) ws.send(JSON.stringify(m));
      };
      ws.onmessage = (ev) => {
        const parsed = serverMsgSchema.safeParse(JSON.parse(String(ev.data)));
        if (parsed.success) dispatch({ type: "server", msg: parsed.data });
        else console.warn("bad server message", parsed.error, ev.data);
      };
      ws.onclose = () => {
        dispatch({ type: "connected", connected: false });
        socketRef.current = null;
        if (!disposed) {
          timer = window.setTimeout(connect, retryMs);
          retryMs = Math.min(retryMs * 2, 8000);
        }
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
      socketRef.current?.close();
    };
  }, []);

  const send = useCallback((msg: ClientMsg) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else queueRef.current.push(msg);
  }, []);

  return { state, send, dispatch };
}
