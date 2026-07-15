import { activeSprint, sprintStories, useStore } from "../store";
import type { Project, Sprint, Story } from "../types";
import { formatDate } from "./common";
import { totalTrackedHours } from "../time";

const DAY = 24 * 60 * 60 * 1000;

export default function Reports() {
  const { project } = useStore();
  const sprint = activeSprint(project) ?? [...project.sprints].reverse().find((sp) => sp.state === "completed");
  const completed = project.sprints.filter((sp) => sp.state === "completed");

  return (
    <>
      <div className="view-header">
        <div>
          <h1>Reports</h1>
          <div className="sub">Burndown for the current sprint and velocity across completed sprints.</div>
        </div>
      </div>
      <div className="chart-grid">
        <div className="panel panel-pad chart-panel">
          <h3>Sprint burndown</h3>
          <div className="sub">
            {sprint
              ? `${sprint.name} · ${formatDate(sprint.startDate)} – ${formatDate(sprint.endDate)}`
              : "No sprint data yet"}
          </div>
          {sprint ? (
            <Burndown sprint={sprint} stories={sprintStories(project, sprint.id)} />
          ) : (
            <p style={{ color: "var(--text-dim)" }}>Start a sprint to see its burndown.</p>
          )}
        </div>
        <div className="panel panel-pad chart-panel">
          <h3>Velocity</h3>
          <div className="sub">Committed vs completed story points per sprint</div>
          {completed.length ? (
            <Velocity sprints={completed} />
          ) : (
            <p style={{ color: "var(--text-dim)" }}>Complete a sprint to start tracking velocity.</p>
          )}
        </div>
      </div>

      <div className="panel panel-pad">
        <h3>Time tracking</h3>
        <div className="sub">Hours logged per task and per team member, from each task's start/stop timer.</div>
        <TimeTrackingPanel project={project} />
      </div>
    </>
  );
}

function TimeTrackingPanel({ project }: { project: Project }) {
  const tracked = project.stories.filter((s) => s.timeEntries.length > 0);

  if (tracked.length === 0) {
    return <p style={{ color: "var(--text-dim)" }}>No time has been tracked yet — start a task's timer to see it here.</p>;
  }

  const rows = tracked
    .map((s) => ({
      story: s,
      hours: totalTrackedHours(s),
      assignee: project.members.find((m) => m.id === s.assigneeId),
    }))
    .sort((a, b) => b.hours - a.hours);

  const byMember = new Map<string, number>();
  for (const s of tracked) {
    for (const e of s.timeEntries) {
      if (!e.memberId) continue;
      const ms = (e.endedAt ? new Date(e.endedAt).getTime() : Date.now()) - new Date(e.startedAt).getTime();
      byMember.set(e.memberId, (byMember.get(e.memberId) ?? 0) + ms);
    }
  }
  const memberRows = [...byMember.entries()]
    .map(([id, ms]) => ({ member: project.members.find((m) => m.id === id), hours: ms / 3_600_000 }))
    .sort((a, b) => b.hours - a.hours);

  return (
    <div className="time-report-grid">
      <div>
        <h4 className="time-report-subhead">By task</h4>
        <div className="time-report-table">
          <div className="time-report-row time-report-head">
            <span>Task</span><span>Assignee</span><span>Hours</span>
          </div>
          {rows.map(({ story, hours, assignee }) => (
            <div className="time-report-row" key={story.id}>
              <span className="time-report-task" title={story.title}>{story.key} — {story.title}</span>
              <span>{assignee?.name ?? "Unassigned"}</span>
              <span>{hours.toFixed(1)}h</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h4 className="time-report-subhead">By team member</h4>
        <div className="time-report-table">
          <div className="time-report-row time-report-head">
            <span>Member</span><span /><span>Hours</span>
          </div>
          {memberRows.map(({ member, hours }) => (
            <div className="time-report-row" key={member?.id ?? "unknown"}>
              <span className="time-report-task">{member?.name ?? "Unknown"}</span>
              <span />
              <span>{hours.toFixed(1)}h</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Burndown({ sprint, stories }: { sprint: Sprint; stories: Story[] }) {
  const start = new Date(sprint.startDate + "T00:00:00").getTime();
  const end = new Date(sprint.endDate + "T23:59:59").getTime();
  const days = Math.max(1, Math.round((end - start) / DAY));
  const total =
    sprint.committedPoints ?? stories.reduce((sum, s) => sum + (s.points ?? 0), 0);

  // Remaining points at the end of each sprint day, up to today.
  const now = Date.now();
  const actual: { day: number; remaining: number }[] = [];
  for (let d = 0; d <= days; d++) {
    const cutoff = start + d * DAY;
    if (cutoff > now + DAY) break;
    const donePts = stories
      .filter((s) => s.completedAt && new Date(s.completedAt).getTime() <= cutoff)
      .reduce((sum, s) => sum + (s.points ?? 0), 0);
    actual.push({ day: d, remaining: Math.max(0, total - donePts) });
  }

  const W = 460;
  const H = 260;
  const PAD = { top: 14, right: 16, bottom: 30, left: 34 };
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const maxY = Math.max(total, 1);
  const x = (day: number) => PAD.left + (day / days) * iw;
  const y = (pts: number) => PAD.top + (1 - pts / maxY) * ih;

  const actualPath = actual
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)},${y(p.remaining).toFixed(1)}`)
    .join(" ");

  const yTicks = 4;

  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`}>
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const v = (maxY / yTicks) * i;
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)} stroke="#2c2c36" />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#8a8a96">
              {Math.round(v)}
            </text>
          </g>
        );
      })}
      <text x={PAD.left} y={H - 8} fontSize="10" fill="#8a8a96">
        {formatDate(sprint.startDate)}
      </text>
      <text x={W - PAD.right} y={H - 8} textAnchor="end" fontSize="10" fill="#8a8a96">
        {formatDate(sprint.endDate)}
      </text>
      {/* Ideal line */}
      <line
        x1={x(0)} y1={y(total)} x2={x(days)} y2={y(0)}
        stroke="#4a4a56" strokeWidth="1.5" strokeDasharray="5 4"
      />
      {/* Actual line */}
      <path d={actualPath} fill="none" stroke="#7b68ee" strokeWidth="2.5" strokeLinejoin="round" />
      {actual.map((p) => (
        <circle key={p.day} cx={x(p.day)} cy={y(p.remaining)} r="3" fill="#7b68ee" />
      ))}
      <g fontSize="11">
        <line x1={W - 170} y1={16} x2={W - 150} y2={16} stroke="#4a4a56" strokeWidth="1.5" strokeDasharray="5 4" />
        <text x={W - 145} y={20} fill="#9d9da9">Ideal</text>
        <line x1={W - 100} y1={16} x2={W - 80} y2={16} stroke="#7b68ee" strokeWidth="2.5" />
        <text x={W - 75} y={20} fill="#9d9da9">Actual</text>
      </g>
    </svg>
  );
}

