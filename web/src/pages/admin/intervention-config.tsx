import { useEffect, useState } from "react";

interface InterventionConfig {
  intervention_retry_interval_days: number;
  max_intervention_attempts: number;
  note: string;
}

export default function InterventionConfigPage() {
  const [config, setConfig] = useState<InterventionConfig | null>(null);
  const [retryInterval, setRetryInterval] = useState("");
  const [maxAttempts, setMaxAttempts] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const token = localStorage.getItem("sb-mentible-app-auth-token");

  useEffect(() => {
    const load = async () => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("https://mambakkam.net/mentible-api/api/v1/admin/analytics/intervention-config", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as InterventionConfig;
        setConfig(data);
        setRetryInterval(String(data.intervention_retry_interval_days));
        setMaxAttempts(String(data.max_intervention_attempts));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load config.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token]);

  const handleSave = async () => {
    if (!token || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    const updates: Record<string, number> = {};
    if (retryInterval && retryInterval !== String(config?.intervention_retry_interval_days)) {
      const val = parseInt(retryInterval, 10);
      if (isNaN(val) || val < 1) {
        setError("Retry interval must be a number ≥ 1");
        setSaving(false);
        return;
      }
      updates.intervention_retry_interval_days = val;
    }
    if (maxAttempts && maxAttempts !== String(config?.max_intervention_attempts)) {
      const val = parseInt(maxAttempts, 10);
      if (isNaN(val) || val < 1) {
        setError("Max attempts must be a number ≥ 1");
        setSaving(false);
        return;
      }
      updates.max_intervention_attempts = val;
    }

    if (Object.keys(updates).length === 0) {
      setSuccess("No changes to save.");
      setSaving(false);
      return;
    }

    try {
      const response = await fetch("https://mambakkam.net/mentible-api/api/v1/admin/analytics/intervention-config", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        const errData = (await response.json()) as { detail?: string };
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }
      const result = (await response.json()) as InterventionConfig & { updated: Record<string, number> };
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              intervention_retry_interval_days:
                result.updated.intervention_retry_interval_days ?? prev.intervention_retry_interval_days,
              max_intervention_attempts:
                result.updated.max_intervention_attempts ?? prev.max_intervention_attempts,
            }
          : null
      );
      setSuccess("Config updated (live, no restart needed).");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save config.");
    } finally {
      setSaving(false);
    }
  };

  if (!token) {
    return <div className="p-6">Not authenticated. Please sign in.</div>;
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-2">Intervention Config</h1>
      <p className="text-gray-600 mb-6">Manage user re-engagement intervention settings (live updates)</p>

      {loading && <div className="text-center py-8">Loading...</div>}

      {!loading && (
        <div className="space-y-4">
          {error && <div className="p-4 bg-red-100 text-red-700 rounded">{error}</div>}
          {success && <div className="p-4 bg-green-100 text-green-700 rounded">{success}</div>}

          <div>
            <label className="block font-semibold mb-2">Retry Interval (days)</label>
            <input
              type="number"
              value={retryInterval}
              onChange={(e) => setRetryInterval(e.target.value)}
              disabled={saving}
              placeholder="e.g. 7"
              className="w-full border px-4 py-2 rounded disabled:opacity-50"
            />
            <p className="text-sm text-gray-600 mt-1">Days before retrying intervention for stalled users</p>
          </div>

          <div>
            <label className="block font-semibold mb-2">Max Attempts</label>
            <input
              type="number"
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(e.target.value)}
              disabled={saving}
              placeholder="e.g. 3"
              className="w-full border px-4 py-2 rounded disabled:opacity-50"
            />
            <p className="text-sm text-gray-600 mt-1">Maximum number of intervention attempts per user</p>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-blue-600 text-white py-2 rounded font-semibold disabled:opacity-50 hover:bg-blue-700"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      )}
    </div>
  );
}
