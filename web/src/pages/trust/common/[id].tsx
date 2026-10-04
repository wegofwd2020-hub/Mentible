import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getCommonProject,
  importCommonProject,
  CommonProjectDetail,
  ApiError,
  StructuredTocView,
  StructuredTocUnit,
  ProjectView,
} from "@/lib/api";
import { ImportConflictDialog } from "@/components/ImportConflictDialog";
import { Toast } from "@/components/Toast";

export default function CommonProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<CommonProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [existingProjectTitle, setExistingProjectTitle] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [conflictAction, setConflictAction] = useState<"suffix" | "replace" | null>(null);

  const token = localStorage.getItem("sb-mentible-app-auth-token");
  // TODO: Get current user from auth context
  const currentUserEmail = localStorage.getItem("sb-mentible-app-email");

  useEffect(() => {
    const loadProject = async () => {
      if (!id) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getCommonProject(id, token);
        setProject(data);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          setError("Project not found");
        } else {
          setError(
            e instanceof Error ? e.message : "Failed to load project",
          );
        }
      } finally {
        setLoading(false);
      }
    };
    loadProject();
  }, [id, token]);

  const handleImport = async () => {
    if (!token) {
      navigate("/login");
      return;
    }
    if (!id) return;

    setImporting(true);
    try {
      const importedProject = await importCommonProject(id, token);
      setToast({
        message: `✓ Imported as "${importedProject.title}"`,
        type: "success",
      });
      setTimeout(() => {
        navigate(`/projects/${importedProject.id}`);
      }, 1500);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Title conflict - show dialog to handle resolution
        try {
          // Try to extract existing title from error message
          // Backend should return conflict details
          setExistingProjectTitle(null);
          setShowConflictDialog(true);
        } catch {
          setToast({
            message: "A project with this title already exists",
            type: "error",
          });
        }
      } else {
        setToast({
          message: e instanceof Error ? e.message : "Import failed",
          type: "error",
        });
      }
    } finally {
      setImporting(false);
    }
  };

  const handleImportWithSuffix = async () => {
    if (!token || !id) return;
    setImporting(true);
    try {
      const importedProject = await importCommonProject(id, token, {
        conflict_action: "new_with_suffix",
      });
      setShowConflictDialog(false);
      setToast({
        message: `✓ Imported as "${importedProject.title}"`,
        type: "success",
      });
      setTimeout(() => {
        navigate(`/projects/${importedProject.id}`);
      }, 1500);
    } catch (e) {
      setToast({
        message: e instanceof Error ? e.message : "Import failed",
        type: "error",
      });
    } finally {
      setImporting(false);
    }
  };

  const handleImportReplace = async () => {
    if (!token || !id) return;
    setImporting(true);
    try {
      const importedProject = await importCommonProject(id, token, {
        conflict_action: "replace_existing",
      });
      setShowConflictDialog(false);
      setToast({
        message: `✓ Project replaced and imported`,
        type: "success",
      });
      setTimeout(() => {
        navigate(`/projects/${importedProject.id}`);
      }, 1500);
    } catch (e) {
      setToast({
        message: e instanceof Error ? e.message : "Import failed",
        type: "error",
      });
    } finally {
      setImporting(false);
    }
  };

  const isAuthor = project?.is_author || false;
  const isTakenDown = !!project?.taken_down_at;

  if (loading) {
    return (
      <div className="min-h-screen bg-white p-6">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-3/4" />
            <div className="h-4 bg-gray-200 rounded w-1/2" />
            <div className="h-32 bg-gray-200 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {error || "Project not found"}
            </h1>
            <button
              onClick={() => navigate("/trust/common")}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Back to Common Projects
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <button
            onClick={() => navigate("/trust/common")}
            className="text-blue-600 hover:underline mb-4"
          >
            ← Back to Common Projects
          </button>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {project.title}
          </h1>
          <div className="text-sm text-gray-600">
            <p>By {project.author_name}</p>
            <p>Created {new Date(project.created_at).toLocaleDateString()}</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Taken Down Notice */}
        {isTakenDown && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <h3 className="font-semibold text-red-900 mb-1">
              This project has been taken down
            </h3>
            {project.taken_down_reason && (
              <p className="text-sm text-red-800">{project.taken_down_reason}</p>
            )}
          </div>
        )}

        {/* Description */}
        {project.description && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">About</h2>
            <p className="text-gray-700 leading-relaxed">
              {project.description}
            </p>
          </div>
        )}

        {/* Tags */}
        {project.tags && project.tags.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Tags</h2>
            <div className="flex flex-wrap gap-2">
              {project.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-block px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Table of Contents */}
        {project.project_data?.toc && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Table of Contents
            </h2>
            <TableOfContents toc={project.project_data.toc} />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-4 border-t border-gray-200 pt-8">
          <button
            onClick={handleImport}
            disabled={isTakenDown || importing}
            className={`flex-1 px-6 py-3 rounded-lg font-medium transition ${
              isTakenDown || importing
                ? "bg-gray-300 text-gray-600 cursor-not-allowed"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {importing ? "Importing..." : "Import Project"}
          </button>
          {isAuthor && (
            <>
              <button className="px-6 py-3 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50">
                Edit
              </button>
              <button className="px-6 py-3 border border-red-300 rounded-lg font-medium text-red-700 hover:bg-red-50">
                Unpublish
              </button>
            </>
          )}
        </div>
      </div>

      {/* Conflict Dialog */}
      <ImportConflictDialog
        isOpen={showConflictDialog}
        projectTitle={project.title}
        existingProjectTitle={existingProjectTitle}
        isLoading={importing}
        onImportWithSuffix={handleImportWithSuffix}
        onReplaceExisting={handleImportReplace}
        onKeepExisting={() => setShowConflictDialog(false)}
        onCancel={() => setShowConflictDialog(false)}
      />

      {/* Toast Notification */}
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

function TableOfContents({ toc }: { toc: StructuredTocView }) {
  return (
    <div className="space-y-4">
      {toc.subjects.map((subject, subjectIdx) => (
        <div key={subjectIdx} className="border border-gray-200 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 mb-3">
            {subject.subject_label}
          </h3>
          <ul className="space-y-2 ml-4">
            {subject.units.slice(0, 5).map((unit) => (
              <TocUnit key={unit.id} unit={unit} />
            ))}
            {subject.units.length > 5 && (
              <li className="text-sm text-gray-500">
                ... and {subject.units.length - 5} more units
              </li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}

function TocUnit({ unit }: { unit: StructuredTocUnit }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="text-gray-700">
      <div className="flex items-center gap-2 cursor-pointer">
        {unit.subtopics && unit.subtopics.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-gray-500 hover:text-gray-700"
          >
            {expanded ? "▼" : "▶"}
          </button>
        )}
        <span>{unit.title}</span>
      </div>
      {expanded && unit.subtopics && unit.subtopics.length > 0 && (
        <ul className="ml-6 mt-2 space-y-1 text-sm text-gray-600">
          {(unit.subtopics as Array<{ title?: string; id?: string }>).slice(0, 3).map((sub, idx) => (
            <li key={idx}>• {(sub as any)?.title || `Subtopic ${idx + 1}`}</li>
          ))}
          {unit.subtopics.length > 3 && (
            <li>... and {unit.subtopics.length - 3} more</li>
          )}
        </ul>
      )}
    </li>
  );
}
