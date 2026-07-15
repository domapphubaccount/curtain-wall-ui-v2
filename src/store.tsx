import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useReducer } from "react";
import type { ReactNode } from "react";
import type { AppState, Attachment, Epic, ID, Member, Project, Sprint, Story, StoryStatus, WBEdge, WBGroup, WBNode, Whiteboard, WhiteboardKind } from "./types";
import { emptyWhiteboard } from "./types";
import { createSeedState, MEMBER_COLORS } from "./data";
import { apiCreateProject, apiDeleteProject, apiGetProject, apiSyncProject, isApiConfigured } from "./api";

const STORAGE_KEY = "sprintforge-state-v2";
const LEGACY_KEY = "sprintforge-state-v1";

export type Action =
  | { type: "story/add"; story: Omit<Story, "id" | "key" | "createdAt" | "completedAt"> }
  | { type: "story/update"; id: ID; patch: Partial<Story> }
  | { type: "story/delete"; id: ID }
  | { type: "story/move"; id: ID; status: StoryStatus }
  | { type: "story/assignSprint"; id: ID; sprintId: ID | null }
  | { type: "story/timerStart"; id: ID }
  | { type: "story/timerStop"; id: ID }
  | { type: "identity/setCurrentMember"; id: ID | null }
  | { type: "sprint/add"; name: string; goal: string; startDate: string; endDate: string }
  | { type: "sprint/update"; id: ID; patch: Partial<Sprint> }
  | { type: "sprint/start"; id: ID }
  | { type: "sprint/complete"; id: ID; moveIncompleteTo: ID | null }
  | { type: "sprint/delete"; id: ID }
  | { type: "epic/add"; name: string; color: string }
  | { type: "member/add"; name: string; role: string; email: string }
  | { type: "member/update"; id: ID; patch: Partial<Member> }
  | { type: "member/remove"; id: ID }
  | { type: "member/invite"; id: ID }
  | { type: "project/add"; name: string; key: string; members: Member[] }
  | { type: "project/update"; patch: { name?: string; key?: string; members?: Member[] } }
  | { type: "project/delete"; id: ID }
  | { type: "project/switch"; id: ID }
  | { type: "wb/addNode"; node: WBNode }
  | { type: "wb/updateNode"; id: ID; patch: Partial<WBNode> }
  | { type: "wb/deleteNode"; id: ID }
  | { type: "wb/addEdge"; from: ID; to: ID }
  | { type: "wb/updateEdge"; id: ID; patch: Partial<WBEdge> }
  | { type: "wb/deleteEdge"; id: ID }
  | { type: "wb/addStroke"; color: string; points: number[] }
  | { type: "wb/deleteStroke"; id: ID }
  | { type: "wb/clearDrawings" }
  | { type: "wb/group"; nodeIds: ID[]; name: string }
  | { type: "wb/ungroup"; id: ID }
  | { type: "wb/updateGroup"; id: ID; patch: Partial<WBGroup> }
  | { type: "wb/createBoard"; name: string; kind?: WhiteboardKind }
  | { type: "wb/renameBoard"; id: ID; name: string }
  | { type: "wb/deleteBoard"; id: ID }
  | { type: "wb/setActiveBoard"; id: ID }
  | { type: "wb/updateBoardHtml"; id: ID; html: string }
  | { type: "file/add"; files: Attachment[] }
  | { type: "file/delete"; id: ID }
  | { type: "state/reset" }
  | { type: "project/hydrate"; project: Project };

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Apply an update to the currently selected project. */
function withProject(state: AppState, fn: (p: Project) => Project): AppState {
  return {
    ...state,
    projects: state.projects.map((p) => (p.id === state.currentProjectId ? fn(p) : p)),
  };
}

