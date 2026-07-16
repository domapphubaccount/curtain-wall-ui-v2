import { useState } from "react";
import { useStore } from "./store";
import Dashboard from "./components/Dashboard";
import Backlog from "./components/Backlog";
import Board from "./components/Board";
import Reports from "./components/Reports";
import Whiteboard from "./components/Whiteboard";
import Gantt from "./components/Gantt";
import Team from "./components/Team";
import Files from "./components/Files";
import ProjectModal from "./components/ProjectModal";
import StoryModal from "./components/StoryModal";
import { useAuth } from "./auth";

type View = "dashboard" | "backlog" | "board" | "gantt" | "whiteboard" | "team" | "files" | "reports";

const NAV: { id: View; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "◧" },
  { id: "backlog", label: "Backlog", icon: "☰" },
  { id: "board", label: "Board", icon: "▦" },
  { id: "gantt", label: "Gantt", icon: "▬" },
  { id: "whiteboard", label: "Whiteboard", icon: "✎" },
  { id: "files", label: "Files", icon: "🗂" },
  { id: "team", label: "Team", icon: "◍" },
  { id: "reports", label: "Reports", icon: "◔" },
];

export default function App() {
  const { state, project, dispatch, ready, error } = useStore();
  const { user, logout } = useAuth();
  const [view, setView] = useState<View>("dashboard");
  const [projectModal, setProjectModal] = useState<"create" | "settings" | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const currentNav = NAV.find((n) => n.id === view)!;
  const isAdmin = user?.role === "ADMIN";

  if (!ready) return <div className="app-loading">Loading company workspace…</div>;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-mark">⚡</span> SprintForge
        </div>

        <div className="proj-head">
          <span>Projects</span>
          {isAdmin && <button title="New project" onClick={() => setProjectModal("create")}>+</button>}
        </div>
        <div className="proj-list">
          {state.projects.map((p) => (
            <div
              key={p.id}
              className={`proj-item${p.id === project.id ? " active" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => dispatch({ type: "project/switch", id: p.id })}
              onKeyDown={(e) => {
                if (e.key === "Enter") dispatch({ type: "project/switch", id: p.id });
              }}
            >
              <span className="proj-key">{p.key}</span>
              <span className="proj-name">{p.name}</span>
              {isAdmin && p.id === project.id && (
                <button
                  className="proj-gear"
                  title="Project settings"
                  onClick={(e) => {
                    e.stopPropagation();
                    setProjectModal("settings");
                  }}
                >
                  ⚙
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="signed-in-user">
          <span className="avatar" style={{ background: user?.color }}>{user?.name.slice(0, 2).toUpperCase()}</span>
          <div><strong>{user?.name}</strong><small>{isAdmin ? "Administrator" : user?.jobTitle}</small></div>
        </div>
        <div className="footer">
          <button onClick={() => void logout()}>Sign out</button>
        </div>
      </aside>

      <div className="main-wrap">
        <header className="topbar">
          <div className="crumbs">
            <span className="crumb"><span className="ws-badge">S</span> SprintForge</span>
            <span className="sep">/</span>
            <span className="crumb">{project.name}</span>
            <span className="sep">/</span>
            <span className="crumb current">
              {currentNav.icon} {currentNav.label}
            </span>
          </div>
          <div className="topbar-actions">
            {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>Add Task</button>}
          </div>
        </header>
        <nav className="view-tabs">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`view-tab${view === item.id ? " active" : ""}`}
              onClick={() => setView(item.id)}
            >
              <span className="icon">{item.icon}</span> {item.label}
            </button>
          ))}
        </nav>
        <main className="main">
          {error && <div className="sync-error" role="alert">{error}</div>}
          {view === "dashboard" && <Dashboard onNavigate={setView} />}
          {view === "backlog" && <Backlog />}
          {view === "board" && <Board />}
          {view === "gantt" && <Gantt />}
          {view === "whiteboard" && <Whiteboard />}
          {view === "files" && <Files />}
          {view === "team" && <Team />}
          {view === "reports" && <Reports />}
        </main>
      </div>

      {projectModal && <ProjectModal mode={projectModal} onClose={() => setProjectModal(null)} />}
      {showCreate && <StoryModal story={null} onClose={() => setShowCreate(false)} />}
    </div>
  );
}

export type { View };
