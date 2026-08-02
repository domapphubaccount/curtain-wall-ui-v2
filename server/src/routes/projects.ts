import { Router } from "express";
import { Prisma, UserRole } from "@prisma/client";
import { authenticate, type AuthenticatedRequest } from "../auth.js";
import { prisma } from "../db.js";
import { PROJECT_INCLUDE, serializeProject } from "../serialize.js";

export const projectsRouter = Router();
projectsRouter.use(authenticate);

type ProjectBody = {
  id: string;
  name: string;
  key: string;
  seq: number;
  revision: number;
  epics: { id: string; name: string; color: string }[];
  members: { id: string; userId: string; name: string; role: string; email: string; color: string; invitedAt: string | null }[];
  sprints: {
    id: string; name: string; goal: string; startDate: string; endDate: string;
    state: string; velocity: number | null; committedPoints: number | null;
  }[];
  stories: StoryBody[];
  whiteboards: Prisma.InputJsonValue;
  activeWhiteboardId: string;
  files: Prisma.InputJsonValue;
};

type StoryBody = {
  id: string; key: string; title: string; description: string; type: string; status: string;
  priority: string; points: number | null; epicId: string | null; assigneeId: string | null;
  sprintId: string | null; acceptanceCriteria: string[]; createdAt: string; completedAt: string | null;
  startDate: string | null; dueDate: string | null; dependsOn: string[];
  attachments: Prisma.InputJsonValue; timeEntries: Prisma.InputJsonValue;
};

function isProjectBody(value: unknown): value is ProjectBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<ProjectBody>;
  return typeof body.id === "string" && typeof body.name === "string" && typeof body.key === "string" &&
    typeof body.seq === "number" && typeof body.revision === "number" &&
    Number.isInteger(body.revision) && body.revision > 0 &&
    typeof body.activeWhiteboardId === "string" &&
    Array.isArray(body.epics) && Array.isArray(body.members) && Array.isArray(body.sprints) &&
    Array.isArray(body.stories) && Array.isArray(body.whiteboards) && Array.isArray(body.files);
}

function isAdmin(req: AuthenticatedRequest): boolean {
  return req.authUser?.role === UserRole.ADMIN;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

class RevisionConflictError extends Error {}

async function claimRevision(
  tx: Prisma.TransactionClient,
  projectId: string,
  expectedRevision: number,
  data: Prisma.ProjectUpdateManyMutationInput = {},
): Promise<void> {
  const result = await tx.project.updateMany({
    where: { id: projectId, revision: expectedRevision },
    data: { ...data, revision: { increment: 1 } },
  });
  if (result.count !== 1) throw new RevisionConflictError();
}

function storyData(story: StoryBody): Prisma.StoryUncheckedUpdateInput {
  return {
    key: story.key,
    title: story.title,
    description: story.description,
    type: story.type,
    status: story.status,
    priority: story.priority,
    points: story.points,
    epicId: story.epicId,
    assigneeId: story.assigneeId,
    sprintId: story.sprintId,
    acceptanceCriteria: story.acceptanceCriteria,
    completedAt: story.completedAt ? new Date(story.completedAt) : null,
    startDate: story.startDate,
    dueDate: story.dueDate,
    dependsOn: story.dependsOn,
    attachments: story.attachments,
    timeEntries: story.timeEntries,
  };
}

async function hasForeignOwnedIds(projectId: string, body: ProjectBody): Promise<boolean> {
  const [epics, members, sprints, stories] = await Promise.all([
    prisma.epic.count({ where: { id: { in: (body.epics ?? []).map((item) => item.id) }, NOT: { projectId } } }),
    prisma.member.count({ where: { id: { in: (body.members ?? []).map((item) => item.id) }, NOT: { projectId } } }),
    prisma.sprint.count({ where: { id: { in: (body.sprints ?? []).map((item) => item.id) }, NOT: { projectId } } }),
    prisma.story.count({ where: { id: { in: (body.stories ?? []).map((item) => item.id) }, NOT: { projectId } } }),
  ]);
  return epics + members + sprints + stories > 0;
}

projectsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const projects = await prisma.project.findMany({
    where: isAdmin(req) ? undefined : { members: { some: { userId: req.authUser?.id } } },
    include: PROJECT_INCLUDE,
    orderBy: { updatedAt: "desc" },
  });
  res.json(projects.map(serializeProject));
});

projectsRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id }, include: PROJECT_INCLUDE });
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!isAdmin(req) && !project.members.some((member) => member.userId === req.authUser?.id)) {
    return res.status(403).json({ error: "You are not a member of this project" });
  }
  res.json(serializeProject(project));
});

projectsRouter.post("/", async (req: AuthenticatedRequest, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Only administrators can create projects" });
  if (!isProjectBody(req.body)) return res.status(400).json({ error: "Invalid project payload" });
  const body = req.body;
  if (!body.id || !body.name?.trim() || !body.key?.trim()) {
    return res.status(400).json({ error: "Project name and key are required" });
  }

  const userIds = [...new Set((body.members ?? []).map((member) => member.userId).filter(Boolean))];
  if (userIds.length !== (body.members ?? []).length) return res.status(400).json({ error: "Project users must be unique" });
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, active: true } });
  if (users.length !== userIds.length) return res.status(400).json({ error: "One or more selected users are invalid" });
  if (await hasForeignOwnedIds(body.id, body)) return res.status(409).json({ error: "One or more resource IDs already exist" });

  try {
    const project = await prisma.project.create({
      data: {
        id: body.id,
        name: body.name.trim(),
        key: body.key.trim().toUpperCase(),
        seq: 1,
        whiteboards: body.whiteboards ?? [],
        activeWhiteboardId: body.activeWhiteboardId,
        files: body.files ?? [],
        members: {
          create: users.map((user) => ({
            id: body.members.find((member) => member.userId === user.id)?.id,
            userId: user.id,
            name: user.name,
            role: user.jobTitle,
            email: user.email,
            color: user.color,
            invitedAt: new Date(),
          })),
        },
      },
      include: PROJECT_INCLUDE,
    });
    res.status(201).json(serializeProject(project));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ error: "A project with this key already exists" });
    }
    throw error;
  }
});

projectsRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Only administrators can delete projects" });
  await prisma.project.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

