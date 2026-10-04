import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface AdminUser {
  sub: string;
  email: string;
  created_at: string;
  last_seen: string | null;
  status: "active" | "suspended" | "deleted";
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const token = localStorage.getItem("sb-mentible-app-auth-token");

  useEffect(() => {
    const load = async () => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("https://mambakkam.net/mentible-api/api/v1/admin/users", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as { users: AdminUser[]; total: number };
        setUsers(data.users.slice(0, 20)); // Show first 20
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load users.");
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
      <h1 className="text-3xl font-bold mb-6">Admin Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Link to="/admin/users" className="p-4 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100">
          <h3 className="font-semibold text-lg mb-1">Users</h3>
          <p className="text-sm text-gray-600">Manage user accounts</p>
        </Link>
        <Link to="/admin/feedback" className="p-4 bg-green-50 border border-green-200 rounded hover:bg-green-100">
          <h3 className="font-semibold text-lg mb-1">Feedback</h3>
          <p className="text-sm text-gray-600">View user feedback</p>
        </Link>
        <Link to="/admin/usage" className="p-4 bg-purple-50 border border-purple-200 rounded hover:bg-purple-100">
          <h3 className="font-semibold text-lg mb-1">Usage</h3>
          <p className="text-sm text-gray-600">Usage statistics</p>
        </Link>
        <Link
          to="/admin/intervention-config"
          className="p-4 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100"
        >
          <h3 className="font-semibold text-lg mb-1">Intervention Config</h3>
          <p className="text-sm text-gray-600">Configure interventions</p>
        </Link>
        <Link
          to="/admin/common-projects"
          className="p-4 bg-pink-50 border border-pink-200 rounded hover:bg-pink-100"
        >
          <h3 className="font-semibold text-lg mb-1">Common Projects</h3>
          <p className="text-sm text-gray-600">Moderate shared projects</p>
        </Link>
      </div>

      <div className="bg-white border rounded p-6">
        <h2 className="text-xl font-bold mb-4">Recent Users</h2>

        {loading && <div className="text-center py-8">Loading...</div>}
        {error && <div className="p-4 bg-red-100 text-red-700 rounded mb-4">{error}</div>}

        {!loading && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-4">Email</th>
                  <th className="text-left py-2 px-4">Status</th>
                  <th className="text-left py-2 px-4">Created</th>
                  <th className="text-left py-2 px-4">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.sub} className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <Link to={`/admin/users/${user.sub}`} className="text-blue-600 hover:underline">
                        {user.email}
                      </Link>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          user.status === "active"
                            ? "bg-green-100 text-green-700"
                            : user.status === "suspended"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {user.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">{new Date(user.created_at).toLocaleDateString()}</td>
                    <td className="py-3 px-4">
                      {user.last_seen ? new Date(user.last_seen).toLocaleDateString() : "Never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
