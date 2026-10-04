import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { syncSession, getProject, ProjectDetail, Membership } from "@/lib/api/trust";

interface ReviewProject {
  membership: Membership;
  detail: ProjectDetail | null;
}

export default function ReviewsPage() {
  const { token } = useAuth();
  const [reviews, setReviews] = useState<ReviewProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!token) return;
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
  }, [token]);

  const approveVersion = async (artifactId: string, versionId: string) => {
    if (!token) return;
    setApproving(versionId);
    try {
      // TODO: Call POST /api/v1/trust/artifacts/{artifactId}/versions/{versionId}/approve
      // For now, show toast
      setToast("Version approved! (API not yet wired)");
      setTimeout(() => setToast(null), 3000);
    } catch (e) {
      setToast(`Error: ${e instanceof Error ? e.message : "Failed to approve"}`);
      setTimeout(() => setToast(null), 3000);
    } finally {
      setApproving(null);
    }
  };

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

      {toast && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 text-blue-700 rounded">
          {toast}
        </div>
      )}

      {loading && <div className="text-center py-8">Loading...</div>}
      {error && <div className="p-4 bg-red-100 text-red-700 rounded mb-4">{error}</div>}

      {!loading && reviewsWithDetails.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-600 mb-2">No projects to review yet.</p>
          <p className="text-sm text-gray-500">When an expert invites you, the project will appear here.</p>
        </div>
      )}

      {!loading && reviewsWithDetails.length > 0 && (
        <div className="space-y-6">
          {reviewsWithDetails.map(({ membership, detail }) => {
            const versions = detail.artifacts.flatMap((a) => a.versions);
            const validatedCount = versions.filter((v) => v.is_validated).length;

            return (
              <div key={membership.project_id} className="bg-white border rounded p-6">
                {/* Project header */}
                <div className="mb-4">
                  <Link
                    to={`/trust/projects/${membership.project_id}`}
                    className="text-xl font-semibold text-blue-600 hover:underline"
                  >
                    {detail.project.title}
                  </Link>
                  {detail.project.topic && (
                    <p className="text-sm text-gray-600 mt-1">Topic: {detail.project.topic}</p>
                  )}
                </div>

                {/* Progress */}
                <div className="mb-6">
                  <div className="text-sm text-gray-600 mb-2">
                    Progress: {validatedCount}/{versions.length} versions validated
                  </div>
                  <div className="h-2 bg-gray-200 rounded overflow-hidden">
                    <div
                      className="h-full bg-blue-500"
                      style={{ width: `${versions.length > 0 ? (validatedCount / versions.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                {/* Versions */}
                {detail.artifacts.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-sm mb-3">Versions to Review</h3>
                    <div className="space-y-3">
                      {detail.artifacts.map((artifact) =>
                        artifact.versions.map((version) => (
                          <div
                            key={version.id}
                            className="flex items-center justify-between p-3 bg-gray-50 rounded border"
                          >
                            <div className="flex-1">
                              <div className="text-sm font-medium">
                                {artifact.title || artifact.format} v{version.version_no}
                              </div>
                              <div className="text-xs text-gray-500 mt-1">
                                Created: {new Date(version.created_at).toLocaleDateString()}
                              </div>
                              {version.approved_at && (
                                <div className="text-xs text-green-600 mt-1">
                                  ✓ Approved: {new Date(version.approved_at).toLocaleDateString()}
                                </div>
                              )}
                            </div>

                            {!version.is_validated && (
                              <button
                                onClick={() => approveVersion(artifact.id, version.id)}
                                disabled={approving === version.id}
                                className="ml-4 px-3 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50 whitespace-nowrap"
                              >
                                {approving === version.id ? "Approving..." : "Approve"}
                              </button>
                            )}
                            {version.is_validated && (
                              <span className="ml-4 text-xs text-green-600 font-semibold">Approved</span>
                            )}
                          </div>
                        )),
                      )}
                    </div>
                  </div>
                )}

                <div className="text-xs text-gray-500 mt-4">
                  {detail.project.created_at
                    ? `Created: ${new Date(detail.project.created_at).toLocaleDateString()}`
                    : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
