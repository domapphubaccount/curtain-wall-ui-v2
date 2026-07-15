import type { Story } from "./types";

export function activeTimeEntry(story: Story) {
  return story.timeEntries.find((e) => e.endedAt === null);
}

export function totalTrackedMs(story: Story, now: number = Date.now()): number {
  return story.timeEntries.reduce((sum, e) => {
    const end = e.endedAt ? new Date(e.endedAt).getTime() : now;
    return sum + Math.max(0, end - new Date(e.startedAt).getTime());
  }, 0);
}

export function totalTrackedHours(story: Story, now: number = Date.now()): number {
  return totalTrackedMs(story, now) / 3_600_000;
}

/** e.g. "2h 15m", "45m", "0m" */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
