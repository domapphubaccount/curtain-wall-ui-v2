import { useState } from "react";
import type { DragEvent } from "react";
import { activeSprint, sprintStories, storyPoints, useStore } from "../store";
import type { ID, Story, StoryStatus } from "../types";
import { useAuth } from "../auth";
import { BOARD_COLUMNS, STATUS_LABELS } from "../types";
import {
  AttachmentBadge,
  Avatar,
  EpicChip,
  PointsBadge,
  PriorityIcon,
  TimerControl,
  TypeIcon,
  daysLeft,
  formatDate,
} from "./common";
import StoryModal from "./StoryModal";

export default function Board() {
  const { project, dispatch } = useStore();
  const { user } = useAuth();
  const [editing, setEditing] = useState<Story | null>(null);
  const [dragOverCol, setDragOverCol] = useState<StoryStatus | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<ID | "">("");

  const sprint = activeSprint(project);

  if (!sprint) {
    return (
      <>
        <div className="view-header">
          <div>
            <h1>Sprint Board</h1>
            <div className="sub">Track the active sprint's work through the workflow.</div>
          </div>
        </div>
        <div className="panel empty-state">
          <div className="big">▦</div>
          <h3>No active sprint</h3>
          <p>Go to the Backlog, plan a sprint, and start it to activate the board.</p>
        </div>
      </>
    );
  }

  const stories = sprintStories(project, sprint.id).filter(
    (s) => !assigneeFilter || s.assigneeId === assigneeFilter
  );
  const donePts = storyPoints(stories.filter((s) => s.status === "done"));
  const totalPts = storyPoints(stories);

  function handleDrop(e: DragEvent, status: StoryStatus) {
    e.preventDefault();
    setDragOverCol(null);
    const id = e.dataTransfer.getData("text/story-id");
    const story = project.stories.find((item) => item.id === id);
    const assignee = story?.assigneeId ? project.members.find((member) => member.id === story.assigneeId) : undefined;
    if (story && (user?.role === "ADMIN" || assignee?.userId === user?.id)) dispatch({ type: "story/move", id, status });
  }

  return (
    <>
      <div className="view-header">
        <div>
          <h1>{sprint.name}</h1>
          <div className="sub">
            {sprint.goal && <>🎯 {sprint.goal} · </>}
            {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)} ·{" "}
            <strong>{daysLeft(sprint.endDate)} days left</strong> · {donePts}/{totalPts} pts done
          </div>
        </div>
        <div className="actions">
          <select
            className="toolbar-select"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
          >
            <option value="">Everyone</option>
            {project.members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="board">
        {BOARD_COLUMNS.map((col) => {
          const colStories = stories.filter((s) => s.status === col);
          return (
            <div
              key={col}
              className={`board-col${dragOverCol === col ? " over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverCol(col);
              }}
              onDragLeave={() => setDragOverCol((c) => (c === col ? null : c))}
              onDrop={(e) => handleDrop(e, col)}
            >
              <div className="col-head">
                <span>{STATUS_LABELS[col]}</span>
                <span className="count">{colStories.length}</span>
              </div>
              {colStories.map((story) => {
                const epic = project.epics.find((ep) => ep.id === story.epicId);
                const assignee = project.members.find((m) => m.id === story.assigneeId);
                return (
                  <div
                    key={story.id}
                    className="card"
                    draggable={user?.role === "ADMIN" || assignee?.userId === user?.id}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/story-id", story.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    {epic && (
                      <div className="epic-line">
                        <EpicChip epic={epic} />
                      </div>
                    )}
                    <p className="card-title" onClick={() => setEditing(story)}>
                      {story.title}
                    </p>
                    <div className="card-foot">
                      <TypeIcon type={story.type} />
                      <span className="key">{story.key}</span>
                      <PriorityIcon priority={story.priority} />
                      <PointsBadge points={story.points} />
                      <AttachmentBadge count={story.attachments.length} />
                      <Avatar member={assignee} />
                      <TimerControl story={story} />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {editing && <StoryModal story={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
