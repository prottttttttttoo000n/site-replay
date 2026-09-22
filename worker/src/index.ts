import { Hono } from "hono";
import { cors } from "hono/cors";
import { ingestRoute } from "./routes/ingest";
import { sessionsRoute } from "./routes/sessions";
import { healthRoute } from "./routes/health";
import { SessionHub } from "./do/SessionHub";

import type { Env } from "./types";

export { SessionHub };

const app = new Hono<{ Bindings: Env }>();

// CORS for dashboard (apex domain + any pages.dev deployment alias)
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (!origin) return origin;
      const u = new URL(origin);
      if (u.hostname === "site-replay.pages.dev") return origin;
      if (u.hostname.endsWith(".site-replay.pages.dev")) return origin;
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return origin;
      return null;
    },
    credentials: true,
  })
);

// API routes
app.route("/api/health", healthRoute);
app.route("/api/ingest", ingestRoute);
app.route("/api/sessions", sessionsRoute);

// Single session data
app.get("/api/session/:id", async (c) => {
  const id = c.req.param("id");
  const hub = c.env.SESSION_HUB.get(c.env.SESSION_HUB.idFromName("main"));
  return hub.fetch(new Request(`https://internal/session/${id}`));
});

// WebSocket upgrade for recorder
app.get("/ws/record", async (c) => {
  const hub = c.env.SESSION_HUB.get(c.env.SESSION_HUB.idFromName("main"));
  return hub.fetch(c.req.raw);
});

// WebSocket upgrade for dashboard live view
app.get("/ws/watch", async (c) => {
  const hub = c.env.SESSION_HUB.get(c.env.SESSION_HUB.idFromName("main"));
  return hub.fetch(c.req.raw);
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // With run_worker_first: true, every request reaches the worker first.
    // Serve static assets (r.js) from the ASSETS binding; everything else
    // goes through the Hono app.
    const url = new URL(request.url);

    // Only attempt asset routing for plain GET requests without API/WS paths.
    const isAssetPath =
      request.method === "GET" &&
      !url.pathname.startsWith("/api/") &&
      !url.pathname.startsWith("/ws/");

    if (isAssetPath) {
      const asset = await env.ASSETS.fetch(request.clone());
      if (asset.status !== 404) {
        return asset;
      }
    }

    return app.fetch(request, env, ctx);
  },
};
