"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/insforge/db";

function cleanId(id: unknown): string {
  return String(id ?? "").trim().slice(0, 128);
}

/** Toggle a sound's favorite flag. Favorites are the workflow allow-list. */
export async function toggleFavorite(id: string, favorite: boolean): Promise<void> {
  const sid = cleanId(id);
  if (!sid) return;
  await query(`update sounds set favorite = $2 where id = $1`, [sid, favorite]);
  revalidatePath("/dashboard/sounds");
}

/**
 * Check off a favorite as "used" (e.g. added to a carousel). Checking bumps the
 * usage count + stamps last_used_at for tracking; unchecking just clears the
 * box and keeps the history so the workflow can rotate least-recently-used.
 */
export async function setChecked(id: string, checked: boolean): Promise<void> {
  const sid = cleanId(id);
  if (!sid) return;
  if (checked) {
    await query(
      `update sounds
          set checked = true, used_count = used_count + 1, last_used_at = now()
        where id = $1`,
      [sid],
    );
  } else {
    await query(`update sounds set checked = false where id = $1`, [sid]);
  }
  revalidatePath("/dashboard/sounds");
}

/** Tag which creator gender a sound suits — "female", "male", or "any" (either). */
export async function setGender(id: string, gender: string): Promise<void> {
  const sid = cleanId(id);
  if (!sid) return;
  const g = gender === "female" || gender === "male" ? gender : "any";
  await query(`update sounds set gender = $2 where id = $1`, [sid, g]);
  revalidatePath("/dashboard/sounds");
}

/** Save your notes on a sound — what you think of it / what it should be used for. */
export async function setNotes(id: string, notes: string): Promise<void> {
  const sid = cleanId(id);
  if (!sid) return;
  const text = String(notes ?? "").slice(0, 2000);
  await query(`update sounds set notes = $2 where id = $1`, [sid, text]);
  revalidatePath("/dashboard/sounds");
}

/**
 * Soft-delete a sound: hide it from the tab. We keep the row so the daily cron's
 * dedup won't re-add it if it's still trending.
 */
export async function deleteSound(id: string): Promise<void> {
  const sid = cleanId(id);
  if (!sid) return;
  await query(`update sounds set hidden = true, favorite = false where id = $1`, [sid]);
  revalidatePath("/dashboard/sounds");
}
