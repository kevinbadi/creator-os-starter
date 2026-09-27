import { effectiveViews } from "@/lib/analytics/snapshots";
import type { ZernioAnalyticsPost } from "@/lib/zernio/types";

// Cohorts are tracked for 60 days so the headline delta can be month-over-
// month (Kevin 2026-07-08: header trends are m/m); the sparkline series stays
// a tighter 14-day window where daily movement is actually visible.
const DAYS = 60;
const SERIES_DAYS = 14;
const DAY_MS = 86_400_000;

export type DayPoint = {
  /** ET publish date of the cohort (series runs oldest → newest). */
  date: string;
  posts: number;
  avg: number;
};

export type AccountAvgTrend = {
  /** Account username on the platform, or null when Zernio didn't attribute one. */
  username: string | null;
  posts: number;
  totalViews: number;
  avg: number;
  deltaPct: number | null;
  /** Last-7-days cohort avg vs the 7 before — the near-term growth signal. */
  delta7Pct: number | null;
  series: DayPoint[];
};

export type PlatformAvgTrend = {
  platform: string;
  posts: number;
  totalViews: number;
  /** All-time average views per platform post. */
  avg: number;
  /** Last-30-days cohort avg vs the 30 days before — null until both cohorts have posts. */
  deltaPct: number | null;
  /** Last-7-days cohort avg vs the 7 before — the near-term growth signal. */
  delta7Pct: number | null;
  /** Daily publish cohorts for the last 14 days. */
  series: DayPoint[];
  /** Per-account breakdown (multiple TikToks/IGs per channel), biggest first. */
  accounts: AccountAvgTrend[];
};

export type AvgViewsSummary = {
  posts: number;
  avg: number;
  deltaPct: number | null;
  delta7Pct: number | null;
  /** Daily overall avg-views cohorts, last 30 days — the growth chart. */
  trendSeries: DayPoint[];
  platforms: PlatformAvgTrend[];
};

const etDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);

type Acc = { posts: number; views: number; days: { posts: number; views: number }[] };
const mkAcc = (): Acc => ({
  posts: 0,
  views: 0,
  days: Array.from({ length: DAYS }, () => ({ posts: 0, views: 0 })),
});

/**
 * Average views per platform post — overall and per platform — with a trend
 * series of DAILY publish cohorts (last 14 ET days; the fleet posts every
 * day, so days beat weeks for spotting a trend early). The headline delta is
 * steadier and month-over-month: last-30-days cohort vs the 30 days before
 * (null until both months have posts). A Zernio post
 * fanned to 3 platforms counts as 3 platform posts. Zero-view published
 * posts drag the average down on purpose: that is the honest per-post
 * number. Views follow effectiveViews (X/Threads impressions count).
 */
