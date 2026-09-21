import type { Context, Next } from "hono";

export async function validateSiteId(c: Context, next: Next) {
  const siteId = c.req.header("X-Site-ID") || c.req.query("siteId");

  if (!siteId) {
    return c.json({ error: "Missing site ID" }, 401);
  }

  // Validate format (8 char alphanumeric)
  if (!/^[0-9A-Za-z]{8}$/.test(siteId)) {
    return c.json({ error: "Invalid site ID format" }, 400);
  }

  // Store for downstream use
  c.set("siteId", siteId);
  await next();
}
