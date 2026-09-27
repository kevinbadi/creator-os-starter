import "server-only";
import {
  captionForThreads,
  captionForTwitter,
  captionWithoutCommentCta,
} from "@/lib/agent-posts/copy";
import {
  LINKEDIN_CTA,
  REPLY_CTA,
  buildPlatformEntries,
  stripAppendedCta,
  type PlatformLeg,
} from "@/lib/agent-posts/resource-cta";
import {
  invalidateSlotBoards,
  isWithinStagger,
  siblingProfileId,
  slotGridLabel,
  slotKey,
} from "@/lib/agent-posts/slots";
import {
  getAgentPost,
  listAgentPostsByZernioIds,
  listClaimedSlots,
  patchAgentPost,
  type AgentPost,
} from "@/lib/agent-posts/store";
import { ttlDelPrefix } from "@/lib/cache/ttl";
import {
  queueCommentToDm,
  updatePendingCommentDmSchedule,
} from "@/lib/comments/automations";
import { buildDmMessage, resolveResourceUrls } from "@/lib/comments/dm-copy";
import { etDatetimeLocalToIso } from "@/lib/et-datetime";
import { isPostLive, isPostScheduled } from "@/lib/posts/status";
import { getPost, updatePost } from "@/lib/zernio/client";
import type { ZernioPost, ZernioPostPlatform } from "@/lib/zernio/types";

const TITLE_MAX = 100;
const KEYWORD_MAX = 40;
const CAPTION_MAX = 2200;
const TOO_SOON_MS = 2 * 60 * 1000;

export type EditScheduledPostInput = {
  zernioPostId?: string;
  agentPostId?: string;
  title?: string;
  caption?: string;
  scheduledFor?: string;
  keyword?: string;
  dmText?: string;
  commentReply?: string;
  resourceUrl?: string;
  thumbnailUrl?: string;
};

export type EditScheduledPostResult = {
  zernioPostId: string;
  agentPostId: string | null;
  title: string;
  caption: string;
  scheduledFor: string | null;
  keyword: string | null;
  dmText: string | null;
  commentReply: string | null;
  resourceUrl: string | null;
  thumbnailUrl: string | null;
  job: AgentPost | null;
};