export function avgViewsPerPost(analyticsPosts: ZernioAnalyticsPost[]): AvgViewsSummary {
  const todayMs = Date.parse(`${etDate(new Date())}T00:00:00Z`);
  const byPlatform = new Map<string, Acc>();
  const byAccount = new Map<string, Map<string | null, Acc>>();
  const overall = mkAcc();

  for (const p of analyticsPosts) {
    const dateIso = p.publishedAt ?? p.scheduledFor;
    if (!dateIso) continue;
    const postMs = Date.parse(`${etDate(new Date(dateIso))}T00:00:00Z`);
    if (Number.isNaN(postMs)) continue;
    const ageDays = Math.floor((todayMs - postMs) / DAY_MS);
    if (ageDays < 0) continue; // scheduled for the future
    for (const pl of p.platforms ?? []) {
      if (pl.status === "failed") continue;
      const views = effectiveViews(pl.analytics);
      let acc = byPlatform.get(pl.platform);
      if (!acc) byPlatform.set(pl.platform, (acc = mkAcc()));
      let accts = byAccount.get(pl.platform);
      if (!accts) byAccount.set(pl.platform, (accts = new Map()));
      const username = pl.accountUsername ?? null;
      let acctAcc = accts.get(username);
      if (!acctAcc) accts.set(username, (acctAcc = mkAcc()));
      for (const a of [acc, acctAcc, overall]) {
        a.posts += 1;
        a.views += views;
        if (ageDays < DAYS) {
          a.days[ageDays].posts += 1;
          a.days[ageDays].views += views;
        }
      }
    }
  }

  const daySeries = (a: Acc, days: number): DayPoint[] =>
    a.days
      .slice(0, days)
      .map((d, i) => ({
        date: new Date(todayMs - i * DAY_MS).toISOString().slice(0, 10),
        posts: d.posts,
        avg: d.posts ? d.views / d.posts : 0,
      }))
      .reverse();

  const summarize = (a: Acc) => {
    const bucket = (from: number, to: number) =>
      a.days.slice(from, to).reduce(
        (s, d) => ({ posts: s.posts + d.posts, views: s.views + d.views }),
        { posts: 0, views: 0 },
      );
    const cohortDelta = (window: number) => {
      const cur = bucket(0, window);
      const prev = bucket(window, window * 2);
      return cur.posts && prev.posts && prev.views > 0
        ? ((cur.views / cur.posts - prev.views / prev.posts) / (prev.views / prev.posts)) * 100
        : null;
    };
    return {
      posts: a.posts,
      avg: a.posts ? a.views / a.posts : 0,
      deltaPct: cohortDelta(30),
      delta7Pct: cohortDelta(7),
      series: daySeries(a, SERIES_DAYS),
    };
  };

  const platforms: PlatformAvgTrend[] = [...byPlatform.entries()]
    .map(([platform, a]) => ({
      platform,
      totalViews: a.views,
      ...summarize(a),
      accounts: [...(byAccount.get(platform) ?? new Map<string | null, Acc>()).entries()]
        .map(([username, acc]) => ({ username, totalViews: acc.views, ...summarize(acc) }))
        .sort((x, y) => y.totalViews - x.totalViews),
    }))
    .sort((x, y) => y.totalViews - x.totalViews);

  const o = summarize(overall);
  return {
    posts: o.posts,
    avg: o.avg,
    deltaPct: o.deltaPct,
    delta7Pct: o.delta7Pct,
    trendSeries: daySeries(overall, 30),
    platforms,
  };
}

function avgOf(total: number, posts: number): number {
  return posts > 0 ? total / posts : 0;
}

function prevYearMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function sumInMonth(
  rows: { date: string; value: number }[],
  ym: string,
  throughDay?: number,
): number {
  let s = 0;
  for (const r of rows) {
    if (!r.date.startsWith(ym)) continue;
    if (throughDay != null && Number(r.date.slice(8, 10)) > throughDay) continue;
    s += r.value;
  }
  return s;
}

/**
 * Header avg views/post: this ET calendar month's view gains ÷ posts
 * published this month (Kevin 2026-09-22: 1.1M views / 641 posts, not the
 * lifetime snapshot total ÷ lifetime post count).
 *
 * m/m compares the same day-of-month window last month (Sep 1–22 vs Aug 1–22)
 * so a live month is never scored against a completed one.
 */
export function monthAvgViewsPerPost(input: {
  viewGains: { date: string; value: number }[];
  postsDaily: { date: string; value: number }[];
  todayEt?: string;
}): { avg: number; posts: number; views: number; deltaPct: number | null } {
  const todayEt = input.todayEt ?? etDate(new Date());
  const ym = todayEt.slice(0, 7);
  const throughDay = Number(todayEt.slice(8, 10));
  const views = sumInMonth(input.viewGains, ym);
  const posts = sumInMonth(input.postsDaily, ym);
  const avg = avgOf(views, posts);
  const prev = prevYearMonth(ym);
  const prevAvg = avgOf(
    sumInMonth(input.viewGains, prev, throughDay),
    sumInMonth(input.postsDaily, prev, throughDay),
  );
  return {
    avg,
    posts,
    views,
    deltaPct: prevAvg > 0 ? ((avg - prevAvg) / prevAvg) * 100 : null,
  };
}

/** Day-over-day post_count on the lifetime snapshot series (first day = 0). */
export function postsDailyFromLifetimeCounts(
  series: { date: string; postCount: number }[],
): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  let prev: number | undefined;
  for (const d of series) {
    out.push({
      date: d.date,
      value: prev == null ? 0 : Math.max(0, d.postCount - prev),
    });
    prev = d.postCount;
  }
  return out;
}

