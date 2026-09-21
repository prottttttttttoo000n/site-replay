import { Hono } from "hono";
import type { Env } from "../types";

const sessions = new Hono<{ Bindings: Env }>();

sessions.get("/", async (c) => {
  const siteId = c.req.query("siteId");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");

  if (!siteId) {
    return c.json({ error: "siteId query parameter required" }, 400);
  }

  const hub = c.env.SESSION_HUB.get(c.env.SESSION_HUB.idFromName("main"));

  const response = await hub.fetch(
    new Request(`https://internal/sessions?siteId=${siteId}&limit=${limit}&offset=${offset}`)
  );

  return response;
});

export { sessions as sessionsRoute };
