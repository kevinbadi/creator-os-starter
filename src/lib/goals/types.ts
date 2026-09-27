export type GoalStatus = "planned" | "in_progress" | "done";
export type GoalCategory = "development" | "marketing";
/** Goals linked to a live metric auto-track their progress (no manual slider). */
export type GoalMetric = "downloads" | "posts";

export type Goal = {
  id: string;
  title: string;
  detail?: string;
  /** ISO date string (YYYY-MM-DD) or null. */
  targetDate: string | null;
  /** Live-tracked metric source, target, and which channel it reads from. */
  metric: GoalMetric | null;
  targetValue: number | null;
  metricChannelId: string | null;
  /** Time of day for the deadline, "HH:mm" (24h) or null. Defaults to end-of-day. */
  targetTime: string | null;
  /** When work started, ISO timestamp or null. Used for "time elapsed". */
  startedAt: string | null;
  status: GoalStatus;
  progress: number; // 0-100
  category: GoalCategory;
};

/** Combine a goal's date + time into a single epoch-ms deadline.
 *  Missing time → end of the target day (23:59). Returns null if no date. */
export function goalDeadlineMs(
  targetDate: string | null,
  targetTime: string | null,
): number | null {
  if (!targetDate) return null;
  const [y, m, d] = targetDate.split("-").map(Number);
  let hh = 23;
  let mm = 59;
  if (targetTime) {
    const [h, mi] = targetTime.split(":").map(Number);
    if (Number.isFinite(h)) hh = h;
    if (Number.isFinite(mi)) mm = mi;
  }
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
};

export const GOAL_STATUSES: GoalStatus[] = ["planned", "in_progress", "done"];

export const GOAL_CATEGORIES: GoalCategory[] = ["development", "marketing"];

export const GOAL_CATEGORY_LABEL: Record<GoalCategory, string> = {
  development: "Development",
  marketing: "Marketing",
};
