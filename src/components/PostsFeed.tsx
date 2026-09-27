import type { ZernioPost, ZernioPostPlatform } from "@/lib/zernio/types";
import { formatDateTime } from "@/lib/format";
import { platformPostLink } from "@/lib/zernio/links";
import { isPostLive, isPostScheduled, postCoverUrl, postWhen, type PostFeedOverlay } from "@/lib/posts/status";
import { ScheduledPostEditor } from "@/components/ScheduledPostEditor";

// Chronological feed of everything uploaded — live or scheduled — with preview
// links to the actual media. Server component; data comes from the posts the
// overview page already fetched (Zernio-authored + externally synced).

type Props = {
  posts: ZernioPost[];
  /** Label a platform entry, e.g. "@megs.fit · TikTok" (page's socialLabel). */
  labelFor: (pl: ZernioPostPlatform) => string;
  limit?: number;
  overlays?: Record<string, PostFeedOverlay>;
  /** 2 = two-up grid on large screens (full-width strip); 1 = single list. */
  columns?: 1 | 2;
};

type FeedItem = {
  id: string;
  date: string | null;
  live: boolean;
  scheduled: boolean;
  failed: boolean;
  title: string;
  caption: string;
  fullCaption: string;
  scheduledFor: string | null;
  labels: { label: string; url: string | null }[];
  media: { type: "image" | "video"; url: string }[];
  commentDm: { keyword: string; dmText: string | null; status: string | null } | null;
  overlay: PostFeedOverlay | undefined;
};

function feedMedia(
  p: ZernioPost,
  overlay?: PostFeedOverlay,
): { type: "image" | "video"; url: string }[] {
  const images = (p.mediaItems ?? []).filter((m) => m.type === "image" && m.url);
  if (images.length > 1) {
    return images.map((m) => ({ type: "image" as const, url: m.url }));
  }
  const cover = postCoverUrl(p, overlay?.thumbnailUrl);
  if (cover.url) {
    return [{ type: cover.video ? "video" : "image", url: cover.url }];
  }
  return (p.mediaItems ?? [])
    .filter((m) => m.url)
    .map((m) => ({ type: m.type, url: m.url }));
}

function toItem(
  p: ZernioPost,
  labelFor: Props["labelFor"],
  overlay?: PostFeedOverlay,
): FeedItem {
  const live = isPostLive(p);
  const plats = p.platforms ?? [];
  const labels = new Map<string, string | null>();
  for (const pl of plats) {
    if (pl.status === "failed") continue;
    const label = labelFor(pl);
    if (!labels.has(label) || !labels.get(label)) {
      labels.set(label, platformPostLink(pl));
    }
  }
  const keyword = overlay?.keyword?.trim() || "";
  return {
    id: p._id,
    date: postWhen(p),
    live,
    scheduled: isPostScheduled(p),
    failed: !live && (p.status === "failed" || plats.every((pl) => pl.status === "failed")),
    title: (p.title ?? "").trim(),
    caption: (p.content ?? "").split("\n")[0].trim(),
    fullCaption: p.content ?? "",
    scheduledFor: p.scheduledFor ?? null,
    labels: Array.from(labels, ([label, url]) => ({ label, url })),
    media: feedMedia(p, overlay),
    overlay,
    commentDm: keyword
      ? {
          keyword,
          dmText: overlay?.dmText ?? null,
          status: overlay?.commentDmStatus ?? null,
        }
      : null,
  };
}

