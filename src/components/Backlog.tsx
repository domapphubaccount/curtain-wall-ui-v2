import { useState } from "react";
import type { DragEvent } from "react";
import { backlogStories, sprintStories, storyPoints, useStore } from "../store";
import { MEMBER_COLORS } from "../data";
import type { ID, Sprint, Story } from "../types";
import { STATUS_LABELS } from "../types";
import {
  AttachmentBadge,
  Avatar,
  EpicChip,
  Modal,
  PointsBadge,
  PriorityIcon,
  StatusDot,
  TimerControl,
  TypeIcon,
  formatDate,
} from "./common";
import StoryModal from "./StoryModal";
import { useAuth } from "../auth";

function ListColumns() {
  return (
    <div className="list-cols">
      <span />
      <span>Name</span>
      <span>Epic</span>
      <span>Assignee</span>
      <span>Priority</span>
      <span>Points</span>
      <span>Status</span>
      <span>Timer</span>
    </div>
  );
}

export default function Backlog() {
  const { project, dispatch } = useStore();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [editing, setEditing] = useState<Story | null>(null);
  const [creatingIn, setCreatingIn] = useState<ID | null | "closed">("closed");
  const [showSprintModal, setShowSprintModal] = useState(false);
  const [showEpicModal, setShowEpicModal] = useState(false);
  const [completing, setCompleting] = useState<Sprint | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null); // sprint id or "backlog"
  const [epicFilter, setEpicFilter] = useState<ID | "">("");

  const openSprints = project.sprints.filter((sp) => sp.state !== "completed");
  const backlog = backlogStories(project).filter((s) => !epicFilter || s.epicId === epicFilter);
  const hasActive = project.sprints.some((sp) => sp.state === "active");

  function handleDrop(e: DragEvent, target: ID | null) {
    e.preventDefault();
    setDragOver(null);
    const storyId = e.dataTransfer.getData("text/story-id");
    const story = project.stories.find((item) => item.id === storyId);
    const assignee = story?.assigneeId ? project.members.find((member) => member.id === story.assigneeId) : undefined;
    if (story && (isAdmin || assignee?.userId === user?.id)) dispatch({ type: "story/assignSprint", id: storyId, sprintId: target });
  }

  function dropProps(zone: string, target: ID | null) {
    return {
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        setDragOver(zone);
      },
      onDragLeave: () => setDragOver((z) => (z === zone ? null : z)),
      onDrop: (e: DragEvent) => handleDrop(e, target),
    };
  }

  function renderRow(story: Story) {
    const epic = project.epics.find((ep) => ep.id === story.epicId);
    const assignee = project.members.find((m) => m.id === story.assigneeId);
    return (
      <div
        key={story.id}
        className="story-row"
        draggable={isAdmin || assignee?.userId === user?.id}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/story-id", story.id);
          e.dataTransfer.effectAllowed = "move";
        }}
      >
        <StatusDot status={story.status} />
        <span className="cell-name" onClick={() => setEditing(story)}>
          <TypeIcon type={story.type} />
          <span className="key">{story.key}</span>
          <span className="title">{story.title}</span>
          <AttachmentBadge count={story.attachments.length} />
        </span>
        <span className="cell"><EpicChip epic={epic} /></span>
        <span className="cell"><Avatar member={assignee} /></span>
        <span className="cell"><PriorityIcon priority={story.priority} /></span>
        <span className="cell"><PointsBadge points={story.points} /></span>
        <span className="cell">
          <span className={`status-pill status-${story.status}`}>
            {story.status === "backlog" ? "Open" : STATUS_LABELS[story.status]}
          </span>
        </span>
        <span className="cell"><TimerControl story={story} /></span>
      </div>
    );
  }

  function renderSection(sprint: Sprint) {
    const stories = sprintStories(project, sprint.id).filter(
      (s) => !epicFilter || s.epicId === epicFilter
    );
    const done = stories.filter((s) => s.status === "done");
    return (
      <div className="panel sprint-section" key={sprint.id}>
        <div className="section-head">
          <span className={`group-pill gp-${sprint.state === "active" ? "active" : "planned"}`}>
            {sprint.name}
          </span>
          <span className={`sprint-state ${sprint.state}`}>{sprint.state}</span>
          <span className="count">{stories.length}</span>
          <span className="goal">{sprint.goal}</span>
          <span className="dates">
            {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
          </span>
          <span className="count">{storyPoints(done)}/{storyPoints(stories)} pts</span>
          {isAdmin && sprint.state === "planned" && (
            <>
              <button
                className="btn btn-sm btn-primary"
                disabled={hasActive || stories.length === 0}
                title={hasActive ? "Complete the active sprint first" : undefined}
                onClick={() => dispatch({ type: "sprint/start", id: sprint.id })}
              >
                Start sprint
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  if (confirm(`Delete ${sprint.name}? Its items return to the backlog.`)) {
                    dispatch({ type: "sprint/delete", id: sprint.id });
                  }
                }}
              >
                Delete
              </button>
            </>
          )}
          {isAdmin && sprint.state === "active" && (
            <button className="btn btn-sm" onClick={() => setCompleting(sprint)}>
              Complete sprint
            </button>
          )}
        </div>
        <ListColumns />
        {stories.map(renderRow)}
        <div
          className={`drop-zone${dragOver === sprint.id ? " over" : ""}`}
          {...dropProps(sprint.id, sprint.id)}
        >
          {stories.length === 0 && (
            <div className="drop-hint">Drag items here to plan this sprint</div>
          )}
        </div>
        {isAdmin && <QuickCreate
          open={creatingIn === sprint.id}
          onOpen={() => setCreatingIn(sprint.id)}
          onClose={() => setCreatingIn("closed")}
          sprintId={sprint.id}
        />}
      </div>
    );
  }

  return (
    <>
      <div className="view-header">
        <div>
          <h1>Backlog</h1>
          <div className="sub">Plan sprints by dragging items between sections. Click a title to edit.</div>
        </div>
        {isAdmin && <div className="actions">
          <button className="btn" onClick={() => setShowEpicModal(true)}>+ New epic</button>
          <button className="btn" onClick={() => setShowSprintModal(true)}>+ New sprint</button>
        </div>}
      </div>

      <div className="filters">
        <span className="toolbar-pill">Group: Sprint</span>
        <select value={epicFilter} onChange={(e) => setEpicFilter(e.target.value)}>
          <option value="">All epics</option>
          {project.epics.map((ep) => (
            <option key={ep.id} value={ep.id}>{ep.name}</option>
          ))}
        </select>
      </div>

      {openSprints.map(renderSection)}

      <div className="panel sprint-section">
        <div className="section-head">
          <span className="group-pill gp-backlog">Product Backlog</span>
          <span className="count">{backlog.length}</span>
          <span className="goal">Prioritized by severity — refine and estimate before planning</span>
          <span className="count">{storyPoints(backlog)} pts</span>
        </div>
        <ListColumns />
        {backlog.map(renderRow)}
        <div
          className={`drop-zone${dragOver === "backlog" ? " over" : ""}`}
          {...dropProps("backlog", null)}
        >
          {backlog.length === 0 && <div className="drop-hint">Backlog is empty</div>}
        </div>
        {isAdmin && <QuickCreate
          open={creatingIn === null}
          onOpen={() => setCreatingIn(null)}
          onClose={() => setCreatingIn("closed")}
          sprintId={null}
        />}
      </div>

      {editing && <StoryModal story={editing} onClose={() => setEditing(null)} />}
      {showSprintModal && <SprintModal onClose={() => setShowSprintModal(false)} />}
      {showEpicModal && <EpicModal onClose={() => setShowEpicModal(false)} />}
      {completing && <CompleteSprintModal sprint={completing} onClose={() => setCompleting(null)} />}
    </>
  );
}