/** Apply an update to the currently open whiteboard within the currently selected project. */
function withActiveBoard(state: AppState, fn: (b: Whiteboard) => Whiteboard): AppState {
  return withProject(state, (p) => ({
    ...p,
    whiteboards: p.whiteboards.map((b) => (b.id === p.activeWhiteboardId ? fn(b) : b)),
  }));
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "story/add":
      return withProject(state, (p) => {
        const story: Story = {
          ...action.story,
          id: uid(),
          key: `${p.key}-${p.seq}`,
          createdAt: new Date().toISOString(),
          completedAt: action.story.status === "done" ? new Date().toISOString() : null,
        };
        return { ...p, stories: [...p.stories, story], seq: p.seq + 1 };
      });
    case "story/update":
      return withProject(state, (p) => ({
        ...p,
        stories: p.stories.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s)),
      }));
    case "story/delete":
      return withProject(state, (p) => ({
        ...p,
        stories: p.stories
          .filter((s) => s.id !== action.id)
          .map((s) => (s.dependsOn.includes(action.id) ? { ...s, dependsOn: s.dependsOn.filter((id) => id !== action.id) } : s)),
      }));
    case "story/move":
      return withProject(state, (p) => ({
        ...p,
        stories: p.stories.map((s) => {
          if (s.id !== action.id) return s;
          return {
            ...s,
            status: action.status,
            completedAt:
              action.status === "done"
                ? s.completedAt ?? new Date().toISOString()
                : null,
          };
        }),
      }));
    case "story/assignSprint":
      return withProject(state, (p) => ({
        ...p,
        stories: p.stories.map((s) => {
          if (s.id !== action.id) return s;
          // Moving into a sprint puts backlog items on the board; moving out resets to backlog.
          let status = s.status;
          if (action.sprintId === null) status = "backlog";
          else if (s.status === "backlog") status = "todo";
          return { ...s, sprintId: action.sprintId, status, completedAt: status === "done" ? s.completedAt : null };
        }),
      }));
    case "story/timerStart":
      return withProject(state, (p) => ({
        ...p,
        stories: p.stories.map((s) => {
          if (s.id !== action.id || s.timeEntries.some((e) => e.endedAt === null)) return s;
          return {
            ...s,
            timeEntries: [
              ...s.timeEntries,
              { id: uid(), memberId: s.assigneeId, startedAt: new Date().toISOString(), endedAt: null },
            ],
          };
        }),
      }));
    case "story/timerStop":
      return withProject(state, (p) => ({
        ...p,
        stories: p.stories.map((s) => {
          if (s.id !== action.id) return s;
          return {
            ...s,
            timeEntries: s.timeEntries.map((e) =>
              e.endedAt === null ? { ...e, endedAt: new Date().toISOString() } : e
            ),
          };
        }),
      }));
    case "identity/setCurrentMember":
      return { ...state, currentMemberId: action.id };
    case "sprint/add":
      return withProject(state, (p) => ({
        ...p,
        sprints: [
          ...p.sprints,
          {
            id: uid(),
            name: action.name,
            goal: action.goal,
            startDate: action.startDate,
            endDate: action.endDate,
            state: "planned",
            velocity: null,
            committedPoints: null,
          },
        ],
      }));
    case "sprint/update":
      return withProject(state, (p) => ({
        ...p,
        sprints: p.sprints.map((sp) => (sp.id === action.id ? { ...sp, ...action.patch } : sp)),
      }));
    case "sprint/start":
      return withProject(state, (p) => {
        if (p.sprints.some((sp) => sp.state === "active")) return p;
        const committed = p.stories
          .filter((s) => s.sprintId === action.id)
          .reduce((sum, s) => sum + (s.points ?? 0), 0);
        return {
          ...p,
          sprints: p.sprints.map((sp) =>
            sp.id === action.id
              ? { ...sp, state: "active", committedPoints: committed, startDate: sp.startDate < today() ? today() : sp.startDate }
              : sp
          ),
        };
      });
    case "sprint/complete":
      return withProject(state, (p) => {
        const velocity = p.stories
          .filter((s) => s.sprintId === action.id && s.status === "done")
          .reduce((sum, s) => sum + (s.points ?? 0), 0);
        return {
          ...p,
          sprints: p.sprints.map((sp) =>
            sp.id === action.id ? { ...sp, state: "completed", velocity, endDate: today() < sp.endDate ? today() : sp.endDate } : sp
          ),
          stories: p.stories.map((s) => {
            if (s.sprintId !== action.id || s.status === "done") return s;
            // Incomplete work rolls to the chosen sprint, or back to the product backlog.
            return {
              ...s,
              sprintId: action.moveIncompleteTo,
              status: action.moveIncompleteTo ? s.status : "backlog",
            };
          }),
        };
      });
    case "sprint/delete":
      return withProject(state, (p) => ({
        ...p,
        sprints: p.sprints.filter((sp) => sp.id !== action.id),
        stories: p.stories.map((s) =>
          s.sprintId === action.id ? { ...s, sprintId: null, status: "backlog" } : s
        ),
      }));
    case "epic/add":
      return withProject(state, (p) => ({
        ...p,
        epics: [...p.epics, { id: uid(), name: action.name, color: action.color } as Epic],
      }));
    case "member/add":
      return withProject(state, (p) => ({
        ...p,
        members: [
          ...p.members,
          {
            id: uid(),
            name: action.name,
            role: action.role || "Team member",
            email: action.email,
            color: MEMBER_COLORS[p.members.length % MEMBER_COLORS.length],
            invitedAt: null,
          },
        ],
      }));
    case "member/update":
      return withProject(state, (p) => ({
        ...p,
        members: p.members.map((m) => (m.id === action.id ? { ...m, ...action.patch } : m)),
      }));
    case "member/remove":
      return withProject(state, (p) => ({
        ...p,
        members: p.members.filter((m) => m.id !== action.id),
        stories: p.stories.map((s) => (s.assigneeId === action.id ? { ...s, assigneeId: null } : s)),
      }));
    case "member/invite":
      return withProject(state, (p) => ({
        ...p,
        members: p.members.map((m) => (m.id === action.id ? { ...m, invitedAt: new Date().toISOString() } : m)),
      }));
    case "project/add": {
      const board = emptyWhiteboard(uid(), "Main");
      const project: Project = {
        id: uid(),
        name: action.name,
        key: action.key,
        stories: [],
        epics: [],
        sprints: [],
        members: action.members,
        whiteboards: [board],
        activeWhiteboardId: board.id,
        files: [],
        seq: 1,
      };
      return {
        ...state,
        projects: [...state.projects, project],
        currentProjectId: project.id,
      };
    }
    case "project/update":
      return withProject(state, (p) => {
        const next = { ...p, ...action.patch };
        if (action.patch.members) {
          // Unassign stories whose owner was removed from the team.
          const ids = new Set(action.patch.members.map((m) => m.id));
          next.stories = p.stories.map((s) =>
            s.assigneeId && !ids.has(s.assigneeId) ? { ...s, assigneeId: null } : s
          );
        }
        return next;
      });
    case "project/delete": {
      if (state.projects.length <= 1) return state;
      const projects = state.projects.filter((p) => p.id !== action.id);
      return {
        ...state,
        projects,
        currentProjectId:
          state.currentProjectId === action.id ? projects[0].id : state.currentProjectId,
      };
    }
    case "project/switch":
      return state.projects.some((p) => p.id === action.id)
        ? { ...state, currentProjectId: action.id }
        : state;
    case "wb/addNode":
      return withActiveBoard(state, (b) => ({ ...b, nodes: [...b.nodes, action.node] }));
    case "wb/updateNode":
      return withActiveBoard(state, (b) => ({
        ...b,
        nodes: b.nodes.map((n) => (n.id === action.id ? { ...n, ...action.patch } : n)),
      }));
    case "wb/deleteNode":
      return withActiveBoard(state, (b) => {
        const remaining = b.nodes.filter((n) => n.id !== action.id);
        // A group with fewer than 2 surviving members no longer makes sense — dissolve it.
        const memberCounts = new Map<ID, number>();
        for (const n of remaining) if (n.groupId) memberCounts.set(n.groupId, (memberCounts.get(n.groupId) ?? 0) + 1);
        const groups = b.groups.filter((g) => (memberCounts.get(g.id) ?? 0) >= 2);
        const liveGroupIds = new Set(groups.map((g) => g.id));
        const nodes = remaining.map((n) => (n.groupId && !liveGroupIds.has(n.groupId) ? { ...n, groupId: undefined } : n));
        return { ...b, nodes, groups, edges: b.edges.filter((e) => e.from !== action.id && e.to !== action.id) };
      });
    case "wb/addEdge":
      return withActiveBoard(state, (b) => {
        if (action.from === action.to) return b;
        const exists = b.edges.some(
          (e) =>
            (e.from === action.from && e.to === action.to) ||
            (e.from === action.to && e.to === action.from)
        );
        if (exists) return b;
        return { ...b, edges: [...b.edges, { id: uid(), from: action.from, to: action.to }] };
      });
    case "wb/updateEdge":
      return withActiveBoard(state, (b) => ({
        ...b,
        edges: b.edges.map((e) => (e.id === action.id ? { ...e, ...action.patch } : e)),
      }));
    case "wb/deleteEdge":
      return withActiveBoard(state, (b) => ({ ...b, edges: b.edges.filter((e) => e.id !== action.id) }));
    case "wb/addStroke":
      return withActiveBoard(state, (b) => ({
        ...b,
        strokes: [...b.strokes, { id: uid(), color: action.color, points: action.points }],
      }));
    case "wb/deleteStroke":
      return withActiveBoard(state, (b) => ({ ...b, strokes: b.strokes.filter((s) => s.id !== action.id) }));
    case "wb/clearDrawings":
      return withActiveBoard(state, (b) => ({ ...b, strokes: [] }));
    case "wb/group":
      return withActiveBoard(state, (b) => {
        if (action.nodeIds.length < 2) return b;
        const groupId = uid();
        const idSet = new Set(action.nodeIds);
        return {
          ...b,
          groups: [...b.groups, { id: groupId, name: action.name }],
          nodes: b.nodes.map((n) => (idSet.has(n.id) ? { ...n, groupId } : n)),
        };
      });
    case "wb/ungroup":
      return withActiveBoard(state, (b) => ({
        ...b,
        groups: b.groups.filter((g) => g.id !== action.id),
        nodes: b.nodes.map((n) => (n.groupId === action.id ? { ...n, groupId: undefined } : n)),
      }));
    case "wb/updateGroup":
      return withActiveBoard(state, (b) => ({
        ...b,
        groups: b.groups.map((g) => (g.id === action.id ? { ...g, ...action.patch } : g)),
      }));
    case "wb/createBoard":
      return withProject(state, (p) => {
        const board = emptyWhiteboard(uid(), action.name, action.kind ?? "canvas");
        return { ...p, whiteboards: [...p.whiteboards, board], activeWhiteboardId: board.id };
      });
    case "wb/renameBoard":
      return withProject(state, (p) => ({
        ...p,
        whiteboards: p.whiteboards.map((b) => (b.id === action.id ? { ...b, name: action.name } : b)),
      }));
    case "wb/deleteBoard":
      return withProject(state, (p) => {
        if (p.whiteboards.length <= 1) return p;
        const whiteboards = p.whiteboards.filter((b) => b.id !== action.id);
        const activeWhiteboardId =
          p.activeWhiteboardId === action.id ? whiteboards[0].id : p.activeWhiteboardId;
        return { ...p, whiteboards, activeWhiteboardId };
      });
    case "wb/setActiveBoard":
      return withProject(state, (p) =>
        p.whiteboards.some((b) => b.id === action.id) ? { ...p, activeWhiteboardId: action.id } : p
      );
    case "wb/updateBoardHtml":
      return withProject(state, (p) => ({
        ...p,
        whiteboards: p.whiteboards.map((b) => (b.id === action.id ? { ...b, html: action.html } : b)),
      }));
    case "file/add":
      return withProject(state, (p) => ({ ...p, files: [...p.files, ...action.files] }));
    case "file/delete":
      return withProject(state, (p) => ({ ...p, files: p.files.filter((f) => f.id !== action.id) }));
    case "state/reset":
      return createSeedState();
    case "project/hydrate":
      return {
        ...state,
        projects: state.projects.map((p) => (p.id === action.project.id ? action.project : p)),
      };
    default:
      return state;
  }
}

