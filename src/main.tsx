import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { StoreProvider } from "./store";
import { AuthProvider, useAuth } from "./auth";
import Login from "./components/Login";
import "./styles.css";

function AuthenticatedApplication() {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading">Loading SprintForge…</div>;
  if (!user) return <Login />;
  return <StoreProvider><App /></StoreProvider>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <AuthenticatedApplication />
    </AuthProvider>
  </StrictMode>
);
