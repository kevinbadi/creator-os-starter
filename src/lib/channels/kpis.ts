import {
  dailyViewsForAverages,
  loadDailyViews,
  type DailyViewPoint,
} from "@/lib/analytics/snapshots";
import {
  avgViewsFromDailyTotals,
  monthAvgViewsPerPost,
  postsDailyFromLifetimeCounts,
} from "@/lib/analytics/post-averages";
import { dailyFollowerGains } from "@/lib/analytics/followers";
import { getNewCustomersDaily, getOverviewMetrics, type RevenueCatOverview } from "@/lib/revenuecat/client";
import { getMrrMonthOverMonth, recordOverviewSnapshot } from "@/lib/revenuecat/mrr-history";
import { getWebVisitorsDaily } from "@/lib/posthog/client";
import "server-only";
import type { Channel } from "./types";
import type { Kpi } from "@/components/KpiStrip";
import { getAnalytics, listAccounts } from "@/lib/zernio/client";
import { withFreshFollowers } from "@/lib/followers/live";
import { normalizeAccount } from "@/components/SocialAccounts";
import { formatFullNumber, formatNumber } from "@/lib/format";
import { usdToCad } from "@/lib/fx";
import type { ZernioAccount, ZernioAnalytics } from "@/lib/zernio/types";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Growth %: last N ET days vs the N days before, from a date→value series. */
function periodOverPeriod(
  points: { date: string; value: number }[],
  days: number,
): number | null {
  // Age by calendar ET day string (YYYY-MM-DD), not Date.parse-as-UTC —
  // that was shifting evening ET into the wrong bucket.
  const todayEt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
  const todayMs = Date.parse(`${todayEt}T12:00:00Z`);
  let cur = 0;
  let prev = 0;
  for (const p of points) {
    const age = Math.floor((todayMs - Date.parse(`${p.date}T12:00:00Z`)) / 86_400_000);
    if (age >= 0 && age < days) cur += p.value;
    else if (age >= days && age < days * 2) prev += p.value;
  }
  return prev > 0 ? ((cur - prev) / prev) * 100 : null;
}

export type ChannelKpiInputs = {
  channel: Channel;
  accounts: ZernioAccount[];
  analyticsList: ZernioAnalytics[];
  rcOverview: RevenueCatOverview | null;
  /** Nightly view totals — one number per ET day. Header Views / m/m / avg. */
  dailyViewSeries: DailyViewPoint[];
  customersDaily: { date: string; count: number }[];
  visitorsDaily: { date: string; visitors: number }[];
  viewsTotal?: number;
  avgViews?: { avg: number; posts: number; deltaPct: number | null; delta7Pct: number | null };
  /** Daily net follower gains — powers Audience m/m on personal channels. */
  followerGains?: { date: string; gained: number }[];
  /** Posts published per day (ET date string) — powers Posts m/m. */
  postsDaily?: { date: string; value: number }[];
};

/** Build the header strip from data the Overview already loaded — do not
 *  refetch Zernio / RevenueCat / PostHog here. */
