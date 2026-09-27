import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { PlatformBadge } from "@/components/PlatformBadge";
import { getActiveChannel } from "@/lib/channels/store";
import { listChannelPosts } from "@/lib/channels/posts";
import { listAccounts } from "@/lib/zernio/client";
import { normalizeAccount } from "@/components/SocialAccounts";
import { latestSnapshotMetrics, type SnapshotMetrics } from "@/lib/analytics/snapshots";
import { platformPostLink } from "@/lib/zernio/links";
import type { ZernioPost, ZernioPostMetrics } from "@/lib/zernio/types";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/format";
import { isPostLive, isPostScheduled, postCoverUrl, postWhen } from "@/lib/posts/status";
import { loadPostFeedOverlays } from "@/lib/posts/overlays";
import { ScheduledPostEditor } from "@/components/ScheduledPostEditor";
import { formatSlotEt, nextOpenSlots } from "@/lib/agent-posts/slots";
import { listAgentPostTargets } from "@/lib/agent-posts/targets";

export const metadata = { title: "Posts · Marketing OS" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "all", label: "All" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
  { key: "draft", label: "Drafts" },
];

const METRICS: { key: keyof ZernioPostMetrics; label: string }[] = [
  { key: "views", label: "views" },
  { key: "likes", label: "likes" },
  { key: "comments", label: "comments" },
  { key: "saves", label: "saves" },
];

