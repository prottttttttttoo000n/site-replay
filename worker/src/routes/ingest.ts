import { Hono } from "hono";
import type { Env } from "../types";

const ingest = new Hono<{ Bindings: Env }>();

ingest.post("/", async (c) => {
  const body = await c.req.json();
  const { sessionId, events } = body;

  if (!sessionId || !Array.isArray(events)) {
    return c.json({ error: "Invalid request: sessionId and events[] required" }, 400);
  }

  if (events.length === 0) {
    return c.json({ ok: true, received: 0 });
  }

  // Forward to Durable Object
  const hub = c.env.SESSION_HUB.get(c.env.SESSION_HUB.idFromName("main"));

  const response = await hub.fetch(
    new Request("https://internal/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, events }),
    })
  );

  return response;
});

export { ingest as ingestRoute };
