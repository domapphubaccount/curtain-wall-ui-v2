import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, UserRole, type User } from "@prisma/client";

const prisma = new PrismaClient();
const colors = ["#6366f1", "#0ea5e9", "#10b981", "#f97316", "#ec4899"];

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function ensureUser(input: {
  email: string;
  password: string;
  name: string;
  jobTitle: string;
  color: string;
  role: UserRole;
}): Promise<User> {
  const email = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: { active: true, role: input.role === UserRole.ADMIN ? UserRole.ADMIN : existing.role },
    });
  }
  const { password, ...profile } = input;
  return prisma.user.create({
    data: { ...profile, email, passwordHash: await bcrypt.hash(password, 12) },
  });
}

function ymd(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function bootstrap() {
  const initialAdminPassword = required("INITIAL_ADMIN_PASSWORD");
  if (initialAdminPassword.length < 12) {
    throw new Error("INITIAL_ADMIN_PASSWORD must contain at least 12 characters");
  }
  const admin = await ensureUser({
    email: required("INITIAL_ADMIN_EMAIL"),
    password: initialAdminPassword,
    name: process.env.INITIAL_ADMIN_NAME?.trim() || "SprintForge Admin",
    jobTitle: "Administrator",
    color: "#8b5cf6",
    role: UserRole.ADMIN,
  });

  if (process.env.SEED_DEMO_DATA === "false") return;

  const seedPassword = process.env.SEED_USER_PASSWORD || "SprintForge123!";
  const seedUsers = await Promise.all([
    ensureUser({ email: "aisha@company.local", password: seedPassword, name: "Aisha Khan", jobTitle: "Tech Lead", color: colors[0], role: UserRole.USER }),
    ensureUser({ email: "diego@company.local", password: seedPassword, name: "Diego Reyes", jobTitle: "Frontend Dev", color: colors[1], role: UserRole.USER }),
    ensureUser({ email: "mei@company.local", password: seedPassword, name: "Mei Lin", jobTitle: "Backend Dev", color: colors[2], role: UserRole.USER }),
    ensureUser({ email: "tom@company.local", password: seedPassword, name: "Tom Okafor", jobTitle: "Full-stack Dev", color: colors[3], role: UserRole.USER }),
  ]);

  const existingProject = await prisma.project.findUnique({ where: { key: "NOVA" } });
  const project = existingProject ?? await prisma.project.create({
    data: {
      id: "novacart",
      name: "NovaCart",
      key: "NOVA",
      seq: 23,
      whiteboards: [{ id: "wb-main", name: "Main", kind: "canvas", html: "", nodes: [], edges: [], strokes: [], groups: [] }],
      activeWhiteboardId: "wb-main",
      files: [],
    },
  });
  if (existingProject && !existingProject.activeWhiteboardId) {
    await prisma.project.update({
      where: { id: existingProject.id },
      data: {
        whiteboards: [{ id: "wb-main", name: "Main", kind: "canvas", html: "", nodes: [], edges: [], strokes: [], groups: [] }],
        activeWhiteboardId: "wb-main",
        files: [],
      },
    });
  }

  const membershipInputs = [
    { id: `member-${admin.id}`, user: admin },
    ...seedUsers.map((user, index) => ({ id: `m${index + 1}`, user })),
  ];
  for (const { id, user } of membershipInputs) {
    const existingByUser = await prisma.member.findFirst({ where: { projectId: project.id, userId: user.id } });
    if (existingByUser) continue;
    const existingById = await prisma.member.findUnique({ where: { id } });
    if (existingById && existingById.projectId === project.id) {
      await prisma.member.update({
        where: { id },
        data: { userId: user.id, name: user.name, role: user.jobTitle, email: user.email, color: user.color },
      });
    } else {
      await prisma.member.create({
        data: { id, projectId: project.id, userId: user.id, name: user.name, role: user.jobTitle, email: user.email, color: user.color, invitedAt: new Date() },
      });
    }
  }

  const epicData = [
    { id: "e1", name: "Product Discovery", color: "#8b5cf6" },
    { id: "e2", name: "Cart & Checkout", color: "#06b6d4" },
    { id: "e3", name: "Accounts & Auth", color: "#f59e0b" },
    { id: "e4", name: "Admin Console", color: "#ec4899" },
  ];
  for (const epic of epicData) {
    await prisma.epic.upsert({
      where: { id: epic.id },
      create: { ...epic, projectId: project.id },
      update: {},
    });
  }

  const sprintData = [
    { id: "s1", name: "Sprint 1", goal: "Shoppers can find and view products", startDate: ymd(-28), endDate: ymd(-14), state: "completed", velocity: 23, committedPoints: 23 },
    { id: "s2", name: "Sprint 2", goal: "Shoppers can buy: cart and checkout end-to-end", startDate: ymd(-7), endDate: ymd(7), state: "active", velocity: null, committedPoints: 26 },
  ];
  for (const sprint of sprintData) {
    await prisma.sprint.upsert({
      where: { id: sprint.id },
      create: { ...sprint, projectId: project.id },
      update: {},
    });
  }

  if (await prisma.story.count({ where: { projectId: project.id } }) === 0) {
    const stories = [
      ["Set up project scaffolding and CI pipeline", "task", "done", "high", 3, "e1", "m1", "s1"],
      ["As a shopper, I can browse the product catalog", "story", "done", "critical", 8, "e1", "m2", "s1"],
      ["As a shopper, I can search products by keyword", "story", "done", "high", 5, "e1", "m3", "s1"],
      ["Fix broken image fallback on catalog cards", "bug", "done", "medium", 2, "e1", "m2", "s1"],
      ["As a shopper, I can view product details", "story", "done", "high", 5, "e1", "m4", "s1"],
      ["As a shopper, I can add items to my cart", "story", "done", "critical", 5, "e2", "m2", "s2"],
      ["As a shopper, I can update quantities in my cart", "story", "done", "high", 3, "e2", "m3", "s2"],
      ["As a shopper, I can check out with a credit card", "story", "inprogress", "critical", 8, "e2", "m1", "s2"],
      ["Cart total wrong when coupon applied twice", "bug", "review", "high", 2, "e2", "m3", "s2"],
      ["As a shopper, I can save my shipping address", "story", "inprogress", "medium", 3, "e3", "m4", "s2"],
      ["Spike: evaluate tax calculation providers", "spike", "todo", "medium", 3, "e2", null, "s2"],
      ["As a shopper, I receive an order confirmation email", "story", "todo", "high", 2, "e2", "m4", "s2"],
      ["As a returning user, I can log in with Google", "story", "backlog", "high", 5, "e3", null, null],
      ["As a user, I can reset my password", "story", "backlog", "medium", 3, "e3", null, null],
      ["As a shopper, I can leave a product review", "story", "backlog", "medium", 5, "e1", null, null],
      ["As an admin, I can manage inventory levels", "story", "backlog", "high", 8, "e4", null, null],
      ["As an admin, I can view a sales dashboard", "story", "backlog", "medium", 8, "e4", null, null],
      ["Checkout page slow on mobile (LCP > 4s)", "bug", "backlog", "high", 3, "e2", null, null],
      ["As a shopper, I can track my order status", "story", "backlog", "medium", 5, "e2", null, null],
      ["Add rate limiting to public API", "task", "backlog", "low", 2, "e4", null, null],
      ["As a shopper, I can add items to a wishlist", "story", "backlog", "low", 3, "e1", null, null],
    ] as const;

    await prisma.story.createMany({
      data: stories.map(([title, type, status, priority, points, epicId, assigneeId, sprintId], index) => ({
        id: `st${index + 1}`,
        projectId: project.id,
        key: `NOVA-${index + 1}`,
        title,
        description: "",
        type,
        status,
        priority,
        points,
        epicId,
        assigneeId,
        sprintId,
        acceptanceCriteria: [],
        createdAt: new Date(Date.now() - (30 - index) * 86_400_000),
        completedAt: status === "done" ? new Date(Date.now() - 14 * 86_400_000) : null,
        startDate: null,
        dueDate: null,
        dependsOn: [],
        attachments: [],
        timeEntries: [],
      })),
    });
    await prisma.project.update({ where: { id: project.id }, data: { seq: stories.length + 1 } });
  }
}

bootstrap()
  .then(() => console.log("SprintForge bootstrap complete"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
