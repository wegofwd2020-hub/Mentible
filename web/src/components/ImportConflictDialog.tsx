import { useState } from "react";

export interface ImportConflictDialogProps {
  projectTitle: string;
  existingProjectTitle?: string | null;
  isOpen: boolean;
  isLoading?: boolean;
  mode?: "import" | "publish"; // defaults to "import"
  quotaRemaining?: number;
  quotaLimit?: number;
  onKeepExisting?: () => void;
  onReplaceExisting?: () => void;
  onImportWithSuffix?: () => void;
  onPublish?: (title: string, description: string, tags: string[]) => void;
  onCancel: () => void;
}

export function ImportConflictDialog({
  projectTitle,
  existingProjectTitle,
  isOpen,
  isLoading = false,
  mode = "import",
  quotaRemaining = 0,
  quotaLimit = 0,
  onKeepExisting,
  onReplaceExisting,
  onImportWithSuffix,
  onPublish,
  onCancel,
}: ImportConflictDialogProps) {
  const [showConfirmReplace, setShowConfirmReplace] = useState(false);
  const [publishTitle, setPublishTitle] = useState(projectTitle);
  const [publishDescription, setPublishDescription] = useState("");
  const [publishTags, setPublishTags] = useState("");

  if (!isOpen) return null;

  const quotaAtLimit = quotaRemaining <= 0 && mode === "import";

  const handlePublish = () => {
    if (onPublish) {
      const tagArray = publishTags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t);
      onPublish(publishTitle, publishDescription, tagArray);
    }
  };

  // Publish mode
  if (mode === "publish") {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6">
          <h2 className="text-xl font-bold mb-4">Publish to Common Projects</h2>

          {quotaAtLimit && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
              ❌ Quota full. Upgrade to publish more.
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={publishTitle}
                onChange={(e) => setPublishTitle(e.target.value)}
                disabled={quotaAtLimit || isLoading}
                className="w-full px-3 py-2 border rounded text-sm disabled:bg-gray-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={publishDescription}
                onChange={(e) => setPublishDescription(e.target.value)}
                disabled={quotaAtLimit || isLoading}
                className="w-full px-3 py-2 border rounded text-sm disabled:bg-gray-100"
                rows={3}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
              <input
                type="text"
                value={publishTags}
                onChange={(e) => setPublishTags(e.target.value)}
                disabled={quotaAtLimit || isLoading}
                placeholder="e.g. AI, Python, Tutorial"
                className="w-full px-3 py-2 border rounded text-sm disabled:bg-gray-100"
              />
            </div>

            <div className="flex gap-2 pt-4">
              <button
                onClick={onCancel}
                disabled={isLoading}
                className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded text-sm hover:bg-gray-400 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handlePublish}
                disabled={!publishTitle || quotaAtLimit || isLoading}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
              >
                {isLoading ? "Publishing..." : "Publish"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Import mode (original)
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg max-w-md mx-4">
        {/* Header */}
        <div className="border-b border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900">
            Project Title Already Exists
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            A project with this title already exists in your library.
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm font-medium text-gray-700">
              Import title:
            </p>
            <p className="text-base font-semibold text-gray-900">
              {projectTitle}
            </p>
          </div>

          {existingProjectTitle && (
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm font-medium text-gray-700">
                Your existing project:
              </p>
              <p className="text-base font-semibold text-gray-900">
                {existingProjectTitle}
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        {!showConfirmReplace ? (
          <div className="border-t border-gray-200 p-6 space-y-3">
            <button
              onClick={onImportWithSuffix}
              disabled={isLoading}
              className="w-full px-4 py-2 bg-blue-600 text-white font-medium rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Import with suffix "(2)"
            </button>

            <button
              onClick={() => setShowConfirmReplace(true)}
              disabled={isLoading}
              className="w-full px-4 py-2 border border-red-300 text-red-700 font-medium rounded hover:bg-red-50 disabled:opacity-50"
            >
              Replace my project (destructive)
            </button>

            <button
              onClick={onCancel}
              disabled={isLoading}
              className="w-full px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="border-t border-gray-200 p-6 space-y-3">
            <div className="bg-red-50 border border-red-200 rounded p-3">
              <p className="text-sm text-red-800 font-medium">
                ⚠ Warning: This will replace your existing project
                <strong className="block mt-1">{existingProjectTitle}</strong>
                This action cannot be undone.
              </p>
            </div>

            <button
              onClick={onReplaceExisting}
              disabled={isLoading}
              className="w-full px-4 py-2 bg-red-600 text-white font-medium rounded hover:bg-red-700 disabled:opacity-50"
            >
              {isLoading ? "Replacing..." : "Yes, replace it"}
            </button>

            <button
              onClick={() => setShowConfirmReplace(false)}
              disabled={isLoading}
              className="w-full px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