projectsRouter.put("/:id", async (req: AuthenticatedRequest, res) => {
  const id = req.params.id;
  if (!isProjectBody(req.body)) return res.status(400).json({ error: "Invalid project payload" });
  const body = req.body;
  const current = await prisma.project.findUnique({ where: { id }, include: PROJECT_INCLUDE });
  if (!current) return res.status(404).json({ error: "Project not found" });

  if (!isAdmin(req)) {
    if (!current.members.some((member) => member.userId === req.authUser?.id)) {
      return res.status(403).json({ error: "You are not a member of this project" });
    }
    const serialized = serializeProject(current);
    const stableProjectFields =
      body.name === serialized.name && body.key === serialized.key && body.seq === serialized.seq &&
      same(body.epics, serialized.epics) && same(body.members, serialized.members) &&
      same(body.sprints, serialized.sprints) && same(body.files, serialized.files);
    if (!stableProjectFields || body.stories.length !== serialized.stories.length) {
      return res.status(403).json({ error: "You may only edit tasks assigned to you" });
    }

    const existingStories = new Map(serialized.stories.map((story) => [story.id, story]));
    const memberById = new Map(current.members.map((member) => [member.id, member]));
    const changedStories: StoryBody[] = [];
    for (const requested of body.stories) {
      const existing = existingStories.get(requested.id);
      if (!existing) return res.status(403).json({ error: "Users cannot create tasks" });
      if (same(requested, existing)) continue;
      const assignee = existing.assigneeId ? memberById.get(existing.assigneeId) : undefined;
      if (assignee?.userId !== req.authUser?.id || requested.assigneeId !== existing.assigneeId || requested.key !== existing.key) {
        return res.status(403).json({ error: "You may only edit your assigned tasks and cannot reassign them" });
      }
      changedStories.push(requested);
    }

    try {
      await prisma.$transaction(async (tx) => {
        await claimRevision(tx, id, body.revision, {
          whiteboards: body.whiteboards,
          activeWhiteboardId: body.activeWhiteboardId,
        });
        for (const story of changedStories) {
          await tx.story.update({ where: { id: story.id }, data: storyData(story) });
        }
      });
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        return res.status(409).json({ error: "This project changed in another session. It has been reloaded; please retry." });
      }
      throw error;
    }
    const updated = await prisma.project.findUniqueOrThrow({ where: { id }, include: PROJECT_INCLUDE });
    return res.json(serializeProject(updated));
  }

  const userIds = [...new Set(body.members.map((member) => member.userId).filter(Boolean))];
  if (userIds.length !== body.members.length) return res.status(400).json({ error: "Project users must be unique" });
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, active: true } });
  if (users.length !== userIds.length) return res.status(400).json({ error: "One or more project users are invalid" });
  if (await hasForeignOwnedIds(id, body)) return res.status(409).json({ error: "One or more resource IDs belong to another project" });
  const usersById = new Map(users.map((user) => [user.id, user]));

  try {
    await prisma.$transaction(async (tx) => {
      await claimRevision(tx, id, body.revision, {
        name: body.name.trim(), key: body.key.trim().toUpperCase(), seq: body.seq,
        whiteboards: body.whiteboards, activeWhiteboardId: body.activeWhiteboardId, files: body.files,
      });

      const epicIds = body.epics.map((epic) => epic.id);
      await tx.epic.deleteMany({ where: { projectId: id, id: { notIn: epicIds } } });
      for (const epic of body.epics) {
        await tx.epic.upsert({
          where: { id: epic.id },
          create: { ...epic, projectId: id },
          update: { name: epic.name, color: epic.color },
        });
      }

      const memberIds = body.members.map((member) => member.id);
      await tx.member.deleteMany({ where: { projectId: id, id: { notIn: memberIds } } });
      for (const member of body.members) {
        const user = usersById.get(member.userId)!;
        await tx.member.upsert({
          where: { id: member.id },
          create: { id: member.id, projectId: id, userId: user.id, name: user.name, role: user.jobTitle, email: user.email, color: user.color, invitedAt: new Date() },
          update: { userId: user.id, name: user.name, role: user.jobTitle, email: user.email, color: user.color },
        });
      }

      const sprintIds = body.sprints.map((sprint) => sprint.id);
      await tx.sprint.deleteMany({ where: { projectId: id, id: { notIn: sprintIds } } });
      for (const sprint of body.sprints) {
        const data = {
          name: sprint.name, goal: sprint.goal, startDate: sprint.startDate, endDate: sprint.endDate,
          state: sprint.state, velocity: sprint.velocity, committedPoints: sprint.committedPoints,
        };
        await tx.sprint.upsert({ where: { id: sprint.id }, create: { id: sprint.id, projectId: id, ...data }, update: data });
      }

      const storyIds = body.stories.map((story) => story.id);
      await tx.story.deleteMany({ where: { projectId: id, id: { notIn: storyIds } } });
      for (const story of body.stories) {
        const data = storyData(story);
        await tx.story.upsert({
          where: { id: story.id },
          create: {
            ...(data as Prisma.StoryUncheckedCreateInput),
            id: story.id,
            projectId: id,
            key: story.key,
            createdAt: new Date(story.createdAt),
          },
          update: data,
        });
      }
    });
  } catch (error) {
    if (error instanceof RevisionConflictError) {
      return res.status(409).json({ error: "This project changed in another session. It has been reloaded; please retry." });
    }
    throw error;
  }

  const project = await prisma.project.findUniqueOrThrow({ where: { id }, include: PROJECT_INCLUDE });
  res.json(serializeProject(project));
});
