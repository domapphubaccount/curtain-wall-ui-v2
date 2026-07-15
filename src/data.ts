import type { AppState, Priority, Project, Story, StoryStatus, StoryType, TimeEntry, Whiteboard } from "./types";
import { NOTE_COLORS } from "./types";

/** Palette cycled through when new team members are added. */
export const MEMBER_COLORS = [
  "#6366f1", "#0ea5e9", "#10b981", "#f97316",
  "#ec4899", "#8b5cf6", "#14b8a6", "#eab308",
];

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function iso(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY).toISOString();
}

function ymd(offsetDays: number): string {
  return iso(offsetDays).slice(0, 10);
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR).toISOString();
}

interface SeedStory {
  title: string;
  type: StoryType;
  status: StoryStatus;
  priority: Priority;
  points: number | null;
  epic: number | null;
  assignee: number | null;
  sprint: number | null; // index into sprints array, null = backlog
  doneDaysAgo?: number;
  description?: string;
  ac?: string[];
  /** Gantt scheduling, as an offset in days from today. */
  start?: number;
  due?: number;
  /** Zero-based indices into seedStories this item depends on. */
  dependsOn?: number[];
  /** Demo timer sessions. Omit durationMinutes for a still-running session. */
  timeLog?: { memberIdx: number; startHoursAgo: number; durationMinutes?: number }[];
}

