import { PageHeader } from "@/components/PageHeader";
import { PlatformBadge } from "@/components/PlatformBadge";
import { AudienceBreakdown } from "@/components/AudienceBreakdown";
import { getAnalytics, listAccounts, listExternalPosts, listPosts } from "@/lib/zernio/client";
import { platformPostLink } from "@/lib/zernio/links";
import { effectiveViews } from "@/lib/analytics/snapshots";
import { clicksBySource } from "@/lib/analytics/attribution";
import { getActiveChannel } from "@/lib/channels/store";
import { formatNumber, relativeTime } from "@/lib/format";
import type {
  ZernioAccount,
  ZernioAnalyticsPost,
  ZernioPost,
  ZernioPostMetrics,
} from "@/lib/zernio/types";

export const metadata = { title: "Analytics · Marketing OS" };

/** Normalize platform ids (TikTok publish handles → numeric tail). */
function platformKey(id?: string | null): string | null {
  if (!id) return null;
  const m = String(id).match(/(\d{12,})\s*$/);
  return m ? m[1] : String(id);
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  twitter: "X",
  threads: "Threads",
  linkedin: "LinkedIn",
  facebook: "Facebook",
};

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; platform?: string }>;
}) {
  const { sort, platform } = await searchParams;
  const sortMode = sort === "recent" ? "recent" : "views";
  const active = await getActiveChannel();
  const profileIds = active?.zernioProfileIds ?? [];

  // Fan out across every profile in the channel (analytics + posts + accounts).
  const [analyticsArr, postsArr, externalArr, accountsArr, sources] = await Promise.all([
    Promise.all(profileIds.map((pid) => safe(() => getAnalytics(pid, { page: 1 }), null))),
    Promise.all(
      profileIds.map((pid) => safe(() => listPosts({ limit: 100, profileId: pid }), [] as ZernioPost[])),
    ),
    // Video uploads synced FROM the platforms (YouTube etc.) are "external"
    // posts — a separate endpoint, but they carry the preview media.
    Promise.all(
      profileIds.map((pid) => safe(() => listExternalPosts(pid), [] as ZernioPost[])),
    ),
    Promise.all(profileIds.map((pid) => safe(() => listAccounts(pid), [] as ZernioAccount[]))),
    safe(() => clicksBySource(), []),
  ]);

  const analyticsPosts: ZernioAnalyticsPost[] = analyticsArr
    .filter(Boolean)
    .flatMap((a) => a!.posts ?? []);
  const accounts = accountsArr.flat();

  // Preview media: analytics documents carry no media — join to the feed post
  // that owns the same platform post id. Prefer an image; video-only posts
  // (reels, shorts) fall back to the video itself so uploads still preview.
  const mediaByPlatformKey = new Map<string, { url: string; type: "image" | "video" }>();
  // Our threads inflate the platform's comment count with their OWN child
  // items (Threads counts the whole chain, X counts the root's direct reply).
  // Map platform post id → self-replies to subtract so "comments" means real
  // audience comments.
  const selfRepliesByPlatformKey = new Map<string, number>();
  for (const p of [...postsArr.flat(), ...externalArr.flat()]) {
    const img = (p.mediaItems ?? []).find((m) => m.type === "image");
    const vid = (p.mediaItems ?? []).find((m) => m.type === "video");
    const media = img ?? vid;
    for (const pl of p.platforms ?? []) {
      const k = platformKey(pl.platformPostId);
      if (!k) continue;
      if (media && !mediaByPlatformKey.has(k)) {
        mediaByPlatformKey.set(k, { url: media.url, type: media.type });
      }
      const items = (pl.platformSpecificData as { threadItems?: unknown[] } | undefined)
        ?.threadItems?.length ?? 0;
      if (items > 1) {
        selfRepliesByPlatformKey.set(k, pl.platform === "twitter" ? 1 : items - 1);
      }
    }
  }
  /** Audience comments only — the post's own thread items subtracted. */
  const realComments = (
    pl: { platformPostId?: string | null },
    comments: number | undefined,
  ): number => {
    const k = platformKey(pl.platformPostId);
    const self = k ? (selfRepliesByPlatformKey.get(k) ?? 0) : 0;
    return Math.max(0, (comments ?? 0) - self);
  };

  // Platform filter (?platform=instagram|tiktok|…): scopes the list, the
  // totals AND the view sort to that platform's own numbers.
  const presentPlatforms = [
    ...new Set(analyticsPosts.flatMap((p) => (p.platforms ?? []).map((pl) => pl.platform))),
  ].sort();
  const platformFilter =
    platform && presentPlatforms.includes(platform) ? platform : null;
  const platformEntries = (p: ZernioAnalyticsPost) =>
    (p.platforms ?? []).filter((pl) => !platformFilter || pl.platform === platformFilter);
  const filtered = platformFilter
    ? analyticsPosts.filter((p) => platformEntries(p).length > 0)
    : analyticsPosts;

  const totals = filtered.reduce(
    (acc, p) => {
      const a = p.analytics ?? {};
      const pls = platformEntries(p);
      if (platformFilter) {
        // Platform-scoped: sum only that platform's entries.
        for (const pl of pls) {
          const m = pl.analytics ?? {};
          acc.views += effectiveViews(m);
          acc.likes += m.likes ?? 0;
          acc.comments += realComments(pl, m.comments);
          acc.saves += m.saves ?? 0;
        }
      } else {
        acc.views += effectiveViews(a);
        acc.likes += a.likes ?? 0;
        // Comments come from the platform entries so thread self-replies can
        // be subtracted per platform; post-level a.comments is the raw sum.
        acc.comments += pls.length
          ? pls.reduce((s, pl) => s + realComments(pl, pl.analytics?.comments), 0)
          : (a.comments ?? 0);
        acc.saves += a.saves ?? 0;
      }
      return acc;
    },
    { views: 0, likes: 0, comments: 0, saves: 0 },
  );

  // Sort toggle (?sort=views|recent): best-performing first with zero-view
  // posts sunk to the bottom, or a straight newest-first timeline. With a
  // platform filter, "views" means that platform's views.
  const when = (p: ZernioAnalyticsPost) =>
    Date.parse(p.publishedAt ?? p.scheduledFor ?? "") || 0;
  const viewsOf = (p: ZernioAnalyticsPost) =>
    platformFilter
      ? platformEntries(p).reduce((s, pl) => s + effectiveViews(pl.analytics ?? {}), 0)
      : effectiveViews(p.analytics);
  const top = [...filtered].sort((a, b) => {
    if (sortMode === "recent") return when(b) - when(a);
    const diff = viewsOf(b) - viewsOf(a);
    if (diff !== 0) return diff;
    return when(b) - when(a);
  });

  const pageUrl = (opts: { sort?: string; platform?: string | null }) => {
    const q = new URLSearchParams();
    const s = "sort" in opts ? opts.sort : sortMode === "recent" ? "recent" : undefined;
    const pf = "platform" in opts ? opts.platform : platformFilter;
    if (s === "recent") q.set("sort", "recent");
    if (pf) q.set("platform", pf);
    const qs = q.toString();
    return `/dashboard/analytics${qs ? `?${qs}` : ""}`;
  };

  return (
    <main className="w-full px-6 py-8">
      <PageHeader
        title="Analytics"
        description={`Performance for ${active?.name ?? "your channels"} — every post with its per-platform numbers.`}
      />

      {(() => {
        const scope = platformFilter
          ? ` · ${PLATFORM_LABELS[platformFilter] ?? platformFilter}`
          : "";
        return (
          <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label={`Views${scope}`} value={formatNumber(totals.views)} />
            <Stat label={`Likes${scope}`} value={formatNumber(totals.likes)} />
            <Stat label={`Comments${scope}`} value={formatNumber(totals.comments)} />
            <Stat label={`Saves${scope}`} value={formatNumber(totals.saves)} />
          </section>
        );
      })()}

      <section className="mt-8 overflow-hidden rounded-2xl border border-black/[.08] bg-white dark:border-white/[.14] dark:bg-[var(--surface-1)]">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-black/[.06] px-5 py-3 dark:border-white/[.12]">
          <h2 className="text-sm font-medium">
            {platformFilter ? `${PLATFORM_LABELS[platformFilter] ?? platformFilter} posts` : "All posts"}
            {sortMode === "recent" ? ", most recent" : " by views"}
            {top.length > 0 ? (
              <span className="ml-2 font-normal text-neutral-400">{top.length}</span>
            ) : null}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-black/[.04] p-0.5 dark:bg-white/[.09]">
              {[
                { key: null, label: "All" },
                ...presentPlatforms.map((pf) => ({ key: pf, label: PLATFORM_LABELS[pf] ?? pf })),
              ].map((t) => (
                <a
                  key={t.key ?? "all"}
                  href={pageUrl({ platform: t.key })}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    platformFilter === t.key
                      ? "bg-white text-neutral-900 shadow-sm dark:bg-[var(--surface-3)] dark:text-white"
                      : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                  }`}
                >
                  {t.label}
                </a>
              ))}
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-black/[.04] p-0.5 dark:bg-white/[.09]">
              {(
                [
                  { key: "views", label: "Top views" },
                  { key: "recent", label: "Most recent" },
                ] as const
              ).map((t) => (
                <a
                  key={t.key}
                  href={pageUrl({ sort: t.key === "recent" ? "recent" : undefined })}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    sortMode === t.key
                      ? "bg-white text-neutral-900 shadow-sm dark:bg-[var(--surface-3)] dark:text-white"
                      : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                  }`}
                >
                  {t.label}
                </a>
              ))}
            </div>
          </div>
        </header>
        <ul className="divide-y divide-black/[.06] dark:divide-white/[.08]">
          {top.length === 0 ? (
            <li className="px-5 py-12 text-center text-sm text-neutral-500">
              No analytics data yet.
            </li>
          ) : null}
          {top.map((p) => {
            // Own media first: the analytics doc carries thumbnailUrl +
            // mediaItems even for posts outside the recent-posts window — the
            // feed join alone left real media posts showing the "text"
            // placeholder. Videos render their poster jpg (CDN video URLs
            // expire) with the video itself as best-effort.
            const own = (p.mediaItems ?? []).find((m) => m.url || m.thumbnail);
            const preview =
              own?.type === "video"
                ? { url: own.url, type: "video" as const, poster: own.thumbnail ?? p.thumbnailUrl }
                : own?.url
                  ? { url: own.url, type: "image" as const, poster: undefined }
                  : p.thumbnailUrl
                    ? { url: p.thumbnailUrl, type: "image" as const, poster: undefined }
                    : (p.platforms ?? [])
                        .map((pl) => {
                          const m = mediaByPlatformKey.get(platformKey(pl.platformPostId) ?? "");
                          return m ? { ...m, poster: undefined } : undefined;
                        })
                        .find(Boolean);
            return (
              <li key={p._id} className="flex gap-4 px-5 py-4">
                {/* The post */}
                {preview?.type === "video" ? (
                  <div className="relative h-36 w-28 shrink-0 overflow-hidden rounded-xl border border-black/[.06] dark:border-white/[.12]">
                    <video
                      src={preview.url}
                      poster={preview.poster}
                      muted
                      playsInline
                      preload="metadata"
                      className="size-full object-cover"
                    />
                    <span className="absolute inset-0 grid place-items-center text-xl text-white drop-shadow">
                      ▶
                    </span>
                  </div>
                ) : preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview.url}
                    alt=""
                    className="h-36 w-28 shrink-0 rounded-xl border border-black/[.06] object-cover dark:border-white/[.12]"
                  />
                ) : (
                  <div className="grid h-36 w-28 shrink-0 place-items-center rounded-xl bg-neutral-100 text-xs text-neutral-400 dark:bg-[var(--surface-2)]">
                    text
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm">{p.content || "(no caption)"}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    {relativeTime(p.publishedAt ?? p.scheduledFor)}
                    {p.analytics?.engagementRate ? (
                      <span className="ml-2">
                        {p.analytics.engagementRate.toFixed(1)}% engagement
                      </span>
                    ) : null}
                  </p>

                  {/* Per-platform analytics underneath (filter-scoped) */}
                  <div className="mt-2.5 space-y-1.5">
                    {platformEntries(p).map((pl, i) => {
                      const m: ZernioPostMetrics = pl.analytics ?? {};
                      const url =
                        pl.platformPostUrl ||
                        platformPostLink({
                          platform: pl.platform,
                          platformPostId: pl.platformPostId,
                          platformPostUrl: pl.platformPostUrl,
                          accountId: pl.accountUsername
                            ? { _id: "", username: pl.accountUsername }
                            : null,
                        });
                      const badge = (
                        <span className="inline-flex items-center gap-1.5">
                          <PlatformBadge platform={pl.platform} />
                          {pl.accountUsername ? (
                            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
                              @{pl.accountUsername}
                            </span>
                          ) : null}
                        </span>
                      );
                      return (
                        <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer" className="shrink-0 transition hover:opacity-80">
                              {badge}
                            </a>
                          ) : (
                            badge
                          )}
                          <span className="flex items-center gap-2.5 text-xs text-neutral-500 dark:text-[#b6bac2]">
                            {(
                              [
                                // X/Threads report impressions as their native
                                // "views" — effectiveViews normalizes that.
                                ["views", effectiveViews(m)],
                                ["likes", m.likes],
                                // Thread self-replies excluded — audience only.
                                ["comments", realComments(pl, m.comments)],
                                ["saves", m.saves],
                                ["shares", m.shares],
                              ] as const
                            ).map(([label, v]) => (
                              <span key={label} className="whitespace-nowrap">
                                <span className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                                  {formatNumber(v ?? 0)}
                                </span>{" "}
                                {label}
                              </span>
                            ))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-8 overflow-hidden rounded-2xl border border-black/[.08] bg-white dark:border-white/[.14] dark:bg-[var(--surface-1)]">
        <header className="border-b border-black/[.06] px-5 py-3 dark:border-white/[.12]">
          <h2 className="text-sm font-medium">Download clicks by source</h2>
          <p className="mt-0.5 text-xs text-neutral-400">
            Tracked links (/go/&lt;source&gt;) placed in bios and post CTAs — clicks
            through to the App Store, per source.
          </p>
        </header>
        {sources.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-neutral-500">
            No clicks yet — tracked links go live once bios point at /go/&lt;source&gt;.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/[.06] text-left text-xs uppercase tracking-wider text-neutral-500 dark:border-white/[.12]">
                <th className="px-5 py-2.5 font-medium">Source</th>
                <th className="px-5 py-2.5 text-right font-medium">Today</th>
                <th className="px-5 py-2.5 text-right font-medium">7 days</th>
                <th className="px-5 py-2.5 text-right font-medium">All time</th>
                <th className="px-5 py-2.5 text-right font-medium">Last click</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[.06] dark:divide-white/[.08]">
              {sources.map((s) => (
                <tr key={s.slug}>
                  <td className="px-5 py-2.5 font-medium">{s.slug}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{formatNumber(s.today)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{formatNumber(s.last7)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{formatNumber(s.total)}</td>
                  <td className="px-5 py-2.5 text-right text-xs text-neutral-400">
                    {s.lastAt ? relativeTime(s.lastAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {accounts.length > 0 ? (
        <section className="mt-8">
          <AudienceBreakdown accounts={accounts} />
        </section>
      ) : null}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.14] dark:bg-[var(--surface-1)]">
      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}
