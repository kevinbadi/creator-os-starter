import { after } from "next/server";
import Link from "next/link";
import { normalizeAccount } from "@/components/SocialAccounts";
import { PlatformBadge } from "@/components/PlatformBadge";
import { AudienceBreakdown } from "@/components/AudienceBreakdown";
import type { HeatmapEntry } from "@/components/CalendarHeatmap";
import { MonthlyCalendar } from "@/components/MonthlyCalendar";
import { AvgViewsPerPost } from "@/components/AvgViewsPerPost";
import { avgViewsFromDailyTotals, monthAvgViewsPerPost } from "@/lib/analytics/post-averages";
import { FollowerGrowthHeatmap } from "@/components/FollowerGrowthHeatmap";
import { ApiKeyChip } from "@/components/ApiKeyChip";
import { CompactSocials } from "@/components/CompactSocials";
import { PostsFeed } from "@/components/PostsFeed";
import { NewCustomersChart } from "@/components/NewCustomersChart";
import { KpiStrip } from "@/components/KpiStrip";
import { CountUp } from "@/components/CountUp";
import { RailwayTimeline } from "@/components/RailwayTimeline";
import { buildChannelKpis } from "@/lib/channels/kpis";
import { mergeAgentCreatedPosts } from "@/lib/channels/posts";
import { loadPostFeedOverlays } from "@/lib/posts/overlays";
import { postWhen } from "@/lib/posts/status";
import { listRailwayAutomations, latestManagerReport } from "@/lib/automations/railway";
import {
  getAnalyticsForProfiles,
  listAccounts,
  listExternalPosts,
  listPosts,
  listProfiles,
  syncExternalPosts,
} from "@/lib/zernio/client";
import { getNewCustomersDaily, getOverviewMetrics, fillEtDailyCounts } from "@/lib/revenuecat/client";
import { getNewSubscribersDailySplit } from "@/lib/revenuecat/subs";
import { getWebVisitorsDaily } from "@/lib/posthog/client";
import { getActiveChannel } from "@/lib/channels/store";
import { personaSlugsForChannel } from "@/lib/channels/personas";
import { formatFullNumber, formatNumber, platformLabel } from "@/lib/format";
import {
  dailyViewsForAverages,
  loadDailyViews,
} from "@/lib/analytics/snapshots";
import {
  followerGrowthLive,
  dailyFollowerGains,
  latestFollowerSnapshotCounts,
  recordDisplayedFollowerCounts,
  type FollowerGrowth,
} from "@/lib/analytics/followers";
import { freshFollowerCounts } from "@/lib/followers/live";
import { dbConfigured, query } from "@/lib/insforge/db";
import type {
  ZernioAccount,
  ZernioAnalytics,
  ZernioPost,
} from "@/lib/zernio/types";

function deadline<T>(fn: () => Promise<T>, fallback: T, ms: number): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    fn()
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch(() => {
        clearTimeout(t);
        resolve(fallback);
      });
  });
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export const metadata = {
  title: "Overview · Marketing OS",
};


