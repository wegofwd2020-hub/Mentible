import { useAuth } from "@/contexts/AuthContext";

export default function SettingsPage() {
  const { user, signOut } = useAuth();

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Settings</h1>

      {/* Account Section */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Account</h2>
        <div className="bg-gray-50 p-6 rounded-lg">
          {user ? (
            <>
              <p className="text-sm text-gray-600">Email</p>
              <p className="text-lg font-medium text-gray-900 mb-6">{user.email}</p>
              <button
                onClick={() => {
                  signOut();
                  window.location.href = "/";
                }}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Sign Out
              </button>
            </>
          ) : (
            <p className="text-gray-600">Not signed in</p>
          )}
        </div>
      </div>

      {/* API Configuration */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">API</h2>
        <div className="bg-gray-50 p-6 rounded-lg text-center">
          <p className="text-gray-600">API configuration coming soon</p>
        </div>
      </div>

      {/* Preferences */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Preferences</h2>
        <div className="bg-gray-50 p-6 rounded-lg text-center">
          <p className="text-gray-600">Theme and language settings coming soon</p>
        </div>
      </div>
    </div>
  );
}
