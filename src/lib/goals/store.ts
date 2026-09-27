import "server-only";
import { query } from "@/lib/insforge/db";
import type { Goal, GoalCategory, GoalMetric, GoalStatus } from "./types";

type GoalRow = {
  id: string;
  title: string;
  detail: string | null;
  target_date: string | null;
  target_time: string | null;
  started_at: string | null;
  status: GoalStatus;
  progress: number;
  category: GoalCategory;
  metric: GoalMetric | null;
  target_value: number | null;
  metric_channel_id: string | null;
};

export async function listGoals(): Promise<Goal[]> {
  const rows = await query<GoalRow>(
    `select id, title, detail,
            to_char(target_date, 'YYYY-MM-DD') as target_date,
            to_char(target_time, 'HH24:MI') as target_time,
            to_char(started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as started_at,
            status, progress, category, metric, target_value, metric_channel_id
       from goals
      order by
        case status when 'done' then 1 else 0 end,
        target_date asc nulls last,
        position,
        created_at`,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    detail: r.detail ?? undefined,
    targetDate: r.target_date,
    targetTime: r.target_time,
    startedAt: r.started_at,
    status: r.status,
    progress: r.progress,
    category: r.category,
    metric: r.metric,
    targetValue: r.target_value,
    metricChannelId: r.metric_channel_id,
  }));
}
