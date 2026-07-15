import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { PROJECT_INCLUDE, serializeProject } from "../serialize.js";

export const projectsRouter = Router();

projectsRouter.get("/", async (_req, res) => {
  const projects = await prisma.project.findMany({ select: { id: true, name: true, key: true, updatedAt: true } });
  res.json(projects);
});

projectsRouter.get("/:id", async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id }, include: PROJECT_INCLUDE });
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json(serializeProject(project));
});

projectsRouter.post("/", async (req, res) => {
  const { id, name, key, members } = req.body as {
    id: string;
    name: string;
    key: string;
    members: { id: string; name: string; role: string; email: string; color: string }[];
  };
  const project = await prisma.project.create({
    data: {
      id,
      name,
      key,
      seq: 1,
      members: { create: members.map((m) => ({ id: m.id, name: m.name, role: m.role, email: m.email, color: m.color })) },
    },
    include: PROJECT_INCLUDE,
  });
  res.status(201).json(serializeProject(project));
});

projectsRouter.delete("/:id", async (req, res) => {
  await prisma.project.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

/**
 * Full state sync: the frontend keeps its existing client-side reducer and just PUTs the
 * resulting project graph here after every change. We reconcile each child table (upsert what's
 * present, delete what's missing) inside one transaction, in FK-safe order.
 */
projectsRouter.put("/:id", async (req, res) => {
  const id = req.params.id;
  const body = req.body as {
    name: string;
    key: string;
    seq: number;
    epics: { id: string; name: string; color: string }[];
    members: { id: string; name: string; role: string; email: string; color: string; invitedAt: string | null }[];
    sprints: {
      id: string; name: string; goal: string; startDate: string; endDate: string;
      state: string; velocity: number | null; committedPoints: number | null;
    }[];
    stories: {
      id: string; key: string; title: string; description: string; type: string; status: string;
      priority: string; points: number | null; epicId: string | null; assigneeId: string | null;
      sprintId: string | null; acceptanceCriteria: string[]; createdAt: string; completedAt: string | null;
      startDate: string | null; dueDate: string | null; dependsOn: string[];
    }[];
    whiteboard: {
      nodes: {
        id: string; kind: string; x: number; y: number; w: number; h: number; text?: string;
        color?: string; shape?: string; fontFamily?: string; bold?: boolean; textColor?: string;
        storyId?: string; groupId?: string;
      }[];
      edges: { id: string; from: string; to: string; color?: string; bend?: number }[];
      strokes: { id: string; color: string; points: number[] }[];
      groups: { id: string; name: string }[];
    };
  };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id }, data: { name: body.name, key: body.key, seq: body.seq } });

      const epicIds = body.epics.map((e) => e.id);
      await tx.epic.deleteMany({ where: { projectId: id, id: { notIn: epicIds } } });
      for (const e of body.epics) {
        await tx.epic.upsert({
          where: { id: e.id },
          create: { id: e.id, name: e.name, color: e.color, projectId: id },
          update: { name: e.name, color: e.color },
        });
      }

      const memberIds = body.members.map((m) => m.id);
      await tx.member.deleteMany({ where: { projectId: id, id: { notIn: memberIds } } });
      for (const m of body.members) {
        const invitedAt = m.invitedAt ? new Date(m.invitedAt) : null;
        await tx.member.upsert({
          where: { id: m.id },
          create: { id: m.id, name: m.name, role: m.role, email: m.email, color: m.color, invitedAt, projectId: id },
          update: { name: m.name, role: m.role, email: m.email, color: m.color, invitedAt },
        });
      }

      const sprintIds = body.sprints.map((s) => s.id);
      await tx.sprint.deleteMany({ where: { projectId: id, id: { notIn: sprintIds } } });
      for (const s of body.sprints) {
        const data = {
          name: s.name, goal: s.goal, startDate: s.startDate, endDate: s.endDate,
          state: s.state, velocity: s.velocity, committedPoints: s.committedPoints,
        };
        await tx.sprint.upsert({ where: { id: s.id }, create: { id: s.id, ...data, projectId: id }, update: data });
      }

      const storyIds = body.stories.map((s) => s.id);
      await tx.story.deleteMany({ where: { projectId: id, id: { notIn: storyIds } } });
      for (const s of body.stories) {
        const data: Prisma.StoryUncheckedUpdateInput = {
          key: s.key, title: s.title, description: s.description, type: s.type, status: s.status,
          priority: s.priority, points: s.points, epicId: s.epicId, assigneeId: s.assigneeId, sprintId: s.sprintId,
          acceptanceCriteria: s.acceptanceCriteria, createdAt: new Date(s.createdAt),
          completedAt: s.completedAt ? new Date(s.completedAt) : null,
          startDate: s.startDate, dueDate: s.dueDate, dependsOn: s.dependsOn,
        };
        await tx.story.upsert({
          where: { id: s.id },
          create: { id: s.id, ...(data as Prisma.StoryUncheckedCreateInput), projectId: id },
          update: data,
        });
      }

      const groupIds = body.whiteboard.groups.map((g) => g.id);
      await tx.wBGroup.deleteMany({ where: { projectId: id, id: { notIn: groupIds } } });
      for (const g of body.whiteboard.groups) {
        await tx.wBGroup.upsert({
          where: { id: g.id },
          create: { id: g.id, name: g.name, projectId: id },
          update: { name: g.name },
        });
      }

      const nodeIds = body.whiteboard.nodes.map((n) => n.id);
      await tx.wBNode.deleteMany({ where: { projectId: id, id: { notIn: nodeIds } } });
      for (const n of body.whiteboard.nodes) {
        const data = {
          kind: n.kind, x: n.x, y: n.y, w: n.w, h: n.h, text: n.text ?? null, color: n.color ?? null,
          shape: n.shape ?? null, fontFamily: n.fontFamily ?? null, bold: n.bold ?? null, textColor: n.textColor ?? null,
          storyId: n.storyId ?? null, groupId: n.groupId ?? null,
        };
        await tx.wBNode.upsert({ where: { id: n.id }, create: { id: n.id, ...data, projectId: id }, update: data });
      }

      const edgeIds = body.whiteboard.edges.map((e) => e.id);
      await tx.wBEdge.deleteMany({ where: { projectId: id, id: { notIn: edgeIds } } });
      for (const e of body.whiteboard.edges) {
        const data = { fromId: e.from, toId: e.to, color: e.color ?? null, bend: e.bend ?? null };
        await tx.wBEdge.upsert({ where: { id: e.id }, create: { id: e.id, ...data, projectId: id }, update: data });
      }

      const strokeIds = body.whiteboard.strokes.map((s) => s.id);
      await tx.wBStroke.deleteMany({ where: { projectId: id, id: { notIn: strokeIds } } });
      for (const s of body.whiteboard.strokes) {
        const data = { color: s.color, points: s.points };
        await tx.wBStroke.upsert({ where: { id: s.id }, create: { id: s.id, ...data, projectId: id }, update: data });
      }
    });

    const project = await prisma.project.findUniqueOrThrow({ where: { id }, include: PROJECT_INCLUDE });
    res.json(serializeProject(project));
  } catch (err) {
    console.error("Project sync failed:", err);
    res.status(500).json({ error: "Failed to sync project" });
  }
});