function Velocity({ sprints }: { sprints: Sprint[] }) {
  const W = 460;
  const H = 260;
  const PAD = { top: 14, right: 16, bottom: 34, left: 34 };
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const maxY = Math.max(...sprints.map((sp) => Math.max(sp.velocity ?? 0, sp.committedPoints ?? 0)), 1);
  const slot = iw / sprints.length;
  const barW = Math.min(34, slot / 3);
  const y = (v: number) => PAD.top + (1 - v / maxY) * ih;
  const yTicks = 4;

  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`}>
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const v = (maxY / yTicks) * i;
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)} stroke="#2c2c36" />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#8a8a96">
              {Math.round(v)}
            </text>
          </g>
        );
      })}
      {sprints.map((sp, i) => {
        const cx = PAD.left + slot * i + slot / 2;
        const committed = sp.committedPoints ?? 0;
        const done = sp.velocity ?? 0;
        return (
          <g key={sp.id}>
            <rect
              x={cx - barW - 2} y={y(committed)} width={barW} height={ih + PAD.top - y(committed)}
              fill="#4a4a56" rx="3"
            />
            <rect
              x={cx + 2} y={y(done)} width={barW} height={ih + PAD.top - y(done)}
              fill="#7b68ee" rx="3"
            />
            <text x={cx} y={H - 16} textAnchor="middle" fontSize="10.5" fill="#9d9da9">
              {sp.name}
            </text>
            <text x={cx} y={H - 4} textAnchor="middle" fontSize="10" fill="#8a8a96">
              {done}/{committed} pts
            </text>
          </g>
        );
      })}
      <g fontSize="11">
        <rect x={W - 190} y={9} width={10} height={10} fill="#4a4a56" rx="2" />
        <text x={W - 175} y={18} fill="#9d9da9">Committed</text>
        <rect x={W - 95} y={9} width={10} height={10} fill="#7b68ee" rx="2" />
        <text x={W - 80} y={18} fill="#9d9da9">Completed</text>
      </g>
    </svg>
  );
}
