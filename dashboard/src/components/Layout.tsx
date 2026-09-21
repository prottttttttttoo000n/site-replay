import { Outlet } from "react-router-dom";
import { Activity } from "lucide-react";

export function Layout() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2 text-lg font-semibold">
            <Activity className="w-5 h-5 text-red-500" />
            <span>Site Replay</span>
          </a>
          <div className="text-sm text-gray-400">Dashboard</div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}
