import "server-only";
import type { Goal } from "./types";
import { DAY } from "./time";
import { listChannels } from "@/lib/channels/store";
import { getTotalCustomers } from "@/lib/revenuecat/client";
import { listPosts } from "@/lib/zernio/client";

export type GoalMetricValue = {
  current: number;
  target: number;
  unit: string;
  source: string;
};

// Never let a slow/hung upstream (Zernio/RevenueCat) block the page render.
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// When did counting start? Use the goal's started_at; for a posts/consistency
// goal that hasn't started, derive a 30-day window ending on the target date.
function startDateOf(goal: Goal): Date {
  if (goal.startedAt) {
    const d = new Date(goal.startedAt);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (goal.targetDate && goal.metric === "posts") {
    const [y, m, dd] = goal.targetDate.split("-").map(Number);
    const d = new Date(y, m - 1, dd);
    d.setDate(d.getDate() - 29);
    return d;
  }
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

/** Live values for metric-linked goals, counted since each goal's start. */
export async function computeGoalMetrics(
  goals: Goal[],
): Promise<Record<string, GoalMetricValue>> {
  const metricGoals = goals.filter((g) => g.metric && g.targetValue);
  if (metricGoals.length === 0) return {};

  const channels = await listChannels();
  const byId = new Map(channels.map((c) => [c.id, c]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: Record<string, GoalMetricValue> = {};

  await Promise.all(
    metricGoals.map(async (g) => {
      const ch = g.metricChannelId ? byId.get(g.metricChannelId) : undefined;
      const start = startDateOf(g);
      const target = g.targetValue ?? 0;

      if (g.metric === "downloads") {
        // Total downloads = total RevenueCat customers (all-time) for the project.
        let current = 0;
        const projectId = ch?.revenuecatProjectId;
        if (projectId) {
          current = await withTimeout(
            getTotalCustomers(projectId, ch?.revenuecatApiKey),
            12_000,
            0,
          );
        }
        out[g.id] = { current, target, unit: "downloads", source: "RevenueCat" };
      } else if (g.metric === "posts") {
        const profileIds = ch?.zernioProfileIds ?? [];
        let current = 0;
        const startMs = start.getTime();
        const endMs = today.getTime() + DAY; // include all of today
        try {
          const arrays = await Promise.all(
            profileIds.map((pid) =>
              withTimeout(
                listPosts({ limit: 200, profileId: pid }),
                12_000,
                [],
              ),
            ),
          );
          for (const arr of arrays) {
            for (const p of arr) {
              const ts = p.publishedAt ?? p.scheduledFor ?? p.createdAt;
              if (!ts) continue;
              const d = new Date(ts).getTime();
              if (d >= startMs && d < endMs) current++;
            }
          }
        } catch {
          /* leave 0 */
        }
        out[g.id] = { current, target, unit: "posts", source: "Zernio" };
      }
    }),
  );

  return out;
}
