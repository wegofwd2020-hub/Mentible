import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  adminListCommonProjects,
  takeDownCommonProject,
  restoreCommonProject,
  AdminCommonProjectRow,
} from "@/lib/api/common-projects";

export default function AdminCommonProjectsPage() {
  const [projects, setProjects] = useState<AdminCommonProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const [selectedProject, setSelectedProject] = useState<AdminCommonProjectRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAction, setModalAction] = useState<"takedown" | "restore">("takedown");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const token = localStorage.getItem("sb-mentible-app-auth-token");

  const loadProjects = async (q: string, o: number) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const result = await adminListCommonProjects({
        q: q || undefined,
        limit,
        offset: o,
        token,
      });
      setProjects(result.projects);
      setTotal(result.total);
      setOffset(o);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load projects.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects(searchQ, 0);
  }, [token]);

  const handleSearch = (q: string) => {
    setSearchQ(q);
    setOffset(0);
    loadProjects(q, 0);
  };

  const openModal = (project: AdminCommonProjectRow, action: "takedown" | "restore") => {
    setSelectedProject(project);
    setModalAction(action);
    setReason("");
    setSubmitError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedProject(null);
    setReason("");
    setSubmitError(null);
  };

  const handleSubmit = async () => {
    if (!selectedProject || !token) return;

    if (modalAction === "takedown" && !reason.trim()) {
      setSubmitError("Reason is required");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      if (modalAction === "takedown") {
        await takeDownCommonProject(selectedProject.id, { reason: reason.trim() }, token);
      } else {
        await restoreCommonProject(selectedProject.id, token);
      }

      // Reload projects
      await loadProjects(searchQ, offset);
      closeModal();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : `Couldn't ${modalAction} project.`);
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return <div className="p-6">Not authenticated. Please sign in.</div>;
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      <Link to="/admin" className="text-blue-600 hover:underline mb-4 inline-block">
        ← Back to Admin
      </Link>

      <h1 className="text-3xl font-bold mb-6 mt-4">Common Projects Moderation</h1>

      <div className="mb-6 flex gap-2">
        <input
          type="text"
          placeholder="Search by title or description..."
          value={searchQ}
          onChange={(e) => handleSearch(e.target.value)}
          className="flex-1 px-4 py-2 border rounded"
        />
      </div>

      {loading && <div className="text-center py-8">Loading...</div>}
      {error && <div className="p-4 bg-red-100 text-red-700 rounded mb-4">{error}</div>}

      {!loading && (
        <>
          <div className="bg-white border rounded overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left py-3 px-4">Title</th>
                  <th className="text-left py-3 px-4">Author</th>
                  <th className="text-left py-3 px-4">Created</th>
                  <th className="text-left py-3 px-4">Status</th>
                  <th className="text-left py-3 px-4">Reason</th>
                  <th className="text-left py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id} className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4 max-w-xs truncate">{project.title}</td>
                    <td className="py-3 px-4">{project.author_name}</td>
                    <td className="py-3 px-4">{new Date(project.created_at).toLocaleDateString()}</td>
                    <td className="py-3 px-4">
                      {project.taken_down_at ? (
                        <span className="px-2 py-1 rounded text-xs font-semibold bg-red-100 text-red-700">
                          Taken Down
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded text-xs font-semibold bg-green-100 text-green-700">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 max-w-xs truncate text-xs text-gray-600">
                      {project.taken_down_reason || "—"}
                    </td>
                    <td className="py-3 px-4">
                      {project.taken_down_at ? (
                        <button
                          onClick={() => openModal(project, "restore")}
                          className="text-blue-600 hover:underline"
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          onClick={() => openModal(project, "takedown")}
                          className="text-red-600 hover:underline"
                        >
                          Take Down
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-600">
              Showing {offset + 1} to {Math.min(offset + limit, total)} of {total}
            </p>
            <div className="flex gap-2">
              <button
                disabled={offset === 0}
                onClick={() => loadProjects(searchQ, Math.max(0, offset - limit))}
                className="px-4 py-2 border rounded disabled:opacity-50"
              >
                Previous
              </button>
              <button
                disabled={offset + limit >= total}
                onClick={() => loadProjects(searchQ, offset + limit)}
                className="px-4 py-2 border rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* Modal */}
      {modalOpen && selectedProject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold mb-4">
              {modalAction === "takedown" ? "Take Down Project" : "Restore Project"}
            </h2>

            <p className="mb-4 text-gray-600">
              <strong>Project:</strong> {selectedProject.title}
            </p>

            {modalAction === "takedown" && (
              <div className="mb-4">
                <label className="block text-sm font-semibold mb-2">Reason (required)</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why is this project being taken down?"
                  rows={3}
                  className="w-full px-3 py-2 border rounded text-sm"
                  maxLength={500}
                />
                <p className="text-xs text-gray-500 mt-1">{reason.length}/500</p>
              </div>
            )}

            {submitError && <div className="p-3 bg-red-100 text-red-700 rounded mb-4 text-sm">{submitError}</div>}

            <div className="flex gap-2 justify-end">
              <button
                onClick={closeModal}
                className="px-4 py-2 border rounded hover:bg-gray-50"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || (modalAction === "takedown" && !reason.trim())}
                className={`px-4 py-2 rounded text-white font-semibold ${
                  modalAction === "takedown"
                    ? "bg-red-600 hover:bg-red-700 disabled:bg-red-400"
                    : "bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400"
                }`}
              >
                {submitting ? "Submitting..." : modalAction === "takedown" ? "Take Down" : "Restore"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
