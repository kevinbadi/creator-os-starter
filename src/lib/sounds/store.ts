import "server-only";
import { dbConfigured, query } from "@/lib/insforge/db";

// Sounds now live in Insforge storage (audio) + the `sounds` table (metadata).
// Nothing is read from local disk — the dashboard works the same whether it runs
// on your laptop or deployed.

export type Sound = {
  id: string;
  title: string;
  author: string;
  duration: string; // M:SS or ""
  region: string;
  sourceUrl: string;
  audioUrl: string; // Insforge public URL
  mime: string;
  favorite: boolean;
  chart: "music" | "sounds";
  /** Checked off (used in a post/carousel). */
  checked: boolean;
  /** How many times it's been used — tracking. */
  usedCount: number;
  /** ISO timestamp of last use, or null. */
  lastUsedAt: string | null;
  /** Which creator gender this sound suits. "any" = usable by either. */
  gender: Gender;
  /** Free-text: what you think of it / what it should be used for. */
  notes: string;
  /** VIP boost window end (Kevin-pinned trending sound) — active VIPs ride
   *  the top of every pick queue. Null = not VIP. */
  vipUntil: string | null;
};

/** A sound can be tagged for female creators, male creators, or either. */
export type Gender = "female" | "male" | "any";

export type SoundSet = {
  date: string; // batch label, e.g. "2026-06-30_GLOBAL"
  sounds: Sound[];
};

type Row = {
  id: string;
  title: string;
  author: string | null;
  duration: number | null;
  region: string | null;
  batch: string | null;
  source_url: string | null;
  audio_url: string;
  mime: string | null;
  favorite: boolean;
  chart: string | null;
  checked: boolean;
  used_count: number | string | null;
  last_used_at: Date | string | null;
  gender: string | null;
  notes: string | null;
  vip_until: Date | string | null;
};

function toGender(g: string | null): Gender {
  return g === "female" || g === "male" ? g : "any";
}

function fmtDur(sec: number | null): string {
  const n = Math.round(Number(sec) || 0);
  return n ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}` : "";
}

function toSound(r: Row): Sound {
  return {
    id: r.id,
    title: r.title,
    author: r.author ?? "",
    duration: fmtDur(r.duration),
    region: r.region ?? "",
    sourceUrl: r.source_url ?? "",
    audioUrl: r.audio_url,
    mime: r.mime ?? "audio/mp4",
    favorite: Boolean(r.favorite),
    chart: r.chart === "sounds" ? "sounds" : "music",
    checked: Boolean(r.checked),
    usedCount: Number(r.used_count ?? 0),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
    gender: toGender(r.gender),
    notes: r.notes ?? "",
    vipUntil: r.vip_until ? new Date(r.vip_until).toISOString() : null,
  };
}

const COLS =
  "id, title, author, duration, region, batch, source_url, audio_url, mime, favorite, chart, checked, used_count, last_used_at, gender, notes, vip_until";

/** Visible (non-hidden) sounds grouped by batch, newest batch first. */
export async function listSoundSets(): Promise<SoundSet[]> {
  if (!dbConfigured) return [];

  const rows = await query<Row>(
    `select ${COLS}
       from sounds
      where not hidden
      order by created_at desc, title asc`,
  );

  const byBatch = new Map<string, Sound[]>();
  for (const r of rows) {
    const batch = r.batch || "Unsorted";
    if (!byBatch.has(batch)) byBatch.set(batch, []);
    byBatch.get(batch)!.push(toSound(r));
  }

  return Array.from(byBatch.entries()).map(([date, sounds]) => ({ date, sounds }));
}

/**
 * Favorited sounds — the curated allow-list that workflows may pull from for
 * carousels / picture posts. Newest first. Never includes hidden sounds.
 *
 * Pass a persona's gender (e.g. Megan → "female") to get only the sounds tagged
 * for that gender plus the "any"-gender ones — so a female creator never picks a
 * male-only sound, without you having to hand-review each batch.
 */
export async function listFavoriteSounds(gender?: Gender): Promise<Sound[]> {
  if (!dbConfigured) return [];
  // Filter by gender when asked: matching-gender + "any" are eligible. "any"
  // (or no arg) returns the full favorites list.
  const genderClause =
    gender && gender !== "any" ? ` and gender in ($1, 'any')` : "";
  const params = gender && gender !== "any" ? [gender] : [];
  // Queue order (matches the publishers): active VIPs first, then unused
  // favorites NEWEST-first (trending boosts decay in days), then LRU.
  const rows = await query<Row>(
    `select ${COLS}
       from sounds
      where favorite and not hidden${genderClause}
      order by (coalesce(vip_until, 'epoch'::timestamptz) > now()) desc,
               checked asc,
               (case when not checked then created_at end) desc nulls last,
               last_used_at asc nulls first`,
    params,
  );
  return rows.map(toSound);
}
