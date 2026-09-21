# Site Replay — Work Plan

> Session replay tool for the privacy-first web. Record user interactions, replay them like video. Self-hosted on Cloudflare.

---

## Project Overview

**Goal**: Build a complete session replay system — recorder script, backend API, Durable Object for real-time storage, and a React dashboard for viewing replays.

**Stack**: CF Workers (Hono) + Durable Objects (SQLite) + R2 + React + Vite + Tailwind

**Timeline**: 10-14 days of focused work

---

## Phase 0: Project Scaffolding

### 0.1 Initialize Monorepo Structure

```
site-replay/
├── package.json              # Root workspace config
├── worker/                   # CF Worker backend
│   ├── package.json
│   ├── wrangler.jsonc
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts          # Entry point + router
│       ├── types.ts          # Shared types
│       ├── routes/
│       │   ├── ingest.ts     # POST /api/ingest
│       │   ├── sessions.ts   # GET /api/sessions
│       │   └── health.ts     # GET /api/health
│       ├── do/
│       │   └── SessionHub.ts # Durable Object
│       └── lib/
│           ├── auth.ts       # Site ID validation
│           └── storage.ts    # R2 archival helpers
├── recorder/                 # The r.js script (separate build)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   └── index.ts          # Recorder source
│   └── build.ts              # Build script -> outputs r.js
├── dashboard/                # React SPA
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       ├── lib/
│       └── types.ts
└── test/                     # Integration tests
    ├── worker.test.ts
    └── recorder.test.ts
```

### 0.2 Root package.json

```json
{
  "name": "site-replay",
  "private": true,
  "workspaces": ["worker", "recorder", "dashboard"],
  "scripts": {
    "dev": "npm run dev --workspace=worker",
    "build": "npm run build --workspaces",
    "test": "vitest run",
    "deploy": "npm run deploy --workspace=worker && npm run deploy --workspace=dashboard"
  }
}
```

### 0.3 Wrangler Config (worker/wrangler.jsonc)

```jsonc
{
  "name": "site-replay",
  "main": "src/index.ts",
  "compatibility_date": "2024-01-01",
  "routes": [
    { "pattern": "replay.yourdomain.com/*", "zone_name": "yourdomain.com" }
  ],
  "durable_objects": {
    "bindings": [
      { "name": "SESSION_HUB", "class_name": "SessionHub" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_classes": ["SessionHub"] }
  ],
  "r2_buckets": [
    { "binding": "SESSION_ARCHIVE", "bucket_name": "session-archive" }
  ],
  "vars": {
    "ENVIRONMENT": "production"
  }
}
```

### 0.4 Shared Types (worker/src/types.ts)

```typescript
export interface ReplayEvent {
  type: "mousemove" | "click" | "scroll" | "input" | "navigation" | "resize" | "rageClick";
  timestamp: number;
  x?: number;
  y?: number;
  target?: string;
  value?: string;
  text?: string;
  url?: string;
  referrer?: string;
  scrollX?: number;
  scrollY?: number;
  screenWidth?: number;
  screenHeight?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  userAgent?: string;
}

export interface SessionMeta {
  id: string;
  siteId: string;
  startedAt: string;
  endedAt?: string;
  duration?: number;
  pageUrl: string;
  userAgent: string;
  screenWidth: number;
  screenHeight: number;
  eventCount: number;
  rageClicks: number;
  deadClicks: number;
}

export interface Env {
  SESSION_HUB: DurableObjectNamespace;
  SESSION_ARCHIVE: R2Bucket;
  ENVIRONMENT: string;
}
```

---

## Phase 1: Recorder Script (r.js)

**Goal**: A <2KB gzipped vanilla JS script that captures user interactions and sends them to the backend.

### 1.1 Event Capture System

| Event | Throttle | Data |
|---|---|---|
| `mousemove` | 50ms (20fps) | x, y |
| `click` | none | target selector, x, y, text |
| `scroll` | 100ms | scrollX, scrollY |
| `input` | none | target selector, value (masked if sensitive) |
| `resize` | none | width, height |
| `navigation` | on page load | url, referrer, userAgent |
| `rageClick` | detection | target, count (3+ clicks in 1s on same element) |

