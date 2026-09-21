import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { clientMsgSchema, type ClientMsg, type ServerMsg } from "@katsu-magi/shared";
import type { Logger } from "../logger.js";
import { BusyError, type Orchestrator } from "../orchestrator/Orchestrator.js";

/**
 * Single /ws endpoint. Every Orchestrator message is broadcast to all connected sockets so
 * several browser tabs stay in sync; a new socket receives the current state on connect.
 */
export function registerWebSocket(app: FastifyInstance, orch: Orchestrator, log: Logger): void {
  const sockets = new Set<WebSocket>();

  const send = (socket: WebSocket, msg: ServerMsg) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };
  const broadcast = (msg: ServerMsg) => {
    for (const s of sockets) send(s, msg);
  };
  orch.on("message", broadcast);

  app.get("/ws", { websocket: true }, (socket) => {
    sockets.add(socket);
    log.info({ clients: sockets.size }, "ws client connected");
    send(socket, orch.snapshot());

    socket.on("message", (raw: { toString(): string }) => {
      let msg: ClientMsg;
      try {
        msg = clientMsgSchema.parse(JSON.parse(raw.toString()));
      } catch (err) {
        send(socket, { type: "error", code: "BAD_MESSAGE", message: err instanceof Error ? err.message : String(err) });
        return;
      }
      void dispatch(msg, socket);
    });

    socket.on("close", () => {
      sockets.delete(socket);
      log.info({ clients: sockets.size }, "ws client disconnected");
    });
  });

  async function dispatch(msg: ClientMsg, socket: WebSocket): Promise<void> {
    try {
      switch (msg.type) {
        case "hello":
          send(socket, orch.snapshot());
          return;
        case "prompt":
          await orch.ask(msg.requestId, msg.text, msg.sites);
          return;
        case "cancel":
          await orch.cancel(msg.requestId);
          return;
        case "newConversation":
          await orch.newConversation(msg.sites);
          return;
        case "retry":
          await orch.retry(msg.site);
          return;
        case "setSiteEnabled":
          orch.setEnabled(msg.site, msg.enabled);
          return;
        case "browser":
          if (msg.action === "restart") await orch.restartBrowser();
          else await orch.setBrowserVisible(msg.action === "show");
          return;
      }
    } catch (err) {
      if (err instanceof BusyError) {
        send(socket, { type: "error", code: "BUSY", message: "A request is still running. Cancel it or wait.", requestId: err.requestId });
        return;
      }
      log.error({ err, msg }, "ws dispatch failed");
      send(socket, { type: "error", code: "INTERNAL", message: err instanceof Error ? err.message : String(err) });
    }
  }
}
