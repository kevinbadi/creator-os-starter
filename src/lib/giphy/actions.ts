"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/insforge/db";

function cleanId(id: unknown): string {
  return String(id ?? "").trim().slice(0, 128);
}

function cleanUrl(u: unknown): string {
  const s = String(u ?? "").trim().slice(0, 2000);
  return /^https:\/\/[a-z0-9.-]*giphy\.com\//i.test(s) ? s : "";
}

/** Favorite a GIF — upserts it into the workflow allow-list. */
export async function saveGif(gif: {
  id: string;
  title: string;
  preview: string;
  mp4: string;
  query: string;
}): Promise<void> {
  const id = cleanId(gif.id);
  const preview = cleanUrl(gif.preview);
  const mp4 = cleanUrl(gif.mp4);
  if (!id || !preview || !mp4) return;
  await query(
    `insert into gifs (id, title, preview_url, mp4_url, query)
     values ($1, $2, $3, $4, $5)
     on conflict (id) do nothing`,
    [
      id,
      String(gif.title ?? "GIF").slice(0, 300),
      preview,
      mp4,
      String(gif.query ?? "").slice(0, 200),
    ],
  );
  revalidatePath("/dashboard/giphy");
}

/** Unfavorite — removes it from the allow-list (search re-finds it anytime). */
export async function removeGif(id: string): Promise<void> {
  const gid = cleanId(id);
  if (!gid) return;
  await query(`delete from gifs where id = $1`, [gid]);
  revalidatePath("/dashboard/giphy");
}

/**
 * Check off a favorite as "used". Checking bumps the usage count + stamps
 * last_used_at; unchecking clears the box but keeps history so workflows can
 * rotate least-recently-used.
 */
export async function setGifChecked(id: string, checked: boolean): Promise<void> {
  const gid = cleanId(id);
  if (!gid) return;
  if (checked) {
    await query(
      `update gifs
          set checked = true, used_count = used_count + 1, last_used_at = now()
        where id = $1`,
      [gid],
    );
  } else {
    await query(`update gifs set checked = false where id = $1`, [gid]);
  }
  revalidatePath("/dashboard/giphy");
}

/** Save your notes on a GIF — what it's for / which persona / vibe. */
export async function setGifNotes(id: string, notes: string): Promise<void> {
  const gid = cleanId(id);
  if (!gid) return;
  await query(`update gifs set notes = $2 where id = $1`, [
    gid,
    String(notes ?? "").slice(0, 2000),
  ]);
  revalidatePath("/dashboard/giphy");
}