function MetricStrip({ m }: { m: SnapshotMetrics }) {
  return (
    <span className="flex items-center gap-2.5 text-xs text-neutral-500 dark:text-[#b6bac2]">
      {METRICS.map(({ key, label }) => (
        <span key={key} className="whitespace-nowrap">
          <span className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
            {formatNumber(m[key] ?? 0)}
          </span>{" "}
          {label}
          {key === "views" && m.viewsDelta ? (
            <span className="ml-1 font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
              +{formatNumber(m.viewsDelta)}
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

/** Preview media for a post — thumbnail first, then an image, then the video. */
function previewUrl(
  p: ZernioPost,
  overlayThumb?: string | null,
): { url: string | null; video: boolean } {
  return postCoverUrl(p, overlayThumb);
}

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; commentDm?: string }>;
}) {
  const { status, commentDm } = await searchParams;
  const active = TABS.find((t) => t.key === status)?.key ?? "all";
  const channel = await getActiveChannel();
  const profileIds = channel?.zernioProfileIds ?? [];

  // Analytics documents have their own ids (no overlap with post ids) — the
  // stable join key is the platform-level post id. TikTok's publish handle
  // ("p_pub_url~v2.123…") normalizes to its numeric tail.
  const platformKey = (id?: string | null): string | null => {
    if (!id) return null;
    const m = String(id).match(/(\d{12,})\s*$/);
    return m ? m[1] : String(id);
  };

  let posts: ZernioPost[] = [];
  const usernameByAccountId = new Map<string, string>();
  let snapshotDate: string | null = null;
  let metricsByPlatformPost = new Map<string, SnapshotMetrics>();
  let overlays: Awaited<ReturnType<typeof loadPostFeedOverlays>> = {};
  let error: string | null = null;
  let nextSlotLine: { name: string; at: string }[] = [];
  try {
    // Metrics come from the NIGHTLY snapshot table (analytics-snapshot cron),
    // not live Zernio — clean day-to-day numbers, no platform sync-lag jitter.
    const [postList, snapshot, accounts, agentTargets] = await Promise.all([
      listChannelPosts(channel, {
        limit: 80,
        status: active === "all" ? undefined : active,
        fresh: active === "scheduled",
      }),
      latestSnapshotMetrics(),
      Promise.all(
        profileIds.map((pid) => listAccounts(pid).catch(() => [])),
      ).then((arr) => arr.flat()),
      listAgentPostTargets(),
    ]);
    posts = postList;
    const slotById = await nextOpenSlots(agentTargets.map((t) => t.profileId));
    nextSlotLine = agentTargets
      .filter((t) => slotById[t.profileId])
      .map((t) => ({
        name: t.name,
        at: formatSlotEt(new Date(slotById[t.profileId])),
      }));
    overlays = await loadPostFeedOverlays(posts.map((p) => p._id));
    snapshotDate = snapshot.date;
    metricsByPlatformPost = snapshot.byPlatformPost;
    for (const a of accounts) {
      const n = normalizeAccount(a);
      if (n.username) usernameByAccountId.set(a._id, n.username);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load posts";
  }

  return (
    <main className="w-full px-6 py-8">
      <PageHeader
        title="Posts"
        description={`Posts on ${channel?.name ?? "this channel"}, including Agent Posts Done for You${snapshotDate ? ` — metrics from the nightly snapshot (${snapshotDate}, green = views gained that day)` : ""}.`}
        actions={
          <Link
            href="/dashboard/posts/new"
            className="inline-flex h-9 items-center justify-center rounded-md bg-neutral-900 px-3 text-sm font-medium text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            New post
          </Link>
        }
      />

      {commentDm === "wired" || commentDm === "pending" || commentDm === "error" ? (
        <p
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            commentDm === "error"
              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
              : commentDm === "pending"
                ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200"
                : "border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900/40 dark:bg-teal-950/40 dark:text-teal-200"
          }`}
        >
          {commentDm === "wired"
            ? "Comments-to-DM is live on this post. Matching comments will get a DM with your resource."
            : commentDm === "pending"
              ? "Comments-to-DM is queued. It attaches once Instagram or Facebook finishes publishing — right away for live posts, or automatically when a scheduled post goes live."
              : "Post went out, but comments-to-DM could not be wired. Check that the Zernio Inbox addon is active, then try again."}
        </p>
      ) : null}

      {nextSlotLine.length > 0 ? (
        <p className="mt-4 text-sm text-neutral-500">
          Next open slot (Kev AI is +1h):{" "}
          {nextSlotLine.map((row, i) => (
            <span key={row.name}>
              {i > 0 ? " · " : ""}
              <span className="font-medium text-neutral-700 dark:text-neutral-200">
                {row.name}
              </span>{" "}
              {row.at}
            </span>
          ))}
        </p>
      ) : null}

      <div className="mt-6 flex items-center gap-1 border-b border-black/[.06] dark:border-white/[.12]">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "all" ? "/dashboard/posts" : `/dashboard/posts?status=${t.key}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
              active === t.key
                ? "border-neutral-900 font-medium text-neutral-900 dark:border-white dark:text-white"
                : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {error ? (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <ul className="mt-4 divide-y divide-black/[.06] overflow-hidden rounded-2xl border border-black/[.08] bg-white dark:divide-white/[.08] dark:border-white/[.14] dark:bg-[var(--surface-1)]">
        {posts.length === 0 && !error ? (
          <li className="px-5 py-12 text-center text-sm text-neutral-500">
            Nothing here yet.
          </li>
        ) : null}
        {posts.map((p) => {
          const overlay = overlays[p._id];
          const scheduled = isPostScheduled(p);
          const live = isPostLive(p);
          const when = postWhen(p) ?? p.createdAt;
          const preview = previewUrl(p, overlay?.thumbnailUrl);
          const platformRows = (p.platforms ?? []).map((pl) => {
            const k = platformKey(pl.platformPostId);
            const username =
              typeof pl.accountId === "object" && pl.accountId
                ? pl.accountId.username
                : pl.accountId
                  ? usernameByAccountId.get(pl.accountId)
                  : undefined;
            return {
              platform: pl.platform,
              username,
              url: platformPostLink(pl),
              metrics: (k && metricsByPlatformPost.get(k)) || null,
            };
          });
          return (
            <li key={p._id} className="px-5 py-4">
            <div className="flex gap-4">
              {/* Preview */}
              {preview.url && preview.video ? (
                <div className="relative h-28 w-20 shrink-0 overflow-hidden rounded-xl border border-black/[.06] dark:border-white/[.12]">
                  <video src={preview.url} muted playsInline preload="metadata" className="size-full object-cover" />
                  <span className="absolute inset-0 grid place-items-center text-lg text-white drop-shadow">▶</span>
                </div>
              ) : preview.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview.url}
                  alt=""
                  className="h-28 w-20 shrink-0 rounded-xl border border-black/[.06] object-cover dark:border-white/[.12]"
                />
              ) : (
                <div className="flex h-28 w-20 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-lg text-neutral-400 dark:bg-[var(--surface-2)]">
                  —
                </div>
              )}

              {/* Title + caption + per-platform analytics */}
              <div className="min-w-0 flex-1">
                {p.title ? (
                  <p className="truncate text-sm font-semibold">{p.title}</p>
                ) : null}
                <p className={`line-clamp-2 text-sm ${p.title ? "mt-0.5 text-neutral-500 dark:text-[#b6bac2]" : ""}`}>
                  {p.content || "(no caption)"}
                </p>

                {overlay?.keyword ? (
                  <div className="mt-2 rounded-xl border border-black/[.08] bg-black/[.02] px-3 py-2 dark:border-white/[.12] dark:bg-white/[.04]">
                    <p className="text-[11px] font-medium text-neutral-700 dark:text-neutral-200">
                      Comment{" "}
                      <span className="rounded bg-teal-100 px-1.5 py-0.5 font-semibold text-teal-900 dark:bg-teal-950/60 dark:text-teal-200">
                        {overlay.keyword}
                      </span>{" "}
                      → DM
                      {overlay.commentDmStatus === "wired" ? (
                        <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                          live
                        </span>
                      ) : overlay.commentDmStatus === "pending" ? (
                        <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          attaches when live
                        </span>
                      ) : null}
                    </p>
                    {overlay.dmText ? (
                      <p className="mt-1 line-clamp-2 text-[11px] text-neutral-500 dark:text-[#b6bac2]">
                        {overlay.dmText}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-2 space-y-1">
                  {platformRows.map((row, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      {row.url ? (
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noreferrer"
                          title={`Open on ${row.platform}`}
                          className="group inline-flex shrink-0 items-center gap-1 transition hover:opacity-80"
                        >
                          <PlatformBadge platform={row.platform} />
                          {row.username ? (
                            <span className="text-xs font-medium text-neutral-600 group-hover:underline dark:text-neutral-300">
                              @{row.username}
                            </span>
                          ) : null}
                          <span className="text-[10px] text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-300">
                            ↗
                          </span>
                        </a>
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-1">
                          <PlatformBadge platform={row.platform} />
                          {row.username ? (
                            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
                              @{row.username}
                            </span>
                          ) : null}
                        </span>
                      )}
                      {row.metrics ? (
                        <MetricStrip m={row.metrics} />
                      ) : (
                        <span className="text-xs text-neutral-400">
                          {scheduled ? "not live yet" : "no analytics yet"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Status + time */}
              <div className="shrink-0 text-right">
                {scheduled ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                    ⏰ Scheduled
                  </span>
                ) : live ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                    Published
                  </span>
                ) : p.status ? (
                  <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium capitalize text-neutral-600 dark:bg-[var(--surface-2)] dark:text-neutral-300">
                    {p.status.replace(/_/g, " ")}
                  </span>
                ) : null}
                <p className="mt-1 text-sm">{formatDateTime(when)}</p>
                <p className="text-xs text-neutral-500">
                  {scheduled ? `goes live ${relativeTime(when)}` : relativeTime(when)}
                </p>
              </div>
            </div>
            {scheduled ? (
              <ScheduledPostEditor
                post={{
                  zernioPostId: p._id,
                  agentPostId: overlay?.agentPostId,
                  title: p.title ?? "",
                  caption: p.content ?? "",
                  scheduledFor: p.scheduledFor ?? when,
                  keyword: overlay?.keyword,
                  dmText: overlay?.dmText,
                  commentReply: overlay?.commentReply,
                  resourceUrl: overlay?.resourceUrl,
                  thumbnailUrl: overlay?.thumbnailUrl,
                }}
              />
            ) : null}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
