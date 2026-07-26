CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL DEFAULT 'Team member',
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "whiteboards" JSONB NOT NULL DEFAULT '[]',
    "activeWhiteboardId" TEXT,
    "files" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Epic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    CONSTRAINT "Epic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3),
    "userId" TEXT,
    "projectId" TEXT NOT NULL,
    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Sprint" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "velocity" INTEGER,
    "committedPoints" INTEGER,
    "projectId" TEXT NOT NULL,
    CONSTRAINT "Sprint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Story" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "points" INTEGER,
    "acceptanceCriteria" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "startDate" TEXT,
    "dueDate" TEXT,
    "dependsOn" TEXT[],
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "timeEntries" JSONB NOT NULL DEFAULT '[]',
    "projectId" TEXT NOT NULL,
    "epicId" TEXT,
    "assigneeId" TEXT,
    "sprintId" TEXT,
    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WBGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    CONSTRAINT "WBGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WBNode" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "w" DOUBLE PRECISION NOT NULL,
    "h" DOUBLE PRECISION NOT NULL,
    "text" TEXT,
    "color" TEXT,
    "shape" TEXT,
    "fontFamily" TEXT,
    "bold" BOOLEAN,
    "textColor" TEXT,
    "projectId" TEXT NOT NULL,
    "storyId" TEXT,
    "groupId" TEXT,
    CONSTRAINT "WBNode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WBEdge" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "color" TEXT,
    "bend" DOUBLE PRECISION,
    "projectId" TEXT NOT NULL,
    CONSTRAINT "WBEdge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WBStroke" (
    "id" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "points" DOUBLE PRECISION[],
    "projectId" TEXT NOT NULL,
    CONSTRAINT "WBStroke_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Project_key_key" ON "Project"("key");
CREATE INDEX "Epic_projectId_idx" ON "Epic"("projectId");
CREATE INDEX "Member_projectId_idx" ON "Member"("projectId");
CREATE INDEX "Member_userId_idx" ON "Member"("userId");
CREATE UNIQUE INDEX "Member_projectId_userId_key" ON "Member"("projectId", "userId");
CREATE INDEX "Sprint_projectId_idx" ON "Sprint"("projectId");
CREATE INDEX "Story_projectId_idx" ON "Story"("projectId");
CREATE INDEX "WBGroup_projectId_idx" ON "WBGroup"("projectId");
CREATE INDEX "WBNode_projectId_idx" ON "WBNode"("projectId");
CREATE INDEX "WBEdge_projectId_idx" ON "WBEdge"("projectId");
CREATE INDEX "WBStroke_projectId_idx" ON "WBStroke"("projectId");

ALTER TABLE "Epic" ADD CONSTRAINT "Epic_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Member" ADD CONSTRAINT "Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Member" ADD CONSTRAINT "Member_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sprint" ADD CONSTRAINT "Sprint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Story" ADD CONSTRAINT "Story_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Story" ADD CONSTRAINT "Story_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Story" ADD CONSTRAINT "Story_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Story" ADD CONSTRAINT "Story_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WBGroup" ADD CONSTRAINT "WBGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WBNode" ADD CONSTRAINT "WBNode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WBNode" ADD CONSTRAINT "WBNode_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WBNode" ADD CONSTRAINT "WBNode_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "WBGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WBEdge" ADD CONSTRAINT "WBEdge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WBStroke" ADD CONSTRAINT "WBStroke_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