const seedStories: SeedStory[] = [
  // ---- Sprint 1 (completed) ----
  { title: "Set up project scaffolding and CI pipeline", type: "task", status: "done", priority: "high", points: 3, epic: 0, assignee: 0, sprint: 0, doneDaysAgo: 18, start: -28, due: -24 },
  { title: "As a shopper, I can browse the product catalog", type: "story", status: "done", priority: "critical", points: 8, epic: 0, assignee: 1, sprint: 0, doneDaysAgo: 16, start: -26, due: -18 },
  { title: "As a shopper, I can search products by keyword", type: "story", status: "done", priority: "high", points: 5, epic: 0, assignee: 2, sprint: 0, doneDaysAgo: 15, start: -20, due: -15 },
  { title: "Fix broken image fallback on catalog cards", type: "bug", status: "done", priority: "medium", points: 2, epic: 0, assignee: 1, sprint: 0, doneDaysAgo: 14, start: -16, due: -14 },
  { title: "As a shopper, I can view product details", type: "story", status: "done", priority: "high", points: 5, epic: 0, assignee: 3, sprint: 0, doneDaysAgo: 14, start: -18, due: -14 },

  // ---- Sprint 2 (active) ----
  {
    title: "As a shopper, I can add items to my cart",
    type: "story", status: "done", priority: "critical", points: 5, epic: 1, assignee: 1, sprint: 1, doneDaysAgo: 3,
    description: "Shoppers need a persistent cart that survives page reloads and merges on login.",
    ac: ["Add-to-cart works from catalog and detail pages", "Cart badge updates immediately", "Cart persists across sessions"],
    start: -7, due: -4,
    timeLog: [
      { memberIdx: 1, startHoursAgo: 76, durationMinutes: 145 },
      { memberIdx: 1, startHoursAgo: 51, durationMinutes: 95 },
    ],
  },
  {
    title: "As a shopper, I can update quantities in my cart",
    type: "story", status: "done", priority: "high", points: 3, epic: 1, assignee: 2, sprint: 1, doneDaysAgo: 2,
    ac: ["Quantity stepper with min 1", "Line totals recalculate instantly", "Remove item with undo toast"],
    start: -4, due: -2,
    timeLog: [{ memberIdx: 2, startHoursAgo: 30, durationMinutes: 110 }],
  },
  {
    title: "As a shopper, I can check out with a credit card",
    type: "story", status: "inprogress", priority: "critical", points: 8, epic: 1, assignee: 0, sprint: 1,
    description: "Integrate Stripe payment intents; handle 3DS challenge flow.",
    ac: ["Card form with validation", "3DS challenge supported", "Order confirmation email sent"],
    start: -2, due: 3, dependsOn: [5],
    timeLog: [
      { memberIdx: 0, startHoursAgo: 20, durationMinutes: 180 },
      { memberIdx: 0, startHoursAgo: 0.4 },
    ],
  },
  {
    title: "Cart total wrong when coupon applied twice",
    type: "bug", status: "review", priority: "high", points: 2, epic: 1, assignee: 2, sprint: 1,
    description: "Applying the same coupon code twice stacks the discount. Should be idempotent.",
    start: 0, due: 2, dependsOn: [7],
  },
  {
    title: "As a shopper, I can save my shipping address",
    type: "story", status: "inprogress", priority: "medium", points: 3, epic: 2, assignee: 3, sprint: 1,
    ac: ["Address book CRUD", "Default address preselected at checkout"],
    start: -1, due: 2,
  },
  {
    title: "Spike: evaluate tax calculation providers",
    type: "spike", status: "todo", priority: "medium", points: 3, epic: 1, assignee: null, sprint: 1,
    description: "Timeboxed 2 days. Compare TaxJar vs Avalara on pricing, latency, and API ergonomics.",
    start: 1, due: 2,
  },
  {
    title: "As a shopper, I receive an order confirmation email",
    type: "story", status: "todo", priority: "high", points: 2, epic: 1, assignee: 3, sprint: 1,
    start: 3, due: 5, dependsOn: [7],
  },

  // ---- Backlog ----
  {
    title: "As a returning user, I can log in with Google",
    type: "story", status: "backlog", priority: "high", points: 5, epic: 2, assignee: null, sprint: null,
    ac: ["OAuth flow with Google", "Account linking for existing emails"],
  },
  { title: "As a user, I can reset my password", type: "story", status: "backlog", priority: "medium", points: 3, epic: 2, assignee: null, sprint: null },
  {
    title: "As a shopper, I can leave a product review",
    type: "story", status: "backlog", priority: "medium", points: 5, epic: 0, assignee: null, sprint: null,
    ac: ["1-5 star rating", "Review moderation queue", "Verified-purchase badge"],
  },
  { title: "As an admin, I can manage inventory levels", type: "story", status: "backlog", priority: "high", points: 8, epic: 3, assignee: null, sprint: null },
  { title: "As an admin, I can view a sales dashboard", type: "story", status: "backlog", priority: "medium", points: 8, epic: 3, assignee: null, sprint: null },
  { title: "Checkout page slow on mobile (LCP > 4s)", type: "bug", status: "backlog", priority: "high", points: 3, epic: 1, assignee: null, sprint: null },
  { title: "As a shopper, I can track my order status", type: "story", status: "backlog", priority: "medium", points: 5, epic: 1, assignee: null, sprint: null },
  { title: "Add rate limiting to public API", type: "task", status: "backlog", priority: "low", points: 2, epic: 3, assignee: null, sprint: null },
  { title: "As a shopper, I can add items to a wishlist", type: "story", status: "backlog", priority: "low", points: 3, epic: 0, assignee: null, sprint: null },
];

export function createSeedState(): AppState {
  const project = createSeedProject();
  return { projects: [project], currentProjectId: project.id, currentMemberId: null };
}

