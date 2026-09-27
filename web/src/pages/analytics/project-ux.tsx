import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

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

interface FunnelRow {
  project_id: string;
  from_stage: string;
  to_stage: string;
  users_at_from_stage: number;
  users_advanced: number;
  advancement_rate_pct: number;
}

interface StalledUser {
  user_id: string;
  email: string;
  project_id: string;
  project_name: string;
  journey_stage: string;
  stalled_at: string;
  days_stalled: number;
  intervention_attempt_count: number;
  last_intervention_sent_at: string | null;
}

interface ProjectUXAnalytics {
  bottlenecks: Bottleneck[];
  funnel: FunnelRow[];
  stalled_users: StalledUser[];
}

const STAGE_COLORS: Record<string, string> = {
  discover_join: "#3B82F6",
  create_first_value: "#10B981",
  refine_validate: "#F59E0B",
  finish_pay: "#EF4444",
  return_advocate: "#8B5CF6",
};

export default function ProjectUXDashboard() {
  const { projectId } = useParams<{ projectId: string }>();
  const [data, setData] = useState<ProjectUXAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const response = await fetch(
          `/api/v1/analytics/dashboards/project-ux/${projectId}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
            },
          }
        );
        if (!response.ok) throw new Error("Failed to fetch analytics");
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    if (projectId) fetchAnalytics();
  }, [projectId]);

  if (loading) return <div className="p-8">Loading analytics...</div>;
  if (error) return <div className="p-8 text-red-600">Error: {error}</div>;
  if (!data) return <div className="p-8">No data available</div>;

  return (
    <div className="p-8 space-y-8">
      <h1 className="text-3xl font-bold">Project UX Analytics</h1>

      {/* Bottleneck Analysis */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">Stage Bottleneck Analysis</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.bottlenecks}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="journey_stage" />
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

      {/* Funnel Analysis */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">Completion Funnel</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.funnel}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="from_stage"
              angle={-45}
              textAnchor="end"
              height={100}
            />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar
              dataKey="advancement_rate_pct"
              fill="#3B82F6"
              name="Advancement %"
            />
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.funnel.map((row) => (
            <div key={`${row.from_stage}-${row.to_stage}`} className="p-4 border rounded">
              <div className="text-sm text-gray-600">
                {row.from_stage} → {row.to_stage}
              </div>
              <div className="text-2xl font-bold text-blue-600">
                {row.advancement_rate_pct.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500">
                {row.users_advanced} of {row.users_at_from_stage} advanced
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stalled Users */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">Stalled Users</h2>
        {data.stalled_users.length === 0 ? (
          <p className="text-gray-600">No stalled users</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">Email</th>
                <th className="text-left py-2">Stage</th>
                <th className="text-right py-2">Days Stalled</th>
                <th className="text-right py-2">Interventions</th>
                <th className="text-left py-2">Last Sent</th>
              </tr>
            </thead>
            <tbody>
              {data.stalled_users.map((user) => (
                <tr key={user.user_id} className="border-b hover:bg-gray-50">
                  <td className="py-2">{user.email}</td>
                  <td className="py-2">{user.journey_stage}</td>
                  <td className="text-right">{user.days_stalled}</td>
                  <td className="text-right font-semibold">
                    {user.intervention_attempt_count}
                  </td>
                  <td className="py-2 text-xs text-gray-500">
                    {user.last_intervention_sent_at
                      ? new Date(user.last_intervention_sent_at).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
