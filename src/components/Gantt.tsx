import { useEffect, useMemo, useReducer as useForceReducer, useRef, useState } from "react";
import { backlogStories, sprintStories, useStore } from "../store";
import type { ID, Sprint, Story } from "../types";
import { Avatar, TypeIcon } from "./common";
import StoryModal from "./StoryModal";
import { addDays, daysBetween, effectiveDates, parseYMD, todayYMD } from "../dates";

const ROW_H = 36;
const GROUP_H = 28;
const HEADER_H = 44;
const LEFT_W = 260;
const MIN_DAY_W = 14;
const MAX_DAY_W = 60;

const STATUS_PROGRESS: Record<string, number> = { backlog: 0, todo: 0, inprogress: 45, review: 80, done: 100 };

function roundedStep(pts: { x: number; y: number }[], r: number): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x},${pts[0].y} `;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], curr = pts[i], next = pts[i + 1];
    const d1x = curr.x - prev.x, d1y = curr.y - prev.y;
    const len1 = Math.hypot(d1x, d1y) || 1;
    const d2x = next.x - curr.x, d2y = next.y - curr.y;
    const len2 = Math.hypot(d2x, d2y) || 1;
    const rr = Math.min(r, len1 / 2, len2 / 2);
    const p1 = { x: curr.x - (d1x / len1) * rr, y: curr.y - (d1y / len1) * rr };
    const p2 = { x: curr.x + (d2x / len2) * rr, y: curr.y + (d2y / len2) * rr };
    d += `L ${p1.x},${p1.y} Q ${curr.x},${curr.y} ${p2.x},${p2.y} `;
  }
  const last = pts[pts.length - 1];
  d += `L ${last.x},${last.y}`;
  return d;
}

interface Row {
  story: Story;
  y: number;
  sprint: Sprint | undefined;
}
interface GroupHeader {
  label: string;
  y: number;
  state?: Sprint["state"];
}

interface DragInfo {
  kind: "move" | "left" | "right" | "connect";
  storyId: ID;
  startClientX: number;
  startStart: string;
  startDue: string;
  /** connect-only: which edge the drag started from. "back" = this task leads to the drop target; "front" = this task depends on the drop target. */
  side?: "front" | "back";
}

export default function Gantt() {
  const { project, dispatch } = useStore();
  const [dayWidth, setDayWidth] = useState(30);
  const dayWidthRef = useRef(dayWidth);
  useEffect(() => {
    dayWidthRef.current = dayWidth;
  }, [dayWidth]);

  const [editingStory, setEditingStory] = useState<Story | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragRef = useRef<DragInfo | null>(null);
  const previewRef = useRef<{ storyId: ID; start: string; due: string } | null>(null);
  const connectPreviewRef = useRef<{ x: number; y: number } | null>(null);
  const [, forceRender] = useForceReducer((n: number) => n + 1, 0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrolledOnceRef = useRef(false);

  function toBodyCoords(clientX: number, clientY: number) {
    const rect = bodyRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  const { groupHeaders, rows, contentHeight } = useMemo(() => {
    const sortedSprints = [...project.sprints].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const groups: { label: string; sprint: Sprint | undefined; stories: Story[] }[] = [
      ...sortedSprints.map((sp) => ({ label: sp.name, sprint: sp, stories: sprintStories(project, sp.id) })),
      { label: "Product Backlog", sprint: undefined, stories: backlogStories(project) },
    ].filter((g) => g.stories.length > 0);

    let cursorY = 0;
    const gh: GroupHeader[] = [];
    const rw: Row[] = [];
    for (const g of groups) {
      gh.push({ label: g.label, y: cursorY, state: g.sprint?.state });
      cursorY += GROUP_H;
      for (const s of g.stories) {
        rw.push({ story: s, y: cursorY, sprint: g.sprint });
        cursorY += ROW_H;
      }
    }
    return { groupHeaders: gh, rows: rw, contentHeight: cursorY };
  }, [project]);

  function getEff(row: Row): { start: string; due: string } {
    if (dragActive && dragRef.current?.storyId === row.story.id && previewRef.current) {
      return { start: previewRef.current.start, due: previewRef.current.due };
    }
    return effectiveDates(row.story, row.sprint);
  }

  const { rangeStart, totalDays } = useMemo(() => {
    const today = todayYMD();
    if (rows.length === 0) {
      return { rangeStart: addDays(today, -3), totalDays: 28 };
    }
    let minStart = today;
    let maxDue = addDays(today, 21);
    for (const row of rows) {
      const eff = effectiveDates(row.story, row.sprint);
      if (eff.start < minStart) minStart = eff.start;
      if (eff.due > maxDue) maxDue = eff.due;
    }
    minStart = addDays(minStart, -3);
    maxDue = addDays(maxDue, 7);
    const days = Math.min(365, daysBetween(minStart, maxDue) + 1);
    return { rangeStart: minStart, totalDays: days };
  }, [rows]);

  function dateToX(d: string): number {
    return daysBetween(rangeStart, d) * dayWidth;
  }

  const monthSegments = useMemo(() => {
    const segs: { label: string; days: number }[] = [];
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(rangeStart, i);
      const label = new Date(parseYMD(d)).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
      const last = segs[segs.length - 1];
      if (last && last.label === label) last.days++;
      else segs.push({ label, days: 1 });
    }
    return segs;
  }, [rangeStart, totalDays]);

  const timelineWidth = totalDays * dayWidth;
  const today = todayYMD();
  const todayX = dateToX(today) + dayWidth / 2;

  const scrollToToday = () => {
    const el = scrollRef.current;
    if (!el) return;
    const target = LEFT_W + dateToX(today) - (el.clientWidth - LEFT_W) / 2;
    el.scrollLeft = Math.max(0, target);
  };

  useEffect(() => {
    if (scrolledOnceRef.current) return;
    scrolledOnceRef.current = true;
    scrollToToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalDays]);

  useEffect(() => {
    if (!dragActive) return;
    function onMove(e: MouseEvent) {
      const info = dragRef.current;
      if (!info) return;
      if (info.kind === "connect") {
        connectPreviewRef.current = toBodyCoords(e.clientX, e.clientY);
        forceRender();
        return;
      }
      const dw = dayWidthRef.current;
      const deltaDays = Math.round((e.clientX - info.startClientX) / dw);
      let start = info.startStart, due = info.startDue;
      if (info.kind === "move") {
        start = addDays(info.startStart, deltaDays);
        due = addDays(info.startDue, deltaDays);
      } else if (info.kind === "left") {
        start = addDays(info.startStart, deltaDays);
        if (start > due) start = due;
      } else if (info.kind === "right") {
        due = addDays(info.startDue, deltaDays);
        if (due < start) due = start;
      }
      previewRef.current = { storyId: info.storyId, start, due };
      forceRender();
    }
    function onUp(e: MouseEvent) {
      const info = dragRef.current;
      if (info) {
        if (info.kind === "connect") {
          const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-gantt-bar-id]") as HTMLElement | null;
          const targetId = target?.getAttribute("data-gantt-bar-id");
          if (targetId && targetId !== info.storyId) {
            if (info.side === "front") {
              // Dragged from this task's start: this task depends on the drop target.
              const srcStory = project.stories.find((s) => s.id === info.storyId);
              if (srcStory && !srcStory.dependsOn.includes(targetId)) {
                dispatch({
                  type: "story/update",
                  id: info.storyId,
                  patch: { dependsOn: [...srcStory.dependsOn, targetId] },
                });
              }
            } else {
              // Dragged from this task's end: the drop target depends on this task.
              const targetStory = project.stories.find((s) => s.id === targetId);
              if (targetStory && !targetStory.dependsOn.includes(info.storyId)) {
                dispatch({
                  type: "story/update",
                  id: targetId,
                  patch: { dependsOn: [...targetStory.dependsOn, info.storyId] },
                });
              }
            }
          }
        } else {
          const dx = e.clientX - info.startClientX;
          const movedFar = Math.abs(dx) > 4;
          if (movedFar && previewRef.current) {
            dispatch({
              type: "story/update",
              id: info.storyId,
              patch: { startDate: previewRef.current.start, dueDate: previewRef.current.due },
            });
          } else if (info.kind === "move") {
            const story = project.stories.find((s) => s.id === info.storyId);
            if (story) setEditingStory(story);
          }
        }
      }
      dragRef.current = null;
      previewRef.current = null;
      connectPreviewRef.current = null;
      setDragActive(false);
      forceRender();
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragActive]);

  function startDrag(e: React.MouseEvent, kind: DragInfo["kind"], story: Story, eff: { start: string; due: string }) {
    e.stopPropagation();
    dragRef.current = { kind, storyId: story.id, startClientX: e.clientX, startStart: eff.start, startDue: eff.due };
    setDragActive(true);
  }

  function startConnect(e: React.MouseEvent, story: Story, side: "front" | "back") {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { kind: "connect", storyId: story.id, startClientX: e.clientX, startStart: "", startDue: "", side };
    connectPreviewRef.current = toBodyCoords(e.clientX, e.clientY);
    setDragActive(true);
  }

  const rowInfo = new Map<ID, { y: number; eff: { start: string; due: string } }>();
  for (const row of rows) rowInfo.set(row.story.id, { y: row.y, eff: getEff(row) });

  return (
    <>
      <div className="view-header">
        <div>
          <h1>Gantt Chart</h1>
          <div className="sub">
            Drag a bar to reschedule, drag its edges to resize, click it to edit. Drag from the dot on its back (end) to make another task depend on it, or from the dot on its front (start) to make it depend on another task.
          </div>
        </div>
        <div className="actions">
          <button className="btn btn-sm" onClick={scrollToToday}>Today</button>
          <div className="gantt-zoom">
            <button onClick={() => setDayWidth((w) => Math.max(MIN_DAY_W, w - 6))}>−</button>
            <button onClick={() => setDayWidth((w) => Math.min(MAX_DAY_W, w + 6))}>+</button>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="panel empty-state">
          <div className="big">▬</div>
          <h3>Nothing to schedule yet</h3>
          <p>Create a task and set a sprint or dates to see it on the Gantt chart.</p>
        </div>
      ) : (
        <div className="gantt-scroll" ref={scrollRef}>
          <div className="gantt-flex" style={{ width: LEFT_W + timelineWidth }}>
            <div className="gantt-left" style={{ width: LEFT_W }}>
              <div className="gantt-left-header">Task</div>
              <div className="gantt-left-body" style={{ height: contentHeight }}>
                {groupHeaders.map((g) => (
                  <div key={g.label} className="gantt-group-label" style={{ top: g.y, height: GROUP_H }}>
                    <span className={`group-pill gp-${g.state === "active" ? "active" : g.state === "completed" ? "backlog" : "planned"}`}>
                      {g.label}
                    </span>
                  </div>
                ))}
                {rows.map((row) => {
                  const assignee = project.members.find((m) => m.id === row.story.assigneeId);
                  return (
                    <div
                      key={row.story.id}
                      className="gantt-row-label"
                      style={{ top: row.y, height: ROW_H }}
                      onClick={() => setEditingStory(row.story)}
                    >
                      <TypeIcon type={row.story.type} />
                      <span className="gantt-row-key">{row.story.key}</span>
                      <span className="gantt-row-title">{row.story.title}</span>
                      <Avatar member={assignee} />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="gantt-right" style={{ width: timelineWidth }}>
              <div className="gantt-date-header" style={{ height: HEADER_H }}>
                <div className="gantt-month-row">
                  {monthSegments.map((seg, i) => (
                    <span key={i} className="gantt-month" style={{ width: seg.days * dayWidth }}>{seg.label}</span>
                  ))}
                </div>
                <div className="gantt-day-row">
                  {Array.from({ length: totalDays }, (_, i) => {
                    const d = addDays(rangeStart, i);
                    const dow = new Date(parseYMD(d)).getUTCDay();
                    return (
                      <span key={i} className={`gantt-day${dow === 0 || dow === 6 ? " weekend" : ""}${d === today ? " is-today" : ""}`} style={{ width: dayWidth }}>
                        {new Date(parseYMD(d)).getUTCDate()}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className="gantt-body" ref={bodyRef} style={{ height: contentHeight }}>
                {Array.from({ length: totalDays }, (_, i) => {
                  const d = addDays(rangeStart, i);
                  const dow = new Date(parseYMD(d)).getUTCDay();
                  if (dow !== 0 && dow !== 6) return null;
                  return <div key={i} className="gantt-weekend-col" style={{ left: i * dayWidth, width: dayWidth }} />;
                })}

                {groupHeaders.map((g) => (
                  <div key={g.label} className="gantt-group-band" style={{ top: g.y, height: GROUP_H }} />
                ))}

                <div className="gantt-today-line" style={{ left: todayX }} />

                <svg className="gantt-arrows" width={timelineWidth} height={contentHeight}>
                  <defs>
                    <marker id="gantt-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3.5" orient="auto">
                      <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--text-faint)" />
                    </marker>
                  </defs>
                  {rows.flatMap((row) =>
                    row.story.dependsOn.map((depId) => {
                      const dep = rowInfo.get(depId);
                      const me = rowInfo.get(row.story.id);
                      if (!dep || !me) return null;
                      const x1 = dateToX(dep.eff.due) + dayWidth;
                      const y1 = dep.y + ROW_H / 2;
                      const x2 = dateToX(me.eff.start);
                      const y2 = me.y + ROW_H / 2;
                      const midX = Math.max(x1 + 12, x2 - 12);
                      const pts =
                        y1 === y2
                          ? [{ x: x1, y: y1 }, { x: x2, y: y2 }]
                          : [{ x: x1, y: y1 }, { x: midX, y: y1 }, { x: midX, y: y2 }, { x: x2, y: y2 }];
                      return (
                        <path
                          key={`${depId}-${row.story.id}`}
                          d={roundedStep(pts, 8)}
                          fill="none"
                          stroke="var(--text-faint)"
                          strokeWidth={1.5}
                          markerEnd="url(#gantt-arrow)"
                        />
                      );
                    })
                  )}
                  {dragActive && dragRef.current?.kind === "connect" && connectPreviewRef.current && (() => {
                    const src = rowInfo.get(dragRef.current.storyId);
                    if (!src) return null;
                    const x1 = dragRef.current.side === "front" ? dateToX(src.eff.start) : dateToX(src.eff.due) + dayWidth;
                    const y1 = src.y + ROW_H / 2;
                    return (
                      <line
                        x1={x1} y1={y1}
                        x2={connectPreviewRef.current.x} y2={connectPreviewRef.current.y}
                        stroke="var(--accent-strong)" strokeWidth={2} strokeDasharray="5 4"
                      />
                    );
                  })()}
                </svg>

                {rows.map((row) => {
                  const eff = getEff(row);
                  const left = dateToX(eff.start);
                  const width = (daysBetween(eff.start, eff.due) + 1) * dayWidth;
                  const pct = STATUS_PROGRESS[row.story.status] ?? 0;
                  return (
                    <div
                      key={row.story.id}
                      className="gantt-bar"
                      data-gantt-bar-id={row.story.id}
                      style={{ top: row.y + 6, left, width: Math.max(dayWidth - 4, width - 4), height: ROW_H - 12 }}
                      onMouseDown={(e) => startDrag(e, "move", row.story, eff)}
                      title={`${row.story.key} · ${eff.start} → ${eff.due}`}
                    >
                      <span className="gantt-bar-handle gantt-bar-handle-l" onMouseDown={(e) => startDrag(e, "left", row.story, eff)} />
                      <div className={`gantt-bar-inner gantt-bar-${row.story.status}`}>
                        {pct > 0 && <span className="gantt-bar-fill" style={{ width: `${pct}%` }} />}
                        <span className="gantt-bar-label">{row.story.title}</span>
                      </div>
                      <span className="gantt-bar-handle gantt-bar-handle-r" onMouseDown={(e) => startDrag(e, "right", row.story, eff)} />
                      <span
                        className="gantt-bar-connect gantt-bar-connect-l"
                        title="Drag onto another task to make this task depend on it"
                        onMouseDown={(e) => startConnect(e, row.story, "front")}
                      />
                      <span
                        className="gantt-bar-connect gantt-bar-connect-r"
                        title="Drag onto another task to make it depend on this task"
                        onMouseDown={(e) => startConnect(e, row.story, "back")}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {editingStory && <StoryModal story={editingStory} onClose={() => setEditingStory(null)} />}
    </>
  );
}
