import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Navigation } from "@/components/Navigation";
import CommonProjectsPage from "@/pages/trust/common";
import CommonProjectDetailPage from "@/pages/trust/common/[id]";

export default function App() {
  return (
    <Router>
      <div className="min-h-screen bg-white">
        <Navigation />
        <Routes>
          <Route path="/trust/common" element={<CommonProjectsPage />} />
          <Route path="/trust/common/:id" element={<CommonProjectDetailPage />} />
          {/* Fallback */}
          <Route path="/" element={<CommonProjectsPage />} />
        </Routes>
      </div>
    </Router>
  );
}
