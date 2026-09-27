"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/insforge/db";
import {
  GOAL_STATUSES,
  GOAL_CATEGORIES,
  type GoalStatus,
  type GoalCategory,
} from "./types";

function clean(s: unknown, max = 2000): string {
  return String(s ?? "").trim().slice(0, max);
}

function normStatus(s: unknown): GoalStatus {
  return (GOAL_STATUSES as string[]).includes(s as string)
    ? (s as GoalStatus)
    : "in_progress";
}

function normCategory(c: unknown): GoalCategory {
  return (GOAL_CATEGORIES as string[]).includes(c as string)
    ? (c as GoalCategory)
    : "development";
}

function normProgress(p: unknown): number {
  const n = Math.round(Number(p) || 0);
  return Math.max(0, Math.min(100, n));
}

/** Accept "HH:mm" (from <input type="time">), else null. */
function normTime(t: unknown): string | null {
  const s = clean(t, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : null;
}

function refresh() {
  revalidatePath("/dashboard/progress");
}

export async function createGoal(input: {
  title: string;
  detail?: string;
  targetDate?: string;
  targetTime?: string;
  status?: string;
  progress?: number;
  category?: string;
}): Promise<{ error?: string }> {
  const title = clean(input.title, 200);
  if (!title) return { error: "Title is required." };

  const id = randomUUID();
  const [{ next } = { next: 0 }] = await query<{ next: number }>(
    `select coalesce(max(position), -1) + 1 as next from goals`,
  );

  // started_at is stamped automatically when a goal begins "in progress".
  await query(
    `insert into goals (id, title, detail, target_date, target_time, status, progress, position, category, started_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             case when $6 = 'in_progress' then now() else null end)`,
    [
      id,
      title,
      clean(input.detail) || null,
      input.targetDate ? clean(input.targetDate, 10) : null,
      normTime(input.targetTime),
      normStatus(input.status),
      normProgress(input.progress),
      next,
      normCategory(input.category),
    ],
  );
  refresh();
  return {};
}

export async function updateGoal(
  id: string,
  patch: {
    title?: string;
    detail?: string;
    targetDate?: string;
    targetTime?: string;
    status?: string;
    progress?: number;
    category?: string;
  },
): Promise<{ error?: string }> {
  const title = clean(patch.title, 200);
  if (!title) return { error: "Title is required." };

  await query(
    `update goals
        set title = $2, detail = $3, target_date = $4, target_time = $5,
            status = $6, progress = $7, category = $8,
            started_at = coalesce(
              started_at,
              case when $6 = 'in_progress' then now() else null end
            )
      where id = $1`,
    [
      id,
      title,
      clean(patch.detail) || null,
      patch.targetDate ? clean(patch.targetDate, 10) : null,
      normTime(patch.targetTime),
      normStatus(patch.status),
      normProgress(patch.progress),
      normCategory(patch.category),
    ],
  );
  refresh();
  return {};
}

/** Lightweight update for the inline progress slider / status pills. */
export async function setGoalProgress(
  id: string,
  progress: number,
): Promise<void> {
  const p = normProgress(progress);
  // Auto-flip status to done at 100, and out of done when dropped below.
  await query(
    `update goals
        set progress = $2,
            status = case
              when $2 >= 100 then 'done'
              when status = 'done' then 'in_progress'
              else status
            end
      where id = $1`,
    [id, p],
  );
  refresh();
}

export async function setGoalStatus(
  id: string,
  status: string,
): Promise<void> {
  const s = normStatus(status);
  await query(
    `update goals
        set status = $2,
            progress = case when $2 = 'done' then 100 else progress end,
            started_at = coalesce(
              started_at,
              case when $2 = 'in_progress' then now() else null end
            )
      where id = $1`,
    [id, s],
  );
  refresh();
}

export async function deleteGoal(id: string): Promise<void> {
  await query(`delete from goals where id = $1`, [id]);
  refresh();
}
