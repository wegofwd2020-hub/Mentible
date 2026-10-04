import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

export default function SettingsPage() {
  const { user, isGuest, signOut } = useAuth();
  const navigate = useNavigate();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      // TODO: Call DELETE /api/v1/account
      // For now, just sign out
      await signOut();
      navigate("/");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Failed to delete account");
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Settings</h1>

      {/* Account Section */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Account</h2>
        <div className="bg-white border rounded-lg p-6">
          {isGuest ? (
            <div className="text-center py-6">
              <p className="text-gray-600 mb-4">You're browsing as a guest.</p>
              <button
                onClick={() => navigate("/login")}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Sign In
              </button>
            </div>
          ) : user ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Email</label>
                <p className="text-lg font-medium text-gray-900">{user.email}</p>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Email Verified</label>
                <p className="text-base">
                  {user.email_verified ? (
                    <span className="text-green-600">✓ Verified</span>
                  ) : (
                    <span className="text-yellow-600">Pending verification</span>
                  )}
                </p>
              </div>

              <div className="pt-4 border-t">
                <button
                  onClick={() => {
                    signOut();
                    window.location.href = "/";
                  }}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
                >
                  Sign Out
                </button>
              </div>
            </div>
          ) : (
            <p className="text-gray-600">Not signed in</p>
          )}
        </div>
      </div>

      {/* Credentials Section */}
      {!isGuest && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">API & Credentials</h2>
          <div className="bg-white border rounded-lg p-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  API Key Type
                </label>
                <p className="text-base text-gray-700">
                  Managed Key (default) — we handle your API tokens securely
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  Optional: Bring Your Own Key (BYOK) coming soon
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Danger Zone */}
      {!isGuest && user && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-red-600 mb-4">Danger Zone</h2>
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h3 className="font-semibold text-gray-900 mb-2">Delete Account</h3>
            <p className="text-sm text-gray-600 mb-4">
              Permanently delete your account and all associated data. This action cannot be undone.
            </p>

            {deleteError && (
              <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
                {deleteError}
              </div>
            )}

            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Delete Account
              </button>
            ) : (
              <div className="space-y-4">
                <div className="bg-red-100 border border-red-300 rounded p-4">
                  <p className="text-red-800 font-medium">
                    ⚠️ Are you sure? This will permanently delete:
                  </p>
                  <ul className="text-red-700 text-sm mt-2 space-y-1 ml-4 list-disc">
                    <li>Your account ({user.email})</li>
                    <li>All your projects and versions</li>
                    <li>All analytics data</li>
                  </ul>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleteLoading}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                  >
                    {deleteLoading ? "Deleting..." : "Yes, delete forever"}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={deleteLoading}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