### 1.2 Core Implementation

```typescript
// recorder/src/index.ts

const SESSION_ID = crypto.randomUUID();
const BATCH_SIZE = 50;
const FLUSH_INTERVAL = 1000;

let buffer: any[] = [];
let ws: WebSocket | null = null;
let sessionStartTime = Date.now();
let retryCount = 0;

// ─── Throttle ───
function throttle(fn: Function, ms: number) {
  let last = 0;
  return (...args: any[]) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...args); }
  };
}

// ─── CSS Selector ───
function getSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.body) {
    let sel = cur.tagName.toLowerCase();
    if (cur.id) { sel = `#${cur.id}`; parts.unshift(sel); break; }
    if (cur.className && typeof cur.className === 'string')
      sel += '.' + cur.className.trim().split(/\s+/).join('.');
    parts.unshift(sel);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

// ─── Sensitive Field Detection ───
function isSensitive(el: HTMLInputElement): boolean {
  const t = el.type?.toLowerCase();
  const n = el.name?.toLowerCase();
  const a = el.autocomplete?.toLowerCase();
  return t === 'password' || n?.includes('password') || n?.includes('credit')
    || n?.includes('ssn') || a?.includes('cc-') || a?.includes('password');
}

// ─── Event Capture ───
function capture(type: string, data: any) {
  buffer.push({ type, timestamp: Date.now() - sessionStartTime, ...data });
  if (buffer.length >= BATCH_SIZE) flush();
}

// Mouse moves (20fps)
document.addEventListener('mousemove', throttle((e: MouseEvent) => {
  capture('mousemove', { x: e.clientX, y: e.clientY });
}, 50));

// Clicks
document.addEventListener('click', (e: MouseEvent) => {
  const target = e.target as Element;
  capture('click', {
    target: getSelector(target),
    text: target.textContent?.slice(0, 100),
    x: e.clientX, y: e.clientY,
  });
});

// Scrolls (10fps)
document.addEventListener('scroll', throttle(() => {
  capture('scroll', { scrollX: window.scrollX, scrollY: window.scrollY });
}, 100));

// Inputs (masked if sensitive)
document.addEventListener('input', (e: Event) => {
  const el = e.target as HTMLInputElement;
  const value = isSensitive(el) ? '*'.repeat(el.value.length) : el.value;
  capture('input', { target: getSelector(el), value });
});

// Resize
window.addEventListener('resize', () => {
  capture('resize', { width: window.innerWidth, height: window.innerHeight });
});

// ─── Transport ───
function send(events: any[]) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(events));
  } else {
    fetch('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: SESSION_ID, events }),
    }).catch(() => {
      if (retryCount < 3) { retryCount++; setTimeout(() => send(events), 1000 * 2 ** retryCount); }
    });
  }
}

function flush() {
  if (buffer.length === 0) return;
  send(buffer.splice(0, BATCH_SIZE));
}

// ─── WebSocket ───
function connect() {
  const host = (document.currentScript as HTMLScriptElement)?.dataset?.host || location.host;
  ws = new WebSocket(`wss://${host}/ws/record?sid=${SESSION_ID}`);

  ws.onopen = () => {
    capture('navigation', {
      url: location.href, referrer: document.referrer,
      userAgent: navigator.userAgent,
      screenWidth: screen.width, screenHeight: screen.height,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
    });
    flush();
  };

  ws.onclose = () => {
    const delay = Math.min(30000, 1000 * 2 ** retryCount);
    setTimeout(connect, delay);
    retryCount++;
  };
}

