import "server-only";
import { dbConfigured, query } from "@/lib/insforge/db";
import { ttlRemember } from "@/lib/cache/ttl";
import { isCompactGrainDrop } from "@/lib/followers/live";

// Follower growth per account, from the `follower_snapshots` table written by
// scripts/follower-snapshot.mjs (registry job `follower-growth`). The live
// count on each Overview chip stays fresh Zernio — this module only supplies
// the deltas, so it degrades to empty (no badges) until snapshots accumulate.

export type FollowerGrowth = {
  /** Followers gained since the previous snapshot day (null = no history yet). */
  day: number | null;
  /** Followers gained over the last 7 days of snapshots (null = single day). */
  week: number | null;
};

export type DailyFollowerGain = {
  date: string;
  gained: number;
  /** Platform with the largest denoised net gain that day (null if none / unknown). */
  topPlatform: string | null;
};

// Public follower counts wobble a few every day from platform recounts / bot
// purges (TikTok especially) — noise that isn't real growth or loss. Summed
// across big accounts this jitter can drag a genuinely-flat/up day negative
// (Kevin 2026-07-15: chart showed -3 on a day of real gains, driven by two
// TikTok recounts of -9 and -7). Big accounts keep a dead-band:
// |delta| > max(2, 0.15% of base). Small accounts (Kev AI IG/TikTok/Threads/X
// at tens of followers) grow +1 at a time — the old flat floor of 2 zeroed
// those days so only Kev AI YouTube (~5k) landed in kevbuildsapps totals.
const NOISE_MIN_FOLLOWERS = 100;
const NOISE_FLOOR_SQL = `case
  when followers >= ${NOISE_MIN_FOLLOWERS}
   and abs(delta) <= greatest(2, followers * 0.0015) then 0
  else delta
end`;

function denoiseFollowerDelta(from: number | null, to: number): number | null {
  if (from == null) return null;
  if (isCompactGrainDrop(from, to)) return 0;
  const delta = to - from;
  const floor = to >= NOISE_MIN_FOLLOWERS ? Math.max(2, to * 0.0015) : 0;
  return Math.abs(delta) > floor ? delta : 0;
}

/** Net follower change per day, summed across the given accounts — one row
 *  per snapshot day that has a previous day to diff against, with per-account
 *  recount noise filtered out. Feeds the Overview's follower-growth heatmap. */
export async function dailyFollowerGains(
  accountIds: string[],
  days = 120,
): Promise<DailyFollowerGain[]> {
  if (!dbConfigured || accountIds.length === 0) return [];
  const key = `snap:folGains:v4:${days}:${[...accountIds].sort().join(",")}`;
  return ttlRemember(key, 60_000, () => dailyFollowerGainsFresh(accountIds, days));
}

async function dailyFollowerGainsFresh(
  accountIds: string[],
  days: number,
): Promise<DailyFollowerGain[]> {
  try {
    const rows = await query<{
      date: string;
      gained: number;
      top_platform: string | null;
    }>(
      `with deltas as (
         select snapshot_date,
                lower(coalesce(nullif(trim(platform), ''), 'unknown')) as platform,
                followers,
                followers - lag(followers) over (
                  partition by account_id order by snapshot_date
                ) as delta
           from follower_snapshots
          where account_id = any($1)
       ),
       clean as (
         select snapshot_date, platform,
                ${NOISE_FLOOR_SQL} as delta
           from deltas
          where delta is not null
            and snapshot_date >= current_date - $2::int
       ),
       by_day as (
         select snapshot_date, sum(delta)::int as gained
           from clean
          group by snapshot_date
       ),
       by_plat as (
         select snapshot_date, platform, sum(delta)::int as gained,
                row_number() over (
                  partition by snapshot_date
                  order by sum(delta) desc, platform asc
                ) as rn
           from clean
          group by snapshot_date, platform
       )
       select d.snapshot_date::text as date,
              d.gained,
              case
                when p.platform is null or p.platform = 'unknown' or p.gained <= 0 then null
                else p.platform
              end as top_platform
         from by_day d
         left join by_plat p
           on p.snapshot_date = d.snapshot_date and p.rn = 1
        order by d.snapshot_date`,
      [accountIds, days],
    );
    return rows.map((r) => ({
      date: r.date,
      gained: r.gained,
      topPlatform: r.top_platform,
    }));
  } catch {
    return []; // table appears with the first snapshot run
  }
}

/** Growth per Zernio account id. Accounts without ≥2 snapshot days are absent. */
export async function followerGrowthByAccount(
  accountIds: string[],
): Promise<Map<string, FollowerGrowth>> {
  const out = new Map<string, FollowerGrowth>();
  if (!dbConfigured || accountIds.length === 0) return out;
  const key = `snap:folGrowth:v3:${[...accountIds].sort().join(",")}`;
  return ttlRemember(key, 60_000, () => followerGrowthByAccountFresh(accountIds));
}

