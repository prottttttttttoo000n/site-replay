import type { SessionResponse, SessionsListResponse, ReplayEvent } from "../types";

const API_BASE = import.meta.env.DEV ? "" : "https://site-replay.prooooottt5on.workers.dev";

export async function fetchSessions(siteId: string, limit = 50, offset = 0): Promise<SessionsListResponse> {
  const res = await fetch(`${API_BASE}/api/sessions?siteId=${siteId}&limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return res.json();
}

export async function fetchSession(sessionId: string): Promise<SessionResponse> {
  const res = await fetch(`${API_BASE}/api/session/${sessionId}`);
  if (!res.ok) throw new Error("Failed to fetch session");
  return res.json();
}

export function watchSession(sessionId: string, onEvents: (events: ReplayEvent[]) => void): WebSocket {
  const ws = new WebSocket(`wss://${location.host}/ws/watch?sid=${sessionId}`);
  ws.onmessage = (e) => onEvents(JSON.parse(e.data));
  return ws;
}
