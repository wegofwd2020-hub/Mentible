import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Supabase automatically handles the callback and updates the session
        const { data, error: err } = await supabase.auth.getSession();
        if (err) throw err;
        if (data.session) {
          // Session is set, redirect to common projects
          navigate("/trust/common", { replace: true });
        } else {
          setError("No session returned from OAuth");
        }
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Failed to complete sign-in"
        );
      }
    };
    handleCallback();
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md">
          <h1 className="text-2xl font-bold text-center text-gray-900 mb-4">
            Sign-In Error
          </h1>
          <p className="text-red-600 mb-6 text-center">{error}</p>
          <button
            onClick={() => navigate("/login")}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        <p className="text-gray-600">Completing sign-in...</p>
      </div>
    </div>
  );
}