// ─── Init ───
if (!window.__SITE_REPLAY_OPT_OUT) {
  connect();
  setInterval(flush, FLUSH_INTERVAL);
  window.addEventListener('beforeunload', flush);
}
```

### 1.3 Build Process

```typescript
// recorder/build.ts
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  minify: true,
  outfile: '../worker/src/generated/r.js',
  format: 'iife',
  target: 'es2020',
});
```

**Deliverables**:
- [ ] `recorder/src/index.ts` -- full recorder
- [ ] `recorder/build.ts` -- build script
- [ ] `worker/src/generated/r.js` -- bundled output
- [ ] Test on sample HTML page

---

## Phase 2: Backend API (CF Worker + Hono)

**Goal**: Worker that serves the recorder script, receives events, and exposes session APIs.

### 2.1 Router (worker/src/index.ts)

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ingestRoute } from './routes/ingest';
import { sessionsRoute } from './routes/sessions';
import { healthRoute } from './routes/health';
import type { Env } from './types';

// @ts-ignore - generated by recorder build
import { RJS_CONTENT } from './generated/r.js';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors({
  origin: ['http://localhost:5173', 'https://replay.yourdomain.com'],
  credentials: true,
}));

// Serve recorder script
app.get('/r.js', (c) => {
  return c.text(RJS_CONTENT, 200, {
    'Content-Type': 'application/javascript',
    'Cache-Control': 'public, max-age=3600',
    'Access-Control-Allow-Origin': '*',
  });
});

app.route('/api/health', healthRoute);
app.route('/api/ingest', ingestRoute);
app.route('/api/sessions', sessionsRoute);

// Single session data
app.get('/api/session/:id', async (c) => {
  const id = c.req.param('id');
  const hub = c.env.SESSION_HUB.get(c.env.SESSION_HUB.idFromName('main'));
  return hub.fetch(new Request(`https://internal/session/${id}`));
});

// WebSocket upgrade for recorder
app.get('/ws/record', async (c) => {
  const hub = c.env.SESSION_HUB.get(c.env.SESSION_HUB.idFromName('main'));
  return hub.fetch(c.req.raw);
});

// WebSocket upgrade for dashboard live view
app.get('/ws/watch', async (c) => {
  const hub = c.env.SESSION_HUB.get(c.env.SESSION_HUB.idFromName('main'));
  return hub.fetch(c.req.raw);
});

export default { fetch: app.fetch };
```

### 2.2 Ingest Route

```typescript
// worker/src/routes/ingest.ts
import { Hono } from 'hono';
import type { Env } from '../types';

const ingest = new Hono<{ Bindings: Env }>();

ingest.post('/', async (c) => {
  const body = await c.req.json();
  const { sessionId, events } = body;

  if (!sessionId || !Array.isArray(events)) {
    return c.json({ error: 'Invalid request' }, 400);
  }

  const hub = c.env.SESSION_HUB.get(c.env.SESSION_HUB.idFromName('main'));
  return hub.fetch(new Request('https://internal/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, events }),
  }));
});

export { ingest as ingestRoute };
```

### 2.3 Sessions Route

```typescript
// worker/src/routes/sessions.ts
import { Hono } from 'hono';
import type { Env } from '../types';

const sessions = new Hono<{ Bindings: Env }>();

sessions.get('/', async (c) => {
  const siteId = c.req.query('siteId');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  if (!siteId) return c.json({ error: 'siteId required' }, 400);

  const hub = c.env.SESSION_HUB.get(c.env.SESSION_HUB.idFromName('main'));
  return hub.fetch(new Request(
    `https://internal/sessions?siteId=${siteId}&limit=${limit}&offset=${offset}`
  ));
});

export { sessions as sessionsRoute };
```

### 2.4 Health Route

```typescript
// worker/src/routes/health.ts
import { Hono } from 'hono';

const health = new Hono();