function QuickCreate({
  open,
  onOpen,
  onClose,
  sprintId,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  sprintId: ID | null;
}) {
  const { dispatch } = useStore();
  const [title, setTitle] = useState("");

  if (!open) {
    return (
      <div className="inline-create">
        <button className="add-task-btn" onClick={onOpen}>+ Add Task</button>
      </div>
    );
  }

  function submit() {
    if (!title.trim()) return;
    dispatch({
      type: "story/add",
      story: {
        title: title.trim(),
        description: "",
        type: "story",
        status: sprintId ? "todo" : "backlog",
        priority: "medium",
        points: null,
        epicId: null,
        assigneeId: null,
        sprintId,
        acceptanceCriteria: [],
        startDate: null,
        dueDate: null,
        dependsOn: [],
        attachments: [],
        timeEntries: [],
      },
    });
    setTitle("");
  }

  return (
    <div className="inline-create">
      <input
        autoFocus
        value={title}
        placeholder="Task name… (Enter to add, Esc to close)"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onClose();
        }}
      />
      <button className="btn btn-sm btn-primary" onClick={submit} disabled={!title.trim()}>
        Add
      </button>
      <button className="btn btn-sm" onClick={onClose}>Done</button>
    </div>
  );
}

function SprintModal({ onClose }: { onClose: () => void }) {
  const { project, dispatch } = useStore();
  const nextNum = project.sprints.length + 1;
  const [name, setName] = useState(`Sprint ${nextNum}`);
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(
    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );

  return (
    <Modal title="New sprint" onClose={onClose} narrow>
      <div className="form-field">
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className="form-field">
        <label>Sprint goal</label>
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="What outcome makes this sprint a success?"
        />
      </div>
      <div className="form-grid">
        <div className="form-field">
          <label>Start date</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="form-field">
          <label>End date</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-primary"
          disabled={!name.trim() || endDate <= startDate}
          onClick={() => {
            dispatch({ type: "sprint/add", name: name.trim(), goal: goal.trim(), startDate, endDate });
            onClose();
          }}
        >
          Create sprint
        </button>
      </div>
    </Modal>
  );
}

