import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useReducer, useState } from "react";
import type { ReactNode } from "react";
import type { AppState, Attachment, Epic, ID, Member, Project, Sprint, Story, StoryStatus, WBEdge, WBGroup, WBNode, Whiteboard, WhiteboardKind } from "./types";
import { emptyWhiteboard } from "./types";
import { createSeedState } from "./data";
import { apiCreateProject, apiDeleteProject, apiGetProject, apiListProjects, apiSyncProject } from "./api";
import { useAuth } from "./auth";

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
  | { type: "sprint/add"; name: string; goal: string; startDate: string; endDate: string }
  | { type: "sprint/update"; id: ID; patch: Partial<Sprint> }
  | { type: "sprint/start"; id: ID }
  | { type: "sprint/complete"; id: ID; moveIncompleteTo: ID | null }
  | { type: "sprint/delete"; id: ID }
  | { type: "epic/add"; name: string; color: string }
  | { type: "member/add"; member: Member }
  | { type: "member/update"; id: ID; patch: Partial<Member> }
  | { type: "member/remove"; id: ID }
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
  | { type: "project/hydrate"; project: Project }
  | { type: "projects/hydrateAll"; projects: Project[] };

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
        members: [...p.members, action.member],
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
    case "project/add": {
      const board = emptyWhiteboard(uid(), "Main");
      const project: Project = {
        id: uid(),
        name: action.name,
        key: action.key,
        revision: 1,
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
        projects: state.projects.map((p) => (p.id === action.project.id ? withProjectDefaults(action.project) : p)),
      };
    case "projects/hydrateAll": {
      const projects = action.projects.map(withProjectDefaults);
      return {
        ...state,
        projects,
        currentProjectId: projects.some((project) => project.id === state.currentProjectId)
          ? state.currentProjectId
          : projects[0]?.id ?? "",
      };
    }
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

function withProjectDefaults(p: Project): Project {
  const legacyBoard = (p as unknown as { whiteboard?: Whiteboard }).whiteboard;
  const whiteboards = (
    p.whiteboards && p.whiteboards.length > 0
      ? p.whiteboards
      : [legacyBoard ? { ...legacyBoard, id: legacyBoard.id ?? uid(), name: legacyBoard.name ?? "Main" } : emptyWhiteboard(uid(), "Main")]
  ).map((board) => ({ ...board, groups: board.groups ?? [], kind: board.kind ?? "canvas", html: board.html ?? "" }));
  const activeWhiteboardId = whiteboards.some((board) => board.id === p.activeWhiteboardId)
    ? p.activeWhiteboardId
    : whiteboards[0].id;
  return {
    ...p,
    revision: p.revision ?? 1,
    whiteboards,
    activeWhiteboardId,
    files: p.files ?? [],
    stories: p.stories.map((story) => ({
      ...story,
      startDate: story.startDate ?? null,
      dueDate: story.dueDate ?? null,
      dependsOn: story.dependsOn ?? [],
      attachments: story.attachments ?? [],
      timeEntries: story.timeEntries ?? [],
    })),
    members: p.members.map((member) => ({
      ...member,
      userId: member.userId ?? "",
      email: member.email ?? "",
      invitedAt: member.invitedAt ?? null,
    })),
  };
}

/** Backfills fields added after a save was written, so older localStorage data keeps working. */
function withDefaults(state: AppState): AppState {
  return {
    ...state,
    projects: state.projects.map(withProjectDefaults),
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
        revision: 1,
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
      return withDefaults({ projects: [project], currentProjectId: project.id });
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
  ready: boolean;
  error: string | null;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteProjectIdsRef = useRef(new Set<ID>());
  const remoteRevisionsRef = useRef(new Map<ID, number>());
  const syncQueuesRef = useRef(new Map<ID, Promise<void>>());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    let active = true;
    apiListProjects()
      .then((projects) => {
        if (!active) return;
        remoteProjectIdsRef.current = new Set(projects.map((project) => project.id));
        remoteRevisionsRef.current = new Map(projects.map((project) => [project.id, project.revision]));
        dispatch({ type: "projects/hydrateAll", projects });
        setError(null);
      })
      .catch((requestError: Error) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => { active = false; };
  }, []);

  const apiDispatch = useCallback((action: Action) => {
    const currentProject = state.projects.find((project) => project.id === state.currentProjectId);
    const isAdmin = user?.role === "ADMIN";
    const storyAction = action.type.startsWith("story/");
    const storyId = storyAction && "id" in action ? action.id : null;
    const story = storyId ? currentProject?.stories.find((item) => item.id === storyId) : undefined;
    const assignee = story?.assigneeId
      ? currentProject?.members.find((member) => member.id === story.assigneeId)
      : undefined;
    const assignedToCurrentUser = !!user && assignee?.userId === user.id;
    const userEditableStoryAction = ["story/update", "story/move", "story/assignSprint", "story/timerStart", "story/timerStop"].includes(action.type);
    const triesToReassign = action.type === "story/update" && action.patch.assigneeId !== undefined && action.patch.assigneeId !== story?.assigneeId;
    const allowed = isAdmin || action.type === "project/switch" || action.type === "wb/setActiveBoard" || (assignedToCurrentUser && userEditableStoryAction && !triesToReassign);
    if (!allowed) return;

    if (action.type === "project/delete") {
      apiDeleteProject(action.id).catch((requestError: Error) => setError(requestError.message));
      remoteProjectIdsRef.current.delete(action.id);
    }
    dispatch(action);
  }, [state, user]);

  useEffect(() => {
    if (!ready) return;
    const project = state.projects.find((p) => p.id === state.currentProjectId);
    if (!project || !remoteProjectIdsRef.current.has(project.id)) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      const previous = syncQueuesRef.current.get(project.id) ?? Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(async () => {
          const revision = remoteRevisionsRef.current.get(project.id) ?? project.revision;
          const updated = await apiSyncProject(project, revision);
          remoteRevisionsRef.current.set(project.id, updated.revision);
          setError(null);
        })
        .catch(async (requestError: Error) => {
          setError(requestError.message);
          try {
            const authoritative = await apiGetProject(project.id);
            remoteRevisionsRef.current.set(project.id, authoritative.revision);
            dispatch({ type: "project/hydrate", project: authoritative });
          } catch {
            // Keep the visible error from the original failed mutation.
          }
        });
      syncQueuesRef.current.set(project.id, next);
      void next.finally(() => {
        if (syncQueuesRef.current.get(project.id) === next) syncQueuesRef.current.delete(project.id);
      });
    }, 600);
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [state, ready]);

  useEffect(() => {
    if (!ready || user?.role !== "ADMIN") return;
    const project = state.projects.find((p) => p.id === state.currentProjectId);
    if (!project || remoteProjectIdsRef.current.has(project.id)) return;
    remoteProjectIdsRef.current.add(project.id);
    apiCreateProject(project)
      .then((created) => {
        remoteRevisionsRef.current.set(created.id, created.revision);
        dispatch({ type: "project/hydrate", project: created });
        setError(null);
      })
      .catch((requestError: Error) => {
        remoteProjectIdsRef.current.delete(project.id);
        setError(requestError.message);
      });
  }, [state.currentProjectId, ready, user?.role]);

  const value = useMemo(() => {
    const project =
      state.projects.find((p) => p.id === state.currentProjectId) ?? state.projects[0];
    return { state, project, dispatch: apiDispatch, ready, error };
  }, [state, apiDispatch, ready, error]);
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
