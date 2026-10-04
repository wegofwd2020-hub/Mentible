import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface ProjectSummary {
  id: string;
  title: string;
}

interface JourneyDataPoint {
  date: string;
  stalled_count: number;
}

interface Bottleneck {
  project_id: string;
  journey_stage: string;
  total_users_at_stage: number;
  stalled_count: number;
  stall_rate_pct: number;
  avg_hours_before_stall: number | null;
  intervention_sent_count: number;
  resumed_after_intervention_count: number;
  re_engagement_rate_pct: number | null;
}

interface ProjectUXAnalytics {
  bottlenecks: Bottleneck[];
  journey_data: JourneyDataPoint[];
  stalled_count: number;
  total_users: number;
}

export default function ProjectUXDashboard() {
  const { token } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [data, setData] = useState<ProjectUXAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load owned projects
  useEffect(() => {
    const loadProjects = async () => {
      if (!token) return;
      try {
        const res = await fetch("/api/v1/trust/projects", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Failed to load projects");
        const list = await res.json();
        setProjects(list);
        if (list.length > 0) {
          setSelectedProjectId(list[0].id);
        }
      } catch (e) {
        console.error("Load projects error:", e);
      }
    };
    loadProjects();
  }, [token]);

  // Load analytics for selected project
  useEffect(() => {
    const loadAnalytics = async () => {
      if (!token || !selectedProjectId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/v1/analytics/dashboards/project-ux/${selectedProjectId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (!res.ok) {
          if (res.status === 404) {
            setData(null);
            setError("No analytics data available for this project yet");
            return;
          }
          throw new Error("Failed to fetch analytics");
        }
        const result = await res.json();
        setData(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
        setData(null);
      } finally {
        setLoading(false);
      }
    };
    loadAnalytics();
  }, [token, selectedProjectId]);

  if (loading) {
    return <div className="max-w-7xl mx-auto p-6 text-center py-8">Loading...</div>;
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Analytics Dashboard</h1>

      {/* Project selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">Select Project</label>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="px-4 py-2 border rounded-lg"
        >
          <option value="">-- Choose a project --</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </div>

      {!selectedProjectId && (
        <div className="text-center py-12">
          <p className="text-gray-600">Select a project to view analytics</p>
        </div>
      )}

      {selectedProjectId && !data && error && (
        <div className="p-4 bg-blue-50 border border-blue-200 text-blue-700 rounded">
          {error}
        </div>
      )}

      {selectedProjectId && data && (
        <div className="space-y-6">
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white border rounded p-4">
              <div className="text-sm text-gray-600">Total Users</div>
              <div className="text-2xl font-bold mt-1">{data.total_users}</div>
            </div>
            <div className="bg-white border rounded p-4">
              <div className="text-sm text-gray-600">Currently Stalled</div>
              <div className="text-2xl font-bold text-red-600 mt-1">{data.stalled_count}</div>
            </div>
          </div>

          {/* Journey graph */}
          {data.journey_data.length > 0 && (
            <div className="bg-white border rounded p-6">
              <h2 className="text-lg font-semibold mb-4">Stalled Users Over Time</h2>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data.journey_data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="stalled_count"
                    stroke="#EF4444"
                    name="Stalled Users"
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Bottleneck analysis */}
          {data.bottlenecks.length > 0 && (
            <div className="bg-white border rounded p-6">
              <h2 className="text-lg font-semibold mb-4">Stage Bottleneck Analysis</h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.bottlenecks}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="journey_stage" angle={-45} textAnchor="end" height={100} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="stall_rate_pct" fill="#EF4444" name="Stall Rate (%)" />
                  <Bar
                    dataKey="re_engagement_rate_pct"
                    fill="#10B981"
                    name="Re-engagement Rate (%)"
                  />
                </BarChart>
              </ResponsiveContainer>

              {/* Bottleneck table */}
              <table className="w-full mt-6 text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Stage</th>
                    <th className="text-right py-2">Users</th>
                    <th className="text-right py-2">Stalled</th>
                    <th className="text-right py-2">Stall %</th>
                    <th className="text-right py-2">Interventions</th>
                    <th className="text-right py-2">Re-engaged</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bottlenecks.map((row) => (
                    <tr key={row.journey_stage} className="border-b hover:bg-gray-50">
                      <td className="py-2">{row.journey_stage}</td>
                      <td className="text-right">{row.total_users_at_stage}</td>
                      <td className="text-right">{row.stalled_count}</td>
                      <td className="text-right font-semibold text-red-600">
                        {row.stall_rate_pct.toFixed(1)}%
                      </td>
                      <td className="text-right">{row.intervention_sent_count}</td>
                      <td className="text-right text-green-600">
                        {row.resumed_after_intervention_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
