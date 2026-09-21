import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import type { Logger } from "./logger.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Built UI: packages/web/dist, resolved both from src (tsx) and from dist (compiled). */
export function findWebDist(): string | undefined {
  const candidates = [
    path.resolve(here, "../../web/dist"), // from packages/server/src (tsx) or packages/server/dist (bundle)
    path.resolve(here, "../../../web/dist"),
  ];
  return candidates.find((p) => existsSync(path.join(p, "index.html")));
}

export async function createHttpServer(log: Logger): Promise<FastifyInstance> {
  // Fastify's own logger is off; errors are forwarded to our pino instance below.
  const app = Fastify({ logger: false });
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    log.error({ err }, "http error");
    void reply.code(err.statusCode ?? 500).send({ error: err.message });
  });
  await app.register(fastifyWebsocket, { options: { maxPayload: 1024 * 1024 } });

  app.get("/api/health", async () => ({ ok: true }));

  const dist = findWebDist();
  if (dist) {
    await app.register(fastifyStatic, { root: dist, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/ws")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "not found" });
    });
    log.info({ dist }, "serving built web UI");
  } else {
    log.warn("web UI is not built; use `pnpm dev` (Vite on :5173) or run `pnpm build`");
  }

  return app;
}
