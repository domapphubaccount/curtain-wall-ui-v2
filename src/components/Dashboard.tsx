import { activeSprint, backlogStories, sprintStories, storyPoints, useStore } from "../store";
import { STATUS_LABELS } from "../types";
import type { StoryStatus } from "../types";
import type { View } from "../App";
import { Avatar, daysLeft, formatDate } from "./common";
import { exportProjectToExcel } from "../export";

const STATUS_COLORS: Record<StoryStatus, string> = {
  backlog: "#3a3a45",
  todo: "#4a4a56",
  inprogress: "#4f9cf9",
  review: "#f5a623",
  done: "#3ecf8e",
};

export default function Dashboard({ onNavigate }: { onNavigate: (v: View) => void }) {
  const { project } = useStore();
  const sprint = activeSprint(project);
  const backlog = backlogStories(project);
  const completedSprints = project.sprints.filter((sp) => sp.state === "completed");
  const avgVelocity = completedSprints.length
    ? Math.round(
        completedSprints.reduce((sum, sp) => sum + (sp.velocity ?? 0), 0) / completedSprints.length
      )
    : null;

  const stories = sprint ? sprintStories(project, sprint.id) : [];
  const donePts = storyPoints(stories.filter((s) => s.status === "done"));
  const totalPts = storyPoints(stories);
  const pct = totalPts ? Math.round((donePts / totalPts) * 100) : 0;

  return (
    <>
      <div className="view-header">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">
            {sprint
              ? `${sprint.name} is active — ${daysLeft(sprint.endDate)} days remaining`
              : "No active sprint. Plan one from the backlog."}
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => void exportProjectToExcel(project)}>
            ⬇ Export to Excel
          </button>
          <button className="btn" onClick={() => onNavigate("backlog")}>Open backlog</button>
          {sprint && (
            <button className="btn btn-primary" onClick={() => onNavigate("board")}>
              Go to board
            </button>
          )}
        </div>
      </div>

      <div className="stat-grid">
        <div className="panel stat-card">
          <div className="label">Sprint progress</div>
          <div className="value">{pct}%</div>
          <div className="hint">{donePts} of {totalPts} points done</div>
        </div>
        <div className="panel stat-card">
          <div className="label">Days remaining</div>
          <div className="value">{sprint ? daysLeft(sprint.endDate) : "–"}</div>
          <div className="hint">{sprint ? `ends ${formatDate(sprint.endDate)}` : "no active sprint"}</div>
        </div>
        <div className="panel stat-card">
          <div className="label">Items in sprint</div>
          <div className="value">{stories.length}</div>
          <div className="hint">{stories.filter((s) => s.status === "done").length} completed</div>
        </div>
        <div className="panel stat-card">
          <div className="label">Backlog depth</div>
          <div className="value">{backlog.length}</div>
          <div className="hint">{storyPoints(backlog)} points unplanned</div>
        </div>
        <div className="panel stat-card">
          <div className="label">Avg velocity</div>
          <div className="value">{avgVelocity ?? "–"}</div>
          <div className="hint">
            {completedSprints.length
              ? `over ${completedSprints.length} completed sprint${completedSprints.length > 1 ? "s" : ""}`
              : "complete a sprint to measure"}
          </div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="panel panel-pad">
          <h2 className="section-title">Sprint health</h2>
          {sprint ? (
            <>
              {sprint.goal && (
                <p style={{ marginTop: 0 }}>
                  🎯 <strong>Sprint goal:</strong> {sprint.goal}
                </p>
              )}
              <div className="progress-track">
                {(["done", "review", "inprogress", "todo"] as StoryStatus[]).map((st) => {
                  const pts = storyPoints(stories.filter((s) => s.status === st));
                  if (!totalPts || !pts) return null;
                  return (
                    <div
                      key={st}
                      className="progress-fill"
                      style={{ width: `${(pts / totalPts) * 100}%`, background: STATUS_COLORS[st], borderRadius: 0 }}
                      title={`${STATUS_LABELS[st]}: ${pts} pts`}
                    />
                  );
                })}
              </div>
              <div className="legend">
                {(["todo", "inprogress", "review", "done"] as StoryStatus[]).map((st) => (
                  <span key={st}>
                    <span className="dot" style={{ background: STATUS_COLORS[st] }} />
                    {STATUS_LABELS[st]} ·{" "}
                    {storyPoints(stories.filter((s) => s.status === st))} pts
                  </span>
                ))}
              </div>
              {sprint.committedPoints !== null && totalPts > sprint.committedPoints && (
                <p style={{ color: "var(--amber)", fontSize: 13 }}>
                  ⚠ Scope grew: {totalPts - sprint.committedPoints} pts added after sprint start
                  (committed {sprint.committedPoints}, now {totalPts}).
                </p>
              )}
            </>
          ) : (
            <p style={{ color: "var(--text-dim)" }}>
              Nothing in flight. Head to the backlog to plan and start your next sprint.
            </p>
          )}
        </div>

        <div className="panel panel-pad">
          <h2 className="section-title">Team workload</h2>
          {project.members.map((m) => {
            const mine = stories.filter((s) => s.assigneeId === m.id);
            const open = mine.filter((s) => s.status !== "done");
            return (
              <div className="member-row" key={m.id}>
                <Avatar member={m} />
                <div className="meta">
                  <div className="name">{m.name}</div>
                  <div className="role">{m.role}</div>
                </div>
                <div className="load">
                  {open.length} open · {storyPoints(open)} pts
                </div>
              </div>
            );
          })}
          {(() => {
            const unassigned = stories.filter((s) => !s.assigneeId && s.status !== "done");
            return unassigned.length > 0 ? (
              <div className="member-row">
                <Avatar member={null} />
                <div className="meta">
                  <div className="name">Unassigned</div>
                  <div className="role">needs an owner</div>
                </div>
                <div className="load">
                  {unassigned.length} open · {storyPoints(unassigned)} pts
                </div>
              </div>
            ) : null;
          })()}
        </div>
      </div>
    </>
  );
}
