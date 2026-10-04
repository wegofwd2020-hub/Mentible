import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { Navigation } from "@/components/Navigation";
import CommonProjectsPage from "@/pages/trust/common";
import CommonProjectDetailPage from "@/pages/trust/common/[id]";
import LoginPage from "@/pages/login";
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
              <AppLayout>
                <SettingsPage />
              </AppLayout>
            }
          />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