function etAgeDays(date: string, todayEt: string): number {
  return Math.floor(
    (Date.parse(`${todayEt}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS,
  );
}

/** Latest daily avg vs the snapshot from `ago` ET days earlier (or the closest older day). */
function snapshotPointDelta(
  days: { date: string; totalViews: number; postCount: number }[],
  todayEt: string,
  ago: number,
): number | null {
  if (!days.length) return null;
  const latest = days.reduce((a, b) => (a.date > b.date ? a : b));
  const cur = avgOf(latest.totalViews, latest.postCount);
  const prior = days
    .filter((d) => etAgeDays(d.date, todayEt) >= ago)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!prior || prior.date === latest.date) return null;
  const prev = avgOf(prior.totalViews, prior.postCount);
  return prev > 0 ? ((cur - prev) / prev) * 100 : null;
}

function dailyAvgSeries(
  days: { date: string; totalViews: number; postCount: number }[],
  todayEt: string,
  length: number,
): DayPoint[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const todayMs = Date.parse(`${todayEt}T00:00:00Z`);
  const out: DayPoint[] = [];
  for (let i = length - 1; i >= 0; i--) {
    const date = new Date(todayMs - i * DAY_MS).toISOString().slice(0, 10);
    const d = byDate.get(date);
    out.push({
      date,
      posts: d?.postCount ?? 0,
      avg: d ? avgOf(d.totalViews, d.postCount) : 0,
    });
  }
  return out;
}

function summarizeDailyDays(
  days: { date: string; totalViews: number; postCount: number }[],
  todayEt: string,
) {
  const latest = days.reduce(
    (a, b) => (a.date > b.date ? a : b),
    days[0] ?? { date: "", totalViews: 0, postCount: 0 },
  );
  return {
    posts: latest?.postCount ?? 0,
    avg: latest ? avgOf(latest.totalViews, latest.postCount) : 0,
    deltaPct: snapshotPointDelta(days, todayEt, 30),
    delta7Pct: snapshotPointDelta(days, todayEt, 7),
    series: dailyAvgSeries(days, todayEt, SERIES_DAYS),
  };
}

/**
 * Avg views / post from the nightly daily_view_snapshots series — one number
 * per ET day, so header m/m is "today's snapshot vs 30 days ago", not a live
 * Zernio page-1 mix.
 */
export function avgViewsFromDailyTotals(input: {
  days: { date: string; totalViews: number; postCount: number }[];
  platforms: { platform: string; date: string; totalViews: number; postCount: number }[];
  accounts?: {
    username: string;
    platform: string;
    date: string;
    totalViews: number;
    postCount: number;
  }[];
}): AvgViewsSummary {
  const todayEt = etDate(new Date());
  const byPlatform = new Map<string, { date: string; totalViews: number; postCount: number }[]>();
  for (const row of input.platforms) {
    const list = byPlatform.get(row.platform) ?? [];
    list.push(row);
    byPlatform.set(row.platform, list);
  }
  const byAccount = new Map<
    string,
    Map<string, { date: string; totalViews: number; postCount: number }[]>
  >();
  for (const row of input.accounts ?? []) {
    let plats = byAccount.get(row.platform);
    if (!plats) byAccount.set(row.platform, (plats = new Map()));
    const list = plats.get(row.username) ?? [];
    list.push(row);
    plats.set(row.username, list);
  }

  const platforms: PlatformAvgTrend[] = [...byPlatform.entries()]
    .map(([platform, days]) => {
      const s = summarizeDailyDays(days, todayEt);
      const latest = days.reduce((a, b) => (a.date > b.date ? a : b));
      return {
        platform,
        totalViews: latest?.totalViews ?? 0,
        ...s,
        accounts: [...(byAccount.get(platform) ?? new Map<string, { date: string; totalViews: number; postCount: number }[]>()).entries()]
          .map(([username, accDays]) => {
            const a = summarizeDailyDays(accDays, todayEt);
            const last = accDays.reduce((x, y) => (x.date > y.date ? x : y));
            return { username: username || null, totalViews: last?.totalViews ?? 0, ...a };
          })
          .sort((x, y) => y.totalViews - x.totalViews),
      };
    })
    .sort((x, y) => y.totalViews - x.totalViews);

  const o = summarizeDailyDays(input.days, todayEt);
  return {
    posts: o.posts,
    avg: o.avg,
    deltaPct: o.deltaPct,
    delta7Pct: o.delta7Pct,
    trendSeries: dailyAvgSeries(input.days, todayEt, 30),
    platforms,
  };
}
