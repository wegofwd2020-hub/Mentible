import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface AdminUser {
  sub: string;
  email: string;
  created_at: string;
  last_seen: string | null;
  status: "active" | "suspended" | "deleted";
}

export default function AdminUsersPage() {
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
        const response = await fetch("https://mambakkam.net/mentible-api/api/v1/admin/users?limit=100", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as { users: AdminUser[]; total: number };
        setUsers(data.users);
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
      <Link to="/admin" className="text-blue-600 hover:underline mb-4 inline-block">
        ← Back to Admin
      </Link>

      <h1 className="text-3xl font-bold mb-6 mt-4">Users</h1>

      {loading && <div className="text-center py-8">Loading...</div>}
      {error && <div className="p-4 bg-red-100 text-red-700 rounded mb-4">{error}</div>}

      {!loading && (
        <div className="bg-white border rounded overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left py-3 px-4">Email</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-left py-3 px-4">Created</th>
                <th className="text-left py-3 px-4">Last Seen</th>
                <th className="text-left py-3 px-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.sub} className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4">{user.email}</td>
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
                  <td className="py-3 px-4">{user.last_seen ? new Date(user.last_seen).toLocaleDateString() : "Never"}</td>
                  <td className="py-3 px-4">
                    <Link to={`/admin/users/${user.sub}`} className="text-blue-600 hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
