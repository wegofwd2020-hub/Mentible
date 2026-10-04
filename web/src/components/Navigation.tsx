import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export function Navigation() {
  const location = useLocation();
  const { token, signOut } = useAuth();

  const isActive = (path: string) => location.pathname.startsWith(path);

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link to="/" className="text-2xl font-bold text-blue-600">
            Mentible
          </Link>

          {/* Navigation Links */}
          <div className="flex items-center gap-8">
            <Link
              to="/trust/common"
              className={`font-medium transition ${
                isActive("/trust/common")
                  ? "text-blue-600 border-b-2 border-blue-600 pb-1"
                  : "text-gray-700 hover:text-gray-900"
              }`}
            >
              Common Projects
            </Link>

            {token && (
              <>
                <Link
                  to="/trust/projects"
                  className={`font-medium transition ${
                    isActive("/trust/projects")
                      ? "text-blue-600 border-b-2 border-blue-600 pb-1"
                      : "text-gray-700 hover:text-gray-900"
                  }`}
                >
                  Projects
                </Link>
                <Link
                  to="/trust/reviews"
                  className={`font-medium transition ${
                    isActive("/trust/reviews")
                      ? "text-blue-600 border-b-2 border-blue-600 pb-1"
                      : "text-gray-700 hover:text-gray-900"
                  }`}
                >
                  Reviews
                </Link>
                <Link
                  to="/settings"
                  className={`font-medium transition ${
                    isActive("/settings")
                      ? "text-blue-600 border-b-2 border-blue-600 pb-1"
                      : "text-gray-700 hover:text-gray-900"
                  }`}
                >
                  Settings
                </Link>
              </>
            )}

            {/* Auth Button */}
            <div>
              {token ? (
                <button
                  onClick={() => {
                    signOut();
                    window.location.href = "/";
                  }}
                  className="px-4 py-2 text-sm font-medium text-red-600 border border-red-600 rounded hover:bg-red-50"
                >
                  Sign Out
                </button>
              ) : (
                <Link
                  to="/login"
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                >
                  Sign In
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
