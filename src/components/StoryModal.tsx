import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { useStore, uid } from "../store";
import { Modal } from "./common";
import { filesToAttachments, formatBytes } from "../files";
import { activeTimeEntry, formatDuration, totalTrackedMs } from "../time";
import type { Attachment, ID, Priority, Story, StoryStatus, StoryType } from "../types";
import { POINT_SCALE, PRIORITY_LABELS, STATUS_LABELS, TYPE_LABELS } from "../types";

interface Props {
  /** Existing story to edit, or null to create a new one. */
  story: Story | null;
  /** Sprint the new story should land in (create mode only). */
  defaultSprintId?: ID | null;
  onClose: () => void;
}

export default function StoryModal({ story, defaultSprintId = null, onClose }: Props) {
  const { project, dispatch } = useStore();

  const [title, setTitle] = useState(story?.title ?? "");
  const [description, setDescription] = useState(story?.description ?? "");
  const [type, setType] = useState<StoryType>(story?.type ?? "story");
  const [status, setStatus] = useState<StoryStatus>(
    story?.status ?? (defaultSprintId ? "todo" : "backlog")
  );
  const [priority, setPriority] = useState<Priority>(story?.priority ?? "medium");
  const [points, setPoints] = useState<number | null>(story?.points ?? null);
  const [epicId, setEpicId] = useState<ID | "">(story?.epicId ?? "");
  const [assigneeId, setAssigneeId] = useState<ID | "">(story?.assigneeId ?? "");
  const [sprintId, setSprintId] = useState<ID | "">(story?.sprintId ?? defaultSprintId ?? "");
  const [criteria, setCriteria] = useState<string[]>(
    story?.acceptanceCriteria.length ? story.acceptanceCriteria : []
  );
  const [startDate, setStartDate] = useState(story?.startDate ?? "");
  const [dueDate, setDueDate] = useState(story?.dueDate ?? "");
  const [dependsOn, setDependsOn] = useState<ID[]>(story?.dependsOn ?? []);
  const [pendingDependency, setPendingDependency] = useState<ID | "">("");
  const [attachments, setAttachments] = useState<Attachment[]>(story?.attachments ?? []);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next = await filesToAttachments(files, uid);
    if (next.length) setAttachments((prev) => [...prev, ...next]);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  const openSprints = project.sprints.filter((sp) => sp.state !== "completed");
  const dependencyOptions = project.stories.filter(
    (s) => s.id !== story?.id && !dependsOn.includes(s.id)
  );

  function save() {
    if (!title.trim()) return;
    const inSprint = sprintId !== "";
    const finalStatus: StoryStatus = !inSprint ? "backlog" : status === "backlog" ? "todo" : status;
    const fields = {
      title: title.trim(),
      description: description.trim(),
      type,
      status: finalStatus,
      priority,
      points,
      epicId: epicId === "" ? null : epicId,
      assigneeId: assigneeId === "" ? null : assigneeId,
      sprintId: inSprint ? sprintId : null,
      acceptanceCriteria: criteria.map((c) => c.trim()).filter(Boolean),
      startDate: startDate === "" ? null : startDate,
      dueDate: dueDate === "" ? null : dueDate,
      dependsOn,
      attachments,
    };
    if (story) {
      dispatch({
        type: "story/update",
        id: story.id,
        patch: {
          ...fields,
          completedAt:
            finalStatus === "done" ? story.completedAt ?? new Date().toISOString() : null,
        },
      });
    } else {
      dispatch({ type: "story/add", story: { ...fields, timeEntries: [] } });
    }
    onClose();
  }

  return (
    <Modal title={story ? `Edit ${story.key}` : "Create work item"} onClose={onClose}>
      <div className="form-field">
        <label>Title</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="As a <user>, I can <do something> so that <benefit>"
        />
      </div>
      <div className="form-field">
        <label>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Context, constraints, links…"
        />
      </div>
      <div className="form-grid">
        <div className="form-field">
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as StoryType)}>
            {Object.entries(TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>Story points</label>
          <select
            value={points ?? ""}
            onChange={(e) => setPoints(e.target.value === "" ? null : Number(e.target.value))}
          >
            <option value="">Unestimated</option>
            {POINT_SCALE.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>Epic</label>
          <select value={epicId} onChange={(e) => setEpicId(e.target.value)}>
            <option value="">No epic</option>
            {project.epics.map((ep) => (
              <option key={ep.id} value={ep.id}>{ep.name}</option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>Assignee</label>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Unassigned</option>
            {project.members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>Sprint</label>
          <select value={sprintId} onChange={(e) => setSprintId(e.target.value)}>
            <option value="">Backlog</option>
            {openSprints.map((sp) => (
              <option key={sp.id} value={sp.id}>{sp.name}</option>
            ))}
          </select>
        </div>
        {sprintId !== "" && (
          <div className="form-field">
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as StoryStatus)}>
              {(["todo", "inprogress", "review", "done"] as StoryStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
        )}
        <div className="form-field">
          <label>Start date</label>
          <input
            type="date"
            value={startDate}
            max={dueDate || undefined}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>Due date</label>
          <input
            type="date"
            value={dueDate}
            min={startDate || undefined}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
      </div>
      <div className="form-field">
        <label>Depends on</label>
        <div className="ac-list">
          {dependsOn.map((depId) => {
            const dep = project.stories.find((s) => s.id === depId);
            return (
              <div className="ac-item" key={depId}>
                <span className="dep-chip">
                  {dep ? `${dep.key} — ${dep.title}` : "Unknown task"}
                </span>
                <button
                  className="remove"
                  title="Remove dependency"
                  onClick={() => setDependsOn(dependsOn.filter((id) => id !== depId))}
                >
                  ✕
                </button>
              </div>
            );
          })}
          {dependencyOptions.length > 0 && (
            <div className="ac-item">
              <select
                value={pendingDependency}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) setDependsOn([...dependsOn, id]);
                  setPendingDependency("");
                }}
              >
                <option value="">+ Add dependency…</option>
                {dependencyOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.key} — {s.title}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
      <div className="form-field">
        <label>Acceptance criteria</label>
        <div className="ac-list">
          {criteria.map((c, i) => (
            <div className="ac-item" key={i}>
              <input
                type="text"
                value={c}
                placeholder="Given / when / then…"
                onChange={(e) =>
                  setCriteria(criteria.map((x, j) => (j === i ? e.target.value : x)))
                }
              />
              <button
                className="remove"
                title="Remove"
                onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <div>
            <button className="btn btn-sm" onClick={() => setCriteria([...criteria, ""])}>
              + Add criterion
            </button>
          </div>
        </div>
      </div>
      <div className="form-field">
        <label>Attachments</label>
        <div
          className={`attach-drop${dragOver ? " over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <span className="attach-drop-icon">📎</span>
          <span>Drop files or photos here, or click to browse</span>
        </div>
        {(() => {
          const libraryOptions = project.files.filter((f) => !attachments.some((a) => a.id === f.id));
          if (libraryOptions.length === 0) return null;
          return (
            <select
              className="attach-existing-picker"
              value=""
              onChange={(e) => {
                const found = project.files.find((f) => f.id === e.target.value);
                if (found) setAttachments((prev) => [...prev, found]);
              }}
            >
              <option value="">+ Attach from project files…</option>
              {libraryOptions.map((f) => (
                <option key={f.id} value={f.id}>{f.name} ({formatBytes(f.size)})</option>
              ))}
            </select>
          );
        })()}
        {attachments.length > 0 && (
          <div className="attach-grid">
            {attachments.map((a) => (
              <div className="attach-item" key={a.id}>
                {a.mimeType.startsWith("image/") ? (
                  <a href={a.dataUrl} target="_blank" rel="noreferrer" className="attach-thumb">
                    <img src={a.dataUrl} alt={a.name} />
                  </a>
                ) : (
                  <a href={a.dataUrl} download={a.name} className="attach-thumb attach-file">
                    <span className="attach-file-icon">📄</span>
                  </a>
                )}
                <div className="attach-meta">
                  <span className="attach-name" title={a.name}>{a.name}</span>
                  <span className="attach-size">{formatBytes(a.size)}</span>
                </div>
                <button
                  className="remove attach-remove"
                  title="Remove attachment"
                  onClick={() => setAttachments(attachments.filter((x) => x.id !== a.id))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {story && (
        <div className="form-field">
          <label>Time tracking</label>
          <TimeTrackingSection storyId={story.id} />
        </div>
      )}
      <div className="modal-actions">
        {story && (
          <button
            className="btn btn-danger left"
            onClick={() => {
              if (confirm(`Delete ${story.key}? This cannot be undone.`)) {
                dispatch({ type: "story/delete", id: story.id });
                onClose();
              }
            }}
          >
            Delete
          </button>
        )}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!title.trim()}>
          {story ? "Save changes" : "Create"}
        </button>
      </div>
    </Modal>
  );
}

function TimeTrackingSection({ storyId }: { storyId: ID }) {
  const { project, state, dispatch } = useStore();
  const [, setTick] = useState(0);
  const story = project.stories.find((s) => s.id === storyId);
  const running = story ? activeTimeEntry(story) : undefined;

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [running?.id]);

  if (!story) return null;

  if (!story.assigneeId) {
    return <p className="hint-text">Assign this task to someone before tracking time against it.</p>;
  }

  const assignee = project.members.find((m) => m.id === story.assigneeId);
  const isMe = !!state.currentMemberId && state.currentMemberId === story.assigneeId;

  return (
    <div className="time-track-panel">
      <div className="time-track-head">
        <button
          className="btn btn-sm btn-primary"
          disabled={!isMe}
          title={isMe ? undefined : `Only ${assignee?.name ?? "the assignee"} can start or stop this timer`}
          onClick={() => {
            if (running) dispatch({ type: "story/timerStop", id: story.id });
            else dispatch({ type: "story/timerStart", id: story.id });
          }}
        >
          {running ? "⏹ Stop timer" : "▶ Start timer"}
        </button>
        <span className="time-track-total">
          Total logged: <strong>{formatDuration(totalTrackedMs(story))}</strong>
        </span>
      </div>
      {story.timeEntries.length > 0 && (
        <div className="time-entry-list">
          {[...story.timeEntries].reverse().map((e) => {
            const m = project.members.find((mm) => mm.id === e.memberId);
            const startMs = new Date(e.startedAt).getTime();
            const endMs = e.endedAt ? new Date(e.endedAt).getTime() : Date.now();
            return (
              <div className="time-entry-row" key={e.id}>
                <span className="time-entry-member">{m?.name ?? "Unknown"}</span>
                <span className="time-entry-when">
                  {new Date(e.startedAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className={`time-entry-dur${!e.endedAt ? " running" : ""}`}>
                  {e.endedAt ? formatDuration(endMs - startMs) : "running…"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
