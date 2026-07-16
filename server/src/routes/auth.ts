import { Router } from "express";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
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
