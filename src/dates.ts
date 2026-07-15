import type { Sprint, Story } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseYMD(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function formatYMD(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(s: string, days: number): string {
  return formatYMD(parseYMD(s) + days * DAY_MS);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseYMD(b) - parseYMD(a)) / DAY_MS);
}

export function todayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Falls back to the sprint's dates, then a default 3-day window, when a story has no dates of its own. */
export function effectiveDates(story: Story, sprint: Sprint | undefined): { start: string; due: string } {
  if (story.startDate && story.dueDate) return { start: story.startDate, due: story.dueDate };
  if (sprint) return { start: story.startDate ?? sprint.startDate, due: story.dueDate ?? sprint.endDate };
  const t = todayYMD();
  return { start: story.startDate ?? t, due: story.dueDate ?? addDays(t, 3) };
}