function scrub(s: string): string {
  return s.replace(/[\u2013\u2014]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

function platformAccountId(pl: ZernioPostPlatform): string | undefined {
  if (!pl.accountId) return undefined;
  return typeof pl.accountId === "string" ? pl.accountId : pl.accountId._id;
}

function parseWhen(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t) && !t.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(t)) {
    return etDatetimeLocalToIso(t);
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function rewriteQuotedKeyword(caption: string, from: string, to: string): string {
  if (!from || !to || from === to) return caption;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return caption.replace(new RegExp(`(["'])${escaped}\\1`, "g"), `$1${to}$1`);
}

function isCoverUrl(raw: string): boolean {
  return /^https?:\/\/\S+\.(png|jpe?g|webp)(\?|$)/i.test(raw.trim())
    || /^https?:\/\/\S+$/i.test(raw.trim());
}

function mediaItemsWithThumb(
  post: ZernioPost,
  thumbUrl: string,
): NonNullable<Parameters<typeof updatePost>[1]["mediaItems"]> {
  const items = (post.mediaItems ?? [])
    .filter((m) => m.url)
    .map((m) => ({
      type: m.type,
      url: m.url,
      ...(thumbUrl
        ? { instagramThumbnail: thumbUrl, thumbnail: thumbUrl }
        : m.thumbnail
          ? { thumbnail: m.thumbnail }
          : {}),
    }));
  if (thumbUrl && items.length && !items.some((m) => m.type === "video")) {
    items[0] = {
      ...items[0],
      instagramThumbnail: thumbUrl,
      thumbnail: thumbUrl,
    };
  }
  return items;
}

function existingPsd(post: ZernioPost, platform: string): Record<string, unknown> {
  const pl = (post.platforms ?? []).find((p) => p.platform.toLowerCase() === platform);
  return (pl?.platformSpecificData ?? {}) as Record<string, unknown>;
}

function existingCustom(post: ZernioPost, ...platforms: string[]): string {
  const set = new Set(platforms.map((p) => p.toLowerCase()));
  const pl = (post.platforms ?? []).find((p) => set.has(p.platform.toLowerCase()));
  return pl?.customContent || "";
}

function platformsForUpdate(
  post: ZernioPost,
  opts: {
    content?: string;
    title?: string;
    thumbUrl?: string;
    keyword?: string;
    dmText?: string;
    resourceUrl?: string;
    videoUrl?: string;
    linkedinCaption?: string;
    twitterCaption?: string;
    threadsCaption?: string;
    youtubeDescription?: string;
  },
): NonNullable<Parameters<typeof updatePost>[1]["platforms"]> {
  const story = opts.content
    ? captionWithoutCommentCta(opts.content) || opts.content
    : captionWithoutCommentCta(post.content || "") || post.content || "";
  const legs = (post.platforms ?? [])
    .map((pl): PlatformLeg | null => {
      const accountId = platformAccountId(pl);
      if (!accountId) return null;
      return {
        platform: pl.platform,
        accountId,
        profileId: pl.profileId || "",
      };
    })
    .filter((l): l is PlatformLeg => Boolean(l));

  const ig = existingPsd(post, "instagram");
  const yt = existingPsd(post, "youtube");
  const thumbUrl =
    opts.thumbUrl ||
    (typeof ig.thumbnailUrl === "string" ? ig.thumbnailUrl : "") ||
    (typeof ig.instagramThumbnail === "string" ? ig.instagramThumbnail : "") ||
    (typeof yt.thumbnailUrl === "string" ? yt.thumbnailUrl : "");
  const videoUrl =
    opts.videoUrl ||
    post.mediaItems?.find((m) => m.type === "video")?.url ||
    "";
  const linkedinCaption = stripAppendedCta(
    opts.linkedinCaption || existingCustom(post, "linkedin") || story,
    LINKEDIN_CTA,
  );
  const twitterCaption = stripAppendedCta(
    opts.content
      ? captionForTwitter(opts.content, story, opts.title)
      : opts.twitterCaption || existingCustom(post, "twitter", "x") || story,
    REPLY_CTA,
  );
  const threadsCaption = stripAppendedCta(
    opts.content
      ? captionForThreads(opts.content, story)
      : opts.threadsCaption || existingCustom(post, "threads") || story,
    REPLY_CTA,
  );
  const youtubeTitle =
    opts.title ||
    (typeof yt.title === "string" ? yt.title : "") ||
    "";
  const youtubeDescription =
    (opts.content ? story : opts.youtubeDescription) ||
    (typeof yt.description === "string" ? yt.description : "") ||
    story;
  const resourceUrl = opts.resourceUrl || "";
  const hasResource = resolveResourceUrls(resourceUrl).length > 0;

  return buildPlatformEntries({
    legs,
    copy: {
      story,
      youtubeTitle,
      youtubeDescription,
      twitterCaption,
      linkedinCaption,
      threadsCaption,
    },
    videoUrl,
    thumbUrl,
    keyword: opts.keyword || "",
    dmText: opts.dmText || "",
    resourceUrl,
    hasResource,
  });
}

export async function editScheduledPost(
  input: EditScheduledPostInput,
): Promise<{ ok: true; data: EditScheduledPostResult } | { ok: false; error: string }> {
  const agentPostId = String(input.agentPostId ?? "").trim() || null;
  const zernioArg = String(input.zernioPostId ?? "").trim() || null;
  if (!agentPostId && !zernioArg) {
    return { ok: false, error: "Missing post." };
  }

  let job = agentPostId ? await getAgentPost(agentPostId) : null;
  const zernioPostId = zernioArg || job?.zernioPostId || null;
  if (!zernioPostId) {
    return {
      ok: false,
      error: "This post is not on Zernio yet. Wait until it is scheduled, then edit.",
    };
  }
  if (!job) {
    job = (await listAgentPostsByZernioIds([zernioPostId]))[0] ?? null;
  }

  const post = await getPost(zernioPostId).catch(() => null);
  if (!post) return { ok: false, error: "Could not load that scheduled post." };
  if (isPostLive(post) || !isPostScheduled(post)) {
    return { ok: false, error: "Only scheduled posts can be edited. Live posts are locked." };
  }
  if (job && job.status !== "scheduled") {
    return { ok: false, error: "Only scheduled Agent Posts can be edited." };
  }

  const hasTitle = input.title !== undefined;
  const hasCaption = input.caption !== undefined;
  const hasWhen = input.scheduledFor !== undefined;
  const hasKeyword = input.keyword !== undefined;
  const hasDmText = input.dmText !== undefined;
  const hasReply = input.commentReply !== undefined;
  const hasResource = input.resourceUrl !== undefined;
  const hasThumb = input.thumbnailUrl !== undefined;
  if (
    !hasTitle &&
    !hasCaption &&
    !hasWhen &&
    !hasKeyword &&
    !hasDmText &&
    !hasReply &&
    !hasResource &&
    !hasThumb
  ) {
    return { ok: false, error: "Nothing to save." };
  }

  const thumbUrl = hasThumb ? String(input.thumbnailUrl ?? "").trim() : "";
  if (hasThumb && (!thumbUrl || !isCoverUrl(thumbUrl))) {
    return { ok: false, error: "That cover image URL is not valid." };
  }

  const title = hasTitle
    ? scrub(String(input.title ?? "")).trim().slice(0, TITLE_MAX)
    : (post.title || job?.youtubeTitle || "");
  const nextKeyword = hasKeyword
    ? scrub(String(input.keyword ?? "")).trim().slice(0, KEYWORD_MAX)
    : (job?.keyword || null);
  let caption = hasCaption
    ? scrub(String(input.caption ?? "")).trim().slice(0, CAPTION_MAX)
    : post.content;
  if (!hasCaption && hasKeyword && job?.keyword && nextKeyword) {
    caption = rewriteQuotedKeyword(caption, job.keyword, nextKeyword);
  }
  if (!caption) return { ok: false, error: "Caption cannot be empty." };

  let scheduledFor = post.scheduledFor || job?.scheduledFor || null;
  if (hasWhen) {
    const parsed = parseWhen(String(input.scheduledFor ?? ""));
    if (!parsed) return { ok: false, error: "That go-live time is not valid." };
    if (new Date(parsed).getTime() < Date.now() + TOO_SOON_MS) {
      return { ok: false, error: "Pick a time at least a couple of minutes from now." };
    }
    if (job) {
      const when = new Date(parsed);
      const nextKey = slotKey(when, job.profileId);
      const currentKey = job.scheduledFor
        ? slotKey(new Date(job.scheduledFor), job.profileId)
        : null;
      if (nextKey && nextKey !== currentKey) {
        const claimed = await listClaimedSlots(job.profileId);
        const taken = claimed.some(
          (iso) => slotKey(new Date(iso), job.profileId) === nextKey,
        );
        if (taken) {
          return {
            ok: false,
            error: `That ${slotGridLabel(job.profileId)} slot is already taken on this socials set.`,
          };
        }
      }
      const sibling = siblingProfileId(job.profileId);
      if (sibling) {
        const other = await listClaimedSlots(sibling);
        const clash = other.some((iso) => isWithinStagger(when, new Date(iso)));
        if (clash) {
          return {
            ok: false,
            error:
              "Kev AI must stay at least 1 hour away from Kev Builds Apps so the same upload does not fire twice.",
          };
        }
      }
    }
    scheduledFor = parsed;
  }

  const resourceRaw = hasResource
    ? String(input.resourceUrl ?? "").trim()
    : (job?.resourceUrl || "");
  const resourceUrls = resourceRaw ? resolveResourceUrls(resourceRaw) : [];
  if (hasResource && resourceRaw && resourceUrls.length === 0) {
    return {
      ok: false,
      error:
        "That DM resource link is not a URL, /go/slug, or slug. Leave it blank if this post has no comment-to-DM.",
    };
  }
  const resourceUrl = resourceUrls.join("\n");
  const keyword = (nextKeyword || "").trim();
  const dmTextIn = hasDmText
    ? scrub(String(input.dmText ?? "")).trim()
    : (job?.dmText || "");
  const commentReply = hasReply
    ? scrub(String(input.commentReply ?? "")).trim()
    : (job?.commentReply || "");
  const wantsDm = Boolean(keyword && resourceUrl);
  const dmText = wantsDm ? buildDmMessage(keyword, dmTextIn, resourceUrl) : "";

  const story = captionWithoutCommentCta(caption) || caption;
  const currentThumb =
    (hasThumb ? thumbUrl : "") ||
    job?.thumbnailUrl ||
    (typeof existingPsd(post, "instagram").thumbnailUrl === "string"
      ? (existingPsd(post, "instagram").thumbnailUrl as string)
      : "") ||
    "";
  const rebuiltPlatforms = platformsForUpdate(post, {
    content: hasCaption || (hasKeyword && caption !== post.content) ? caption : undefined,
    title: hasTitle || title !== (post.title || "") ? title : undefined,
    thumbUrl: currentThumb || undefined,
    keyword,
    dmText,
    resourceUrl,
    videoUrl: job?.videoUrl,
    linkedinCaption: job?.linkedinCaption ?? undefined,
    twitterCaption: job?.twitterCaption ?? undefined,
    threadsCaption: job?.threadsCaption ?? undefined,
    youtubeDescription: job?.youtubeDescription ?? undefined,
  });
  const twitterCaption =
    rebuiltPlatforms.find((p) => ["twitter", "x"].includes(p.platform.toLowerCase()))
      ?.customContent || captionForTwitter(caption, story);
  const threadsCaption =
    rebuiltPlatforms.find((p) => p.platform.toLowerCase() === "threads")?.customContent ||
    captionForThreads(caption, story);
  const linkedinCaption =
    rebuiltPlatforms.find((p) => p.platform.toLowerCase() === "linkedin")?.customContent ||
    story;
  const youtubeDescription =
    (rebuiltPlatforms.find((p) => p.platform.toLowerCase() === "youtube")?.platformSpecificData
      ?.description as string | undefined) || story;

  const zernioBody: Parameters<typeof updatePost>[1] = {};
  if (hasCaption || (hasKeyword && caption !== post.content)) zernioBody.content = caption;
  if (hasTitle || title !== (post.title || "")) zernioBody.title = title;
  if (hasWhen && scheduledFor) zernioBody.scheduledFor = scheduledFor;
  const rewritePlatforms =
    Boolean(zernioBody.content) ||
    Boolean(zernioBody.title) ||
    hasThumb ||
    hasKeyword ||
    hasDmText ||
    hasResource;
  if (rewritePlatforms) {
    const items = mediaItemsWithThumb(post, currentThumb);
    if (!items.length) {
      return { ok: false, error: "This post has no media to attach a cover to." };
    }
    zernioBody.mediaItems = items;
    zernioBody.platforms = rebuiltPlatforms;
  }

  if (Object.keys(zernioBody).length) {
    const updated = await updatePost(zernioPostId, zernioBody);
    if (!updated.ok) {
      return { ok: false, error: updated.error || "Zernio could not save the edit." };
    }
  }

  if (hasWhen && scheduledFor) {
    await updatePendingCommentDmSchedule(zernioPostId, scheduledFor).catch(() => 0);
  }

  if (wantsDm && (hasKeyword || hasDmText || hasReply || hasResource)) {
    const platforms = (post.platforms ?? []).map((pl) => ({
      platform: pl.platform,
      accountId: platformAccountId(pl),
      profileId: pl.profileId,
    }));
    await queueCommentToDm({
      post,
      platforms,
      keyword,
      dmMessage: dmText,
      resourceUrl,
      commentReply,
      scheduledFor,
    }).catch((e) => {
      console.error(
        "[scheduled-edit] comment-dm:",
        e instanceof Error ? e.message : e,
      );
    });
  }

  let savedJob: AgentPost | null = job;
  if (job) {
    savedJob = await patchAgentPost(job.id, {
      ...(hasCaption || caption !== job.caption ? { caption } : {}),
      ...(hasTitle || title !== (job.youtubeTitle || "") ? { youtubeTitle: title || null } : {}),
      ...(hasWhen && scheduledFor ? { scheduledFor } : {}),
      ...(hasKeyword || keyword !== (job.keyword || "") ? { keyword: keyword || null } : {}),
      ...(hasDmText || dmText !== (job.dmText || "") ? { dmText: dmText || null } : {}),
      ...(hasReply || commentReply !== (job.commentReply || "")
        ? { commentReply: commentReply || null }
        : {}),
      ...(hasResource ? { resourceUrl } : {}),
      ...(hasThumb ? { thumbnailUrl: thumbUrl } : {}),
      ...(rewritePlatforms
        ? {
            youtubeDescription,
            twitterCaption,
            linkedinCaption,
            threadsCaption,
          }
        : {}),
    });
    invalidateSlotBoards();
  }

  ttlDelPrefix("overlays:");
  ttlDelPrefix("zernio:GET:/posts");

  const final = savedJob ?? job;
  return {
    ok: true,
    data: {
      zernioPostId,
      agentPostId: final?.id ?? job?.id ?? null,
      title,
      caption,
      scheduledFor,
      keyword: keyword || null,
      dmText: dmText || null,
      commentReply: commentReply || null,
      resourceUrl: resourceUrl || null,
      thumbnailUrl: hasThumb ? thumbUrl : (final?.thumbnailUrl ?? job?.thumbnailUrl ?? null),
      job: final,
    },
  };
}