export async function buildChannelKpis(input: ChannelKpiInputs): Promise<Kpi[]> {
  const { channel, accounts, analyticsList, rcOverview } = input;

  const viewsTrend = periodOverPeriod(
    (input.dailyViewSeries ?? []).map((g) => ({ date: g.date, value: g.gained })),
    30,
  );
  const downloadsTrend = periodOverPeriod(
    input.customersDaily.map((d) => ({ date: d.date, value: d.count })),
    30,
  );
  const visitorsPoints = input.visitorsDaily.map((d) => ({ date: d.date, value: d.visitors }));
  const visitorsTrend = periodOverPeriod(visitorsPoints, 30);
  const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const todayMs2 = Date.parse(`${todayEt}T00:00:00Z`);
  const visitors30 = visitorsPoints.reduce((s, p) => {
    const age = Math.floor((todayMs2 - Date.parse(`${p.date}T00:00:00Z`)) / 86_400_000);
    return age >= 0 && age < 30 ? s + p.value : s;
  }, 0);
  const visitorsKpi: Kpi | null = channel.posthogProjectId
    ? {
        label: "Visitors",
        value: formatNumber(visitors30),
        sub: visitorsTrend != null ? "m/m · 30d" : "web · 30d",
        trend: visitorsTrend,
        accent: true,
      }
    : null;

  const totalAudience = accounts.reduce(
    (s, a) => s + normalizeAccount(a).followers,
    0,
  );
  const latest = input.dailyViewSeries[input.dailyViewSeries.length - 1];
  const totalViews = input.viewsTotal ?? latest?.totalViews ?? 0;
  const publishedPosts = analyticsList.reduce(
    (s, a) => s + (a.overview?.publishedPosts ?? 0),
    0,
  );

  const fallbackAvg = input.avgViews ?? {
    avg: latest?.avgViews ?? 0,
    posts: latest?.postCount ?? 0,
    deltaPct: null,
    delta7Pct: null,
  };
  const monthAvg = monthAvgViewsPerPost({
    viewGains: (input.dailyViewSeries ?? []).map((d) => ({ date: d.date, value: d.gained })),
    postsDaily:
      input.postsDaily?.length
        ? input.postsDaily
        : postsDailyFromLifetimeCounts(input.dailyViewSeries ?? []),
    todayEt,
  });
  const useMonth = monthAvg.posts > 0;
  const avgKpi: Kpi = {
    label: "Avg views/post",
    value: formatNumber(Math.round(useMonth ? monthAvg.avg : fallbackAvg.avg)),
    sub: useMonth ? "m/m · this month" : fallbackAvg.deltaPct != null ? "m/m" : `${fallbackAvg.posts} posts`,
    trend: useMonth ? monthAvg.deltaPct : fallbackAvg.deltaPct ?? fallbackAvg.delta7Pct,
  };

  // Audience m/m: net followers gained in the last 30 ET days as a % of the
  // count at the start of that window (current − gains).
  const audienceGain30 = (() => {
    const gains = input.followerGains ?? [];
    if (gains.length === 0) return null;
    const todayEt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
    }).format(new Date());
    const todayMs = Date.parse(`${todayEt}T00:00:00Z`);
    let sum = 0;
    let days = 0;
    for (const g of gains) {
      const age = Math.floor((todayMs - Date.parse(`${g.date}T00:00:00Z`)) / 86_400_000);
      if (age >= 0 && age < 30) {
        sum += g.gained;
        days += 1;
      }
    }
    return days > 0 ? sum : null;
  })();
  const audienceThen =
    audienceGain30 != null ? totalAudience - audienceGain30 : null;
  const audienceTrend =
    audienceThen != null && audienceThen > 0
      ? (audienceGain30! / audienceThen) * 100
      : null;

  const postsTrend = periodOverPeriod(input.postsDaily ?? [], 30);

  const rc = (id: string) => rcOverview?.metrics.find((m) => m.id === id);
  const kpis: Kpi[] = [];

  if (visitorsKpi) kpis.push(visitorsKpi);

  if (rcOverview) {
    const dl = rc("new_customers");
    const subs = rc("active_subscriptions");
    const mrr = rc("mrr");
    if (dl) kpis.push({ label: "Downloads", value: formatNumber(dl.value), sub: downloadsTrend != null ? "m/m · 28d" : "Last 28 days", trend: downloadsTrend, accent: true });
    kpis.push({ label: "Views", value: formatFullNumber(totalViews), sub: viewsTrend != null ? "m/m gains" : "daily snapshot", trend: viewsTrend });
    kpis.push(avgKpi);
    if (subs) kpis.push({ label: "Subscribers", value: formatNumber(subs.value), sub: "Active" });
    if (mrr) {
      // Persist today's overview so ARR m/m has a real baseline in 30 days
      // (fire-and-forget — the header never waits on the write).
      if (channel.revenuecatProjectId) {
        void recordOverviewSnapshot(channel.revenuecatProjectId, rcOverview);
      }
      // CAD via live FX, but no "CA$" / "· CAD" labels — Kevin already knows (2026-09-16).
      const [cad, mrrTrend] = await Promise.all([
        usdToCad(),
        channel.revenuecatProjectId
          ? safe(() => getMrrMonthOverMonth(channel.revenuecatProjectId!, mrr.value), null)
          : Promise.resolve(null),
      ]);
      const arr = Math.round(mrr.value * 12 * cad);
      // Valuation is a fixed multiple of ARR, so both chips move by the same
      // m/m %. "est." flags the pre-history estimate from active-sub counts.
      const growthSub =
        mrrTrend == null
          ? null
          : mrrTrend.basis === "snapshot"
            ? "m/m"
            : mrrTrend.basis === "recent"
              ? `${mrrTrend.days}d`
              : "est.";
      kpis.push({
        label: "ARR",
        value: `$${formatFullNumber(arr)}`,
        sub: growthSub ? `${growthSub} · MRR × 12` : "MRR × 12",
        trend: mrrTrend?.pct ?? null,
      });
      kpis.push({
        label: "Valuation",
        value: `$${formatFullNumber(arr * 4)}`,
        sub: growthSub ? `${growthSub} · ARR × 4` : "ARR × 4",
        trend: mrrTrend?.pct ?? null,
      });
    }
    kpis.push({
      label: "Audience",
      value: totalAudience.toLocaleString("en-US"),
      sub: audienceTrend != null ? "m/m" : "followers",
      trend: audienceTrend,
    });
  } else if (channel.type === "app") {
    // Every app channel shares the Creator OS header layout (Kevin
    // 2026-09-10: Hoops AI must be formatted the same) — same chips in the
    // same order, with unwired metrics shown as placeholders until the
    // channel's RevenueCat / PostHog credentials are attached.
    if (!visitorsKpi) kpis.unshift({ label: "Visitors", value: "—", sub: "connect PostHog", accent: true });
    kpis.push({ label: "Downloads", value: "—", sub: "connect RevenueCat", accent: true });
    kpis.push({ label: "Views", value: formatFullNumber(totalViews), sub: viewsTrend != null ? "m/m gains" : "daily snapshot", trend: viewsTrend });
    kpis.push(avgKpi);
    kpis.push({ label: "Subscribers", value: "—", sub: "Active" });
    kpis.push({ label: "ARR", value: "—", sub: "MRR × 12" });
    kpis.push({ label: "Valuation", value: "—", sub: "ARR × 4" });
    kpis.push({
      label: "Audience",
      value: totalAudience.toLocaleString("en-US"),
      sub: audienceTrend != null ? "m/m" : "followers",
      trend: audienceTrend,
    });
  } else {
    // Personal / UGC / yt-automation (e.g. Kev Builds Apps): Kevin 2026-09-16
    // — Audience (m/m), Views, Posts, Avg views/post, Socials.
    kpis.push({
      label: "Audience",
      value: totalAudience.toLocaleString("en-US"),
      sub: audienceTrend != null ? "m/m" : "followers",
      trend: audienceTrend,
    });
    kpis.push({
      label: "Views",
      value: formatFullNumber(totalViews),
      sub: viewsTrend != null ? "m/m gains" : "daily snapshot",
      trend: viewsTrend,
    });
    kpis.push({
      label: "Posts",
      value: formatFullNumber(publishedPosts),
      sub: postsTrend != null ? "m/m" : "published",
      trend: postsTrend,
    });
    kpis.push(avgKpi);
    kpis.push({ label: "Socials", value: String(accounts.length), sub: "connected" });
  }

  return kpis;
}

