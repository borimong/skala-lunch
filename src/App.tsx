import { Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import AdminUploadPage from "./pages/AdminUploadPage";
import AdminReviewPage from "./pages/AdminReviewPage";
import AdminPendingPage from "./pages/AdminPendingPage";
import AdminGate from "./components/AdminGate";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route
        path="/admin"
        element={
          <AdminGate>
            <AdminUploadPage />
          </AdminGate>
        }
      />
      <Route
        path="/admin/review"
        element={
          <AdminGate>
            <AdminReviewPage />
          </AdminGate>
        }
      />
      <Route
        path="/admin/pending"
        element={
          <AdminGate>
            <AdminPendingPage />
          </AdminGate>
        }
      />
    </Routes>
  );
}
