import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { getProject, ProjectDetail } from "@/lib/api/trust";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const token = localStorage.getItem("sb-mentible-app-auth-token");

  useEffect(() => {
    const load = async () => {
      if (!token || !id) {
        navigate("/auth/login");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const detail = await getProject(id, token);
        setProject(detail);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load project.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, id, navigate]);

  if (!token) {
    return null;
  }

  if (loading) {
    return <div className="max-w-7xl mx-auto p-6 text-center py-8">Loading...</div>;
  }

  if (error || !project) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <Link to="/trust/projects" className="text-blue-600 hover:underline mb-4 inline-block">
          ← Back to Projects
        </Link>
        <div className="p-4 bg-red-100 text-red-700 rounded">{error || "Project not found."}</div>
      </div>
    );
  }

  const { project: p, artifacts, my_role, inputs, topic_status, book_validated } = project;

  return (
    <div className="max-w-7xl mx-auto p-6">
      <Link to="/trust/projects" className="text-blue-600 hover:underline mb-4 inline-block">
        ← Back to Projects
      </Link>

      <div className="mt-4 mb-6">
        <h1 className="text-3xl font-bold mb-2">{p.title}</h1>
        <div className="flex gap-4 text-sm text-gray-600">
          <span>Status: {p.status}</span>
          <span>Role: {my_role}</span>
          {p.created_at && <span>Created: {new Date(p.created_at).toLocaleDateString()}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="md:col-span-2">
          {/* Project metadata */}
          <div className="bg-white border rounded p-4 mb-6">
            <h2 className="text-lg font-semibold mb-3">Overview</h2>
            {p.topic && (
              <div className="mb-3">
                <label className="text-sm text-gray-600">Topic</label>
                <p className="text-base">{p.topic}</p>
              </div>
            )}
            {p.audience && (
              <div className="mb-3">
                <label className="text-sm text-gray-600">Audience</label>
                <p className="text-base">{p.audience}</p>
              </div>
            )}
            {p.goal && (
              <div className="mb-3">
                <label className="text-sm text-gray-600">Goal</label>
                <p className="text-base">{p.goal}</p>
              </div>
            )}
            {p.rights_holder && (
              <div className="mb-3">
                <label className="text-sm text-gray-600">Rights Holder</label>
                <p className="text-base">{p.rights_holder}</p>
              </div>
            )}
          </div>

          {/* Inputs */}
          {inputs.length > 0 && (
            <div className="bg-white border rounded p-4 mb-6">
              <h2 className="text-lg font-semibold mb-3">Inputs ({inputs.length})</h2>
              <div className="space-y-3">
                {inputs.map((input) => (
                  <div key={input.id} className="border-l-4 border-blue-400 pl-3">
                    <div className="text-sm font-semibold capitalize">{input.kind}</div>
                    {input.title && <div className="text-sm text-gray-700 mt-1">{input.title}</div>}
                    {input.source_ref && (
                      <div className="text-xs text-gray-500 mt-1">Source: {input.source_ref}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Artifacts */}
          {artifacts.length > 0 && (
            <div className="bg-white border rounded p-4 mb-6">
              <h2 className="text-lg font-semibold mb-3">Artifacts</h2>
              <div className="space-y-4">
                {artifacts.map((artifact) => (
                  <div key={artifact.id} className="border rounded p-3">
                    <div className="font-semibold text-base">
                      {artifact.title || artifact.format}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      Role: {artifact.role} | Format: {artifact.format}
                    </div>
                    <div className="text-sm text-gray-600 mt-2">
                      Versions: {artifact.versions.length}
                      {artifact.versions.filter((v) => v.is_validated).length > 0 &&
                        ` (${artifact.versions.filter((v) => v.is_validated).length} validated)`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Topics */}
          {topic_status.length > 0 && (
            <div className="bg-white border rounded p-4">
              <h2 className="text-lg font-semibold mb-3">Topics ({topic_status.length})</h2>
              <div className="space-y-2">
                {topic_status.map((topic) => (
                  <div key={topic.topic_id} className="flex justify-between items-center py-2 border-b last:border-b-0">
                    <span className="text-sm">{topic.topic_name || topic.topic_id}</span>
                    <span className="px-2 py-1 rounded text-xs font-semibold bg-gray-100">
                      {topic.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="md:col-span-1">
          {/* Status card */}
          <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-4">
            <h3 className="font-semibold text-sm mb-2">Book Status</h3>
            <p className="text-sm text-gray-700">
              {book_validated ? (
                <span className="text-green-600">✓ Validated</span>
              ) : (
                <span className="text-gray-600">Not yet validated</span>
              )}
            </p>
          </div>

          {/* Role info */}
          <div className="bg-white border rounded p-4 mb-4">
            <h3 className="font-semibold text-sm mb-2">Your Role</h3>
            <p className="text-sm text-gray-700 capitalize">{my_role}</p>
            {my_role === "owner" && (
              <p className="text-xs text-gray-500 mt-2">You own this project.</p>
            )}
            {my_role === "reviewer" && (
              <p className="text-xs text-gray-500 mt-2">You are invited to review this project.</p>
            )}
          </div>

          {/* Action buttons */}
          {my_role === "owner" && (
            <div className="space-y-2">
              <button
                disabled
                className="w-full px-4 py-2 bg-gray-300 text-gray-700 rounded disabled:opacity-50 text-sm"
              >
                Invite Reviewer
              </button>
              <button
                disabled
                className="w-full px-4 py-2 bg-gray-300 text-gray-700 rounded disabled:opacity-50 text-sm"
              >
                Edit Project
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
