export interface ReplayEvent {
  type: "mousemove" | "click" | "scroll" | "input" | "navigation" | "resize" | "rageClick" | "snapshot";
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
  html?: string;
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
  SESSION_ARCHIVE?: R2Bucket;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
}