async function followerGrowthByAccountFresh(
  accountIds: string[],
): Promise<Map<string, FollowerGrowth>> {
  const out = new Map<string, FollowerGrowth>();
  try {
    const rows = await query<{
      account_id: string;
      latest: number;
      prev_day: number | null;
      week_ago: number | null;
    }>(
      `select t.account_id,
              t.followers as latest,
              prev.followers as prev_day,
              wk.followers as week_ago
         from (
           select distinct on (account_id) account_id, snapshot_date, followers
             from follower_snapshots
            where account_id = any($1)
            order by account_id, snapshot_date desc
         ) t
         left join lateral (
           select followers from follower_snapshots p
            where p.account_id = t.account_id and p.snapshot_date < t.snapshot_date
            order by p.snapshot_date desc limit 1
         ) prev on true
         left join lateral (
           select followers from follower_snapshots w
            where w.account_id = t.account_id
              and w.snapshot_date >= t.snapshot_date - 7
              and w.snapshot_date < t.snapshot_date
            order by w.snapshot_date asc limit 1
         ) wk on true`,
      [accountIds],
    );
    // Same recount dead-band as the heatmap: a chip's ▲/▼ badge shows only
    // when the move clears the noise floor, so TikTok recount jitter doesn't
    // render as a red "▼9" on a flat day.
    for (const r of rows) {
      if (r.prev_day == null && r.week_ago == null) continue;
      out.set(r.account_id, {
        day: denoiseFollowerDelta(r.prev_day, r.latest),
        week: denoiseFollowerDelta(r.week_ago, r.latest),
      });
    }
  } catch {
    // Table may not exist until the first snapshot run — no badges is fine.
  }
  return out;
}

/** ET calendar day, matching scripts/follower-snapshot.mjs. */
function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

/**
 * Growth measured from the count the Overview is about to display (Zernio +
 * live scrape) against the stored snapshots strictly before today ET, so the
 * badge tracks the chip instead of the last cron capture. Accounts missing
 * from `current` fall back to snapshot-vs-snapshot.
 */
export async function followerGrowthLive(
  accountIds: string[],
  current: Map<string, number>,
): Promise<Map<string, FollowerGrowth>> {
  const base = await followerGrowthByAccount(accountIds);
  if (!dbConfigured || current.size === 0) return base;
  const ids = accountIds.filter((id) => current.has(id));
  if (ids.length === 0) return base;
  const today = etToday();
  const key = `snap:folBase:${today}:${[...ids].sort().join(",")}`;
  const rows = await ttlRemember(key, 60_000, async () => {
    try {
      return await query<{ account_id: string; prev_day: number | null; week_ago: number | null }>(
        `select a.account_id,
                prev.followers as prev_day,
                wk.followers as week_ago
           from unnest($1::text[]) as a(account_id)
           left join lateral (
             select followers from follower_snapshots p
              where p.account_id = a.account_id and p.snapshot_date < $2::date
              order by p.snapshot_date desc limit 1
           ) prev on true
           left join lateral (
             select followers from follower_snapshots w
              where w.account_id = a.account_id
                and w.snapshot_date >= $2::date - 7
                and w.snapshot_date < $2::date
              order by w.snapshot_date asc limit 1
           ) wk on true`,
        [ids, today],
      );
    } catch {
      return [];
    }
  });
  const out = new Map(base);
  for (const r of rows) {
    const latest = current.get(r.account_id);
    if (latest == null || (r.prev_day == null && r.week_ago == null)) continue;
    out.set(r.account_id, {
      day: denoiseFollowerDelta(r.prev_day, latest),
      week: denoiseFollowerDelta(r.week_ago, latest),
    });
  }
  return out;
}

/** Latest stored count per account — used so a rounded 29.8K scrape cannot
 *  knock a chip down from yesterday's 29.9K. */
export async function latestFollowerSnapshotCounts(
  accountIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!dbConfigured || accountIds.length === 0) return out;
  try {
    const rows = await query<{ account_id: string; followers: number }>(
      `select distinct on (account_id) account_id, followers
         from follower_snapshots
        where account_id = any($1)
        order by account_id, snapshot_date desc`,
      [accountIds],
    );
    for (const r of rows) out.set(r.account_id, Number(r.followers) || 0);
  } catch {
    // table appears with the first snapshot run
  }
  return out;
}

export type FollowerSnapshotRow = {
  profileId: string;
  profileName: string | null;
  accountId: string;
  platform: string | null;
  username: string | null;
  followers: number;
};

/**
 * Upsert today's ET snapshot rows from the counts the Overview displayed, so
 * the heatmap/badges never lag the chips until the 9/21 ET cron. Only rows
 * that raise the stored value are written (cron captures stay authoritative
 * for drops), and at most once per account per minute via the TTL cache.
 */
export async function recordDisplayedFollowerCounts(rows: FollowerSnapshotRow[]): Promise<number> {
  if (!dbConfigured || rows.length === 0) return 0;
  const today = etToday();
  let written = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.followers) || r.followers <= 0) continue;
    const key = `snap:folWrite:${today}:${r.accountId}:${r.followers}`;
    const done = await ttlRemember(key, 60_000, async () => {
      try {
        const res = await query<{ id: number }>(
          `insert into follower_snapshots
             (snapshot_date, profile_id, profile_name, account_id, platform, username, followers, captured_at)
           values ($1,$2,$3,$4,$5,$6,$7,now())
           on conflict (snapshot_date, account_id) do update
             set followers = excluded.followers, captured_at = now()
             where follower_snapshots.followers < excluded.followers
           returning id`,
          [today, r.profileId, r.profileName, r.accountId, r.platform, r.username, r.followers],
        );
        return res.length;
      } catch {
        return 0;
      }
    });
    written += done;
  }
  return written;
}
