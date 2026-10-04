import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Navigation } from "@/components/Navigation";
import CommonProjectsPage from "@/pages/trust/common";
import CommonProjectDetailPage from "@/pages/trust/common/[id]";
import TrustProjectsPage from "@/pages/trust/projects";
import TrustProjectDetailPage from "@/pages/trust/projects/[id]";
import ReviewsPage from "@/pages/trust/reviews";
import LoginPage from "@/pages/login";
import AuthCallbackPage from "@/pages/auth/callback";
import ProjectsPage from "@/pages/projects";
import SettingsPage from "@/pages/settings";

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <Navigation />
      {children}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Auth pages (no nav) */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />

          {/* App pages (with nav) */}
          <Route
            path="/"
            element={
              <AppLayout>
                <CommonProjectsPage />
              </AppLayout>
            }
          />
          <Route
            path="/trust/common"
            element={
              <AppLayout>
                <CommonProjectsPage />
              </AppLayout>
            }
          />
          <Route
            path="/trust/common/:id"
            element={
              <AppLayout>
                <CommonProjectDetailPage />
              </AppLayout>
            }
          />
          <Route
            path="/trust/projects"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <TrustProjectsPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/trust/projects/:id"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <TrustProjectDetailPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/trust/reviews"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <ReviewsPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects"
            element={
              <AppLayout>
                <ProjectsPage />
              </AppLayout>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <SettingsPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