interface LegacyState {
  projectName: string;
  projectKey: string;
  stories: Story[];
  epics: Epic[];
  sprints: Sprint[];
  members: Member[];
  seq: number;
}

/** Backfills fields added after a save was written, so older localStorage data keeps working. */
function withDefaults(state: AppState): AppState {
  return {
    ...state,
    currentMemberId: state.currentMemberId ?? null,
    projects: state.projects.map((p) => {
      // Pre-multi-board saves had a single `whiteboard` object instead of a `whiteboards` array.
      const legacyBoard = (p as unknown as { whiteboard?: Whiteboard }).whiteboard;
      const whiteboards = (
        p.whiteboards && p.whiteboards.length > 0
          ? p.whiteboards
          : [legacyBoard ? { ...legacyBoard, id: legacyBoard.id ?? uid(), name: legacyBoard.name ?? "Main" } : emptyWhiteboard(uid(), "Main")]
      ).map((b) => ({ ...b, groups: b.groups ?? [], kind: b.kind ?? "canvas", html: b.html ?? "" }));
      const activeWhiteboardId = whiteboards.some((b) => b.id === p.activeWhiteboardId)
        ? p.activeWhiteboardId
        : whiteboards[0].id;
      return {
        ...p,
        whiteboards,
        activeWhiteboardId,
        files: p.files ?? [],
        stories: p.stories.map((s) => ({
          ...s,
          startDate: s.startDate ?? null,
          dueDate: s.dueDate ?? null,
          dependsOn: s.dependsOn ?? [],
          attachments: s.attachments ?? [],
          timeEntries: s.timeEntries ?? [],
        })),
        members: p.members.map((m) => ({
          ...m,
          email: m.email ?? "",
          invitedAt: m.invitedAt ?? null,
        })),
      };
    }),
  };
}

