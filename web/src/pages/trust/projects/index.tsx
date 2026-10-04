import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listOwnedProjects, ProjectSummary } from "@/lib/api/trust";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
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
        const list = await listOwnedProjects(token);
        setProjects(list);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load projects.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, navigate]);

  if (!token) {
    return null;
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      <Link to="/" className="text-blue-600 hover:underline mb-4 inline-block">
        ← Back
      </Link>

      <div className="flex items-center justify-between mb-6 mt-4">
        <h1 className="text-3xl font-bold">Projects</h1>
        <Link
          to="/trust/projects/new"
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          New Project
        </Link>
      </div>

      {loading && <div className="text-center py-8">Loading...</div>}
      {error && <div className="p-4 bg-red-100 text-red-700 rounded mb-4">{error}</div>}

      {!loading && projects.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-600 mb-4">No projects yet. Create one to get started.</p>
          <Link
            to="/trust/projects/new"
            className="inline-block px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Create First Project
          </Link>
        </div>
      )}

      {!loading && projects.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/trust/projects/${project.id}`}
              className="block p-4 bg-white border rounded hover:bg-gray-50"
            >
              <h3 className="text-lg font-semibold mb-1">{project.title}</h3>
              {project.topic && <p className="text-sm text-gray-600">Topic: {project.topic}</p>}
              {project.audience && (
                <p className="text-sm text-gray-600">Audience: {project.audience}</p>
              )}
              <div className="flex items-center justify-between mt-3">
                <span className="inline-block px-2 py-1 rounded text-xs font-semibold bg-blue-100 text-blue-700">
                  {project.status}
                </span>
                <span className="text-xs text-gray-500">
                  {project.created_at ? new Date(project.created_at).toLocaleDateString() : ""}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
