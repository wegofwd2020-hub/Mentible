import { useState } from "react";

export interface ImportConflictDialogProps {
  projectTitle: string;
  existingProjectTitle: string | null;
  isOpen: boolean;
  isLoading?: boolean;
  onKeepExisting: () => void;
  onReplaceExisting: () => void;
  onImportWithSuffix: () => void;
  onCancel: () => void;
}

export function ImportConflictDialog({
  projectTitle,
  existingProjectTitle,
  isOpen,
  isLoading = false,
  onKeepExisting,
  onReplaceExisting,
  onImportWithSuffix,
  onCancel,
}: ImportConflictDialogProps) {
  const [showConfirmReplace, setShowConfirmReplace] = useState(false);

  if (!isOpen) return null;

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
