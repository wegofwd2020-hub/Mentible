import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { syncSession, getProject, ProjectDetail, Membership } from "@/lib/api/trust";

interface ReviewProject {
  membership: Membership;
  detail: ProjectDetail | null;
}

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<ReviewProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const token = localStorage.getItem("sb-mentible-app-auth-token");

  useEffect(() => {
    const load = async () => {
      if (!token) {
        navigate("/auth/login");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const sync = await syncSession(token);
        const reviewerProjects = sync.memberships.filter((m) => m.role === "reviewer");

        const details = await Promise.all(
          reviewerProjects.map(async (m) => {
            try {
              const detail = await getProject(m.project_id, token);
              return { membership: m, detail };
            } catch (e) {
              return { membership: m, detail: null };
            }
          }),
        );

        setReviews(details);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load your reviews.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, navigate]);

  if (!token) {
    return null;
  }

  const reviewsWithDetails = reviews.filter((r) => r.detail !== null) as Array<{
    membership: Membership;
    detail: ProjectDetail;
  }>;

  return (
    <div className="max-w-7xl mx-auto p-6">
      <Link to="/" className="text-blue-600 hover:underline mb-4 inline-block">
        ← Back
      </Link>

      <h1 className="text-3xl font-bold mb-6 mt-4">Projects to Review</h1>

      {loading && <div className="text-center py-8">Loading...</div>}
      {error && <div className="p-4 bg-red-100 text-red-700 rounded mb-4">{error}</div>}

      {!loading && reviewsWithDetails.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-600 mb-2">No projects to review yet.</p>
          <p className="text-sm text-gray-500">When an expert invites you, the project will appear here.</p>
        </div>
      )}

      {!loading && reviewsWithDetails.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {reviewsWithDetails.map(({ membership, detail }) => {
            const versions = detail.artifacts.flatMap((a) => a.versions);
            const validatedCount = versions.filter((v) => v.is_validated).length;

            return (
              <Link
                key={membership.project_id}
                to={`/trust/projects/${membership.project_id}`}
                className="block p-4 bg-white border rounded hover:bg-gray-50"
              >
                <h3 className="text-lg font-semibold mb-2">{detail.project.title}</h3>

                <div className="mb-3">
                  <div className="text-sm text-gray-600">
                    Progress: {validatedCount}/{versions.length} versions validated
                  </div>
                  <div className="mt-2 h-2 bg-gray-200 rounded overflow-hidden">
                    <div
                      className="h-full bg-blue-500"
                      style={{ width: `${versions.length > 0 ? (validatedCount / versions.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                {detail.project.topic && (
                  <p className="text-sm text-gray-600">Topic: {detail.project.topic}</p>
                )}

                <div className="text-xs text-gray-500 mt-3">
                  {detail.project.created_at
                    ? new Date(detail.project.created_at).toLocaleDateString()
                    : ""}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
