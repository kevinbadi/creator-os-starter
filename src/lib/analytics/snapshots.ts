import "server-only";
import { dbConfigured, query } from "@/lib/insforge/db";
import { ttlRemember } from "@/lib/cache/ttl";
import type { ZernioPostMetrics } from "@/lib/zernio/types";

// Reads for the nightly `analytics_snapshots` table (scripts/analytics-snapshot.mjs,
// scheduled via the content-cron registry) and the `daily_view_snapshots` rollup.
// Overview header Views / avg views / m/m are that daily series — never live Zernio.

/**
 * Platform-native "views": X/Threads report impressions where every other
 * platform reports views — Kevin's rule is to treat those AS views everywhere.
 */
export function effectiveViews(m?: { views?: number | null; impressions?: number | null }): number {
  return Number(m?.views) || Number(m?.impressions) || 0;
}

/**
 * TikTok publish handles carry a text prefix — reduce to the numeric tail,
 * mirroring platformKey in scripts/analytics-snapshot.mjs, so live Zernio
 * platformPostIds join against snapshot rows.
 */
export function normalizePlatformPostId(id?: string | null): string | null {
  if (!id) return null;
  const m = String(id).match(/(\d{12,})\s*$/);
  return m ? m[1] : String(id);
}

const ET = "America/New_York";
const etDateOf = (d: Date): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ET }).format(d);

/** UTC instant of the ET midnight that starts the day AFTER the given instant. */
function nextEtMidnight(d: Date): Date {
  const [y, m, day] = etDateOf(d).split("-").map(Number);
  // ET is UTC-4 (EDT) or UTC-5 (EST); probe both offsets for the next date.
  const next = new Date(Date.UTC(y, m - 1, day + 1));
  const nextStr = etDateOf(new Date(next.getTime() + 12 * 3_600_000)); // noon UTC is same ET date year-round
  for (const off of [4, 5]) {
    const cand = new Date(next.getTime() + off * 3_600_000);
    if (etDateOf(cand) === nextStr && etDateOf(new Date(cand.getTime() - 1)) !== nextStr) {
      return cand;
    }
  }
  return new Date(next.getTime() + 5 * 3_600_000);
}

/**
 * Split a view count measured over [t0, t1] across the ET calendar days that
 * interval spans, proportional to time. This is how snapshot-to-snapshot
 * deltas become calendar cells: a delta captured 11 AM → 9 AM next day is
 * mostly YESTERDAY's viewing, so ~13/22 of it belongs on yesterday's cell —
 * attributing it all to the later snapshot's date made past days shrink and
 * "today" balloon whenever a snapshot ran late or a slot was missed.
 */
export function apportionAcrossETDays(
  t0: Date,
  t1: Date,
  total: number,
): { date: string; value: number }[] {
  if (!Number.isFinite(total) || total <= 0) return [];
  if (!(t1.getTime() > t0.getTime())) return [{ date: etDateOf(t1), value: total }];
  const spanMs = t1.getTime() - t0.getTime();
  const out: { date: string; value: number }[] = [];
  let cursor = t0;
  let assigned = 0;
  while (cursor.getTime() < t1.getTime()) {
    const dayEnd = nextEtMidnight(cursor);
    const sliceEnd = Math.min(dayEnd.getTime(), t1.getTime());
    const value = Math.round((total * (sliceEnd - cursor.getTime())) / spanMs);
    if (value > 0) out.push({ date: etDateOf(cursor), value });
    assigned += value;
    cursor = new Date(sliceEnd);
  }
  // Rounding drift lands on the last (most recent) day.
  if (out.length && assigned !== total) out[out.length - 1].value += total - assigned;
  return out.filter((e) => e.value > 0);
}

let indexesReady = false;

async function ensureSnapshotIndexes(): Promise<void> {
  if (indexesReady || !dbConfigured) return;
  try {
    await query(
      `create index if not exists analytics_snapshots_acct_post_date
         on analytics_snapshots (account_username, platform_post_id, snapshot_date)`,
    );
    await query(
      `create index if not exists analytics_snapshots_post_date
         on analytics_snapshots (platform_post_id, snapshot_date)`,
    );
    indexesReady = true;
  } catch {
    /* first read still works without the index */
  }
}

export type SnapshotBaseline = { views: number; capturedAt: string | null };

/**
 * Most recent snapshotted views per platform post (whatever day that post was
 * last captured), with WHEN it was captured. This is the baseline the
 * dashboard diffs fresh Zernio numbers against; the capture time lets the
 * live remainder be time-apportioned across days instead of all landing on
 * today's cell.
 */
