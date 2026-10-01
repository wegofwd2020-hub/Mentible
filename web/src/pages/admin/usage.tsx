import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface UsageStats {
  total_users: number;
  active_users_today: number;
  total_tokens_used: number;
  total_tokens_available: number;
  managed_users: number;
  byok_users: number;
}

export default function AdminUsagePage() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const token = localStorage.getItem("sb-mentible-app-auth-token");

  useEffect(() => {
    const load = async () => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("https://mambakkam.net/mentible-api/api/v1/admin/usage/stats", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as UsageStats;
        setStats(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load usage stats.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token]);

  if (!token) {
    return <div className="p-6">Not authenticated. Please sign in.</div>;
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      <Link to="/admin" className="text-blue-600 hover:underline mb-4 inline-block">
        ← Back to Admin
      </Link>

      <h1 className="text-3xl font-bold mb-6 mt-4">Usage Statistics</h1>

      {loading && <div className="text-center py-8">Loading...</div>}
      {error && <div className="p-4 bg-red-100 text-red-700 rounded mb-4">{error}</div>}

      {!loading && stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="bg-white border rounded p-6">
            <p className="text-gray-600 text-sm font-semibold mb-1">Total Users</p>
            <p className="text-4xl font-bold">{stats.total_users}</p>
          </div>

          <div className="bg-white border rounded p-6">
            <p className="text-gray-600 text-sm font-semibold mb-1">Active Today</p>
            <p className="text-4xl font-bold text-green-600">{stats.active_users_today}</p>
          </div>

          <div className="bg-white border rounded p-6">
            <p className="text-gray-600 text-sm font-semibold mb-1">Managed Users</p>
            <p className="text-4xl font-bold">{stats.managed_users}</p>
          </div>

          <div className="bg-white border rounded p-6">
            <p className="text-gray-600 text-sm font-semibold mb-1">BYOK Users</p>
            <p className="text-4xl font-bold">{stats.byok_users}</p>
          </div>

          <div className="bg-white border rounded p-6 lg:col-span-2">
            <p className="text-gray-600 text-sm font-semibold mb-3">Token Usage</p>
            <div className="mb-2 flex justify-between text-sm">
              <span>
                {stats.total_tokens_used.toLocaleString()} / {stats.total_tokens_available.toLocaleString()} tokens
              </span>
              <span className="font-semibold">
                {Math.round((stats.total_tokens_used / stats.total_tokens_available) * 100)}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded h-3 overflow-hidden">
              <div
                className="bg-blue-600 h-full"
                style={{
                  width: `${Math.min((stats.total_tokens_used / stats.total_tokens_available) * 100, 100)}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
