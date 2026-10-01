import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface FeedbackRecord {
  id: string;
  user_email: string;
  message: string;
  created_at: string;
}

export default function AdminFeedbackPage() {
  const [feedback, setFeedback] = useState<FeedbackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const token = localStorage.getItem("sb-mentible-app-auth-token");

  useEffect(() => {
    const load = async () => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("https://mambakkam.net/mentible-api/api/v1/admin/feedback?limit=50", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as { feedback: FeedbackRecord[] };
        setFeedback(data.feedback);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load feedback.");
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

      <h1 className="text-3xl font-bold mb-6 mt-4">User Feedback</h1>

      {loading && <div className="text-center py-8">Loading...</div>}
      {error && <div className="p-4 bg-red-100 text-red-700 rounded mb-4">{error}</div>}

      {!loading && (
        <div className="space-y-4">
          {feedback.length === 0 ? (
            <div className="text-center py-8 text-gray-600">No feedback yet</div>
          ) : (
            feedback.map((item) => (
              <div key={item.id} className="bg-white border rounded p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-semibold">{item.user_email}</p>
                    <p className="text-xs text-gray-600">{new Date(item.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <p className="text-gray-700 whitespace-pre-wrap">{item.message}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