function EpicModal({ onClose }: { onClose: () => void }) {
  const { project, dispatch } = useStore();
  const [name, setName] = useState("");
  const [color, setColor] = useState(MEMBER_COLORS[project.epics.length % MEMBER_COLORS.length]);

  return (
    <Modal title="New epic" onClose={onClose} narrow>
      <div className="form-field">
        <label>Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Cart & Checkout"
        />
      </div>
      <div className="form-field">
        <label>Color</label>
        <div className="wb-popover-row" style={{ justifyContent: "flex-start" }}>
          {MEMBER_COLORS.map((c) => (
            <button
              key={c}
              className={`wb-color-swatch${color === c ? " active" : ""}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-primary"
          disabled={!name.trim()}
          onClick={() => {
            dispatch({ type: "epic/add", name: name.trim(), color });
            onClose();
          }}
        >
          Create epic
        </button>
      </div>
    </Modal>
  );
}

function CompleteSprintModal({ sprint, onClose }: { sprint: Sprint; onClose: () => void }) {
  const { project, dispatch } = useStore();
  const stories = sprintStories(project, sprint.id);
  const done = stories.filter((s) => s.status === "done");
  const open = stories.filter((s) => s.status !== "done");
  const planned = project.sprints.filter((sp) => sp.state === "planned");
  const [target, setTarget] = useState<ID | "">("");

  return (
    <Modal title={`Complete ${sprint.name}`} onClose={onClose} narrow>
      <p>
        <strong>{done.length}</strong> items done ({storyPoints(done)} pts) ·{" "}
        <strong>{open.length}</strong> items incomplete ({storyPoints(open)} pts)
      </p>
      {open.length > 0 && (
        <div className="form-field">
          <label>Move incomplete items to</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Product backlog</option>
            {planned.map((sp) => (
              <option key={sp.id} value={sp.id}>{sp.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-primary"
          onClick={() => {
            dispatch({
              type: "sprint/complete",
              id: sprint.id,
              moveIncompleteTo: target === "" ? null : target,
            });
            onClose();
          }}
        >
          Complete sprint
        </button>
      </div>
    </Modal>
  );
}