export function PostsFeed({ posts, labelFor, limit = 15, overlays = {},
  columns = 1 }: Props) {
  const seen = new Set<string>();
  const items = posts
    .filter((p) => !seen.has(p._id) && (seen.add(p._id), true))
    .map((p) => toItem(p, labelFor, overlays[p._id]))
    .filter((it) => !it.failed && (it.live || it.date))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, limit);

  return (
    <section className="card">
      <h2 className="card-title">
        Post feed
      </h2>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-400">
          Nothing uploaded yet — published and scheduled posts will appear here.
        </p>
      ) : (
        <ul
          className={
            columns === 2
              ? "mt-2 grid gap-x-8 lg:grid-cols-2 [&>li]:border-t [&>li]:border-black/[.06] dark:[&>li]:border-white/[.08]"
              : "mt-2 divide-y divide-black/[.06] dark:divide-white/[.08]"
          }
        >
          {items.map((it) => (
            <li key={it.id} className="flex gap-3 py-3">
              <MediaPreviews media={it.media} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      it.live
                        ? "bg-[#2dd4bf] text-neutral-900"
                        : "bg-amber-400/20 text-amber-700 dark:text-amber-300"
                    }`}
                  >
                    {it.live ? "Live" : "Scheduled"}
                  </span>
                  <span className="text-[11px] text-neutral-400 tabular-nums">
                    {it.date ? formatDateTime(it.date) : "—"}
                  </span>
                </div>
                {it.caption ? (
                  <p className="mt-1 truncate text-xs text-neutral-700 dark:text-neutral-300">
                    {it.caption}
                  </p>
                ) : null}
                {it.commentDm ? (
                  <p className="mt-1 line-clamp-2 text-[11px] text-neutral-500 dark:text-[#b6bac2]">
                    Comment{" "}
                    <span className="font-semibold text-neutral-800 dark:text-neutral-100">
                      {it.commentDm.keyword}
                    </span>{" "}
                    → DM
                    {it.commentDm.dmText ? ` · ${it.commentDm.dmText}` : ""}
                    {it.commentDm.status === "pending" ? " · attaching when live" : ""}
                    {it.commentDm.status === "wired" ? " · live" : ""}
                  </p>
                ) : null}
                <div className="mt-1 flex flex-wrap gap-1">
                  {it.labels.map((l) =>
                    l.url ? (
                      <a
                        key={l.label}
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open live post"
                        className="rounded-full border border-black/[.08] bg-black/[.03] px-1.5 py-0.5 text-[10px] text-neutral-500 transition hover:border-black/[.25] hover:text-neutral-800 dark:border-white/[.14] dark:bg-white/[.07] dark:text-[#b6bac2] dark:hover:border-white/[.30] dark:hover:text-neutral-200"
                      >
                        {l.label} ↗
                      </a>
                    ) : (
                      <span
                        key={l.label}
                        className="rounded-full border border-black/[.08] bg-black/[.03] px-1.5 py-0.5 text-[10px] text-neutral-500 dark:border-white/[.14] dark:bg-white/[.07] dark:text-[#b6bac2]"
                      >
                        {l.label}
                      </span>
                    ),
                  )}
                </div>
                {it.scheduled ? (
                  <ScheduledPostEditor
                    compact
                    post={{
                      zernioPostId: it.id,
                      agentPostId: it.overlay?.agentPostId,
                      title: it.title,
                      caption: it.fullCaption,
                      scheduledFor: it.scheduledFor || it.date,
                      keyword: it.overlay?.keyword,
                      dmText: it.overlay?.dmText,
                      commentReply: it.overlay?.commentReply,
                      resourceUrl: it.overlay?.resourceUrl,
                      thumbnailUrl: it.overlay?.thumbnailUrl,
                    }}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const MAX_THUMBS = 4;

function MediaPreviews({ media }: { media: FeedItem["media"] }) {
  if (media.length === 0) {
    return (
      <div className="grid h-36 w-28 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-200 font-serif text-2xl italic text-neutral-400 dark:from-[var(--surface-3)] dark:to-[var(--surface-2)]">
        Aa
      </div>
    );
  }
  const shown = media.slice(0, MAX_THUMBS);
  const extra = media.length - shown.length;
  return (
    <div className="flex shrink-0 gap-1.5">
      {shown.map((m, i) => (
        <a
          key={`${m.url}-${i}`}
          href={m.url}
          target="_blank"
          rel="noreferrer"
          title={m.type === "video" ? "Open video" : "Open image"}
          className="relative block h-36 w-28 overflow-hidden rounded-xl border border-black/[.08] bg-gradient-to-br from-neutral-100 to-neutral-200 transition hover:border-black/[.25] dark:border-white/[.14] dark:from-[var(--surface-3)] dark:to-[var(--surface-2)] dark:hover:border-white/[.30]"
        >
          {m.type === "video" ? (
            <>
              <video src={m.url} muted playsInline preload="metadata" className="size-full object-cover" />
              <span className="absolute inset-0 grid place-items-center">
                <span className="grid size-9 place-items-center rounded-full bg-black/45 pl-0.5 text-sm text-white ring-1 ring-white/30 backdrop-blur-sm">▶</span>
              </span>
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.url} alt="" loading="lazy" className="size-full object-cover" />
          )}
          {extra > 0 && m === shown[shown.length - 1] ? (
            <span className="absolute inset-0 grid place-items-center bg-black/50 text-base font-semibold text-white">
              +{extra}
            </span>
          ) : null}
        </a>
      ))}
    </div>
  );
}