export async function latestViewsByPlatformPost(
  accountUsernames?: string[],
): Promise<Map<string, SnapshotBaseline>> {
  const key = `snap:latestViews:${(accountUsernames ?? []).slice().sort().join(",")}`;
  return ttlRemember(key, 60_000, () => latestViewsByPlatformPostFresh(accountUsernames));
}

async function latestViewsByPlatformPostFresh(
  accountUsernames?: string[],
): Promise<Map<string, SnapshotBaseline>> {
  if (!dbConfigured) return new Map();
  if (accountUsernames && accountUsernames.length === 0) return new Map();
  try {
    const scope = accountUsernames?.length ? `where account_username = any($1)` : "";
    const rows = await query<{ id: string; v: number; cap: Date | string | null }>(
      `select distinct on (platform_post_id)
              platform_post_id as id,
              coalesce(nullif(views,0), impressions, 0)::int as v,
              captured_at as cap
         from analytics_snapshots
         ${scope}
        order by platform_post_id, snapshot_date desc`,
      accountUsernames?.length ? [accountUsernames] : [],
    );
    return new Map(
      rows.map((r) => [
        r.id,
        { views: Number(r.v), capturedAt: r.cap ? new Date(r.cap).toISOString() : null },
      ]),
    );
  } catch {
    return new Map();
  }
}

/**
 * All-time view totals straight from the snapshot table (latest capture per
 * post), overall and per platform. Used as the Views headline whenever the
 * live Zernio read came back incomplete — a headline summed from a partial
 * page set is what made the total change on every refresh (2026-07-31).
 */
export async function snapshotViewTotals(
  accountUsernames?: string[],
): Promise<{ total: number; byPlatform: [string, number][] }> {
  const key = `snap:totals:${(accountUsernames ?? []).slice().sort().join(",")}`;
  return ttlRemember(key, 60_000, () => snapshotViewTotalsFresh(accountUsernames));
}

async function snapshotViewTotalsFresh(
  accountUsernames?: string[],
): Promise<{ total: number; byPlatform: [string, number][] }> {
  if (!dbConfigured) return { total: 0, byPlatform: [] };
  if (accountUsernames && accountUsernames.length === 0) return { total: 0, byPlatform: [] };
  try {
    const scope = accountUsernames?.length ? `where account_username = any($1)` : "";
    const rows = await query<{ platform: string; views: string | number }>(
      `select coalesce(platform, 'other') as platform, sum(v)::bigint as views
         from (
           select distinct on (platform_post_id)
                  platform_post_id, platform,
                  coalesce(nullif(views,0), impressions, 0) as v
             from analytics_snapshots
             ${scope}
            order by platform_post_id, snapshot_date desc
         ) latest
        group by 1
        order by 2 desc`,
      accountUsernames?.length ? [accountUsernames] : [],
    );
    const byPlatform = rows.map((r) => [r.platform, Number(r.views)] as [string, number]);
    return { total: byPlatform.reduce((s, [, v]) => s + v, 0), byPlatform };
  } catch {
    return { total: 0, byPlatform: [] };
  }
}

export type SnapshotMetrics = ZernioPostMetrics & {
  /** Views gained since the previous snapshot day (undefined until 2 days exist). */
  viewsDelta?: number;
};

type Row = {
  platform_post_id: string;
  views: number; impressions: number; likes: number; comments: number; saves: number; shares: number;
  prev_views: number | null; prev_impressions: number | null;
};

/**
 * Latest snapshot per platform post, with day-over-day views delta once two
 * snapshot days exist. Keyed by normalized platform post id.
 */
export async function latestSnapshotMetrics(): Promise<{
  date: string | null;
  byPlatformPost: Map<string, SnapshotMetrics>;
}> {
  return ttlRemember("snap:latestMetrics", 60_000, latestSnapshotMetricsFresh);
}

