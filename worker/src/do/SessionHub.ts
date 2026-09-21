import { DurableObject } from "cloudflare:workers";
import type { ReplayEvent, Env } from "../types";

interface SessionState {
  id: string;
  siteId: string;
  startedAt: string;
  endedAt?: string;
  eventCount: number;
  pageUrl: string;
  userAgent: string;
}

export class SessionHub extends DurableObject<Env> {
  private sessions = new Map<string, SessionState>();
  private viewers = new Map<string, WebSocket[]>();
  private initialized = false;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  private async initialize() {
    if (this.initialized) return;
    this.initialized = true;

    // Create tables
    await this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration INTEGER,
        page_url TEXT DEFAULT '',
        user_agent TEXT DEFAULT '',
        event_count INTEGER DEFAULT 0,
        rage_clicks INTEGER DEFAULT 0,
        dead_clicks INTEGER DEFAULT 0,
        metadata TEXT DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_site ON sessions(site_id, started_at);
    `);

    // Load active sessions into memory
    const results = this.ctx.storage.sql.exec(
      "SELECT id, site_id, started_at, event_count, page_url, user_agent FROM sessions WHERE ended_at IS NULL"
    );
    for (const row of results) {
      this.sessions.set(row.id as string, {
        id: row.id as string,
        siteId: row.site_id as string,
        startedAt: row.started_at as string,
        eventCount: row.event_count as number,
        pageUrl: row.page_url as string,
        userAgent: row.user_agent as string,
      });
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.initialize();

    const url = new URL(request.url);
    const path = url.pathname;

    // WebSocket: recorder ingestion
    if (path === "/ws/record") {
      return this.handleRecordWS(request);
    }

    // WebSocket: dashboard live view
    if (path === "/ws/watch") {
      return this.handleWatchWS(request);
    }

    // HTTP: batch event ingestion
    if (path === "/ingest" && request.method === "POST") {
      return this.handleBatchIngest(request);
    }

    // HTTP: list sessions
    if (path === "/sessions") {
      return this.handleListSessions(url);
    }

    // HTTP: get single session with events
    if (path.startsWith("/session/")) {
      const sessionId = path.split("/")[2];
      return this.handleGetSession(sessionId);
    }

    return new Response("Not Found", { status: 404 });
  }

  // ─── WebSocket: Recorder ───
  private handleRecordWS(request: Request): Response {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sid");

    if (!sessionId) {
      return new Response("Missing sid parameter", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.ctx.acceptWebSocket(server, `recorder:${sessionId}`);

    // Create session record
    const session: SessionState = {
      id: sessionId,
      siteId: "default",
      startedAt: new Date().toISOString(),
      eventCount: 0,
      pageUrl: "",
      userAgent: "",
    };
    this.sessions.set(sessionId, session);

    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO sessions (id, site_id, started_at) VALUES (?, ?, ?)",
      [sessionId, session.siteId, session.startedAt]
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── WebSocket: Dashboard Viewer ───
  private handleWatchWS(request: Request): Response {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sid");

    if (!sessionId) {
      return new Response("Missing sid parameter", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.ctx.acceptWebSocket(server, `viewer:${sessionId}`);

    // Add to viewers
    if (!this.viewers.has(sessionId)) {
      this.viewers.set(sessionId, []);
    }
    this.viewers.get(sessionId)!.push(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── WebSocket Messages ───
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const tags = (ws as any).attachedTags as string[] | undefined;
    const tag = tags?.[0] || "";

    try {
      const data = JSON.parse(message as string);

      if (tag.startsWith("recorder:")) {
        const sessionId = tag.split(":")[1];
        const events = Array.isArray(data) ? data : [data];
        await this.processEvents(sessionId, events);
      }

      if (tag.startsWith("viewer:") && data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch (e) {
      console.error("WebSocket message error:", e);
    }
  }

  async webSocketClose(ws: WebSocket) {
    const tags = (ws as any).attachedTags as string[] | undefined;
    const tag = tags?.[0] || "";

    if (tag.startsWith("recorder:")) {
      const sessionId = tag.split(":")[1];
      await this.endSession(sessionId);
    }

    if (tag.startsWith("viewer:")) {
      const sessionId = tag.split(":")[1];
      const viewers = this.viewers.get(sessionId) || [];
      this.viewers.set(
        sessionId,
        viewers.filter((v) => v !== ws)
      );
    }
  }

  // ─── Event Processing ───
  private async processEvents(sessionId: string, events: ReplayEvent[]) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Store events in SQLite
    for (const event of events) {
      await this.ctx.storage.sql.exec(
        "INSERT INTO events (session_id, type, timestamp, data) VALUES (?, ?, ?, ?)",
        [sessionId, event.type, event.timestamp, JSON.stringify(event)]
      );
    }

    // Update session metadata
    session.eventCount += events.length;

    // Extract page info from navigation events
    const navEvent = events.find((e) => e.type === "navigation");
    if (navEvent) {
      session.pageUrl = navEvent.url || "";
      session.userAgent = navEvent.userAgent || "";

      // Update siteId if provided
      const url = new URL(navEvent.url || "https://unknown");
      session.siteId = url.hostname;
    }

    await this.ctx.storage.sql.exec(
      "UPDATE sessions SET event_count = ?, page_url = ?, user_agent = ? WHERE id = ?",
      [session.eventCount, session.pageUrl, session.userAgent, sessionId]
    );

    // Broadcast to live viewers
    const viewers = this.viewers.get(sessionId) || [];
    const msg = JSON.stringify(events);
    for (const viewer of viewers) {
      try {
        viewer.send(msg);
      } catch {
        // Viewer disconnected
      }
    }
  }

  private async endSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const endedAt = new Date().toISOString();
    const duration = new Date(endedAt).getTime() - new Date(session.startedAt).getTime();

    await this.ctx.storage.sql.exec(
      "UPDATE sessions SET ended_at = ?, duration = ? WHERE id = ?",
      [endedAt, duration, sessionId]
    );

    session.endedAt = endedAt;

    // Archive to R2 if session has meaningful data
    if (session.eventCount > 10) {
      await this.archiveSession(sessionId);
    }
  }

  private async archiveSession(sessionId: string) {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) return;

      // Fetch all events
      const results = this.ctx.storage.sql.exec(
        "SELECT type, timestamp, data FROM events WHERE session_id = ? ORDER BY timestamp",
        [sessionId]
      );

      const events: any[] = [];
      for (const row of results) {
        events.push({
          type: row.type,
          timestamp: row.timestamp,
          ...JSON.parse(row.data as string),
        });
      }

      const key = `${session.siteId}/${sessionId}.json`;

      await this.env.SESSION_ARCHIVE.put(
        key,
        JSON.stringify({
          meta: session,
          events,
        })
      );
    } catch (e) {
      console.error("Archive error:", e);
    }
  }

  // ─── HTTP Handlers ───
  private async handleBatchIngest(request: Request): Promise<Response> {
    const { sessionId, events } = await request.json();
    await this.processEvents(sessionId, events);
    return new Response(JSON.stringify({ ok: true, received: events.length }));
  }

  private async handleListSessions(url: URL): Promise<Response> {
    const siteId = url.searchParams.get("siteId");
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const offset = parseInt(url.searchParams.get("offset") || "0");

    const results = this.ctx.storage.sql.exec(
      "SELECT * FROM sessions WHERE site_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?",
      [siteId, limit, offset]
    );

    const sessions: any[] = [];
    for (const row of results) {
      sessions.push(row);
    }

    // Count live sessions
    const live = Array.from(this.sessions.values()).filter(
      (s) => !s.endedAt && s.siteId === siteId
    ).length;

    return new Response(
      JSON.stringify({
        sessions,
        total: sessions.length,
        live,
      })
    );
  }

  private async handleGetSession(sessionId: string): Promise<Response> {
    const session = this.sessions.get(sessionId);

    // Fetch events from SQLite
    const results = this.ctx.storage.sql.exec(
      "SELECT type, timestamp, data FROM events WHERE session_id = ? ORDER BY timestamp",
      [sessionId]
    );

    const events: any[] = [];
    for (const row of results) {
      events.push({
        type: row.type,
        timestamp: row.timestamp,
        ...JSON.parse(row.data as string),
      });
    }

    return new Response(
      JSON.stringify({
        meta: session,
        events,
      })
    );
  }
}
