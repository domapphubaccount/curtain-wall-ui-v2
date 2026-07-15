import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useStore } from "../store";
import type { Epic, Member, Priority, Story, StoryType } from "../types";
import { activeTimeEntry, formatDuration, totalTrackedMs } from "../time";

export function Avatar({ member, title }: { member: Member | null | undefined; title?: string }) {
  if (!member) {
    return (
      <span className="avatar unassigned" title={title ?? "Unassigned"}>
        ?
      </span>
    );
  }
  const initials = member.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  return (
    <span className="avatar" style={{ background: member.color }} title={member.name}>
      {initials}
    </span>
  );
}

const TYPE_GLYPH: Record<StoryType, string> = {
  story: "S",
  bug: "B",
  task: "T",
  spike: "?",
};

export function TypeIcon({ type }: { type: StoryType }) {
  return (
    <span className={`type-icon type-${type}`} title={type}>
      {TYPE_GLYPH[type]}
    </span>
  );
}

export function PriorityIcon({ priority }: { priority: Priority }) {
  return (
    <span className={`prio prio-${priority}`} title={`${priority} priority`}>
      ⚑
    </span>
  );
}

export function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot sd-${status}`} />;
}

export function EpicChip({ epic }: { epic: Epic | null | undefined }) {
  if (!epic) return null;
  return (
    <span className="chip epic" style={{ background: epic.color }}>
      {epic.name}
    </span>
  );
}

export function PointsBadge({ points }: { points: number | null }) {
  return <span className="points-badge" title="Story points">{points ?? "–"}</span>;
}

export function AttachmentBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="attachment-badge" title={`${count} attachment${count === 1 ? "" : "s"}`}>
      📎 {count}
    </span>
  );
}

/** Start/stop control for a task's timer — only the assigned member (as picked in "Acting as") can operate it. */
export function TimerControl({ story }: { story: Story }) {
  const { state, dispatch } = useStore();
  const [, setTick] = useState(0);
  const running = activeTimeEntry(story);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running?.id]);

  if (!story.assigneeId) return null;

  const isMe = !!state.currentMemberId && state.currentMemberId === story.assigneeId;
  const totalMs = totalTrackedMs(story);

  return (
    <span className="timer-control">
      <button
        className={`timer-btn${running ? " running" : ""}`}
        disabled={!isMe}
        title={isMe ? (running ? "Stop timer" : "Start timer") : "Only the assignee can start or stop this timer"}
        onClick={(e) => {
          e.stopPropagation();
          if (running) dispatch({ type: "story/timerStop", id: story.id });
          else if (isMe) dispatch({ type: "story/timerStart", id: story.id });
        }}
      >
        {running ? "⏹" : "▶"}
      </button>
      {(running || totalMs > 0) && (
        <span className={`timer-elapsed${running ? " running" : ""}`}>{formatDuration(totalMs)}</span>
      )}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  narrow,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  narrow?: boolean;
}) {
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal${narrow ? " narrow" : ""}`}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function formatDate(ymd: string): string {
  const d = new Date(ymd + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function daysLeft(endDate: string): number {
  const end = new Date(endDate + "T23:59:59").getTime();
  return Math.max(0, Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000)));
}