async function latestSnapshotMetricsFresh(): Promise<{
  date: string | null;
  byPlatformPost: Map<string, SnapshotMetrics>;
}> {
  if (!dbConfigured) return { date: null, byPlatformPost: new Map() };
  try {
    const dates = await query<{ d: string }>(
      `select distinct snapshot_date::text as d from analytics_snapshots order by d desc limit 2`,
    );
    if (!dates.length) return { date: null, byPlatformPost: new Map() };
    const [latest, prev] = [dates[0]?.d, dates[1]?.d];
    const rows = await query<Row>(
      `select s.platform_post_id, s.views, s.impressions, s.likes, s.comments, s.saves, s.shares,
              p.views as prev_views, p.impressions as prev_impressions
         from analytics_snapshots s
         left join analytics_snapshots p
           on p.platform_post_id = s.platform_post_id and p.snapshot_date = $2::date
        where s.snapshot_date = $1::date`,
      [latest, prev ?? latest],
    );
    const map = new Map<string, SnapshotMetrics>();
    for (const r of rows) {
      const v = effectiveViews(r);
      const prevV =
        r.prev_views != null || r.prev_impressions != null
          ? effectiveViews({ views: r.prev_views, impressions: r.prev_impressions })
          : null;
      map.set(r.platform_post_id, {
        views: v, likes: Number(r.likes), comments: Number(r.comments),
        saves: Number(r.saves), shares: Number(r.shares),
        viewsDelta: prev && prevV != null ? v - prevV : undefined,
      });
    }
    return { date: latest ?? null, byPlatformPost: map };
  } catch {
    return { date: null, byPlatformPost: new Map() };
  }
}

export type DailyViewPoint = {
  date: string;
  totalViews: number;
  postCount: number;
  avgViews: number;
  gained: number;
};

export type DailyViewSlice = DailyViewPoint & {
  account: string;
  platform: string;
};

/** Posts published before this UTC instant stay out of header Views / avg. */
export const VIEWS_SINCE = "2026-06-01";

let dailyTableReady = false;

async function ensureDailyViewSnapshots(): Promise<boolean> {
  if (!dbConfigured) return false;
  if (!dailyTableReady) {
    try {
      await query(
        `create table if not exists daily_view_snapshots (
           snapshot_date date not null,
           account_username text not null default '',
           platform text not null default 'other',
           total_views bigint not null default 0,
           post_count int not null default 0,
           captured_at timestamptz not null default now(),
           unique (snapshot_date, account_username, platform)
         )`,
      );
      await query(
        `create index if not exists daily_view_snapshots_date_idx
           on daily_view_snapshots (snapshot_date desc)`,
      );
      dailyTableReady = true;
    } catch {
      return false;
    }
  }
  return true;
}

function packPoint(
  date: string,
  totalViews: number,
  postCount: number,
  gained: number,
): DailyViewPoint {
  return {
    date,
    totalViews,
    postCount,
    avgViews: postCount > 0 ? totalViews / postCount : 0,
    gained,
  };
}

/**
 * One ET-day series of lifetime view totals (and the day-over-day gain).
 * Header Views, avg views/post, m/m, and the Views heatmap all read this.
 */
export async function loadDailyViews(accountUsernames?: string[]): Promise<{
  latest: DailyViewPoint | null;
  series: DailyViewPoint[];
  slices: DailyViewSlice[];
  byPlatform: [string, number][];
}> {
  const empty = { latest: null, series: [], slices: [], byPlatform: [] as [string, number][] };
  if (!dbConfigured) return empty;
  if (accountUsernames && accountUsernames.length === 0) return empty;
  const key = `snap:dailyViews.v2:${(accountUsernames ?? []).slice().sort().join(",")}`;
  return ttlRemember(key, 60_000, () => loadDailyViewsFresh(accountUsernames));
}