export default async function OverviewPage() {
  const t0 = Date.now();
  const active = await getActiveChannel();
  const profileIds = active?.zernioProfileIds ?? [];

  // One round-trip: accounts, posts, analytics (page 1), and side panels
  // together. The old path waited on accounts → live follower scrapes → then
  // a second Zernio fan-out, which is why Overview sat for a minute.
  const [
    accountsArraysRaw,
    automations,
    manager,
    allProfiles,
    rcOverview,
    postsArrays,
    externalArrays,
    analyticsArr,
    customersDaily30,
    newSubscribersSplit,
    visitorsDaily30,
  ] = await Promise.all([
    deadline(
      () =>
        Promise.all(
          profileIds.map((pid) => safe(() => listAccounts(pid), [] as ZernioAccount[])),
        ),
      [] as ZernioAccount[][],
      3000,
    ),
    deadline(
      () =>
        personaSlugsForChannel(active).then((slugs) =>
          listRailwayAutomations({
            personas: slugs,
            includeShared: active?.id === "app-1",
          }),
        ),
      [],
      2500,
    ),
    deadline(() => latestManagerReport(), null, 1500),
    deadline(() => listProfiles(), [], 3000),
    deadline(
      () =>
        active?.revenuecatProjectId
          ? getOverviewMetrics(active.revenuecatProjectId, active.revenuecatApiKey)
          : Promise.resolve(null),
      null,
      2500,
    ),
    deadline(
      async () => {
        const arrays = profileIds.length
          ? await Promise.all(
              profileIds.flatMap((pid) => [
                safe(() => listPosts({ limit: 100, profileId: pid }), [] as ZernioPost[]),
              ]),
            )
          : [];
        const merged = await mergeAgentCreatedPosts(arrays.flat());
        return [merged];
      },
      [] as ZernioPost[][],
      4000,
    ),
    deadline(
      () =>
        Promise.all(
          profileIds.map((pid) => safe(() => listExternalPosts(pid), [] as ZernioPost[])),
        ),
      [] as ZernioPost[][],
      3000,
    ),
    deadline(() => getAnalyticsForProfiles(profileIds), [] as (ZernioAnalytics | null)[], 3000),
    deadline(
      () =>
        active?.revenuecatProjectId
          ? getNewCustomersDaily(active.revenuecatProjectId, 30, active.revenuecatApiKey)
          : Promise.resolve([]),
      [],
      2500,
    ),
    deadline(
      () =>
        active?.revenuecatProjectId
          ? getNewSubscribersDailySplit(active.revenuecatProjectId, 30, active.revenuecatApiKey)
          : Promise.resolve({ ios: [], web: [] }),
      { ios: [], web: [] },
      2500,
    ),
    deadline(
      () =>
        active?.posthogProjectId
          ? getWebVisitorsDaily(
              active.id,
              active.posthogProjectId,
              active.posthogHost ?? "https://us.posthog.com",
              30,
            )
          : Promise.resolve([]),
      [],
      2500,
    ),
  ]);

  // Banned/dead accounts hidden from the Overview but left connected in
  // Zernio so their post history keeps counting. Megan TikTok #2
  // (@megancreatorcoach) banned 2026-07-12 — remove the id here when Kevin
  // connects the replacement.
  const HIDDEN_ACCOUNT_IDS = new Set(["ZERNIO_ACCOUNT_5"]);
  const accountsFlatRaw0 = accountsArraysRaw
    .flat()
    .filter((a) => !HIDDEN_ACCOUNT_IDS.has(a._id));

  // Live follower counts (public-page scrape reconciled with Zernio's nightly
  // sync). Zernio only re-syncs ~midnight ET, so without this the chips sat on
  // yesterday's numbers all day (Kevin 2026-09-11). Scrapes are cached 15 min
  // by the fetch cache; the deadline keeps a slow platform from holding the
  // page — those accounts just show Zernio's figure.
  const lastKnown = await deadline(
    () => latestFollowerSnapshotCounts(accountsFlatRaw0.map((a) => a._id)),
    new Map<string, number>(),
    1500,
  );
  const fresh = await deadline(
    () => freshFollowerCounts(accountsFlatRaw0, lastKnown),
    new Map<string, number>(),
    3500,
  );
  const applyFresh = (a: ZernioAccount): ZernioAccount =>
    fresh.has(a._id) ? { ...a, followersCount: fresh.get(a._id) } : a;
  const accountsArraysFresh = accountsArraysRaw.map((arr) => arr.map(applyFresh));
  const profileNameById = new Map(allProfiles.map((p) => [p._id, p.name]));
  const accountsFlatRaw = accountsFlatRaw0.map(applyFresh);
  const displayedCounts = new Map(
    accountsFlatRaw.map((a) => [a._id, normalizeAccount(a).followers] as const),
  );

  // Don't block the page on Zernio's per-account external sync (30 POSTs
  // with 429 retries was the 80s Overview). Run it after the response, and
  // stamp today's follower snapshot with what we just displayed so growth
  // tracking never lags the chips.
  after(() => {
    void Promise.allSettled(accountsFlatRaw.map((a) => syncExternalPosts(a._id)));
    void recordDisplayedFollowerCounts(
      accountsArraysFresh.flatMap((arr, i) =>
        arr
          .filter((a) => !HIDDEN_ACCOUNT_IDS.has(a._id))
          .map((a) => ({
            profileId: profileIds[i] ?? (typeof a.profileId === "string" ? a.profileId : a.profileId?._id ?? ""),
            profileName: profileNameById.get(profileIds[i] ?? "") ?? null,
            accountId: a._id,
            platform: a.platform ?? null,
            username: normalizeAccount(a).username ?? null,
            followers: displayedCounts.get(a._id) ?? 0,
          })),
      ),
    );
  });

  const channelUsernames = [
    ...new Set(
      accountsFlatRaw.flatMap((a) => {
        const n = normalizeAccount(a);
        const pd = a.metadata?.profileData;
        return [n.username, a.username, pd?.username].filter(
          (u): u is string => Boolean(u),
        );
      }),
    ),
  ];

  const [
    growth,
    followerGains,
    dailyViews,
    keyRows,
  ] = await Promise.all([
    deadline(
      () => followerGrowthLive(accountsFlatRaw.map((a) => a._id), displayedCounts),
      new Map<string, FollowerGrowth>(),
      2500,
    ),
    // 400 days covers the Year heatmap (52 weeks) with headroom past DST edges.
    deadline(() => dailyFollowerGains(accountsFlatRaw.map((a) => a._id), 400), [], 2500),
    deadline(
      () => loadDailyViews(channelUsernames),
      { latest: null, series: [], slices: [], byPlatform: [] as [string, number][] },
      5000,
    ),
    deadline(
      () =>
        dbConfigured
          ? query<{
              zernio_profile_id: string;
              api_key: string | null;
              api_key_name: string | null;
              api_key_preview: string | null;
            }>(
              `select zernio_profile_id, api_key, api_key_name, api_key_preview
                 from channel_profiles where channel_id = $1`,
              [active?.id ?? ""],
            )
          : Promise.resolve([]),
      [],
      1500,
    ),
  ]);

  const accountsArrays = accountsArraysFresh.map((arr) =>
    arr.filter((a) => !HIDDEN_ACCOUNT_IDS.has(a._id)),
  );
  const accounts = accountsArrays.flat();

  const analyticsList = analyticsArr.filter(Boolean) as ZernioAnalytics[];
  // Align customers / subscribers / visitors onto the same contiguous ET-day
  // window so the Web + iOS charts never drift (Kevin 2026-09-16).
  const CHART_DAYS = 30;
  const customersByDay = new Map(customersDaily30.map((d) => [d.date, d.count]));
  const iosSubsByDay = new Map(newSubscribersSplit.ios.map((d) => [d.date, d.count]));
  const webSubsByDay = new Map(newSubscribersSplit.web.map((d) => [d.date, d.count]));
  const visitorsByDay = new Map(visitorsDaily30.map((d) => [d.date, d.visitors]));
  const emptyDaily30 = fillEtDailyCounts(new Map(), CHART_DAYS);
  const newCustomersDaily =
    customersDaily30.length === 0 && active?.type === "app"
      ? emptyDaily30
      : fillEtDailyCounts(customersByDay, CHART_DAYS);
  const iosSubscribersDaily = fillEtDailyCounts(iosSubsByDay, CHART_DAYS);
  const webSubscribersDaily = fillEtDailyCounts(webSubsByDay, CHART_DAYS);
  const webVisitorsDaily = fillEtDailyCounts(visitorsByDay, CHART_DAYS);

  const avgViews = avgViewsFromDailyTotals(dailyViewsForAverages(dailyViews));
  console.log(
    `[overview] ${Date.now() - t0}ms profiles=${profileIds.length} accounts=${accounts.length}`,
  );

  const nameById = new Map(allProfiles.map((p) => [p._id, p.name]));

  const keyByProfile = new Map<string, { name: string | null; preview: string | null; full: string | null }>();
  for (const r of keyRows) {
    keyByProfile.set(r.zernio_profile_id, {
      name: r.api_key_name,
      preview: r.api_key_preview,
      full: r.api_key,
    });
  }

  // One labeled group per profile (e.g. the app's socials vs. an influencer's).
  const groups = profileIds.map((pid, i) => {
    const accts = accountsArrays[i] ?? [];
    return {
      profileId: pid,
      name: nameById.get(pid) ?? "Profile",
      accounts: accts,
      followers: accts.reduce((s, a) => s + normalizeAccount(a).followers, 0),
      dayGain: accts.reduce((s, a) => s + (growth.get(a._id)?.day ?? 0), 0),
      apiKey: keyByProfile.get(pid) ?? null,
    };
  });

  // App channels are sectioned B2C (mobile app) / B2B (web) — the Creator OS
  // layout is the template for every app channel (Kevin 2026-09-10: Hoops AI
  // must match it, headers included). Creator OS keeps its exact labels and
  // known profile → section map; other apps use their channel name and land
  // every profile in the mobile-app section until told otherwise. Non-app
  // channels render the flat list as before.
  const isCreatorOs = active?.id === "app-1";
  const appName = active?.name ?? "App";
  const SOCIAL_SECTIONS = isCreatorOs
    ? [
        {
          key: "b2c",
          label: "Creator OS · mobile app & creators (B2C)",
          ids: [
            "ZERNIO_PROFILE_BRAND", // brand socials
            "ZERNIO_PROFILE_KEV", // kev persona
            "ZERNIO_PROFILE_MEGAN", // megan
            "ZERNIO_PROFILE_DANNY", // danny
          ],
          fallback: false,
        },
        {
          key: "b2b",
          label: "Creator OS web · agencies & businesses (B2B)",
          ids: [] as string[],
          fallback: true,
        },
      ]
    : [
        {
          key: "b2c",
          label: `${appName} · mobile app & users (B2C)`,
          ids: [] as string[],
          fallback: true,
        },
        {
          key: "b2b",
          label: `${appName} web · agencies & businesses (B2B)`,
          ids: [] as string[],
          fallback: false,
        },
      ];
  const sectionOf = (pid: string) =>
    SOCIAL_SECTIONS.find((s) => s.ids.includes(pid)) ??
    SOCIAL_SECTIONS.find((s) => s.fallback) ??
    SOCIAL_SECTIONS[0];
  const sectioned = active?.type === "app";
  const socialSections = SOCIAL_SECTIONS.map((s) => ({
    ...s,
    groups: groups.filter((g) => sectionOf(g.profileId).key === s.key),
  }));

  // The marketing operation started late June; connected pages carry older
  // history from previous projects (2026-04 "long vidddd"-era upload tests on
  // the brand's Facebook page surfaced in the feed once analytics pagination
  // fetched the full catalog, Kevin 2026-07-12). Anything published before
  // this date is not Creator OS content — drop it everywhere.
  const CONTENT_SINCE = Date.parse("2026-06-01T00:00:00Z");
  const freshOnly = (p: {
    publishedAt?: string | null;
    scheduledFor?: string | null;
    createdAt?: string;
    platforms?: unknown;
  }) => {
    const extra = Array.isArray(p.platforms)
      ? (p.platforms as { publishedAt?: string }[])
          .map((pl) => pl.publishedAt)
          .filter(Boolean)
          .sort()
          .pop()
      : undefined;
    const ts = Date.parse(
      p.publishedAt ?? extra ?? p.scheduledFor ?? p.createdAt ?? "",
    );
    return Number.isNaN(ts) || ts >= CONTENT_SINCE;
  };
  const allPosts = postsArrays.flat().filter(freshOnly);

  // Heatmap + headline: nightly daily_view_snapshots only. Each cell is
  // yesterday→today total for that account×platform, so they add up to the
  // header m/m window and never twitch on refresh.
  const viewsEntries: HeatmapEntry[] = dailyViews.slices
    .filter((s) => s.gained !== 0)
    .map((s) => ({
      date: `${s.date}T00:00:00`,
      value: s.gained,
      label: `${s.account ? `@${s.account}` : ""} · ${platformLabel(s.platform)}`.trim(),
    }));
  const viewsTotal = dailyViews.latest?.totalViews ?? 0;
  const viewsPlatforms = dailyViews.byPlatform;

  // Content calendar counts one entry per social post (a Zernio post fanned to
  // 3 platforms = 3 social posts) and labels each with its account, so the
  // day tooltip shows exactly which socials posted on that day. External
  // posts (published outside Zernio, freshly synced above) are included too;
  // their platforms[].accountId arrives populated as an object.
  const acctLabel = new Map(
    accounts.map((a) => {
      const n = normalizeAccount(a);
      return [a._id, `@${n.username ?? "account"} · ${platformLabel(a.platform)}`];
    }),
  );
  const socialLabel = (pl: ZernioPost["platforms"][number]): string => {
    if (pl.accountId && typeof pl.accountId === "object") {
      const u = pl.accountId.username;
      const plat = platformLabel(pl.accountId.platform ?? pl.platform);
      return u ? `@${u} · ${plat}` : plat;
    }
    return (
      (pl.accountId ? acctLabel.get(pl.accountId) : undefined) ??
      platformLabel(pl.platform)
    );
  };

  const seenPostIds = new Set<string>();
  const feedPosts = [...allPosts, ...externalArrays.flat().filter(freshOnly)];
  const contentEntries: HeatmapEntry[] = feedPosts
    .filter((p) => !seenPostIds.has(p._id) && (seenPostIds.add(p._id), true))
    .flatMap((p) => {
      const date = postWhen(p) ?? p.createdAt ?? null;
      const plats = (p.platforms ?? []).filter((pl) => pl.status !== "failed");
      if (plats.length === 0) return [{ date, value: 1 }];
      return plats.map((pl) => ({ date, value: 1, label: socialLabel(pl) }));
    });

  // Collapse content entries to ET-day totals for the Posts m/m header chip.
  const postsByDay = new Map<string, number>();
  for (const e of contentEntries) {
    if (!e.date || !e.value) continue;
    const d = new Date(e.date);
    if (Number.isNaN(d.getTime())) continue;
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
    postsByDay.set(key, (postsByDay.get(key) ?? 0) + e.value);
  }
  const postsDaily = [...postsByDay.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const monthAvg = monthAvgViewsPerPost({
    viewGains: dailyViews.series.map((d) => ({ date: d.date, value: d.gained })),
    postsDaily,
  });
  if (monthAvg.posts > 0) {
    avgViews.avg = monthAvg.avg;
    avgViews.posts = monthAvg.posts;
    avgViews.deltaPct = monthAvg.deltaPct;
  }

  const kpis = active
    ? await buildChannelKpis({
        channel: active,
        accounts,
        analyticsList,
        rcOverview,
        dailyViewSeries: dailyViews.series,
        customersDaily: customersDaily30,
        visitorsDaily: visitorsDaily30,
        viewsTotal: dailyViews.latest?.totalViews ?? 0,
        avgViews,
        followerGains,
        postsDaily,
      })
    : [];

  const feedOverlays = await deadline(
    () => loadPostFeedOverlays(feedPosts.map((p) => p._id)),
    {},
    1500,
  );

  return (
    <main className="stagger w-full px-6 pb-8 pt-4">
      {kpis.length > 0 ? <KpiStrip items={kpis} /> : null}

      {profileIds.length === 0 ? (
        <p className="card mt-4 border-dashed! text-sm text-neutral-600 dark:text-[#b6bac2]">
          This channel has no Zernio profiles yet.{" "}
          <Link href="/dashboard/channels" className="font-medium underline">
            Attach profiles
          </Link>{" "}
          to see its accounts, views, and posts.
        </p>
      ) : null}

      {/* Socials take the LEFT HALF only (Kevin 2026-07-14) — follower
          growth + manager ride beside them so the charts sit above the fold. */}
      <section className="mt-4 grid gap-4 lg:grid-cols-2 lg:items-stretch">
        <div className="card flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between">
          <h2 className="card-title">
            Connected socials
            <span className="num ml-2 font-sans text-xs not-italic text-neutral-400">
              {accounts.length}
            </span>
          </h2>
          <Link
            href="/dashboard/clients"
            className="eyebrow transition hover:text-neutral-900 dark:hover:text-white"
          >
            Manage
          </Link>
        </div>
        {(() => {
          // Compact rows (Kevin 2026-07-14): icons + follower counts only,
          // details on hover — the charts must fit above the fold.
          // Rows share leftover height so a short list still fills the
          // stretched card instead of leaving a dead zone above Audience.
          const groupRow = (g: (typeof groups)[number]) => (
            <div key={g.profileId} className="flex min-h-0 flex-1 items-stretch gap-3 py-1.5">
              <div className="flex w-32 shrink-0 flex-col justify-center">
                <p className="truncate text-[11px] font-semibold leading-tight">{g.name}</p>
                <p className="text-[9px] leading-tight text-neutral-400 tabular-nums">
                  {formatNumber(g.followers)}
                  <GrowthBadge value={g.dayGain} />
                </p>
                <div className="mt-1.5 hidden xl:block">
                  <ApiKeyChip
                    preview={g.apiKey?.preview ?? null}
                    name={g.apiKey?.name ?? null}
                    fullKey={g.apiKey?.full ?? null}
                  />
                </div>
              </div>
              <div className="min-h-0 min-w-0 flex-1">
                <CompactSocials
                  items={g.accounts.map((a) => {
                    const n = normalizeAccount(a);
                    return {
                      id: n.id,
                      username: n.username ?? null,
                      platform: n.platform,
                      pic: n.pic ?? null,
                      followers: n.followers,
                      url: n.url ?? null,
                      dayGain: growth.get(n.id)?.day ?? null,
                    };
                  })}
                />
              </div>
            </div>
          );
          if (!sectioned) {
            return (
              <div className="mt-2 flex min-h-0 flex-1 flex-col divide-y divide-black/[.06] dark:divide-white/[.08]">
                {groups.map(groupRow)}
              </div>
            );
          }
          return (
            <div className="mt-2 flex min-h-0 flex-1 flex-col">
              {socialSections.map((s, i) => (
                <div
                  key={s.key}
                  className={
                    i > 0
                      ? "mt-2 flex min-h-0 flex-col border-t border-dashed border-black/[.12] pt-2 dark:border-white/[.14]"
                      : "flex min-h-0 flex-col"
                  }
                  style={{ flexGrow: Math.max(s.groups.length, 0) }}
                >
                  <p className="eyebrow shrink-0">
                    {s.label}
                  </p>
                  {s.groups.length > 0 ? (
                    <div className="flex min-h-0 flex-1 flex-col divide-y divide-black/[.06] dark:divide-white/[.08]">
                      {s.groups.map(groupRow)}
                    </div>
                  ) : (
                    <p className="py-2 text-xs text-neutral-400">
                      No socials connected yet — attach {s.key === "b2b" ? "the web app's" : "the app's"} Zernio
                      profile and it lands here.
                    </p>
                  )}
                </div>
              ))}
            </div>
          );
        })()}
        <div className="mt-auto shrink-0 border-t border-black/[.06] pt-3 dark:border-white/[.08]">
          <AudienceBreakdown accounts={accounts} compact />
        </div>
        </div>

        <FollowerGrowthHeatmap
          gains={followerGains}
          label={active?.name}
        />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-3 lg:items-start">
        <div className="space-y-4 lg:col-span-2">
          {isCreatorOs &&
          (newCustomersDaily.length > 0 || webVisitorsDaily.length > 0) ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <NewCustomersChart
                variant="web"
                data={[]}
                subscribers={webSubscribersDaily}
                traffic={webVisitorsDaily}
              />
              <NewCustomersChart
                variant="ios"
                data={newCustomersDaily}
                subscribers={iosSubscribersDaily}
              />
            </div>
          ) : null}
          {/* Silver + cyan ramps mirror the New Customers chart's two series
              (Kevin 2026-07-11): posting activity in the neutral silver,
              views in the cyan accent. */}
          <MonthlyCalendar
            title="Content calendar"
            unit="posts"
            entries={contentEntries}
            palette="silver"
          />
          <MonthlyCalendar
            title="Views"
            unit="views"
            entries={viewsEntries}
            palette="cyan"
            headline={
              <div>
                {/* All-time — the month header shows the displayed month's
                    sum; these differ whenever views live on other months'
                    cells (e.g. pre-July back-catalog posts). */}
                <p className="num font-serif text-[30px] leading-none tracking-tight">
                  <CountUp value={formatFullNumber(viewsTotal)} />
                  <span className="ml-2 font-sans text-xs not-italic text-neutral-500">
                    all time
                  </span>
                </p>
                {viewsPlatforms.length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {viewsPlatforms.map(([platform, v]) => (
                      <span
                        key={platform}
                        className="inline-flex items-center gap-1.5 rounded-full border border-black/[.08] px-2 py-0.5 text-[11px] text-neutral-600 dark:border-white/[.12] dark:text-neutral-300"
                      >
                        <PlatformBadge platform={platform} />
                        <span className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                          {formatNumber(v)}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            }
          />
        </div>

        <div className="space-y-4">
          <RailwayTimeline items={automations} manager={manager} />
        </div>
      </section>

      {/* Full-width strips (2026-09-14): avg views as a two-up platform grid,
          then the feed two-up — no more 1,500px column of whitespace. */}
      <section className="mt-4">
        <AvgViewsPerPost data={avgViews} wide />
      </section>

      <section className="mt-4">
        <PostsFeed
          posts={feedPosts}
          labelFor={socialLabel}
          overlays={feedOverlays}
          columns={2}
        />
      </section>
    </main>
  );
}

function GrowthBadge({ value }: { value: number | null | undefined }) {
  if (!value) return null; // no history yet, or flat day — no badge
  return (
    <span
      className={`ml-1 font-medium tabular-nums ${
        value > 0
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-red-500 dark:text-red-400"
      }`}
    >
      {value > 0 ? "▲" : "▼"}
      {formatNumber(Math.abs(value))}
    </span>
  );
}

// (AccountChips card grid replaced by CompactSocials icons+hover, 2026-07-14.)

