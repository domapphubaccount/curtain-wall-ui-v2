export type ID = string;

export type StoryStatus = "backlog" | "todo" | "inprogress" | "review" | "done";
export type StoryType = "story" | "bug" | "task" | "spike";
export type Priority = "critical" | "high" | "medium" | "low";
export type SprintState = "planned" | "active" | "completed";

export interface Epic {
  id: ID;
  name: string;
  color: string;
}

export interface Member {
  id: ID;
  /** Global database user represented by this project membership. */
  userId: ID;
  name: string;
  role: string;
  email: string;
  color: string;
  /** ISO timestamp of the last invite email composed for this member, or null if never invited. */
  invitedAt: string | null;
}

export type SystemRole = "ADMIN" | "USER";

export interface AuthUser {
  id: ID;
  email: string;
  name: string;
  jobTitle: string;
  color: string;
  role: SystemRole;
}

export interface SystemUser extends AuthUser {
  active: boolean;
}

export interface Attachment {
  id: ID;
  name: string;
  mimeType: string;
  size: number; // bytes
  dataUrl: string; // base64 data: URL
  uploadedAt: string; // ISO date
}

export interface TimeEntry {
  id: ID;
  /** The assignee at the time this session was logged. */
  memberId: ID | null;
  startedAt: string; // ISO timestamp
  /** null while the timer is still running */
  endedAt: string | null;
}

export interface Story {
  id: ID;
  key: string;
  title: string;
  description: string;
  type: StoryType;
  status: StoryStatus;
  priority: Priority;
  points: number | null;
  epicId: ID | null;
  assigneeId: ID | null;
  sprintId: ID | null;
  acceptanceCriteria: string[];
  createdAt: string; // ISO date
  completedAt: string | null; // ISO date, set when moved to done
  startDate: string | null; // yyyy-mm-dd, for the Gantt chart
  dueDate: string | null; // yyyy-mm-dd, for the Gantt chart
  /** IDs of stories that must happen before this one — drawn as dependency arrows on the Gantt chart. */
  dependsOn: ID[];
  attachments: Attachment[];
  /** Start/stop timer sessions logged against this task, oldest first. */
  timeEntries: TimeEntry[];
}

export interface Sprint {
  id: ID;
  name: string;
  goal: string;
  startDate: string; // yyyy-mm-dd
  endDate: string; // yyyy-mm-dd
  state: SprintState;
  /** Snapshot of points completed, taken when the sprint is completed. */
  velocity: number | null;
  /** Snapshot of points committed, taken when the sprint is started. */
  committedPoints: number | null;
}

export type WBNodeKind = "task" | "note" | "file" | "html";
export type WBShape = "rect" | "round" | "diamond" | "circle";

export interface WBNode {
  id: ID;
  kind: WBNodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** note-only */
  text?: string;
  color?: string;
  shape?: WBShape;
  fontFamily?: string;
  bold?: boolean;
  textColor?: string;
  /** task-only: references a Story in the same project */
  storyId?: ID;
  /** file-only: an uploaded image or document */
  attachment?: Attachment;
  /** html-only: raw markup rendered inside a sandboxed iframe */
  html?: string;
  /** references a WBGroup this bubble belongs to, if grouped */
  groupId?: ID;
}

export interface WBGroup {
  id: ID;
  name: string;
}

export interface WBEdge {
  id: ID;
  from: ID;
  to: ID;
  color?: string;
  /** Manual override for the free bend coordinate (midX or midY, whichever applies); unset means auto-routed. */
  bend?: number;
}

export interface WBStroke {
  id: ID;
  color: string;
  /** flat [x0, y0, x1, y1, ...] in canvas space */
  points: number[];
}

/** "canvas" is the default drag-and-drop bubble board; "html" is a single full-size custom HTML surface. */
export type WhiteboardKind = "canvas" | "html";

export interface Whiteboard {
  id: ID;
  name: string;
  /** Defaults to "canvas" when absent, for boards saved before this field existed. */
  kind?: WhiteboardKind;
  /** html-board-only: raw markup rendered full-size inside a sandboxed iframe */
  html?: string;
  nodes: WBNode[];
  edges: WBEdge[];
  strokes: WBStroke[];
  groups: WBGroup[];
}

export interface Project {
  id: ID;
  name: string;
  key: string;
  /** Server-side optimistic-lock version used to prevent stale snapshots overwriting newer work. */
  revision: number;
  stories: Story[];
  epics: Epic[];
  sprints: Sprint[];
  members: Member[];
  /** A project can have several whiteboards (e.g. one per initiative); each belongs to exactly this project. */
  whiteboards: Whiteboard[];
  /** Which of this project's whiteboards is currently open. */
  activeWhiteboardId: ID;
  /** The project's shared file library — uploaded once, then attachable to any task. */
  files: Attachment[];
  /** Auto-increment counter for issue keys (e.g. NOVA-17). */
  seq: number;
}

export interface AppState {
  projects: Project[];
  currentProjectId: ID;
}

export const STATUS_LABELS: Record<StoryStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  inprogress: "In Progress",
  review: "In Review",
  done: "Done",
};

export const BOARD_COLUMNS: StoryStatus[] = ["todo", "inprogress", "review", "done"];

export const TYPE_LABELS: Record<StoryType, string> = {
  story: "Story",
  bug: "Bug",
  task: "Task",
  spike: "Spike",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const POINT_SCALE = [1, 2, 3, 5, 8, 13, 21] as const;

export const NOTE_COLORS = ["#fef3c7", "#d1fae5", "#dbeafe", "#fce7f3", "#ede9fe", "#f4f4f6"];

export const PEN_COLORS = ["#e8e8ee", "#f26d6d", "#f5a623", "#3ecf8e", "#4f9cf9", "#c084fc"];

export const TEXT_COLORS = ["#1c1c22", "#ffffff", "#dc2626", "#2563eb", "#16a34a", "#9333ea"];

export const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: "Sans", value: "'Segoe UI', sans-serif" },
  { label: "Serif", value: "Georgia, serif" },
  { label: "Mono", value: "'Courier New', monospace" },
  { label: "Casual", value: "'Comic Sans MS', cursive" },
  { label: "Trebuchet", value: "'Trebuchet MS', sans-serif" },
];

export function emptyWhiteboard(id: ID, name = "Main", kind: WhiteboardKind = "canvas"): Whiteboard {
  return { id, name, kind, html: "", nodes: [], edges: [], strokes: [], groups: [] };
}