/** Headline KPIs when a page has not already loaded the Overview bundle. */
export async function getChannelKpis(channel: Channel | null): Promise<Kpi[]> {
  if (!channel) return [];
  const profileIds = channel.zernioProfileIds;

  const [accountsArrays, analyticsArr, rcOverview] = await Promise.all([
    Promise.all(
      profileIds.map((pid) => safe(() => listAccounts(pid), [] as ZernioAccount[])),
    ),
    Promise.all(
      profileIds.map((pid) => safe(() => getAnalytics(pid, { page: 1 }), null)),
    ),
    safe(
      () =>
        channel.revenuecatProjectId
          ? getOverviewMetrics(channel.revenuecatProjectId, channel.revenuecatApiKey)
          : Promise.resolve(null),
      null,
    ),
  ]);

  const accounts = await safe(
    () => withFreshFollowers(accountsArrays.flat()),
    accountsArrays.flat(),
  );
  const analyticsList = analyticsArr.filter(Boolean) as ZernioAnalytics[];
  const channelUsernames = accounts
    .map((a) => normalizeAccount(a).username)
    .filter((u): u is string => Boolean(u));
  const [dailyViews, customersDaily, visitorsDaily, followerGains] = await Promise.all([
    safe(() => loadDailyViews(channelUsernames), {
      latest: null,
      series: [],
      slices: [],
      byPlatform: [] as [string, number][],
    }),
    safe(
      () =>
        channel.revenuecatProjectId
          ? getNewCustomersDaily(channel.revenuecatProjectId, 60, channel.revenuecatApiKey)
          : Promise.resolve([]),
      [],
    ),
    safe(
      () =>
        channel.posthogProjectId
          ? getWebVisitorsDaily(
              channel.id,
              channel.posthogProjectId,
              channel.posthogHost ?? "https://us.posthog.com",
              60,
            )
          : Promise.resolve([]),
      [],
    ),
    safe(
      () => dailyFollowerGains(accounts.map((a) => a._id), 60),
      [] as { date: string; gained: number }[],
    ),
  ]);
  const avgViews = avgViewsFromDailyTotals(dailyViewsForAverages(dailyViews));

  return buildChannelKpis({
    channel,
    accounts,
    analyticsList,
    rcOverview,
    dailyViewSeries: dailyViews.series,
    customersDaily,
    visitorsDaily,
    viewsTotal: dailyViews.latest?.totalViews ?? 0,
    avgViews,
    followerGains,
  });
}
