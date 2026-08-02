import type { Epic, Member, Prisma, Project, Sprint, Story, WBEdge, WBGroup, WBNode, WBStroke } from "@prisma/client";

/** Shapes a Prisma row tree into exactly the JSON the frontend's TypeScript types expect. */

export function serializeEpic(e: Epic) {
  return { id: e.id, name: e.name, color: e.color };
}

export function serializeMember(m: Member) {
  return {
    id: m.id,
    userId: m.userId,
    name: m.name,
    role: m.role,
    email: m.email,
    color: m.color,
    invitedAt: m.invitedAt ? m.invitedAt.toISOString() : null,
  };
}

export function serializeSprint(s: Sprint) {
  return {
    id: s.id,
    name: s.name,
    goal: s.goal,
    startDate: s.startDate,
    endDate: s.endDate,
    state: s.state,
    velocity: s.velocity,
    committedPoints: s.committedPoints,
  };
}

export function serializeStory(s: Story) {
  return {
    id: s.id,
    key: s.key,
    title: s.title,
    description: s.description,
    type: s.type,
    status: s.status,
    priority: s.priority,
    points: s.points,
    epicId: s.epicId,
    assigneeId: s.assigneeId,
    sprintId: s.sprintId,
    acceptanceCriteria: s.acceptanceCriteria,
    createdAt: s.createdAt.toISOString(),
    completedAt: s.completedAt ? s.completedAt.toISOString() : null,
    startDate: s.startDate,
    dueDate: s.dueDate,
    dependsOn: s.dependsOn,
    attachments: s.attachments,
    timeEntries: s.timeEntries,
  };
}

function issueKeyForProject(projectKey: string, issueKey: string): string {
  if (issueKey.startsWith(`${projectKey}-`)) return issueKey;
  const issueNumber = issueKey.match(/(\d+)$/)?.[1];
  return issueNumber ? `${projectKey}-${issueNumber}` : issueKey;
}

export function serializeWBNode(n: WBNode) {
  return {
    id: n.id,
    kind: n.kind,
    x: n.x,
    y: n.y,
    w: n.w,
    h: n.h,
    text: n.text ?? undefined,
    color: n.color ?? undefined,
    shape: n.shape ?? undefined,
    fontFamily: n.fontFamily ?? undefined,
    bold: n.bold ?? undefined,
    textColor: n.textColor ?? undefined,
    storyId: n.storyId ?? undefined,
    groupId: n.groupId ?? undefined,
  };
}

export function serializeWBEdge(e: WBEdge) {
  return { id: e.id, from: e.fromId, to: e.toId, color: e.color ?? undefined, bend: e.bend ?? undefined };
}

export function serializeWBStroke(s: WBStroke) {
  return { id: s.id, color: s.color, points: s.points };
}

export function serializeWBGroup(g: WBGroup) {
  return { id: g.id, name: g.name };
}

type FullProject = Project & {
  epics: Epic[];
  members: Member[];
  sprints: Sprint[];
  stories: Story[];
  wbNodes: WBNode[];
  wbEdges: WBEdge[];
  wbStrokes: WBStroke[];
  wbGroups: WBGroup[];
};

export function serializeProject(p: FullProject) {
  return {
    id: p.id,
    name: p.name,
    key: p.key,
    seq: p.seq,
    revision: p.revision,
    whiteboards: p.whiteboards,
    activeWhiteboardId: p.activeWhiteboardId,
    files: p.files,
    epics: p.epics.map(serializeEpic),
    members: p.members.map(serializeMember),
    sprints: p.sprints.map(serializeSprint),
    stories: p.stories.map((story) => ({
      ...serializeStory(story),
      key: issueKeyForProject(p.key, story.key),
    })),
    whiteboard: {
      nodes: p.wbNodes.map(serializeWBNode),
      edges: p.wbEdges.map(serializeWBEdge),
      strokes: p.wbStrokes.map(serializeWBStroke),
      groups: p.wbGroups.map(serializeWBGroup),
    },
  };
}

export const PROJECT_INCLUDE = {
  epics: true,
  members: true,
  sprints: true,
  stories: true,
  wbNodes: true,
  wbEdges: true,
  wbStrokes: true,
  wbGroups: true,
} satisfies Prisma.ProjectInclude;