export function createSeedProject(): Project {
  const epics = [
    { id: "e1", name: "Product Discovery", color: "#8b5cf6" },
    { id: "e2", name: "Cart & Checkout", color: "#06b6d4" },
    { id: "e3", name: "Accounts & Auth", color: "#f59e0b" },
    { id: "e4", name: "Admin Console", color: "#ec4899" },
  ];
  const members = [
    { id: "m1", name: "Aisha Khan", role: "Tech Lead", email: "aisha.khan@novacart.example", color: "#6366f1", invitedAt: iso(-40) },
    { id: "m2", name: "Diego Reyes", role: "Frontend Dev", email: "diego.reyes@novacart.example", color: "#0ea5e9", invitedAt: iso(-40) },
    { id: "m3", name: "Mei Lin", role: "Backend Dev", email: "mei.lin@novacart.example", color: "#10b981", invitedAt: iso(-40) },
    { id: "m4", name: "Tom Okafor", role: "Full-stack Dev", email: "tom.okafor@novacart.example", color: "#f97316", invitedAt: null },
  ];
  const sprints = [
    {
      id: "s1",
      name: "Sprint 1",
      goal: "Shoppers can find and view products",
      startDate: ymd(-28),
      endDate: ymd(-14),
      state: "completed" as const,
      velocity: 23,
      committedPoints: 23,
    },
    {
      id: "s2",
      name: "Sprint 2",
      goal: "Shoppers can buy: cart and checkout end-to-end",
      startDate: ymd(-7),
      endDate: ymd(7),
      state: "active" as const,
      velocity: null,
      committedPoints: 26,
    },
  ];

  const stories: Story[] = seedStories.map((s, i) => ({
    id: `st${i + 1}`,
    key: `NOVA-${i + 1}`,
    title: s.title,
    description: s.description ?? "",
    type: s.type,
    status: s.status,
    priority: s.priority,
    points: s.points,
    epicId: s.epic === null ? null : epics[s.epic].id,
    assigneeId: s.assignee === null ? null : members[s.assignee].id,
    sprintId: s.sprint === null ? null : sprints[s.sprint].id,
    acceptanceCriteria: s.ac ?? [],
    createdAt: iso(-30),
    completedAt: s.doneDaysAgo !== undefined ? iso(-s.doneDaysAgo) : null,
    startDate: s.start !== undefined ? ymd(s.start) : null,
    dueDate: s.due !== undefined ? ymd(s.due) : null,
    dependsOn: (s.dependsOn ?? []).map((idx) => `st${idx + 1}`),
    attachments: [],
    timeEntries: (s.timeLog ?? []).map((t, j): TimeEntry => {
      const startedAt = isoHoursAgo(t.startHoursAgo);
      const endedAt =
        t.durationMinutes === undefined
          ? null
          : new Date(new Date(startedAt).getTime() + t.durationMinutes * 60_000).toISOString();
      return { id: `te${i + 1}-${j + 1}`, memberId: members[t.memberIdx].id, startedAt, endedAt };
    }),
  }));

  const whiteboard: Whiteboard = {
    id: "wb1",
    name: "Main",
    nodes: [
      { id: "wbn1", kind: "note", x: 60, y: 40, w: 200, h: 90, text: "🎯 Sprint 2 goal:\nship checkout end-to-end", color: NOTE_COLORS[3], shape: "rect" },
      { id: "wbn2", kind: "task", x: 60, y: 180, w: 200, h: 82, storyId: "st8" },
      { id: "wbn3", kind: "task", x: 340, y: 180, w: 200, h: 82, storyId: "st9" },
      { id: "wbn4", kind: "task", x: 340, y: 320, w: 200, h: 82, storyId: "st12" },
      { id: "wbn5", kind: "note", x: 620, y: 180, w: 170, h: 90, text: "Blocked until\ntax spike lands", color: NOTE_COLORS[0], shape: "diamond" },
    ],
    edges: [
      { id: "wbe1", from: "wbn1", to: "wbn2" },
      { id: "wbe2", from: "wbn2", to: "wbn3" },
      { id: "wbe3", from: "wbn3", to: "wbn4" },
    ],
    strokes: [],
    groups: [],
  };

  return {
    id: "p1",
    name: "NovaCart",
    key: "NOVA",
    stories,
    epics,
    sprints,
    members,
    whiteboards: [whiteboard],
    activeWhiteboardId: whiteboard.id,
    files: [],
    seq: seedStories.length + 1,
  };
}
