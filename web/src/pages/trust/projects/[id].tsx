import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getProject, generateTopics, publishProject, inviteReviewer, ProjectDetail } from "@/lib/api/trust";
import { ImportConflictDialog } from "@/components/ImportConflictDialog";
import { Toast } from "@/components/Toast";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!token || !id) return;
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
  }, [token, id]);

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
  const isOwner = my_role === "owner";

  const startEdit = (field: string, value: string) => {
    setEditField(field);
    setEditValue(value);
  };

  const cancelEdit = () => {
    setEditField(null);
    setEditValue("");
  };

  const saveEdit = async () => {
    if (!token) return;
    setSaving(true);
    try {
      // TODO: Call PATCH /api/v1/trust/projects/{id} with { [editField]: editValue }
      // For now, just update local state
      if (editField === "title") {
        setProject({ ...project, project: { ...p, title: editValue } });
      } else if (editField === "topic") {
        setProject({ ...project, project: { ...p, topic: editValue } });
      } else if (editField === "audience") {
        setProject({ ...project, project: { ...p, audience: editValue } });
      } else if (editField === "goal") {
        setProject({ ...project, project: { ...p, goal: editValue } });
      }
      setEditField(null);
    } catch (e) {
      console.error("Save error:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!token || !id) return;
    setGenerating(true);
    try {
      const result = await generateTopics(id, token);
      setToast({ message: `Started topic generation (Job: ${result.job_id})`, type: "success" });
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : "Generation failed", type: "error" });
    } finally {
      setGenerating(false);
    }
  };

  const handlePublish = async (title: string, description: string, tags: string[]) => {
    if (!token || !project) return;
    setPublishing(true);
    try {
      const result = await publishProject(
        {
          title,
          description,
          tags,
          project_data: {
            topic: project.project.topic,
            audience: project.project.audience,
            goal: project.project.goal,
            artifacts: project.artifacts.map((a) => ({
              id: a.id,
              format: a.format,
              title: a.title,
            })),
          },
        },
        token,
      );
      setToast({ message: `Published as "${result.title}" (ID: ${result.id})`, type: "success" });
      setShowPublishDialog(false);
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : "Publish failed", type: "error" });
    } finally {
      setPublishing(false);
    }
  };

  const handleInvite = async () => {
    if (!token || !id || !inviteEmail.trim()) return;
    setInviting(true);
    try {
      const result = await inviteReviewer(id, inviteEmail.trim(), token);
      setToast({ message: `Invited ${result.invited_email} as ${result.role}`, type: "success" });
      setShowInviteDialog(false);
      setInviteEmail("");
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : "Invite failed", type: "error" });
    } finally {
      setInviting(false);
    }
  };

  const EditableField = ({ label, field, value }: { label: string; field: string; value: string | null }) => {
    const isEditing = editField === field;
    return (
      <div className="mb-4">
        <label className="text-sm text-gray-600 block mb-1">{label}</label>
        {isEditing ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="flex-1 px-3 py-2 border rounded text-sm"
              autoFocus
            />
            <button
              onClick={saveEdit}
              disabled={saving}
              className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Save
            </button>
            <button onClick={cancelEdit} className="px-3 py-2 bg-gray-300 text-gray-700 text-sm rounded">
              Cancel
            </button>
          </div>
        ) : (
          <div
            onClick={() => isOwner && startEdit(field, value || "")}
            className={`p-2 rounded ${
              isOwner ? "cursor-pointer hover:bg-gray-100" : ""
            } text-sm`}
          >
            {value || "(empty)"}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <Link to="/trust/projects" className="text-blue-600 hover:underline mb-4 inline-block">
        ← Back to Projects
      </Link>

      <div className="mt-4 mb-6">
        <div className="flex justify-between items-start gap-4">
          <div className="flex-1">
            <h1 className="text-3xl font-bold mb-2">{p.title}</h1>
            <div className="flex gap-4 text-sm text-gray-600">
              <span>Status: {p.status}</span>
              <span>Role: {my_role}</span>
              {p.created_at && <span>Created: {new Date(p.created_at).toLocaleDateString()}</span>}
            </div>
          </div>
          {isOwner && <div className="text-xs text-gray-500">Click fields to edit</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="md:col-span-2">
          {/* Project metadata */}
          <div className="bg-white border rounded p-4 mb-6">
            <h2 className="text-lg font-semibold mb-3">Overview</h2>
            <EditableField label="Topic" field="topic" value={p.topic} />
            <EditableField label="Audience" field="audience" value={p.audience} />
            <EditableField label="Goal" field="goal" value={p.goal} />
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
                    <div className="font-semibold text-base">{artifact.title || artifact.format}</div>
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
                  <div
                    key={topic.topic_id}
                    className="flex justify-between items-center py-2 border-b last:border-b-0"
                  >
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
            {isOwner && <p className="text-xs text-gray-500 mt-2">You own this project.</p>}
          </div>

          {/* Action buttons */}
          {isOwner && (
            <div className="space-y-2">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {generating ? "Generating..." : "📤 Generate Topics"}
              </button>
              <button
                onClick={() => setShowPublishDialog(true)}
                disabled={publishing}
                className="w-full px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
              >
                {publishing ? "Publishing..." : "🚀 Publish to Common"}
              </button>
              <button
                onClick={() => setShowInviteDialog(true)}
                disabled={inviting}
                className="w-full px-4 py-2 bg-gray-300 text-gray-700 rounded text-sm hover:bg-gray-400 disabled:opacity-50"
              >
                {inviting ? "Inviting..." : "👥 Invite Reviewer"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Dialog and Toast */}
      <ImportConflictDialog
        projectTitle={p.title}
        isOpen={showPublishDialog}
        isLoading={publishing}
        mode="publish"
        onPublish={handlePublish}
        onCancel={() => setShowPublishDialog(false)}
      />

      {/* Invite Reviewer Dialog */}
      {showInviteDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6">
            <h2 className="text-xl font-bold mb-4">Invite Reviewer</h2>
            <p className="text-sm text-gray-600 mb-4">
              Enter the email address of an expert reviewer who can review and approve versions.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={inviting}
                placeholder="reviewer@example.com"
                className="w-full px-3 py-2 border rounded text-sm disabled:bg-gray-100"
              />
            </div>

            <div className="flex gap-2 pt-4">
              <button
                onClick={handleInvite}
                disabled={inviting || !inviteEmail.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {inviting ? "Sending..." : "Send Invite"}
              </button>
              <button
                onClick={() => {
                  setShowInviteDialog(false);
                  setInviteEmail("");
                }}
                disabled={inviting}
                className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded text-sm hover:bg-gray-400 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
