import { useEffect, useReducer as useForceReducer, useRef, useState } from "react";
import { uid, useStore } from "../store";
import { filesToAttachments, formatBytes } from "../files";
import type { Attachment, ID, Story, WBEdge, WBGroup, WBNode, WBShape, Whiteboard } from "../types";
import { FONT_OPTIONS, NOTE_COLORS, PEN_COLORS, TEXT_COLORS } from "../types";
import { Avatar, Modal, PointsBadge, PriorityIcon, TypeIcon } from "./common";
import StoryModal from "./StoryModal";
import { useAuth } from "../auth";

const GRID = 22;
const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
const TASK_W = 200;
const TASK_H = 82;
const NOTE_W = 180;
const NOTE_H = 110;
const MIN_W = 90;
const MIN_H = 50;
const SHAPES: WBShape[] = ["rect", "round", "diamond", "circle"];
const SHAPE_GLYPH: Record<WBShape, string> = { rect: "▭", round: "▢", diamond: "◇", circle: "○" };
const RESIZE_EDGES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
const RESIZE_CURSOR: Record<(typeof RESIZE_EDGES)[number], string> = {
  nw: "nwse-resize", n: "ns-resize", ne: "nesw-resize", e: "ew-resize",
  se: "nwse-resize", s: "ns-resize", sw: "nesw-resize", w: "ew-resize",
};

type Tool = "select" | "pan" | "pen";
type Selected = { type: "edge" | "stroke"; id: ID } | null;
interface Box { x: number; y: number; w: number; h: number; }
type Side = "left" | "right" | "top" | "bottom";

interface DragInfo {
  kind: "pan" | "node" | "connect" | "pen" | "resize" | "edgebend" | "marquee" | "group";
  id?: ID;
  offsetX?: number;
  offsetY?: number;
  startClientX?: number;
  startClientY?: number;
  startVX?: number;
  startVY?: number;
  startW?: number;
  startH?: number;
  startX?: number;
  startY?: number;
  startCanvasX?: number;
  startCanvasY?: number;
  edge?: string;
  axis?: "x" | "y";
  startBend?: number;
  penColor?: string;
  /** group-drag: which specific bubble was clicked, for click-vs-drag fallback behavior */
  nodeIdForClick?: ID;
  /** group-drag: each member's position at drag start */
  groupStart?: Record<ID, { x: number; y: number }>;
}

function rectBorderPoint(cx: number, cy: number, hw: number, hh: number, tx: number, ty: number) {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

function pointsToPath(points: number[]): string {
  let d = "";
  for (let i = 0; i < points.length; i += 2) {
    d += `${i === 0 ? "M" : "L"}${points[i].toFixed(1)},${points[i + 1].toFixed(1)} `;
  }
  return d;
}

// ---- orthogonal routing with basic obstacle avoidance ----

function pickSides(a: Box, b: Box): { from: Side; to: Side } {
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
  const dx = bcx - acx, dy = bcy - acy;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? { from: "right", to: "left" } : { from: "left", to: "right" };
  }
  return dy >= 0 ? { from: "bottom", to: "top" } : { from: "top", to: "bottom" };
}

function portPoint(box: Box, side: Side) {
  switch (side) {
    case "left": return { x: box.x, y: box.y + box.h / 2 };
    case "right": return { x: box.x + box.w, y: box.y + box.h / 2 };
    case "top": return { x: box.x + box.w / 2, y: box.y };
    case "bottom": return { x: box.x + box.w / 2, y: box.y + box.h };
  }
}

const ROUTE_PAD = 14;

function clearVertical(midX: number, yMin: number, yMax: number, obstacles: Box[]): number {
  for (let iter = 0; iter < 4; iter++) {
    let hit: Box | null = null;
    for (const o of obstacles) {
      const ox1 = o.x - ROUTE_PAD, ox2 = o.x + o.w + ROUTE_PAD;
      const oy1 = o.y - ROUTE_PAD, oy2 = o.y + o.h + ROUTE_PAD;
      if (midX > ox1 && midX < ox2 && yMax > oy1 && yMin < oy2) {
        hit = { x: ox1, y: oy1, w: ox2 - ox1, h: oy2 - oy1 };
        break;
      }
    }
    if (!hit) break;
    const distLeft = Math.abs(midX - hit.x);
    const distRight = Math.abs(hit.x + hit.w - midX);
    midX = distLeft <= distRight ? hit.x : hit.x + hit.w;
  }
  return midX;
}

function clearHorizontal(midY: number, xMin: number, xMax: number, obstacles: Box[]): number {
  for (let iter = 0; iter < 4; iter++) {
    let hit: Box | null = null;
    for (const o of obstacles) {
      const ox1 = o.x - ROUTE_PAD, ox2 = o.x + o.w + ROUTE_PAD;
      const oy1 = o.y - ROUTE_PAD, oy2 = o.y + o.h + ROUTE_PAD;
      if (midY > oy1 && midY < oy2 && xMax > ox1 && xMin < ox2) {
        hit = { x: ox1, y: oy1, w: ox2 - ox1, h: oy2 - oy1 };
        break;
      }
    }
    if (!hit) break;
    const distTop = Math.abs(midY - hit.y);
    const distBottom = Math.abs(hit.y + hit.h - midY);
    midY = distTop <= distBottom ? hit.y : hit.y + hit.h;
  }
  return midY;
}

interface RoutedEdge {
  points: { x: number; y: number }[];
  /** Which coordinate the free bridge segment (if any) is draggable along. */
  axis: "x" | "y" | null;
}

function routeEdge(a: Box, b: Box, obstacles: Box[], manualBend?: number): RoutedEdge {
  const sides = pickSides(a, b);
  const p1 = portPoint(a, sides.from);
  const p2 = portPoint(b, sides.to);
  const horiz1 = sides.from === "left" || sides.from === "right";
  const horiz2 = sides.to === "left" || sides.to === "right";
  if (horiz1 && horiz2) {
    const midX = manualBend ?? clearVertical((p1.x + p2.x) / 2, Math.min(p1.y, p2.y), Math.max(p1.y, p2.y), obstacles);
    return { points: [p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2], axis: "x" };
  }
  if (!horiz1 && !horiz2) {
    const midY = manualBend ?? clearHorizontal((p1.y + p2.y) / 2, Math.min(p1.x, p2.x), Math.max(p1.x, p2.x), obstacles);
    return { points: [p1, { x: p1.x, y: midY }, { x: p2.x, y: midY }, p2], axis: "y" };
  }
  if (horiz1 && !horiz2) return { points: [p1, { x: p2.x, y: p1.y }, p2], axis: null };
  return { points: [p1, { x: p1.x, y: p2.y }, p2], axis: null };
}