async function loadDailyViewsFresh(accountUsernames?: string[]): Promise<{
  latest: DailyViewPoint | null;
  series: DailyViewPoint[];
  slices: DailyViewSlice[];
  byPlatform: [string, number][];
}> {
  const empty = { latest: null, series: [], slices: [], byPlatform: [] as [string, number][] };
  const tableReady = await ensureDailyViewSnapshots();
  try {
    const scope = accountUsernames?.length ? `where account_username = any($1)` : "";
    let rows: {
      date: string;
      account: string;
      platform: string;
      total_views: string | number;
      post_count: string | number;
    }[] = [];
    if (tableReady) {
      rows = await query(
        `select snapshot_date::text as date,
                account_username as account,
                platform,
                total_views,
                post_count
           from daily_view_snapshots
           ${scope}
          order by snapshot_date, account_username, platform`,
        accountUsernames?.length ? [accountUsernames] : [],
      );
    }
    if (!rows.length) {
      // Table is empty until tonight's cron; roll up analytics_snapshots so
      // the header has the same daily series immediately.
      const acct = accountUsernames?.length
        ? `and account_username = any($2)`
        : "";
      rows = await query(
        `select snapshot_date::text as date,
                coalesce(account_username, '') as account,
                coalesce(platform, 'other') as platform,
                sum(coalesce(nullif(views, 0), impressions, 0))::bigint as total_views,
                count(*)::int as post_count
           from analytics_snapshots
          where (published_at is null or published_at >= $1::timestamptz)
            ${acct}
          group by 1, 2, 3
          order by 1, 2, 3`,
        accountUsernames?.length
          ? [`${VIEWS_SINCE}T00:00:00Z`, accountUsernames]
          : [`${VIEWS_SINCE}T00:00:00Z`],
      );
    }
    if (!rows.length) return empty;

    const prevByKey = new Map<string, number>();
    const slices: DailyViewSlice[] = rows.map((r) => {
      const totalViews = Number(r.total_views);
      const postCount = Number(r.post_count);
      const key = `${r.account}\0${r.platform}`;
      const prev = prevByKey.get(key);
      prevByKey.set(key, totalViews);
      const gained = prev == null ? 0 : totalViews - prev;
      return {
        ...packPoint(r.date, totalViews, postCount, gained),
        account: r.account,
        platform: r.platform,
      };
    });

    const byDate = new Map<string, { totalViews: number; postCount: number; gained: number }>();
    for (const s of slices) {
      const cur = byDate.get(s.date) ?? { totalViews: 0, postCount: 0, gained: 0 };
      cur.totalViews += s.totalViews;
      cur.postCount += s.postCount;
      cur.gained += s.gained;
      byDate.set(s.date, cur);
    }
    const series = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => packPoint(date, v.totalViews, v.postCount, 0));
    let prevTotal: number | undefined;
    for (const point of series) {
      point.gained = prevTotal == null ? 0 : point.totalViews - prevTotal;
      prevTotal = point.totalViews;
    }
    const latest = series[series.length - 1] ?? null;

    const byPlatformMap = new Map<string, number>();
    if (latest) {
      for (const s of slices) {
        if (s.date !== latest.date) continue;
        byPlatformMap.set(s.platform, (byPlatformMap.get(s.platform) ?? 0) + s.totalViews);
      }
    }
    const byPlatform = [...byPlatformMap.entries()].sort((a, b) => b[1] - a[1]);
    return { latest, series, slices, byPlatform };
  } catch {
    return empty;
  }
}

/**
 * Daily view gains for the heatmap — consecutive daily_view_snapshots totals
 * (today − yesterday), attributed to the later snapshot date. No live catch-up
 * and no time-apportionment, so cells sum to the header m/m window.
 */
export async function dailyViewGains(
  /** Scope to these account usernames (the active channel's accounts) — the
   *  snapshot table is global across every connected profile. */
  accountUsernames?: string[],
): Promise<
  { date: string; platform: string; account: string | null; content: string | null; gained: number }[]
> {
  const { slices } = await loadDailyViews(accountUsernames);
  return slices
    .filter((s) => s.gained !== 0)
    .map((s) => ({
      date: s.date,
      platform: s.platform,
      account: s.account || null,
      content: null,
      gained: s.gained,
    }));
}

/** Shape the nightly series for avg-views / post (one snapshot per ET day). */
export function dailyViewsForAverages(data: {
  series: DailyViewPoint[];
  slices: DailyViewSlice[];
}): {
  days: { date: string; totalViews: number; postCount: number }[];
  platforms: { platform: string; date: string; totalViews: number; postCount: number }[];
  accounts: {
    username: string;
    platform: string;
    date: string;
    totalViews: number;
    postCount: number;
  }[];
} {
  const platforms = new Map<
    string,
    { platform: string; date: string; totalViews: number; postCount: number }
  >();
  for (const s of data.slices) {
    const k = `${s.platform}\0${s.date}`;
    const cur = platforms.get(k) ?? {
      platform: s.platform,
      date: s.date,
      totalViews: 0,
      postCount: 0,
    };
    cur.totalViews += s.totalViews;
    cur.postCount += s.postCount;
    platforms.set(k, cur);
  }
  return {
    days: data.series.map((d) => ({
      date: d.date,
      totalViews: d.totalViews,
      postCount: d.postCount,
    })),
    platforms: [...platforms.values()],
    accounts: data.slices.map((s) => ({
      username: s.account,
      platform: s.platform,
      date: s.date,
      totalViews: s.totalViews,
      postCount: s.postCount,
    })),
  };
}
