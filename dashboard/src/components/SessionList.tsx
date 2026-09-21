import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, ExternalLink, AlertTriangle } from "lucide-react";
import { fetchSessions } from "../lib/api";
import type { SessionMeta } from "../types";

function parseUserAgent(ua: string): { browser: string; os: string } {
  let browser = "Unknown";
  if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Edg")) browser = "Edge";
  else if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Safari")) browser = "Safari";

  let os = "Unknown";
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac")) os = "Mac";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";

  return { browser, os };
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function timeAgo(date: string): string {
  const now = new Date();
  const then = new Date(date);
  const diff = now.getTime() - then.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function SessionList() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [live, setLive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [siteId, setSiteId] = useState("localhost");

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchSessions(siteId);
      setSessions(data.sessions);
      setLive(data.live);
    } catch (e) {
      console.error("Failed to load sessions:", e);
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is a closure that intentionally re-runs when siteId changes
  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [siteId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sessions</h1>
          <p className="text-gray-400 text-sm mt-1">
            {sessions.length} sessions loaded
            {live > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-green-400">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                {live} live
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            placeholder="Site ID"
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-800 text-left text-sm text-gray-400">
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Page</th>
              <th className="px-4 py-3 font-medium">Browser / OS</th>
              <th className="px-4 py-3 font-medium">Duration</th>
              <th className="px-4 py-3 font-medium">Events</th>
              <th className="px-4 py-3 font-medium">Started</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {sessions.map((session) => {
              const { browser, os } = parseUserAgent(session.user_agent);
              const isLive = !session.ended_at;

              return (
                <tr key={session.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-3">
                    {isLive ? (
                      <span className="inline-flex items-center gap-1.5 text-green-400 text-sm">
                        <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                        Live
                      </span>
                    ) : (
                      <span className="text-gray-500 text-sm">Ended</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-mono text-gray-300 truncate max-w-[200px] block">
                      {session.page_url || "/"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">
                    {browser} / {os}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">
                    {session.duration ? formatDuration(session.duration) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <span>{session.event_count}</span>
                      {session.rage_clicks > 0 && (
                        <span className="inline-flex items-center gap-1 text-yellow-400" title="Rage clicks">
                          <AlertTriangle className="w-3 h-3" />
                          {session.rage_clicks}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{timeAgo(session.started_at)}</td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/session/${session.id}`}
                      className="inline-flex items-center gap-1 text-sm text-red-400 hover:text-red-300 transition-colors"
                    >
                      View
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </td>
                </tr>
              );
            })}
            {sessions.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                  No sessions found. Add the recorder script to your site to start recording.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
