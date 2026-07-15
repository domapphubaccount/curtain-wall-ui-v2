import type { Project } from "./types";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");

export function isApiConfigured(): boolean {
  return !!API_URL;
}

async function safeFetch(path: string, init?: RequestInit): Promise<Response | null> {
  if (!API_URL) return null;
  try {
    return await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    // Backend unreachable (offline, not deployed yet, etc.) — caller falls back to local-only mode.
    return null;
  }
}

export async function apiGetProject(id: string): Promise<Project | null> {
  const res = await safeFetch(`/api/projects/${id}`);
  if (!res || !res.ok) return null;
  return res.json();
}

export async function apiCreateProject(project: Project): Promise<Project | null> {
  const res = await safeFetch("/api/projects", {
    method: "POST",
    body: JSON.stringify({ id: project.id, name: project.name, key: project.key, members: project.members }),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

/** Pushes the full current project graph to the server, reconciling every child collection. */
export async function apiSyncProject(project: Project): Promise<boolean> {
  const res = await safeFetch(`/api/projects/${project.id}`, {
    method: "PUT",
    body: JSON.stringify(project),
  });
  return !!res && res.ok;
}

export async function apiDeleteProject(id: string): Promise<boolean> {
  const res = await safeFetch(`/api/projects/${id}`, { method: "DELETE" });
  return !!res && (res.ok || res.status === 404);
}
