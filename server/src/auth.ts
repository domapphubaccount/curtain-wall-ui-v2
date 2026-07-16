import type { NextFunction, Request, Response } from "express";
import type { User, UserRole } from "@prisma/client";
import jwt from "jsonwebtoken";
import { prisma } from "./db.js";

const COOKIE_NAME = "sprintforge_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  jobTitle: string;
  color: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be configured with at least 32 characters");
  }
  return secret;
}

export function serializeAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    jobTitle: user.jobTitle,
    color: user.color,
    role: user.role,
  };
}

export function issueSession(res: Response, user: User): void {
  const token = jwt.sign({ sub: user.id, role: user.role }, jwtSecret(), {
    expiresIn: SESSION_TTL_SECONDS,
    issuer: "sprintforge",
    audience: "sprintforge-web",
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: "/",
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
  });
}

function readToken(req: Request): string | undefined {
  const cookieToken = req.cookies?.[COOKIE_NAME] as string | undefined;
  if (cookieToken) return cookieToken;
  const authorization = req.header("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  return undefined;
}

export async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: "Authentication required" });

  try {
    const payload = jwt.verify(token, jwtSecret(), {
      issuer: "sprintforge",
      audience: "sprintforge-web",
    });
    if (typeof payload === "string" || typeof payload.sub !== "string") {
      return res.status(401).json({ error: "Invalid session" });
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user?.active) {
      clearSession(res);
      return res.status(401).json({ error: "Account is inactive" });
    }
    req.authUser = serializeAuthUser(user);
    next();
  } catch {
    clearSession(res);
    return res.status(401).json({ error: "Session expired or invalid" });
  }
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.authUser?.role !== "ADMIN") {
    return res.status(403).json({ error: "Administrator access required" });
  }
  next();
}