function roundedPathD(points: { x: number; y: number }[], radius: number): string {
  if (points.length < 2) return "";
  if (points.length === 2) return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  let d = `M ${points[0].x},${points[0].y} `;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], curr = points[i], next = points[i + 1];
    const d1x = curr.x - prev.x, d1y = curr.y - prev.y;
    const len1 = Math.hypot(d1x, d1y) || 1;
    const d2x = next.x - curr.x, d2y = next.y - curr.y;
    const len2 = Math.hypot(d2x, d2y) || 1;
    const r = Math.min(radius, len1 / 2, len2 / 2);
    const rp1 = { x: curr.x - (d1x / len1) * r, y: curr.y - (d1y / len1) * r };
    const rp2 = { x: curr.x + (d2x / len2) * r, y: curr.y + (d2y / len2) * r };
    d += `L ${rp1.x},${rp1.y} Q ${curr.x},${curr.y} ${rp2.x},${rp2.y} `;
  }
  const last = points[points.length - 1];
  d += `L ${last.x},${last.y}`;
  return d;
}

export default function Whiteboard() {
  const { project, dispatch } = useStore();
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || project.members.some((member) => member.userId === user?.id);
  const wb = project.whiteboards.find((b) => b.id === project.activeWhiteboardId) ?? project.whiteboards[0];
  const [renamingBoardId, setRenamingBoardId] = useState<ID | null>(null);
  const [newBoardMenuOpen, setNewBoardMenuOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ x: 90, y: 70, scale: 1 });
  const viewportRef = useRef(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const [tool, setTool] = useState<Tool>("select");
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [notePopoverOpen, setNotePopoverOpen] = useState(false);
  const [pendingShape, setPendingShape] = useState<WBShape>("rect");
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [attachTarget, setAttachTarget] = useState<ID | null>(null);
  const [editingStory, setEditingStory] = useState<Story | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const [noteToolbarId, setNoteToolbarId] = useState<ID | null>(null);
  const [justAddedNoteId, setJustAddedNoteId] = useState<ID | null>(null);
  const [multiSelected, setMultiSelected] = useState<Set<ID>>(new Set());
  const noteRefs = useRef(new Map<ID, HTMLTextAreaElement>());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);
  const [replaceTarget, setReplaceTarget] = useState<ID | null>(null);
  const [dropHover, setDropHover] = useState(false);
  const [htmlEditNodeId, setHtmlEditNodeId] = useState<ID | null>(null);

  const [activeDragKind, setActiveDragKind] = useState<DragInfo["kind"] | null>(null);
  const dragInfo = useRef<DragInfo | null>(null);
  const livePosRef = useRef<{ x: number; y: number } | null>(null);
  const resizePreviewRef = useRef<Box | null>(null);
  const edgeBendPreviewRef = useRef<{ id: ID; value: number } | null>(null);
  const marqueeRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const groupPreviewRef = useRef<Record<ID, { x: number; y: number }> | null>(null);
  const strokePointsRef = useRef<number[]>([]);
  const [, forceRender] = useForceReducer((n: number) => n + 1, 0);

  function toCanvas(clientX: number, clientY: number) {
    const rect = containerRef.current!.getBoundingClientRect();
    const v = viewportRef.current;
    return { x: (clientX - rect.left - v.x) / v.scale, y: (clientY - rect.top - v.y) / v.scale };
  }

  function canvasToScreen(x: number, y: number) {
    return { x: viewport.x + x * viewport.scale, y: viewport.y + y * viewport.scale };
  }

  function getNodeBox(node: WBNode): Box {
    if (activeDragKind === "node" && dragInfo.current?.id === node.id && livePosRef.current) {
      return { x: livePosRef.current.x, y: livePosRef.current.y, w: node.w, h: node.h };
    }
    if (activeDragKind === "resize" && dragInfo.current?.id === node.id && resizePreviewRef.current) {
      return { ...resizePreviewRef.current };
    }
    if (activeDragKind === "group" && groupPreviewRef.current?.[node.id]) {
      const live = groupPreviewRef.current[node.id];
      return { x: live.x, y: live.y, w: node.w, h: node.h };
    }
    return { x: node.x, y: node.y, w: node.w, h: node.h };
  }

  function getGroupBounds(group: WBGroup): Box | null {
    const members = wb.nodes.filter((n) => n.groupId === group.id);
    if (members.length === 0) return null;
    const boxes = members.map((n) => getNodeBox(n));
    const x1 = Math.min(...boxes.map((b) => b.x));
    const y1 = Math.min(...boxes.map((b) => b.y));
    const x2 = Math.max(...boxes.map((b) => b.x + b.w));
    const y2 = Math.max(...boxes.map((b) => b.y + b.h));
    const PAD = 24;
    return { x: x1 - PAD, y: y1 - PAD, w: x2 - x1 + PAD * 2, h: y2 - y1 + PAD * 2 };
  }

  function getEdgeBend(edge: WBEdge): number | undefined {
    if (activeDragKind === "edgebend" && dragInfo.current?.id === edge.id && edgeBendPreviewRef.current) {
      return edgeBendPreviewRef.current.value;
    }
    return edge.bend;
  }

  // ---- drag / pan / connect / draw / resize lifecycle ----
  useEffect(() => {
    if (!activeDragKind) return;

    function onMove(e: MouseEvent) {
      const info = dragInfo.current;
      if (!info) return;
      if (info.kind === "pan") {
        setViewport((v) => ({
          ...v,
          x: info.startVX! + (e.clientX - info.startClientX!),
          y: info.startVY! + (e.clientY - info.startClientY!),
        }));
        return;
      }
      if (info.kind === "resize") {
        const dx = (e.clientX - info.startClientX!) / viewportRef.current.scale;
        const dy = (e.clientY - info.startClientY!) / viewportRef.current.scale;
        const edge = info.edge!;
        let w = info.startW!, h = info.startH!, x = info.startX!, y = info.startY!;
        if (edge.includes("e")) w = Math.max(MIN_W, info.startW! + dx);
        if (edge.includes("w")) {
          w = Math.max(MIN_W, info.startW! - dx);
          x = info.startX! + (info.startW! - w);
        }
        if (edge.includes("s")) h = Math.max(MIN_H, info.startH! + dy);
        if (edge.includes("n")) {
          h = Math.max(MIN_H, info.startH! - dy);
          y = info.startY! + (info.startH! - h);
        }
        resizePreviewRef.current = { x, y, w, h };
        forceRender();
        return;
      }
      if (info.kind === "edgebend") {
        const dx = (e.clientX - info.startClientX!) / viewportRef.current.scale;
        const dy = (e.clientY - info.startClientY!) / viewportRef.current.scale;
        const delta = info.axis === "x" ? dx : dy;
        edgeBendPreviewRef.current = { id: info.id!, value: info.startBend! + delta };
        forceRender();
        return;
      }
      if (info.kind === "marquee") {
        const pt = toCanvas(e.clientX, e.clientY);
        marqueeRef.current = { x1: info.startCanvasX!, y1: info.startCanvasY!, x2: pt.x, y2: pt.y };
        forceRender();
        return;
      }
      if (info.kind === "group") {
        const pt = toCanvas(e.clientX, e.clientY);
        const dx = pt.x - info.startCanvasX!;
        const dy = pt.y - info.startCanvasY!;
        const preview: Record<ID, { x: number; y: number }> = {};
        for (const [id, start] of Object.entries(info.groupStart!)) {
          preview[id] = { x: start.x + dx, y: start.y + dy };
        }
        groupPreviewRef.current = preview;
        forceRender();
        return;
      }
      const pt = toCanvas(e.clientX, e.clientY);
      if (info.kind === "node") {
        livePosRef.current = { x: pt.x - info.offsetX!, y: pt.y - info.offsetY! };
        forceRender();
      } else if (info.kind === "connect") {
        livePosRef.current = pt;
        forceRender();
      } else if (info.kind === "pen") {
        strokePointsRef.current = [...strokePointsRef.current, pt.x, pt.y];
        forceRender();
      }
    }

    function onUp(e: MouseEvent) {
      const info = dragInfo.current;
      if (info) {
        if (info.kind === "node") {
          const dx = e.clientX - info.startClientX!;
          const dy = e.clientY - info.startClientY!;
          const movedFar = dx * dx + dy * dy > 16;
          if (movedFar && livePosRef.current) {
            dispatch({ type: "wb/updateNode", id: info.id!, patch: { x: livePosRef.current.x, y: livePosRef.current.y } });
            setNoteToolbarId(null);
          } else {
            const node = wb.nodes.find((n) => n.id === info.id);
            if (node?.kind === "task" && node.storyId) {
              const story = project.stories.find((s) => s.id === node.storyId);
              if (story) setEditingStory(story);
              setNoteToolbarId(null);
            } else if (node?.kind === "note" || node?.kind === "file" || node?.kind === "html") {
              setNoteToolbarId((prev) => (prev === node.id ? null : node.id));
            }
          }
        } else if (info.kind === "resize") {
          if (resizePreviewRef.current) {
            dispatch({ type: "wb/updateNode", id: info.id!, patch: { ...resizePreviewRef.current } });
          }
        } else if (info.kind === "edgebend") {
          const dx = e.clientX - info.startClientX!;
          const dy = e.clientY - info.startClientY!;
          const movedFar = dx * dx + dy * dy > 16;
          if (movedFar && edgeBendPreviewRef.current) {
            dispatch({ type: "wb/updateEdge", id: info.id!, patch: { bend: edgeBendPreviewRef.current.value } });
          } else {
            setSelected({ type: "edge", id: info.id! });
          }
        } else if (info.kind === "marquee") {
          if (marqueeRef.current) {
            const { x1, y1, x2, y2 } = marqueeRef.current;
            const rx1 = Math.min(x1, x2), rx2 = Math.max(x1, x2);
            const ry1 = Math.min(y1, y2), ry2 = Math.max(y1, y2);
            if (rx2 - rx1 > 4 || ry2 - ry1 > 4) {
              const hits = wb.nodes
                .filter((n) => {
                  const b = getNodeBox(n);
                  return b.x < rx2 && b.x + b.w > rx1 && b.y < ry2 && b.y + b.h > ry1;
                })
                .map((n) => n.id);
              setMultiSelected(new Set(hits));
            }
          }
        } else if (info.kind === "group") {
          const dx = e.clientX - info.startClientX!;
          const dy = e.clientY - info.startClientY!;
          const movedFar = dx * dx + dy * dy > 16;
          if (movedFar && groupPreviewRef.current) {
            for (const [id, pos] of Object.entries(groupPreviewRef.current)) {
              dispatch({ type: "wb/updateNode", id, patch: { x: pos.x, y: pos.y } });
            }
          } else if (info.nodeIdForClick) {
            const node = wb.nodes.find((n) => n.id === info.nodeIdForClick);
            if (node?.kind === "task" && node.storyId) {
              const story = project.stories.find((s) => s.id === node.storyId);
              if (story) setEditingStory(story);
              setNoteToolbarId(null);
            } else if (node?.kind === "note" || node?.kind === "file" || node?.kind === "html") {
              setNoteToolbarId((prev) => (prev === node.id ? null : node.id));
            }
          }
        } else if (info.kind === "connect") {
          const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-node-id]") as HTMLElement | null;
          const targetId = target?.getAttribute("data-node-id");
          if (targetId && targetId !== info.id) {
            dispatch({ type: "wb/addEdge", from: info.id!, to: targetId });
          }
        } else if (info.kind === "pen") {
          if (strokePointsRef.current.length >= 4) {
            dispatch({ type: "wb/addStroke", color: info.penColor ?? penColor, points: strokePointsRef.current });
          }
        }
      }
      dragInfo.current = null;
      livePosRef.current = null;
      resizePreviewRef.current = null;
      edgeBendPreviewRef.current = null;
      marqueeRef.current = null;
      groupPreviewRef.current = null;
      strokePointsRef.current = [];
      setActiveDragKind(null);
      forceRender();
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDragKind]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMultiSelected(new Set());
        setSelected(null);
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "textarea" || tag === "input") return;
      if (!selected) return;
      if (selected.type === "edge") dispatch({ type: "wb/deleteEdge", id: selected.id });
      else dispatch({ type: "wb/deleteStroke", id: selected.id });
      setSelected(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, dispatch]);

  useEffect(() => {
    if (!justAddedNoteId) return;
    const el = noteRefs.current.get(justAddedNoteId);
    if (el) {
      el.focus();
      el.select();
    }
    setJustAddedNoteId(null);
  }, [justAddedNoteId]);

  function startPan(e: React.MouseEvent) {
    setSelected(null);
    setNoteToolbarId(null);
    dragInfo.current = {
      kind: "pan",
      startClientX: e.clientX,
      startClientY: e.clientY,
      startVX: viewport.x,
      startVY: viewport.y,
    };
    setActiveDragKind("pan");
  }

  function startMarquee(e: React.MouseEvent) {
    setSelected(null);
    setNoteToolbarId(null);
    setMultiSelected(new Set());
    const pt = toCanvas(e.clientX, e.clientY);
    marqueeRef.current = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
    dragInfo.current = { kind: "marquee", startCanvasX: pt.x, startCanvasY: pt.y };
    setActiveDragKind("marquee");
  }

  function onCanvasMouseDown(e: React.MouseEvent) {
    if (e.button === 1) {
      e.preventDefault();
      startPan(e);
      return;
    }
    if (tool === "pen") {
      const pt = toCanvas(e.clientX, e.clientY);
      strokePointsRef.current = [pt.x, pt.y];
      dragInfo.current = { kind: "pen", penColor };
      setActiveDragKind("pen");
      return;
    }
    if (tool === "select") {
      startMarquee(e);
      return;
    }
    startPan(e);
  }

  function onCanvasDoubleClick(e: React.MouseEvent) {
    if (e.target !== e.currentTarget) return;
    if (tool === "pen") return;
    const pt = toCanvas(e.clientX, e.clientY);
    const id = uid();
    dispatch({
      type: "wb/addNode",
      node: {
        id,
        kind: "note",
        x: pt.x - NOTE_W / 2,
        y: pt.y - NOTE_H / 2,
        w: NOTE_W,
        h: NOTE_H,
        text: "",
        color: NOTE_COLORS[5],
        shape: "rect",
      },
    });
    setJustAddedNoteId(id);
    setNoteToolbarId(id);
  }

  function onNodeMouseDown(e: React.MouseEvent, node: WBNode) {
    e.stopPropagation();
    if (tool === "pen") return;
    const pt = toCanvas(e.clientX, e.clientY);
    if (node.groupId) {
      const groupStart: Record<ID, { x: number; y: number }> = {};
      for (const n of wb.nodes) if (n.groupId === node.groupId) groupStart[n.id] = { x: n.x, y: n.y };
      dragInfo.current = {
        kind: "group",
        id: node.groupId,
        nodeIdForClick: node.id,
        groupStart,
        startCanvasX: pt.x,
        startCanvasY: pt.y,
        startClientX: e.clientX,
        startClientY: e.clientY,
      };
      setActiveDragKind("group");
      return;
    }
    dragInfo.current = {
      kind: "node",
      id: node.id,
      offsetX: pt.x - node.x,
      offsetY: pt.y - node.y,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };
    setActiveDragKind("node");
  }

  function onGroupTitleMouseDown(e: React.MouseEvent, group: WBGroup) {
    e.stopPropagation();
    if (tool === "pen") return;
    const pt = toCanvas(e.clientX, e.clientY);
    const groupStart: Record<ID, { x: number; y: number }> = {};
    for (const n of wb.nodes) if (n.groupId === group.id) groupStart[n.id] = { x: n.x, y: n.y };
    dragInfo.current = {
      kind: "group",
      id: group.id,
      groupStart,
      startCanvasX: pt.x,
      startCanvasY: pt.y,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };
    setActiveDragKind("group");
  }

  function onHandleMouseDown(e: React.MouseEvent, node: WBNode) {
    e.stopPropagation();
    e.preventDefault();
    if (tool === "pen") return;
    const pt = toCanvas(e.clientX, e.clientY);
    livePosRef.current = pt;
    dragInfo.current = { kind: "connect", id: node.id };
    setActiveDragKind("connect");
    forceRender();
  }

  function onEdgeBendMouseDown(e: React.MouseEvent, edgeId: ID, axis: "x" | "y", currentBend: number) {
    e.stopPropagation();
    if (tool === "pen") return;
    dragInfo.current = {
      kind: "edgebend",
      id: edgeId,
      axis,
      startBend: currentBend,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };
    setActiveDragKind("edgebend");
  }

  function onResizeMouseDown(e: React.MouseEvent, node: WBNode, edge: string) {
    e.stopPropagation();
    e.preventDefault();
    if (tool === "pen") return;
    dragInfo.current = {
      kind: "resize",
      id: node.id,
      edge,
      startW: node.w,
      startH: node.h,
      startX: node.x,
      startY: node.y,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };
    setActiveDragKind("resize");
  }

  function zoomBy(factor: number) {
    setViewport((v) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const cx = rect ? rect.width / 2 : 0;
      const cy = rect ? rect.height / 2 : 0;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const worldX = (cx - v.x) / v.scale;
      const worldY = (cy - v.y) / v.scale;
      return { x: cx - worldX * newScale, y: cy - worldY * newScale, scale: newScale };
    });
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    setViewport((v) => {
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const worldX = (cx - v.x) / v.scale;
      const worldY = (cy - v.y) / v.scale;
      return { x: cx - worldX * newScale, y: cy - worldY * newScale, scale: newScale };
    });
  }

  function viewportCenter() {
    const rect = containerRef.current!.getBoundingClientRect();
    return toCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function addNote(color: string, shape: WBShape) {
    const center = viewportCenter();
    const id = uid();
    const jitter = (Math.random() - 0.5) * 40;
    dispatch({
      type: "wb/addNode",
      node: {
        id,
        kind: "note",
        x: center.x - NOTE_W / 2 + jitter,
        y: center.y - NOTE_H / 2 + jitter,
        w: NOTE_W,
        h: NOTE_H,
        text: "",
        color,
        shape,
      },
    });
    setNotePopoverOpen(false);
    setJustAddedNoteId(id);
  }

  const usedStoryIds = new Set(wb.nodes.filter((n) => n.kind === "task").map((n) => n.storyId));

  function addTaskNode(story: Story) {
    const center = viewportCenter();
    const jitter = (Math.random() - 0.5) * 30;
    dispatch({
      type: "wb/addNode",
      node: {
        id: uid(),
        kind: "task",
        x: center.x - TASK_W / 2 + jitter,
        y: center.y - TASK_H / 2 + jitter,
        w: TASK_W,
        h: TASK_H,
        storyId: story.id,
        shape: "rect",
      },
    });
  }

  const FILE_IMG_W = 200;
  const FILE_IMG_H = 150;
  const FILE_DOC_W = 180;
  const FILE_DOC_H = 92;

  function addFileNodes(attachments: Attachment[], at?: { x: number; y: number }) {
    attachments.forEach((att, i) => {
      const center = at ?? viewportCenter();
      const jitter = (Math.random() - 0.5) * 30;
      const isImage = att.mimeType.startsWith("image/");
      const w = isImage ? FILE_IMG_W : FILE_DOC_W;
      const h = isImage ? FILE_IMG_H : FILE_DOC_H;
      dispatch({
        type: "wb/addNode",
        node: {
          id: uid(),
          kind: "file",
          x: center.x - w / 2 + jitter + i * 24,
          y: center.y - h / 2 + jitter + i * 24,
          w,
          h,
          shape: "rect",
          attachment: att,
        },
      });
    });
  }

  const HTML_W = 320;
  const HTML_H = 220;

  function addHtmlNode() {
    const center = viewportCenter();
    const id = uid();
    dispatch({
      type: "wb/addNode",
      node: {
        id,
        kind: "html",
        x: center.x - HTML_W / 2,
        y: center.y - HTML_H / 2,
        w: HTML_W,
        h: HTML_H,
        shape: "rect",
        html: "",
      },
    });
    setHtmlEditNodeId(id);
  }

  async function handleFilePick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const attachments = await filesToAttachments(files, uid);
    addFileNodes(attachments);
  }

  async function handleCanvasFileDrop(e: React.DragEvent) {
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    setDropHover(false);
    const pt = toCanvas(e.clientX, e.clientY);
    const attachments = await filesToAttachments(e.dataTransfer.files, uid);
    addFileNodes(attachments, pt);
  }

  function pickTask(story: Story) {
    if (attachTarget) {
      dispatch({ type: "wb/updateNode", id: attachTarget, patch: { kind: "task", storyId: story.id } });
      setAttachTarget(null);
      setTaskPickerOpen(false);
      setNoteToolbarId(null);
    } else {
      addTaskNode(story);
    }
  }

  function closeTaskPicker() {
    setTaskPickerOpen(false);
    setAttachTarget(null);
  }

  const gridSize = GRID * viewport.scale;
  const bgPos = `${viewport.x % gridSize}px ${viewport.y % gridSize}px`;
  const toolbarNode = noteToolbarId ? wb.nodes.find((n) => n.id === noteToolbarId) ?? null : null;

  return (
    <>
      <div className="view-header">
        <div>
          <h1>Whiteboard</h1>
          <div className="sub">
            Double-click empty space for a new bubble, drag to window-select bubbles and group them, scroll to zoom, use the hand tool to pan. Drop files or photos anywhere on the canvas to add them, or use the 📎 button.
          </div>
        </div>
      </div>

      <div className="wb-board-tabs">
        {project.whiteboards.map((b) => (
          <div key={b.id} className={`wb-board-tab${b.id === wb.id ? " active" : ""}`}>
            {renamingBoardId === b.id ? (
              <input
                autoFocus
                className="wb-board-tab-input"
                defaultValue={b.name}
                onMouseDown={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name) dispatch({ type: "wb/renameBoard", id: b.id, name });
                  setRenamingBoardId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenamingBoardId(null);
                }}
              />
            ) : (
              <button
                className="wb-board-tab-btn"
                title="Double-click to rename"
                onClick={() => dispatch({ type: "wb/setActiveBoard", id: b.id })}
                onDoubleClick={() => { if (canEdit) setRenamingBoardId(b.id); }}
              >
                <span className="wb-board-tab-icon">{b.kind === "html" ? "</>" : "▦"}</span> {b.name}
              </button>
            )}
            {canEdit && project.whiteboards.length > 1 && (
              <button
                className="wb-board-tab-close"
                title="Delete this whiteboard"
                onClick={() => {
                  if (confirm(`Delete whiteboard "${b.name}"? This cannot be undone.`)) {
                    dispatch({ type: "wb/deleteBoard", id: b.id });
                  }
                }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {canEdit && <div className="wb-board-tab-add-wrap">
          <button
            className="wb-board-tab-add"
            title="New whiteboard"
            onClick={() => setNewBoardMenuOpen((o) => !o)}
          >
            + New board
          </button>
          {newBoardMenuOpen && (
            <div className="wb-board-add-menu" onMouseDown={(e) => e.stopPropagation()}>
              <button
                onClick={() => {
                  dispatch({ type: "wb/createBoard", name: `Board ${project.whiteboards.length + 1}`, kind: "canvas" });
                  setNewBoardMenuOpen(false);
                }}
              >
                ▦ Canvas board
              </button>
              <button
                onClick={() => {
                  dispatch({ type: "wb/createBoard", name: `HTML ${project.whiteboards.length + 1}`, kind: "html" });
                  setNewBoardMenuOpen(false);
                }}
              >
                {"</>"} HTML board
              </button>
            </div>
          )}
        </div>}
      </div>

      {wb.kind === "html" ? (
        <HtmlBoardView
          key={wb.id}
          board={wb}
          readOnly={!canEdit}
          onSave={(html) => dispatch({ type: "wb/updateBoardHtml", id: wb.id, html })}
        />
      ) : (
      <>
      <div
        ref={containerRef}
        className={`wb-viewport${dropHover ? " wb-drop-hover" : ""}${canEdit ? "" : " wb-readonly"}`}
        style={{ backgroundSize: `${gridSize}px ${gridSize}px`, backgroundPosition: bgPos }}
        onMouseDown={onCanvasMouseDown}
        onDoubleClick={canEdit ? onCanvasDoubleClick : undefined}
        onWheel={onWheel}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          if (!dropHover) setDropHover(true);
        }}
        onDragLeave={(e) => {
          if (e.target === e.currentTarget) setDropHover(false);
        }}
        onDrop={canEdit ? handleCanvasFileDrop : undefined}
      >
        <div
          className="wb-canvas"
          style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}
        >
          {wb.groups.map((group) => {
            const bounds = getGroupBounds(group);
            if (!bounds) return null;
            return (
              <div key={group.id} className="wb-group-frame" style={{ left: bounds.x, top: bounds.y, width: bounds.w, height: bounds.h }}>
                <div className="wb-group-titlebar" onMouseDown={(e) => onGroupTitleMouseDown(e, group)}>
                  <input
                    className="wb-group-title-input"
                    value={group.name}
                    onMouseDown={(e) => e.stopPropagation()}
                    onChange={(e) => dispatch({ type: "wb/updateGroup", id: group.id, patch: { name: e.target.value } })}
                  />
                  <button
                    className="wb-group-explode"
                    title="Explode group"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => dispatch({ type: "wb/ungroup", id: group.id })}
                  >
                    ⊟
                  </button>
                </div>
              </div>
            );
          })}

          {activeDragKind === "marquee" && marqueeRef.current && (() => {
            const { x1, y1, x2, y2 } = marqueeRef.current;
            const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
            return (
              <div
                className="wb-marquee"
                style={{ left: rx, top: ry, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }}
              />
            );
          })()}

          <svg className="wb-svg">
            <defs>
              <marker id="wb-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="context-stroke" />
              </marker>
            </defs>

            {wb.strokes.map((s) => (
              <g key={s.id}>
                <path
                  d={pointsToPath(s.points)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  style={{ pointerEvents: tool === "pen" ? "none" : "stroke" }}
                  onMouseDown={(e) => {
                    if (tool === "pen") return;
                    e.stopPropagation();
                    setSelected({ type: "stroke", id: s.id });
                  }}
                />
                <path
                  d={pointsToPath(s.points)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    pointerEvents: "none",
                    filter: selected?.type === "stroke" && selected.id === s.id ? "drop-shadow(0 0 4px var(--accent-strong))" : undefined,
                  }}
                />
              </g>
            ))}

            {activeDragKind === "pen" && strokePointsRef.current.length >= 2 && (
              <path
                d={pointsToPath(strokePointsRef.current)}
                fill="none"
                stroke={penColor}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ pointerEvents: "none" }}
              />
            )}

            {wb.edges.map((edge) => {
              const from = wb.nodes.find((n) => n.id === edge.from);
              const to = wb.nodes.find((n) => n.id === edge.to);
              if (!from || !to) return null;
              const fromBox = getNodeBox(from);
              const toBox = getNodeBox(to);
              const obstacles = wb.nodes
                .filter((n) => n.id !== edge.from && n.id !== edge.to)
                .map((n) => getNodeBox(n));
              const { points: pathPts, axis } = routeEdge(fromBox, toBox, obstacles, getEdgeBend(edge));
              const d = roundedPathD(pathPts, 10);
              const mid = pathPts[Math.floor((pathPts.length - 1) / 2)];
              const isSel = selected?.type === "edge" && selected.id === edge.id;
              const strokeColor = edge.color ?? "var(--text-faint)";
              return (
                <g key={edge.id}>
                  <path
                    d={d} fill="none" stroke="transparent" strokeWidth={14}
                    style={{ pointerEvents: "stroke" }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setSelected({ type: "edge", id: edge.id });
                    }}
                  />
                  {axis && (
                    <line
                      x1={pathPts[1].x} y1={pathPts[1].y} x2={pathPts[2].x} y2={pathPts[2].y}
                      stroke="transparent" strokeWidth={16}
                      style={{ pointerEvents: "stroke", cursor: axis === "x" ? "ew-resize" : "ns-resize" }}
                      onMouseDown={(e) => onEdgeBendMouseDown(e, edge.id, axis, axis === "x" ? pathPts[1].x : pathPts[1].y)}
                    />
                  )}
                  <path
                    d={d} fill="none"
                    stroke={strokeColor}
                    strokeWidth={isSel ? 2.75 : 1.75}
                    markerEnd="url(#wb-arrow)"
                    style={{
                      pointerEvents: "none",
                      filter: isSel ? "drop-shadow(0 0 3px var(--accent-strong))" : undefined,
                    }}
                  />
                  {isSel && (
                    <foreignObject x={mid.x - 100} y={mid.y - 32} width={200} height={34} style={{ overflow: "visible" }}>
                      <div className="wb-edge-toolbar" onMouseDown={(e) => e.stopPropagation()}>
                        {PEN_COLORS.map((c) => (
                          <button
                            key={c}
                            className={`wb-color-swatch${edge.color === c ? " active" : ""}`}
                            style={{ background: c }}
                            onClick={() => dispatch({ type: "wb/updateEdge", id: edge.id, patch: { color: c } })}
                          />
                        ))}
                        <button
                          className="wb-edge-del"
                          onClick={() => {
                            dispatch({ type: "wb/deleteEdge", id: edge.id });
                            setSelected(null);
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </foreignObject>
                  )}
                </g>
              );
            })}

            {activeDragKind === "connect" && dragInfo.current && livePosRef.current && (() => {
              const src = wb.nodes.find((n) => n.id === dragInfo.current!.id);
              if (!src) return null;
              const box = getNodeBox(src);
              const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
              const p1 = rectBorderPoint(cx, cy, box.w / 2, box.h / 2, livePosRef.current.x, livePosRef.current.y);
              return (
                <line
                  x1={p1.x} y1={p1.y} x2={livePosRef.current.x} y2={livePosRef.current.y}
                  stroke="var(--accent-strong)" strokeWidth={2} strokeDasharray="5 4"
                  style={{ pointerEvents: "none" }}
                />
              );
            })()}
          </svg>

          {wb.nodes.map((node) => {
            const box = getNodeBox(node);
            const { x, y, w, h } = box;
            const shape = node.shape ?? "rect";
            const resizeHandles = RESIZE_EDGES.map((edge) => (
              <span
                key={edge}
                className={`wb-resize wb-resize-${edge}`}
                style={{ cursor: RESIZE_CURSOR[edge] }}
                onMouseDown={(e) => onResizeMouseDown(e, node, edge)}
              />
            ));
            const connectHandles = (["top", "right", "bottom", "left"] as const).map((side) => (
              <span key={side} className={`wb-handle wb-handle-${side}`} onMouseDown={(e) => onHandleMouseDown(e, node)} />
            ));

            if (node.kind === "task") {
              const story = project.stories.find((s) => s.id === node.storyId);
              const assignee = story ? project.members.find((m) => m.id === story.assigneeId) : undefined;
              return (
                <div
                  key={node.id}
                  className={`wb-node${multiSelected.has(node.id) ? " wb-node-marqueed" : ""}`}
                  data-node-id={node.id}
                  style={{ left: x, top: y, width: w, height: h }}
                  onMouseDown={(e) => onNodeMouseDown(e, node)}
                >
                  {connectHandles}
                  {resizeHandles}
                  <button
                    className="wb-edit"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => setNoteToolbarId((prev) => (prev === node.id ? null : node.id))}
                  >
                    ✎
                  </button>
                  <button
                    className="wb-del"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => dispatch({ type: "wb/deleteNode", id: node.id })}
                  >
                    ✕
                  </button>
                  <div className={`wb-shape-fill wb-node-task wb-shape-${shape} wb-task-status-${story?.status ?? "todo"}`}>
                    {story ? (
                      <>
                        <div className="wb-task-head">
                          <TypeIcon type={story.type} />
                          <span className="wb-task-key">{story.key}</span>
                          <span className={`status-pill status-${story.status}`}>
                            {story.status === "backlog" ? "Open" : story.status}
                          </span>
                        </div>
                        <div className="wb-task-title">{story.title}</div>
                        <div className="wb-task-foot">
                          <PriorityIcon priority={story.priority} />
                          <PointsBadge points={story.points} />
                          <Avatar member={assignee} />
                        </div>
                      </>
                    ) : (
                      <div className="wb-task-title">Task removed</div>
                    )}
                  </div>
                </div>
              );
            }

            if (node.kind === "file") {
              const att = node.attachment;
              const isImage = att?.mimeType.startsWith("image/") ?? false;
              return (
                <div
                  key={node.id}
                  className={`wb-node${multiSelected.has(node.id) ? " wb-node-marqueed" : ""}`}
                  data-node-id={node.id}
                  style={{ left: x, top: y, width: w, height: h }}
                  onMouseDown={(e) => onNodeMouseDown(e, node)}
                >
                  {connectHandles}
                  {resizeHandles}
                  <button
                    className="wb-edit"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => setNoteToolbarId((prev) => (prev === node.id ? null : node.id))}
                  >
                    ✎
                  </button>
                  <button
                    className="wb-del"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => dispatch({ type: "wb/deleteNode", id: node.id })}
                  >
                    ✕
                  </button>
                  <div className={`wb-shape-fill wb-node-file wb-shape-${shape}`}>
                    {!att ? (
                      <div className="wb-file-missing">File removed</div>
                    ) : isImage ? (
                      <img className="wb-file-img" src={att.dataUrl} alt={att.name} draggable={false} />
                    ) : (
                      <a
                        className="wb-file-generic"
                        href={att.dataUrl}
                        download={att.name}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <span className="wb-file-icon">📄</span>
                        <span className="wb-file-name">{att.name}</span>
                        <span className="wb-file-size">{formatBytes(att.size)}</span>
                      </a>
                    )}
                  </div>
                </div>
              );
            }

            if (node.kind === "html") {
              return (
                <div
                  key={node.id}
                  className={`wb-node${multiSelected.has(node.id) ? " wb-node-marqueed" : ""}`}
                  data-node-id={node.id}
                  style={{ left: x, top: y, width: w, height: h }}
                >
                  {connectHandles}
                  {resizeHandles}
                  <button
                    className="wb-edit"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => setNoteToolbarId((prev) => (prev === node.id ? null : node.id))}
                  >
                    ✎
                  </button>
                  <button
                    className="wb-del"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => dispatch({ type: "wb/deleteNode", id: node.id })}
                  >
                    ✕
                  </button>
                  <div className={`wb-shape-fill wb-node-html wb-shape-${shape}`}>
                    <div className="wb-html-handle" onMouseDown={(e) => onNodeMouseDown(e, node)}>
                      ⠿⠿ <span>HTML</span>
                    </div>
                    {node.html ? (
                      <iframe
                        className="wb-html-frame"
                        srcDoc={node.html}
                        sandbox="allow-scripts"
                        title={`HTML block ${node.id}`}
                      />
                    ) : (
                      <button
                        className="wb-html-empty"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => setHtmlEditNodeId(node.id)}
                      >
                        Click to add HTML…
                      </button>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={node.id}
                className={`wb-node${multiSelected.has(node.id) ? " wb-node-marqueed" : ""}`}
                data-node-id={node.id}
                style={{ left: x, top: y, width: w, height: h }}
              >
                {connectHandles}
                {resizeHandles}
                <button
                  className="wb-edit"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setNoteToolbarId((prev) => (prev === node.id ? null : node.id))}
                >
                  ✎
                </button>
                <button
                  className="wb-del"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => dispatch({ type: "wb/deleteNode", id: node.id })}
                >
                  ✕
                </button>
                <div className={`wb-shape-fill wb-node-note wb-shape-${shape}`} style={{ background: node.color }}>
                  <div className="wb-note-inner">
                    <div className="wb-note-handle" onMouseDown={(e) => onNodeMouseDown(e, node)}>
                      ⠿⠿
                    </div>
                    <textarea
                      ref={(el) => {
                        if (el) noteRefs.current.set(node.id, el);
                        else noteRefs.current.delete(node.id);
                      }}
                      className="wb-note-text"
                      value={node.text ?? ""}
                      placeholder="Type here…"
                      style={{
                        fontFamily: node.fontFamily || undefined,
                        fontWeight: node.bold ? 700 : 400,
                        color: node.textColor || undefined,
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onChange={(e) => dispatch({ type: "wb/updateNode", id: node.id, patch: { text: e.target.value } })}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {toolbarNode && (() => {
          const box = getNodeBox(toolbarNode);
          const anchor = canvasToScreen(box.x + box.w / 2, box.y);
          return (
            <div
              className="wb-bubble-popover"
              style={{ left: anchor.x, top: anchor.y - 10, transform: "translate(-50%, -100%)" }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="wb-popover-row">
                {SHAPES.map((s) => (
                  <button
                    key={s}
                    className={`wb-shape-btn${(toolbarNode.shape ?? "rect") === s ? " active" : ""}`}
                    title={s}
                    onClick={() => dispatch({ type: "wb/updateNode", id: toolbarNode.id, patch: { shape: s } })}
                  >
                    {SHAPE_GLYPH[s]}
                  </button>
                ))}
              </div>
              {toolbarNode.kind === "note" ? (
                <>
                  <div className="wb-popover-row">
                    {NOTE_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`wb-color-swatch${toolbarNode.color === c ? " active" : ""}`}
                        style={{ background: c }}
                        onClick={() => dispatch({ type: "wb/updateNode", id: toolbarNode.id, patch: { color: c } })}
                      />
                    ))}
                  </div>
                  <div className="wb-popover-row">
                    <select
                      className="wb-font-select"
                      value={toolbarNode.fontFamily ?? FONT_OPTIONS[0].value}
                      onChange={(e) => dispatch({ type: "wb/updateNode", id: toolbarNode.id, patch: { fontFamily: e.target.value } })}
                    >
                      {FONT_OPTIONS.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                    <button
                      className={`wb-shape-btn${toolbarNode.bold ? " active" : ""}`}
                      title="Bold"
                      style={{ fontWeight: 800 }}
                      onClick={() => dispatch({ type: "wb/updateNode", id: toolbarNode.id, patch: { bold: !toolbarNode.bold } })}
                    >
                      B
                    </button>
                  </div>
                  <div className="wb-popover-row">
                    {TEXT_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`wb-color-swatch wb-color-swatch-text${(toolbarNode.textColor ?? TEXT_COLORS[0]) === c ? " active" : ""}`}
                        style={{ background: c }}
                        title="Text color"
                        onClick={() => dispatch({ type: "wb/updateNode", id: toolbarNode.id, patch: { textColor: c } })}
                      />
                    ))}
                  </div>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      setAttachTarget(toolbarNode.id);
                      setTaskPickerOpen(true);
                    }}
                  >
                    Insert task…
                  </button>
                </>
              ) : toolbarNode.kind === "file" ? (
                <div className="wb-popover-row">
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      setReplaceTarget(toolbarNode.id);
                      replaceFileInputRef.current?.click();
                    }}
                  >
                    Replace file…
                  </button>
                </div>
              ) : toolbarNode.kind === "html" ? (
                <div className="wb-popover-row">
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => setHtmlEditNodeId(toolbarNode.id)}
                  >
                    Edit HTML…
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn-sm"
                  onClick={() =>
                    dispatch({
                      type: "wb/updateNode",
                      id: toolbarNode.id,
                      patch: { kind: "note", storyId: undefined, color: NOTE_COLORS[5], text: "" },
                    })
                  }
                >
                  Remove task
                </button>
              )}
            </div>
          );
        })()}

        {multiSelected.size >= 2 && (() => {
          const boxes = [...multiSelected]
            .map((id) => wb.nodes.find((n) => n.id === id))
            .filter((n): n is WBNode => !!n)
            .map((n) => getNodeBox(n));
          if (boxes.length === 0) return null;
          const x1 = Math.min(...boxes.map((b) => b.x));
          const x2 = Math.max(...boxes.map((b) => b.x + b.w));
          const y1 = Math.min(...boxes.map((b) => b.y));
          const anchor = canvasToScreen((x1 + x2) / 2, y1);
          return (
            <button
              className="wb-group-btn"
              style={{ left: anchor.x, top: anchor.y - 14, transform: "translate(-50%, -100%)" }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                dispatch({ type: "wb/group", nodeIds: [...multiSelected], name: `Group ${wb.groups.length + 1}` });
                setMultiSelected(new Set());
              }}
            >
              Group {multiSelected.size} bubbles
            </button>
          );
        })()}

        <div className="wb-zoom" onMouseDown={(e) => e.stopPropagation()}>
          <button onClick={() => zoomBy(0.83)}>−</button>
          <span onClick={() => setViewport((v) => ({ ...v, scale: 1 }))}>{Math.round(viewport.scale * 100)}%</span>
          <button onClick={() => zoomBy(1.2)}>+</button>
        </div>

        {canEdit && <div className="wb-toolbar" onMouseDown={(e) => e.stopPropagation()}>
          <button
            className={`wb-tool-btn${tool === "select" ? " active" : ""}`}
            title="Select"
            onClick={() => setTool("select")}
          >
            ⇱
          </button>
          <button
            className={`wb-tool-btn${tool === "pan" ? " active" : ""}`}
            title="Pan"
            onClick={() => setTool("pan")}
          >
            ✋
          </button>
          <span className="wb-tool-sep" />
          <button
            className={`wb-tool-btn${tool === "pen" ? " active" : ""}`}
            title="Draw"
            onClick={() => setTool(tool === "pen" ? "select" : "pen")}
          >
            ✎
          </button>
          {tool === "pen" && (
            <span className="wb-pen-colors">
              {PEN_COLORS.map((c) => (
                <button
                  key={c}
                  className={`wb-color-swatch${penColor === c ? " active" : ""}`}
                  style={{ background: c }}
                  onClick={() => setPenColor(c)}
                />
              ))}
            </span>
          )}
          <span className="wb-tool-sep" />
          <div className="wb-note-wrap">
            <button
              className="wb-tool-btn"
              title="Add sticky note"
              onClick={() => setNotePopoverOpen((o) => !o)}
            >
              ▤
            </button>
            {notePopoverOpen && (
              <div className="wb-note-popover">
                <div className="wb-popover-row">
                  {SHAPES.map((s) => (
                    <button
                      key={s}
                      className={`wb-shape-btn${pendingShape === s ? " active" : ""}`}
                      onClick={() => setPendingShape(s)}
                      title={s}
                    >
                      {SHAPE_GLYPH[s]}
                    </button>
                  ))}
                </div>
                <div className="wb-popover-row">
                  {NOTE_COLORS.map((c) => (
                    <button
                      key={c}
                      className="wb-color-swatch"
                      style={{ background: c }}
                      onClick={() => addNote(c, pendingShape)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
          <button className="wb-tool-btn wb-tool-wide" title="Add task card" onClick={() => setTaskPickerOpen(true)}>
            + Task
          </button>
          <button
            className="wb-tool-btn"
            title="Upload a file or photo"
            onClick={() => fileInputRef.current?.click()}
          >
            📎
          </button>
          <button className="wb-tool-btn" title="Insert custom HTML" onClick={addHtmlNode}>
            {"</>"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.txt,.zip,.csv,.xlsx"
            style={{ display: "none" }}
            onChange={(e) => {
              handleFilePick(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={replaceFileInputRef}
            type="file"
            style={{ display: "none" }}
            onChange={async (e) => {
              const files = e.target.files;
              if (files && files.length && replaceTarget) {
                const [att] = await filesToAttachments(files, uid);
                if (att) dispatch({ type: "wb/updateNode", id: replaceTarget, patch: { attachment: att } });
              }
              setReplaceTarget(null);
              e.target.value = "";
            }}
          />
          {wb.strokes.length > 0 && (
            <button
              className="wb-tool-btn"
              title="Clear all drawings"
              onClick={() => {
                if (confirm("Clear all pen drawings from this whiteboard?")) dispatch({ type: "wb/clearDrawings" });
              }}
            >
              🗑
            </button>
          )}
        </div>}
      </div>

      {taskPickerOpen && (
        <TaskPickerModal
          title={attachTarget ? "Insert a task into this bubble" : "Add a task to the whiteboard"}
          stories={project.stories}
          usedStoryIds={usedStoryIds}
          onPick={pickTask}
          onClose={closeTaskPicker}
        />
      )}
      {editingStory && <StoryModal story={editingStory} onClose={() => setEditingStory(null)} />}
      {(() => {
        const htmlEditNode = htmlEditNodeId ? wb.nodes.find((n) => n.id === htmlEditNodeId) ?? null : null;
        if (!htmlEditNode) return null;
        return (
          <HtmlEditModal
            initialHtml={htmlEditNode.html ?? ""}
            onSave={(html) => dispatch({ type: "wb/updateNode", id: htmlEditNode.id, patch: { html } })}
            onClose={() => setHtmlEditNodeId(null)}
          />
        );
      })()}
      </>
      )}
    </>
  );
}

function TaskPickerModal({
  title,
  stories,
  usedStoryIds,
  onPick,
  onClose,
}: {
  title: string;
  stories: Story[];
  usedStoryIds: Set<ID | undefined>;
  onPick: (story: Story) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = stories.filter(
    (s) => !query.trim() || s.title.toLowerCase().includes(query.toLowerCase()) || s.key.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <Modal title={title} onClose={onClose} narrow>
      <div className="form-field">
        <input autoFocus placeholder="Search tasks…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="wb-picker-list">
        {filtered.length === 0 && <p style={{ color: "var(--text-dim)" }}>No matching tasks.</p>}
        {filtered.map((s) => {
          const used = usedStoryIds.has(s.id);
          return (
            <button
              key={s.id}
              className="wb-picker-row"
              disabled={used}
              onClick={() => onPick(s)}
              title={used ? "Already on the whiteboard" : "Add to whiteboard"}
            >
              <TypeIcon type={s.type} />
              <span className="wb-picker-key">{s.key}</span>
              <span className="wb-picker-title">{s.title}</span>
              {used && <span className="wb-picker-used">Added</span>}
            </button>
          );
        })}
      </div>
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

function HtmlBoardView({
  board,
  readOnly,
  onSave,
}: {
  board: Whiteboard;
  readOnly: boolean;
  onSave: (html: string) => void;
}) {
  const [html, setHtml] = useState(board.html ?? "");
  const [dirty, setDirty] = useState(false);
  const [editorVisible, setEditorVisible] = useState(true);

  function commit() {
    if (!dirty) return;
    onSave(html);
    setDirty(false);
  }

  return (
    <div className="wb-html-board">
      <div className="wb-html-board-bar">
        <span className="wb-html-board-label">HTML</span>
        {!readOnly && <div className="wb-html-board-bar-actions">
          <button className="btn btn-sm" onClick={() => setEditorVisible((v) => !v)}>
            {editorVisible ? "Hide editor" : "Show editor"}
          </button>
          <button className="btn btn-sm btn-primary" disabled={!dirty} onClick={commit}>
            {dirty ? "Save changes" : "Saved"}
          </button>
        </div>}
      </div>
      <div className="wb-html-board-body">
        {!readOnly && editorVisible && (
          <textarea
            autoFocus
            className="wb-html-board-textarea"
            value={html}
            spellCheck={false}
            placeholder={'<html>\n  <body style="font-family:sans-serif">\n    Anything goes here — full pages, embeds, scripts…\n  </body>\n</html>'}
            onChange={(e) => {
              setHtml(e.target.value);
              setDirty(true);
            }}
            onBlur={commit}
          />
        )}
        <iframe className="wb-html-board-frame" srcDoc={html} sandbox="allow-scripts" title={`Board ${board.name}`} />
      </div>
    </div>
  );
}

function HtmlEditModal({
  initialHtml,
  onSave,
  onClose,
}: {
  initialHtml: string;
  onSave: (html: string) => void;
  onClose: () => void;
}) {
  const [html, setHtml] = useState(initialHtml);

  return (
    <Modal title="Edit HTML block" onClose={onClose}>
      <div className="form-field">
        <label>HTML</label>
        <textarea
          autoFocus
          className="wb-html-editor"
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          placeholder={'<div style="padding:12px;font-family:sans-serif">Hello!</div>'}
          spellCheck={false}
        />
      </div>
      <p className="wb-html-hint">
        Renders inside a sandboxed frame — scripts can run, but can't reach the rest of this app, your other tabs, or your data.
      </p>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-primary"
          onClick={() => {
            onSave(html);
            onClose();
          }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