function loadInitialState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return withDefaults(JSON.parse(raw) as AppState);
    // Migrate a single-project v1 save into the multi-project shape.
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as LegacyState;
      const board = emptyWhiteboard(uid(), "Main");
      const project: Project = {
        id: uid(),
        name: legacy.projectName,
        key: legacy.projectKey,
        stories: legacy.stories,
        epics: legacy.epics,
        sprints: legacy.sprints,
        members: legacy.members,
        whiteboards: [board],
        activeWhiteboardId: board.id,
        files: [],
        seq: legacy.seq,
      };
      localStorage.removeItem(LEGACY_KEY);
      return withDefaults({ projects: [project], currentProjectId: project.id, currentMemberId: null });
    }
  } catch {
    // Corrupt storage — fall through to seed data.
  }
  return createSeedState();
}

interface StoreValue {
  state: AppState;
  /** The currently selected project. */
  project: Project;
  dispatch: React.Dispatch<Action>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootstrappedRef = useRef(new Set<ID>());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Wrap dispatch so a project deletion also removes it on the server (fire-and-forget).
  const apiDispatch = useCallback((action: Action) => {
    if (action.type === "project/delete" && isApiConfigured()) {
      apiDeleteProject(action.id);
    }
    dispatch(action);
  }, []);

