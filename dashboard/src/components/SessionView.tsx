import { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Play, Pause, SkipBack, SkipForward, Maximize2, Minimize2 } from "lucide-react";
import { fetchSession, watchSession } from "../lib/api";
import { ReplayPlayer } from "../lib/player";
import type { SessionResponse, ReplayEvent } from "../types";

/* ── Ripple animation keyframes (injected once via <style>) ── */
const RIPPLE_CSS = `
@keyframes srRipple {
  0% { transform: translate(-50%,-50%) scale(0.4); opacity: 1 }
  100% { transform: translate(-50%,-50%) scale(2.2); opacity: 0 }
}
@keyframes srRageRing {
  0% { transform: translate(-50%,-50%) scale(0.3); opacity: 1 }
  100% { transform: translate(-50%,-50%) scale(1.8); opacity: 0 }
}
`;

function makeClickRipple(x: number, y: number): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText =
    `position:absolute;left:${x}px;top:${y}px;width:24px;height:24px;border-radius:50%;` +
    `border:2px solid #ef4444;pointer-events:none;animation:srRipple .3s ease-out forwards`;
  return el;
}

function makeRageRing(x: number, y: number, i: number): HTMLDivElement {
  const size = 16 + i * 12;
  const el = document.createElement("div");
  el.style.cssText =
    `position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${size}px;border-radius:50%;` +
    `border:2px solid rgba(234,179,8,${(1 - i * 0.18).toFixed(2)});pointer-events:none;` +
    `animation:srRageRing .5s ease-out forwards`;
  return el;
}

