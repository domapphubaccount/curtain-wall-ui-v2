import { Router } from "express";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import {
  authenticate,
  clearSession,
  issueSession,
  serializeAuthUser,
  type AuthenticatedRequest,
} from "../auth.js";

export const authRouter = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });

authRouter.post("/login", loginLimiter, async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user?.active ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !valid) return res.status(401).json({ error: "Invalid email or password" });

  issueSession(res, user);
  res.json({ user: serializeAuthUser(user) });
});

authRouter.post("/logout", (_req, res) => {
  clearSession(res);
  res.status(204).end();
});

authRouter.get("/me", authenticate, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.authUser });
});

authRouter.patch("/me", authenticate, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";

  if (!name || !email) return res.status(400).json({ error: "Name and email are required" });
  if (newPassword && newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }

  const existing = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (newPassword && (!currentPassword || !await bcrypt.compare(currentPassword, existing.passwordHash))) {
    return res.status(400).json({ error: "Current password is incorrect" });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          name,
          email,
          ...(newPassword ? { passwordHash: await bcrypt.hash(newPassword, 12) } : {}),
        },
      });
      await tx.member.updateMany({ where: { userId }, data: { name, email } });
      return user;
    });
    issueSession(res, updated);
    res.json({ user: serializeAuthUser(updated) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ error: "A user with this email already exists" });
    }
    throw error;
  }
});