  // Debounced push of the current project to the backend, when one is configured and reachable.
  // Silently does nothing if VITE_API_URL isn't set or the server can't be reached — the app
  // keeps working purely off localStorage either way.
  useEffect(() => {
    if (!isApiConfigured()) return;
    const project = state.projects.find((p) => p.id === state.currentProjectId);
    if (!project) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      apiSyncProject(project);
    }, 600);
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [state]);

  // Once per project: pull the server's copy if it already exists there, otherwise create it
  // remotely from what we have locally so future edits have somewhere to sync to.
  useEffect(() => {
    if (!isApiConfigured()) return;
    const project = state.projects.find((p) => p.id === state.currentProjectId);
    if (!project || bootstrappedRef.current.has(project.id)) return;
    bootstrappedRef.current.add(project.id);
    (async () => {
      const remote = await apiGetProject(project.id);
      if (remote) {
        dispatch({ type: "project/hydrate", project: remote });
      } else {
        const created = await apiCreateProject(project);
        if (created) apiSyncProject(project);
      }
    })();
  }, [state.currentProjectId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps

  const value = useMemo(() => {
    const project =
      state.projects.find((p) => p.id === state.currentProjectId) ?? state.projects[0];
    return { state, project, dispatch: apiDispatch };
  }, [state, apiDispatch]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

// ---- Derived helpers ----

export function activeSprint(project: Project): Sprint | undefined {
  return project.sprints.find((sp) => sp.state === "active");
}

export function sprintStories(project: Project, sprintId: ID): Story[] {
  return project.stories.filter((s) => s.sprintId === sprintId);
}

export function backlogStories(project: Project): Story[] {
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return project.stories
    .filter((s) => s.sprintId === null)
    .sort((a, b) => order[a.priority] - order[b.priority]);
}

export function storyPoints(stories: Story[]): number {
  return stories.reduce((sum, s) => sum + (s.points ?? 0), 0);
}