health.get('/', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

export { health as healthRoute };
```

**Deliverables**:
- [ ] `worker/src/index.ts` -- main router
- [ ] `worker/src/routes/ingest.ts`
- [ ] `worker/src/routes/sessions.ts`
- [ ] `worker/src/routes/health.ts`
- [ ] `worker/wrangler.jsonc`

---

## Phase 3: Durable Object (SessionHub)

**Goal**: Real-time event storage, WebSocket management, and session archival.

### 3.1 SQLite Schema

```sql
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
  data TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_site ON sessions(site_id, started_at);
```

### 3.2 SessionHub Class

```typescript
// worker/src/do/SessionHub.ts
import { DurableObject } from 'cloudflare:workers';
import type { ReplayEvent, Env } from '../types';

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

  async initialize() {
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

    // Load active sessions
    const results = this.ctx.storage.sql.exec(
      'SELECT id, site_id, started_at, event_count, page_url, user_agent FROM sessions WHERE ended_at IS NULL'
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

    if (path === '/ws/record') return this.handleRecordWS(request);
    if (path === '/ws/watch') return this.handleWatchWS(request);
    if (path === '/ingest') return this.handleBatchIngest(request);
    if (path === '/sessions') return this.handleListSessions(url);
    if (path.startsWith('/session/')) return this.handleGetSession(path.split('/')[2]);

    return new Response('Not Found', { status: 404 });
  }

  // ─── WebSocket: Recorder ───
  private handleRecordWS(request: Request): Response {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sid');
    const siteId = url.searchParams.get('site');

    if (!sessionId || !siteId) {
      return new Response('Missing sid or site', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.ctx.acceptWebSocket(server, `recorder:${sessionId}`);

    // Create session
    const session: SessionState = {
      id: sessionId, siteId,
      startedAt: new Date().toISOString(),
      eventCount: 0, pageUrl: '', userAgent: '',
    };
    this.sessions.set(sessionId, session);

    this.ctx.storage.sql.exec(
      'INSERT INTO sessions (id, site_id, started_at) VALUES (?, ?, ?)',
      [sessionId, siteId, session.startedAt]
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── WebSocket: Dashboard Viewer ───
  private handleWatchWS(request: Request): Response {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sid');
    if (!sessionId) return new Response('Missing sid', { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.ctx.acceptWebSocket(server, `viewer:${sessionId}`);

    if (!this.viewers.has(sessionId)) this.viewers.set(sessionId, []);
    this.viewers.get(sessionId)!.push(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── WebSocket Messages ───
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const tags = (ws as any).attachedTags as string[] | undefined;
    const tag = tags?.[0] || '';
    const data = JSON.parse(message as string);

    if (tag.startsWith('recorder:')) {
      const sessionId = tag.split(':')[1];
      const events = Array.isArray(data) ? data : [data];
      await this.processEvents(sessionId, events);
    }

    if (tag.startsWith('viewer:') && data.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  }

  async webSocketClose(ws: WebSocket) {
    const tags = (ws as any).attachedTags as string[] | undefined;
    const tag = tags?.[0] || '';

    if (tag.startsWith('recorder:')) {
      await this.endSession(tag.split(':')[1]);
    }

    if (tag.startsWith('viewer:')) {
      const sid = tag.split(':')[1];
      const viewers = this.viewers.get(sid) || [];
      this.viewers.set(sid, viewers.filter(v => v !== ws));
    }
  }

  // ─── Event Processing ───
  private async processEvents(sessionId: string, events: ReplayEvent[]) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    for (const event of events) {
      await this.ctx.storage.sql.exec(
        'INSERT INTO events (session_id, type, timestamp, data) VALUES (?, ?, ?, ?)',
        [sessionId, event.type, event.timestamp, JSON.stringify(event)]
      );
    }

    session.eventCount += events.length;

    const navEvent = events.find(e => e.type === 'navigation');
    if (navEvent) {
      session.pageUrl = navEvent.url || '';
      session.userAgent = navEvent.userAgent || '';
    }

    await this.ctx.storage.sql.exec(
      'UPDATE sessions SET event_count = ?, page_url = ?, user_agent = ? WHERE id = ?',
      [session.eventCount, session.pageUrl, session.userAgent, sessionId]
    );

    // Broadcast to live viewers
    const viewers = this.viewers.get(sessionId) || [];
    const msg = JSON.stringify(events);
    for (const v of viewers) {
      try { v.send(msg); } catch {}
    }
  }

  private async endSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const endedAt = new Date().toISOString();
    const duration = new Date(endedAt).getTime() - new Date(session.startedAt).getTime();

    await this.ctx.storage.sql.exec(
      'UPDATE sessions SET ended_at = ?, duration = ? WHERE id = ?',
      [endedAt, duration, sessionId]
    );

    session.endedAt = endedAt;

    // Archive to R2 if significant
    if (session.eventCount > 10) {
      await this.archiveSession(sessionId);
    }
  }

  private async archiveSession(sessionId: string) {
    const results = this.ctx.storage.sql.exec(
      'SELECT * FROM events WHERE session_id = ? ORDER BY timestamp',
      [sessionId]
    );

    const events: any[] = [];
    for (const row of results) events.push(row);

    const session = this.sessions.get(sessionId);
    const key = `${session?.siteId}/${sessionId}.json`;

    await this.env.SESSION_ARCHIVE.put(key, JSON.stringify({
      meta: session,
      events,
    }));
  }

  // ─── HTTP Handlers ───
  private async handleBatchIngest(request: Request): Promise<Response> {
    const { sessionId, events } = await request.json();
    await this.processEvents(sessionId, events);
    return new Response(JSON.stringify({ ok: true, received: events.length }));
  }

  private async handleListSessions(url: URL): Promise<Response> {
    const siteId = url.searchParams.get('siteId');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const results = this.ctx.storage.sql.exec(
      'SELECT * FROM sessions WHERE site_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?',
      [siteId, limit, offset]
    );

    const sessions: any[] = [];
    for (const row of results) sessions.push(row);

    const live = Array.from(this.sessions.values())
      .filter(s => !s.endedAt && s.siteId === siteId).length;

    return new Response(JSON.stringify({ sessions, total: sessions.length, live }));
  }

  private async handleGetSession(sessionId: string): Promise<Response> {
    const session = this.sessions.get(sessionId);

    const results = this.ctx.storage.sql.exec(
      'SELECT * FROM events WHERE session_id = ? ORDER BY timestamp',
      [sessionId]
    );

    const events: any[] = [];
    for (const row of results) events.push(row);

    return new Response(JSON.stringify({ meta: session, events }));
  }
}
```

**Deliverables**:
- [ ] `worker/src/do/SessionHub.ts` -- full Durable Object
- [ ] SQLite schema creation on first init
- [ ] WebSocket handling for record + watch
- [ ] R2 archival for completed sessions

---

## Phase 4: Dashboard (React SPA)

**Goal**: Session list, replay player, and live viewer.

### 4.1 Setup

```typescript
// dashboard/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
});
```

### 4.2 Components

```
dashboard/src/
├── components/
│   ├── Layout.tsx           # App shell with nav
│   ├── SessionList.tsx      # Table of sessions with filters
│   ├── SessionRow.tsx       # Single session row
│   ├── SessionPlayer.tsx    # Replay viewer with controls
│   ├── EventTimeline.tsx    # Timeline visualization
│   ├── Filters.tsx          # Filter bar (date, url, device)
│   ├── Stats.tsx            # Summary stats
│   └── LiveIndicator.tsx    # Green dot for live sessions
├── lib/
│   ├── api.ts               # API client
│   ├── player.ts            # Replay engine
│   └── websocket.ts         # Live viewer WS client
├── App.tsx
├── main.tsx
└── types.ts
```

### 4.3 Replay Player Engine

```typescript
// dashboard/src/lib/player.ts
import type { ReplayEvent } from '../types';

export class ReplayPlayer {
  private events: ReplayEvent[] = [];
  private currentIndex = 0;
  private startTime = 0;
  private isPlaying = false;
  private speed = 1;
  private animationFrame: number = 0;
  private onEvent: (event: ReplayEvent) => void;
  private onProgress: (progress: number) => void;

  constructor(
    events: ReplayEvent[],
    onEvent: (e: ReplayEvent) => void,
    onProgress: (p: number) => void,
  ) {
    this.events = events;
    this.onEvent = onEvent;
    this.onProgress = onProgress;
  }

  play() {
    this.isPlaying = true;
    this.startTime = performance.now() - (this.events[this.currentIndex]?.timestamp || 0) / this.speed;
    this.tick();
  }

  pause() {
    this.isPlaying = false;
    cancelAnimationFrame(this.animationFrame);
  }

  seek(timestamp: number) {
    // Find closest event
    this.currentIndex = this.events.findIndex(e => e.timestamp >= timestamp);
    if (this.currentIndex === -1) this.currentIndex = this.events.length - 1;
    this.startTime = performance.now() - timestamp / this.speed;
    this.emitCurrentEvent();
  }

  setSpeed(speed: number) {
    this.speed = speed;
    if (this.isPlaying) {
      this.startTime = performance.now() - this.currentTimestamp() / speed;
    }
  }

  private tick() {
    if (!this.isPlaying) return;

    const elapsed = (performance.now() - this.startTime) * this.speed;

    while (this.currentIndex < this.events.length &&
           this.events[this.currentIndex].timestamp <= elapsed) {
      this.emitCurrentEvent();
      this.currentIndex++;
    }

    // Progress
    const total = this.events[this.events.length - 1]?.timestamp || 1;
    this.onProgress(elapsed / total);

    if (this.currentIndex < this.events.length) {
      this.animationFrame = requestAnimationFrame(() => this.tick());
    } else {
      this.isPlaying = false;
    }
  }

  private emitCurrentEvent() {
    if (this.currentIndex < this.events.length) {
      this.onEvent(this.events[this.currentIndex]);
    }
  }

  private currentTimestamp(): number {
    return this.events[this.currentIndex]?.timestamp || 0;
  }
}
```

### 4.4 Session Player Component

```tsx
// dashboard/src/components/SessionPlayer.tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { ReplayPlayer } from '../lib/player';
import type { ReplayEvent } from '../types';

interface Props {
  sessionId: string;
  events: ReplayEvent[];
}

export function SessionPlayer({ sessionId, events }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [progress, setProgress] = useState(0);
  const [currentEvent, setCurrentEvent] = useState<ReplayEvent | null>(null);
  const playerRef = useRef<ReplayPlayer | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;

    playerRef.current = new ReplayPlayer(
      events,
      (event) => {
        setCurrentEvent(event);
        renderEvent(ctx, canvas, event);
      },
      (p) => setProgress(p),
    );

    return () => playerRef.current?.pause();
  }, [events]);

  const renderEvent = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, event: ReplayEvent) => {
    // Clear or draw based on event type
    switch (event.type) {
      case 'mousemove':
        // Draw cursor
        break;
      case 'click':
        // Draw click indicator
        break;
      case 'scroll':
        // Scroll the canvas
        break;
    }
  };

  return (
    <div className="space-y-4">
      <canvas
        ref={canvasRef}
        width={1920}
        height={1080}
        className="w-full border rounded-lg bg-white"
      />

      <div className="flex items-center gap-4">
        <button onClick={() => isPlaying ? playerRef.current?.pause() : playerRef.current?.play()}>
          {isPlaying ? 'Pause' : 'Play'}
        </button>

        <select value={speed} onChange={(e) => {
          const s = parseFloat(e.target.value);
          setSpeed(s);
          playerRef.current?.setSpeed(s);
        }}>
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={2}>2x</option>
          <option value={4}>4x</option>
        </select>

        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={progress}
          onChange={(e) => {
            const time = parseFloat(e.target.value) * (events[events.length - 1]?.timestamp || 1);
            playerRef.current?.seek(time);
          }}
        />

        <span>{currentEvent?.type || 'idle'}</span>
      </div>
    </div>
  );
}
```

### 4.5 API Client

```typescript
// dashboard/src/lib/api.ts
const API_BASE = import.meta.env.DEV ? '' : 'https://replay.yourdomain.com';

export async function fetchSessions(siteId: string, limit = 50, offset = 0) {
  const res = await fetch(`${API_BASE}/api/sessions?siteId=${siteId}&limit=${limit}&offset=${offset}`);
  return res.json();
}

export async function fetchSession(sessionId: string) {
  const res = await fetch(`${API_BASE}/api/session/${sessionId}`);
  return res.json();
}

export function watchSession(sessionId: string, onEvents: (events: any[]) => void): WebSocket {
  const ws = new WebSocket(`wss://${location.host}/ws/watch?sid=${sessionId}`);
  ws.onmessage = (e) => onEvents(JSON.parse(e.data));
  return ws;
}
```

**Deliverables**:
- [ ] `dashboard/src/` -- full React app
- [ ] Session list with filters
- [ ] Replay player with canvas rendering
- [ ] Live session viewer
- [ ] Responsive design

---

## Phase 5: Testing

### 5.1 Worker Tests

```typescript
// test/worker.test.ts
import { describe, it, expect } from 'vitest';

describe('Worker', () => {
  it('returns health check', async () => {
    const res = await SELF.fetch('https://replay.example.com/api/health');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('serves recorder script', async () => {
    const res = await SELF.fetch('https://replay.example.com/r.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/javascript');
  });

  it('validates ingest request', async () => {
    const res = await SELF.fetch('https://replay.example.com/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
```

### 5.2 Recorder Tests

```typescript
// test/recorder.test.ts
import { describe, it, expect } from 'vitest';

describe('Recorder', () => {
  it('generates valid CSS selectors', () => {
    // Test getSelector function
  });

  it('detects sensitive fields', () => {
    // Test isSensitive function
  });

  it('throttles events correctly', () => {
    // Test throttle function
  });
});
```

**Deliverables**:
- [ ] Worker API tests
- [ ] Recorder unit tests
- [ ] Integration test: recorder -> Worker -> DO -> dashboard

---

## Phase 6: Deployment

### 6.1 Deploy Order

```bash
# 1. Build recorder
cd recorder && npm run build

# 2. Deploy worker
cd ../worker && npm install && npx wrangler deploy

# 3. Create R2 bucket
npx wrangler r2 bucket create session-archive

# 4. Deploy dashboard
cd ../dashboard && npm install && npm run build && npx wrangler pages deploy dist
```

### 6.2 DNS Setup

```
Type  Name   Content            Proxy
CNAME replay  your-domain.dev   Proxied (orange cloud)
```

### 6.3 Custom Domain

1. Add custom domain in CF Pages dashboard
2. Update `wrangler.jsonc` routes
3. Update recorder script host in integration guide

---

## File Checklist

### Recorder
- [ ] `recorder/package.json`
- [ ] `recorder/tsconfig.json`
- [ ] `recorder/src/index.ts`
- [ ] `recorder/build.ts`

### Worker
- [ ] `worker/package.json`
- [ ] `worker/wrangler.jsonc`
- [ ] `worker/tsconfig.json`
- [ ] `worker/src/index.ts`
- [ ] `worker/src/types.ts`
- [ ] `worker/src/routes/ingest.ts`
- [ ] `worker/src/routes/sessions.ts`
- [ ] `worker/src/routes/health.ts`
- [ ] `worker/src/do/SessionHub.ts`

### Dashboard
- [ ] `dashboard/package.json`
- [ ] `dashboard/vite.config.ts`
- [ ] `dashboard/tailwind.config.ts`
- [ ] `dashboard/tsconfig.json`
- [ ] `dashboard/src/main.tsx`
- [ ] `dashboard/src/App.tsx`
- [ ] `dashboard/src/components/Layout.tsx`
- [ ] `dashboard/src/components/SessionList.tsx`
- [ ] `dashboard/src/components/SessionPlayer.tsx`
- [ ] `dashboard/src/components/EventTimeline.tsx`
- [ ] `dashboard/src/components/Filters.tsx`
- [ ] `dashboard/src/lib/api.ts`
- [ ] `dashboard/src/lib/player.ts`
- [ ] `dashboard/src/lib/websocket.ts`
- [ ] `dashboard/src/types.ts`

### Tests
- [ ] `test/worker.test.ts`
- [ ] `test/recorder.test.ts`
- [ ] `vitest.config.ts`

---

## Stretch Features (Post-MVP)

- [ ] Heatmaps (aggregate mouse/click data)
- [ ] Video export (record replay as MP4)
- [ ] AI session summaries
- [ ] Multi-site management
- [ ] Team sharing via link
- [ ] Browser extension for real-time viewing

---

## Cost Estimate

- CF Workers: ~$5/mo for 1M requests
- Durable Objects: ~$7.50/mo for 1M requests + storage
- R2: ~$0.015/GB stored + $0.01/GB transferred
- **Total for 10K sessions/day: ~$10-15/mo**
