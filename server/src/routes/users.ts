import { Router } from "express";
import bcrypt from "bcryptjs";
import { Prisma, UserRole } from "@prisma/client";
import { authenticate, requireAdmin, serializeAuthUser, type AuthenticatedRequest } from "../auth.js";
import { prisma } from "../db.js";

export const usersRouter = Router();
usersRouter.use(authenticate, requireAdmin);

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  res.json(users.map((user) => ({ ...serializeAuthUser(user), active: user.active })));
});

usersRouter.post("/", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const jobTitle = typeof req.body?.jobTitle === "string" ? req.body.jobTitle.trim() : "Team member";
  const color = typeof req.body?.color === "string" ? req.body.color : "#6366f1";
  const role = req.body?.role === UserRole.ADMIN ? UserRole.ADMIN : UserRole.USER;

  if (!name || !email || password.length < 8) {
    return res.status(400).json({ error: "Name, email, and a password of at least 8 characters are required" });
  }

  try {
    const user = await prisma.user.create({
      data: { name, email, passwordHash: await bcrypt.hash(password, 12), jobTitle, color, role },
    });
    res.status(201).json({ ...serializeAuthUser(user), active: user.active });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ error: "A user with this email already exists" });
    }
    throw error;
  }
});

usersRouter.patch("/:id", async (req: AuthenticatedRequest, res) => {
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "User not found" });

  const data: Prisma.UserUpdateInput = {};
  if (typeof req.body?.name === "string" && req.body.name.trim()) data.name = req.body.name.trim();
  if (typeof req.body?.jobTitle === "string") data.jobTitle = req.body.jobTitle.trim() || "Team member";
  if (typeof req.body?.color === "string") data.color = req.body.color;
  if (req.body?.role === UserRole.ADMIN || req.body?.role === UserRole.USER) data.role = req.body.role;
  if (typeof req.body?.active === "boolean") data.active = req.body.active;
  if (typeof req.body?.password === "string") {
    if (req.body.password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    data.passwordHash = await bcrypt.hash(req.body.password, 12);
  }

  const removesAdminAccess = existing.role === UserRole.ADMIN && (data.role === UserRole.USER || data.active === false);
  if (removesAdminAccess) {
    const activeAdmins = await prisma.user.count({ where: { role: UserRole.ADMIN, active: true } });
    if (activeAdmins <= 1) return res.status(409).json({ error: "The system must keep at least one active administrator" });
  }

  const user = await prisma.user.update({ where: { id: existing.id }, data });
  res.json({ ...serializeAuthUser(user), active: user.active });
});