export function SessionView() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isLive, setIsLive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [snapDims, setSnapDims] = useState<{ w: number; h: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<ReplayPlayer | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeWrapRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);

  const hasSnapshot = !!data?.snapshot;
  const snapshot = data?.snapshot ?? null;

  /* ── Load session data ── */
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchSession(id)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  /* ── ResizeObserver: compute iframe scale factor ── */
  useLayoutEffect(() => {
    if (!hasSnapshot || !snapshot || !iframeWrapRef.current) return;

    const wrap = iframeWrapRef.current;
    const vw = snapshot.viewportWidth || 1280;
    const vh = snapshot.viewportHeight || 720;

    const update = () => {
      const cw = wrap.clientWidth;
      const s = cw / vw;
      scaleRef.current = s;
      setSnapDims({ w: vw * s, h: vh * s });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [hasSnapshot, snapshot?.viewportWidth, snapshot?.viewportHeight]);

  /* ── Listen for bridge messages from snapshot iframe ── */
  useEffect(() => {
    if (!hasSnapshot) return;
    const handler = (e: MessageEvent) => {
      if (e.data && e.data.__sr === 1) {
        // iframe bridge is alive — scroll dimensions available if needed
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [hasSnapshot]);

  /* ── Snapshot mode: imperative event handler (ref-only, no React state) ── */
  const onSnapshotEvent = useCallback((event: ReplayEvent) => {
    const cursor = cursorRef.current;
    const overlay = overlayRef.current;
    const iframe = iframeRef.current;

    switch (event.type) {
      case "mousemove": {
        if (!cursor) break;
        const sx = (event.x ?? 0) * scaleRef.current;
        const sy = (event.y ?? 0) * scaleRef.current;
        cursor.style.left = `${sx}px`;
        cursor.style.top = `${sy}px`;
        cursor.style.opacity = "1";
        break;
      }
      case "click": {
        if (!cursor || !overlay) break;
        const sx = (event.x ?? 0) * scaleRef.current;
        const sy = (event.y ?? 0) * scaleRef.current;
        cursor.style.left = `${sx}px`;
        cursor.style.top = `${sy}px`;
        cursor.style.opacity = "1";
        const ring = makeClickRipple(sx, sy);
        overlay.appendChild(ring);
        setTimeout(() => ring.remove(), 350);
        break;
      }
      case "rageClick": {
        if (!cursor || !overlay) break;
        const sx = (event.x ?? 0) * scaleRef.current;
        const sy = (event.y ?? 0) * scaleRef.current;
        cursor.style.left = `${sx}px`;
        cursor.style.top = `${sy}px`;
        cursor.style.opacity = "1";
        const rings: HTMLDivElement[] = [];
        for (let i = 0; i < 5; i++) {
          const ring = makeRageRing(sx, sy, i);
          rings.push(ring);
          overlay.appendChild(ring);
        }
        setTimeout(() => rings.forEach((r) => r.remove()), 600);
        break;
      }
      case "scroll": {
        if (!iframe?.contentWindow) break;
        iframe.contentWindow.postMessage(
          { __srScroll: true, x: event.scrollX ?? 0, y: event.scrollY ?? 0 },
          "*",
        );
        break;
      }
      // navigation, input, resize → ignored in snapshot mode
    }
  }, []);

  /* ── Canvas mode: existing renderEvent (preserved verbatim) ── */
  const renderEvent = useCallback(
    (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, event: ReplayEvent) => {
      switch (event.type) {
        case "navigation":
          if (event.viewportWidth && event.viewportHeight) {
            canvas.width = event.viewportWidth;
            canvas.height = event.viewportHeight;
          }
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          break;

        case "mousemove":
          ctx.beginPath();
          ctx.arc(event.x || 0, event.y || 0, 4, 0, Math.PI * 2);
          ctx.fillStyle = "#ef4444";
          ctx.fill();
          break;

        case "click":
          ctx.beginPath();
          ctx.arc(event.x || 0, event.y || 0, 12, 0, Math.PI * 2);
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 2;
          ctx.stroke();
          setTimeout(() => {
            ctx.clearRect((event.x || 0) - 15, (event.y || 0) - 15, 30, 30);
          }, 300);
          break;

        case "scroll":
          ctx.fillStyle = "rgba(239, 68, 68, 0.1)";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          break;

        case "rageClick":
          for (let i = 0; i < 5; i++) {
            ctx.beginPath();
            ctx.arc(event.x || 0, event.y || 0, 8 + i * 4, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(234, 179, 8, ${1 - i * 0.2})`;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          break;
      }
    },
    [],
  );

  /* ── Initialize player when data loads ── */
  useEffect(() => {
    if (!data) return;

    if (hasSnapshot) {
      // Snapshot mode: player drives events through imperative handler
      playerRef.current = new ReplayPlayer(
        data.events,
        (event) => onSnapshotEvent(event),
        (p) => setProgress(p),
        () => setIsPlaying(false),
      );
    } else {
      // Canvas mode: need canvas ref to be available
      if (!canvasRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const navEvent = data.events.find((e) => e.type === "navigation");
      if (navEvent) {
        canvas.width = navEvent.viewportWidth || 1920;
        canvas.height = navEvent.viewportHeight || 1080;
      }

      playerRef.current = new ReplayPlayer(
        data.events,
        (event) => renderEvent(ctx, canvas, event),
        (p) => setProgress(p),
        () => setIsPlaying(false),
      );
    }

    // Connect to live stream if session is still active
    if (!data.meta.ended_at) {
      setIsLive(true);
      wsRef.current = watchSession(id as string, (newEvents: ReplayEvent[]) => {
        // Filter out snapshot events before appending
        data.events.push(...newEvents.filter((e) => e.type !== "snapshot"));
      });
    }

    return () => {
      playerRef.current?.pause();
      wsRef.current?.close();
    };
  }, [data, id, renderEvent, onSnapshotEvent, hasSnapshot]);

  /* ── Controls (unchanged from original) ── */
  const togglePlay = () => {
    if (!playerRef.current) return;
    playerRef.current.toggle();
    setIsPlaying(playerRef.current.isCurrentlyPlaying());
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value) * (playerRef.current?.getDuration() || 1);
    playerRef.current?.seek(time);
    setProgress(parseFloat(e.target.value));
  };

  const changeSpeed = (newSpeed: number) => {
    playerRef.current?.setSpeed(newSpeed);
    setSpeed(newSpeed);
  };

  const skip = (seconds: number) => {
    if (!playerRef.current) return;
    const current = playerRef.current.getCurrentTime();
    playerRef.current.seek(current + seconds * 1000);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${(seconds % 60).toString().padStart(2, "0")}`;
  };

  /* ── Early returns ── */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">Session not found</p>
        <Link to="/" className="text-red-400 hover:text-red-300 mt-2 inline-block">
          Back to sessions
        </Link>
      </div>
    );
  }

  const duration = playerRef.current?.getDuration() || 0;
  const currentTime = playerRef.current?.getCurrentTime() || 0;
  const vw = snapshot?.viewportWidth || 1280;
  const vh = snapshot?.viewportHeight || 720;
  const showStaticHint = hasSnapshot && iframeLoaded && data.events.length < 2 && !isPlaying;

  return (
    <div className="space-y-6" ref={containerRef}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold font-mono">{data.meta.page_url || "/"}</h1>
            <p className="text-sm text-gray-400">
              {data.meta.user_agent.slice(0, 60)}...
              {isLive && (
                <span className="ml-2 inline-flex items-center gap-1 text-green-400">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  Live
                </span>
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
        >
          {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
        </button>
      </div>

      {/* Preview area — two modes */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        {hasSnapshot && snapshot ? (
          /* ── MODE 1: Snapshot Replay ── */
          <div>
            {/* Browser chrome: faux address bar */}
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
              <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
              <div className="flex-1 ml-3 bg-gray-900 rounded-md px-3 py-1 text-xs font-mono text-gray-400 truncate">
                {snapshot.url}
              </div>
            </div>

            {/* Iframe viewport + overlay */}
            <div
              ref={iframeWrapRef}
              className="relative w-full"
              style={{
                maxWidth: vw,
                maxHeight: isFullscreen ? "calc(100vh - 200px)" : "600px",
                overflow: "hidden",
              }}
            >
              {/* Scaled viewport inner div */}
              <div
                style={{
                  width: snapDims?.w ?? vw,
                  height: snapDims?.h ?? vh,
                  position: "relative",
                }}
              >
                <iframe
                  ref={iframeRef}
                  sandbox="allow-scripts"
                  srcDoc={snapshot.html}
                  title="replay"
                  style={{
                    width: vw,
                    height: vh,
                    border: 0,
                    transform: `scale(${scaleRef.current})`,
                    transformOrigin: "top left",
                    pointerEvents: "none",
                  }}
                  onLoad={() => setIframeLoaded(true)}
                />

                {/* Overlay: cursor + ripple elements (above iframe) */}
                <div
                  ref={overlayRef}
                  className="absolute inset-0"
                  style={{ pointerEvents: "none", zIndex: 10 }}
                >
                  {/* Replay cursor (red mouse pointer) */}
                  <div
                    ref={cursorRef}
                    className="absolute"
                    style={{
                      left: 0,
                      top: 0,
                      opacity: 0,
                      pointerEvents: "none",
                      willChange: "left, top",
                    }}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                      <path d="M13 13l6 6" />
                    </svg>
                  </div>

                  {/* Static hint when few/no interactions */}
                  {showStaticHint && (
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-gray-800/90 rounded-lg border border-gray-700 text-sm text-gray-400">
                      No interactions recorded
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ── MODE 2: Legacy Canvas Fallback (preserved verbatim) ── */
          <canvas
            ref={canvasRef}
            className="w-full h-auto"
            style={{ maxHeight: isFullscreen ? "calc(100vh - 200px)" : "600px" }}
          />
        )}
      </div>

      {/* Controls */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <div className="flex items-center gap-4">
          {/* Skip back */}
          <button
            type="button"
            onClick={() => skip(-10)}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            title="Skip back 10s"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          {/* Play/Pause */}
          <button
            type="button"
            onClick={togglePlay}
            className="p-3 bg-red-500 hover:bg-red-600 rounded-full transition-colors"
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
          </button>

          {/* Skip forward */}
          <button
            type="button"
            onClick={() => skip(10)}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            title="Skip forward 10s"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          {/* Progress bar */}
          <div className="flex-1 flex items-center gap-3">
            <span className="text-sm text-gray-400 w-12 text-right">{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={progress}
              onChange={seek}
              className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-500"
            />
            <span className="text-sm text-gray-400 w-12">{formatTime(duration)}</span>
          </div>

          {/* Speed */}
          <select
            value={speed}
            onChange={(e) => changeSpeed(parseFloat(e.target.value))}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>
        </div>

        {/* Stats */}
        <div className="mt-4 flex items-center gap-6 text-sm text-gray-400">
          <span>{data.events.length} events</span>
          <span>{data.meta.rage_clicks} rage clicks</span>
          <span>{data.meta.dead_clicks} dead clicks</span>
        </div>
      </div>

      {/* Ripple animation keyframes */}
      <style>{RIPPLE_CSS}</style>
    </div>
  );
}
