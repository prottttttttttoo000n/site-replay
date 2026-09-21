import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Play, Pause, SkipBack, SkipForward, Maximize2, Minimize2 } from "lucide-react";
import { fetchSession, watchSession } from "../lib/api";
import { ReplayPlayer } from "../lib/player";
import type { SessionResponse, ReplayEvent } from "../types";

export function SessionView() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isLive, setIsLive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<ReplayPlayer | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load session data
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchSession(id)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const renderEvent = useCallback((ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, event: ReplayEvent) => {
    switch (event.type) {
      case "navigation":
        // Set canvas size
        if (event.viewportWidth && event.viewportHeight) {
          canvas.width = event.viewportWidth;
          canvas.height = event.viewportHeight;
        }
        // Draw initial page background
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        break;

      case "mousemove":
        // Draw cursor
        ctx.beginPath();
        ctx.arc(event.x || 0, event.y || 0, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#ef4444";
        ctx.fill();
        break;

      case "click":
        // Draw click indicator
        ctx.beginPath();
        ctx.arc(event.x || 0, event.y || 0, 12, 0, Math.PI * 2);
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 2;
        ctx.stroke();
        // Fade out
        setTimeout(() => {
          ctx.clearRect((event.x || 0) - 15, (event.y || 0) - 15, 30, 30);
        }, 300);
        break;

      case "scroll":
        // Scroll indicator
        ctx.fillStyle = "rgba(239, 68, 68, 0.1)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        break;

      case "rageClick":
        // Draw rage click burst
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.arc(event.x || 0, event.y || 0, 8 + i * 4, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(234, 179, 8, ${1 - i * 0.2})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        break;
    }
  }, []);

  // Initialize player when data loads
  useEffect(() => {
    if (!data || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size based on first navigation event
    const navEvent = data.events.find((e) => e.type === "navigation");
    if (navEvent) {
      canvas.width = navEvent.viewportWidth || 1920;
      canvas.height = navEvent.viewportHeight || 1080;
    }

    playerRef.current = new ReplayPlayer(
      data.events,
      (event) => renderEvent(ctx, canvas, event),
      (p) => setProgress(p),
      () => setIsPlaying(false)
    );

    // Connect to live stream if session is still active
    if (!data.meta.ended_at) {
      setIsLive(true);
      wsRef.current = watchSession(id as string, (newEvents) => {
        // Append new events and extend player
        data.events.push(...newEvents);
      });
    }

    return () => {
      playerRef.current?.pause();
      wsRef.current?.close();
    };
  }, [data, id, renderEvent]);

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

      {/* Canvas */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-auto"
          style={{ maxHeight: isFullscreen ? "calc(100vh - 200px)" : "600px" }}
        />
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
    </div>
  );
}
