import "server-only";
import { dbConfigured, query } from "@/lib/insforge/db";

// Favorited GIFs live in the `gifs` table — row existence = favorited. Like
// sounds, favorites are the curated allow-list workflows may pull from.

export type SavedGif = {
  id: string; // Giphy id
  title: string;
  preview: string; // animated gif for grids
  mp4: string; // what workflows actually post (carousel-safe everywhere)
  query: string; // search term it was favorited under
  /** Checked off (used in a post/carousel). */
  checked: boolean;
  usedCount: number;
  lastUsedAt: string | null;
  /** Free-text: what it's for / which persona / vibe. */
  notes: string;
  createdAt: string;
};

type Row = {
  id: string;
  title: string;
  preview_url: string;
  mp4_url: string;
  query: string | null;
  checked: boolean;
  used_count: number | string | null;
  last_used_at: Date | string | null;
  notes: string | null;
  created_at: Date | string;
};

function toGif(r: Row): SavedGif {
  return {
    id: r.id,
    title: r.title,
    preview: r.preview_url,
    mp4: r.mp4_url,
    query: r.query ?? "",
    checked: Boolean(r.checked),
    usedCount: Number(r.used_count ?? 0),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
    notes: r.notes ?? "",
    createdAt: new Date(r.created_at).toISOString(),
  };
}

const COLS =
  "id, title, preview_url, mp4_url, query, checked, used_count, last_used_at, notes, created_at";

/** All favorited GIFs, newest first — what the dashboard page shows. */
export async function listSavedGifs(): Promise<SavedGif[]> {
  if (!dbConfigured) return [];
  const rows = await query<Row>(
    `select ${COLS} from gifs order by created_at desc`,
  );
  return rows.map(toGif);
}

/**
 * Favorited GIFs for workflows, unchecked/least-recently-used first so
 * pipelines rotate rather than repeat. Same contract as listFavoriteSounds.
 */
export async function listFavoriteGifs(): Promise<SavedGif[]> {
  if (!dbConfigured) return [];
  const rows = await query<Row>(
    `select ${COLS}
       from gifs
      order by checked asc, last_used_at asc nulls first, created_at desc`,
  );
  return rows.map(toGif);
}
