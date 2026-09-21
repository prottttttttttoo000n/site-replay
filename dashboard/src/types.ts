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
  site_id: string;
  started_at: string;
  ended_at?: string;
  duration?: number;
  page_url: string;
  user_agent: string;
  event_count: number;
  rage_clicks: number;
  dead_clicks: number;
}

export interface SessionResponse {
  meta: SessionMeta;
  events: ReplayEvent[];
}

export interface SessionsListResponse {
  sessions: SessionMeta[];
  total: number;
  live: number;
}
