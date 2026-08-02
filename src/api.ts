import type { AuthUser, Project, SystemRole, SystemUser } from "./types";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError("Cannot connect to the SprintForge server", 0);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (response.status === 401 && !path.endsWith("/login")) {
      window.dispatchEvent(new Event("sprintforge:unauthorized"));
    }
    throw new ApiError(payload?.error || "The request failed", response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiLogin(email: string, password: string): Promise<AuthUser> {
  const result = await request<{ user: AuthUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return result.user;
}

export async function apiMe(): Promise<AuthUser> {
  const result = await request<{ user: AuthUser }>("/api/auth/me");
  return result.user;
}

export async function apiUpdateMe(input: {
  name: string;
  email: string;
  currentPassword?: string;
  newPassword?: string;
}): Promise<AuthUser> {
  const result = await request<{ user: AuthUser }>("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return result.user;
}

export function apiLogout(): Promise<void> {
  return request<void>("/api/auth/logout", { method: "POST" });
}

export function apiListProjects(): Promise<Project[]> {
  return request<Project[]>("/api/projects");
}

export function apiGetProject(id: string): Promise<Project> {
  return request<Project>(`/api/projects/${id}`);
}

export function apiCreateProject(project: Project): Promise<Project> {
  return request<Project>("/api/projects", { method: "POST", body: JSON.stringify(project) });
}

export function apiSyncProject(project: Project, expectedRevision = project.revision): Promise<Project> {
  return request<Project>(`/api/projects/${project.id}`, {
    method: "PUT",
    body: JSON.stringify({ ...project, revision: expectedRevision }),
  });
}

export function apiDeleteProject(id: string): Promise<void> {
  return request<void>(`/api/projects/${id}`, { method: "DELETE" });
}

export function apiListUsers(): Promise<SystemUser[]> {
  return request<SystemUser[]>("/api/users");
}

export function apiCreateUser(input: {
  name: string;
  email: string;
  password: string;
  jobTitle: string;
  role: SystemRole;
  color: string;
}): Promise<SystemUser> {
  return request<SystemUser>("/api/users", { method: "POST", body: JSON.stringify(input) });
}

export function apiUpdateUser(id: string, input: Partial<SystemUser> & { password?: string }): Promise<SystemUser> {
  return request<SystemUser>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}
