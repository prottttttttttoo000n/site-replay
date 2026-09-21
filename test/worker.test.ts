import { describe, it, expect, beforeAll } from "vitest";

// These tests run against the local dev server
// Make sure to run `npm run dev` in the worker workspace first

const BASE_URL = "http://127.0.0.1:8787";

describe("Worker API", () => {
  describe("GET /api/health", () => {
    it("returns health status", async () => {
      const res = await fetch(`${BASE_URL}/api/health`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe("ok");
      expect(data.service).toBe("site-replay");
      expect(data.timestamp).toBeDefined();
    });
  });

  describe("GET /r.js", () => {
    it("serves recorder script", async () => {
      const res = await fetch(`${BASE_URL}/r.js`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("javascript");
    });

    it("has correct cache headers", async () => {
      const res = await fetch(`${BASE_URL}/r.js`);
      expect(res.headers.get("Cache-Control")).toContain("max-age");
    });

    it("allows CORS", async () => {
      const res = await fetch(`${BASE_URL}/r.js`);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  describe("POST /api/ingest", () => {
    it("rejects invalid requests", async () => {
      const res = await fetch(`${BASE_URL}/api/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("accepts valid event batches", async () => {
      const res = await fetch(`${BASE_URL}/api/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          events: [
            { type: "navigation", timestamp: 0, url: "https://example.com" },
            { type: "click", timestamp: 100, x: 100, y: 200, target: "#btn" },
          ],
        }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.received).toBe(2);
    });

    it("handles empty event arrays", async () => {
      const res = await fetch(`${BASE_URL}/api/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-456",
          events: [],
        }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.received).toBe(0);
    });
  });

  describe("GET /api/sessions", () => {
    it("requires siteId parameter", async () => {
      const res = await fetch(`${BASE_URL}/api/sessions`);
      expect(res.status).toBe(400);
    });

    it("returns sessions list", async () => {
      const res = await fetch(`${BASE_URL}/api/sessions?siteId=localhost`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.sessions).toBeDefined();
      expect(Array.isArray(data.sessions)).toBe(true);
      expect(typeof data.live).toBe("number");
    });
  });

  describe("GET /api/session/:id", () => {
    it("returns session data", async () => {
      // First create a session via ingest
      await fetch(`${BASE_URL}/api/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-789",
          events: [{ type: "navigation", timestamp: 0, url: "https://example.com" }],
        }),
      });

      // Small delay for DO processing
      await new Promise((r) => setTimeout(r, 100));

      const res = await fetch(`${BASE_URL}/api/session/test-session-789`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.meta).toBeDefined();
      expect(data.events).toBeDefined();
      expect(Array.isArray(data.events)).toBe(true);
    });
  });
});
