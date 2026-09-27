import "server-only";
import { resolveResourceUrls } from "@/lib/comments/dm-copy";
import { isPostLive, isPostScheduled } from "@/lib/posts/status";
import { getPost, updatePost } from "@/lib/zernio/client";
import type { ZernioPost, ZernioPostPlatform } from "@/lib/zernio/types";
import { captionWithoutCommentCta, draftPlatformCopy } from "./copy";
import { buildPlatformEntries, type PlatformLeg } from "./resource-cta";
import { listAgentPostsByZernioIds, listScheduledAgentZernioIds, patchAgentPost } from "./store";

// Rewire already-scheduled agent posts to the per-platform resource delivery
// (Kevin 2026-09-14: "today's uploads will tell us whether that's working").
// Regenerates the platform copy (Hormozi LinkedIn), rebuilds every platform
// entry through the same builder run.ts uses, and PUTs it to Zernio with the
// mediaItems echoed (dropping them would strip the IG cover).

function legOf(pl: ZernioPostPlatform, fallbackProfile: string): PlatformLeg | null {
  const acc = pl.accountId;
  const accountId = typeof acc === "string" ? acc : acc?._id;
  if (!accountId) return null;
  const prof = (pl as { profileId?: unknown }).profileId;
  const profileId =
    typeof prof === "string" ? prof : (prof as { _id?: string } | undefined)?._id ?? fallbackProfile;
  return { platform: pl.platform, accountId, profileId };
}

function echoMedia(post: ZernioPost, thumbUrl: string) {
  return (post.mediaItems ?? [])
    .filter((m) => m.url)
    .map((m) => ({
      type: m.type,
      url: m.url,
      ...(thumbUrl ? { thumbnail: thumbUrl, instagramThumbnail: thumbUrl } : {}),
    }));
}

export type RewireResult = {
  zernioPostId: string;
  agentPostId: string;
  status: "updated" | "skipped" | "failed" | "preview";
  reason?: string;
  linkedin?: string;
  twitterRoot?: string;
  threads?: string;
  firstComment?: string;
};

export async function rewireScheduledResourceCtas(opts: {
  ids?: string[];
  dryRun?: boolean;
} = {}): Promise<RewireResult[]> {
  const ids = opts.ids?.length ? opts.ids : await listScheduledAgentZernioIds();
  const jobs = await listAgentPostsByZernioIds(ids);
  const out: RewireResult[] = [];

  for (const job of jobs) {
    const zid = job.zernioPostId;
    if (!zid) continue;
    const base = { zernioPostId: zid, agentPostId: job.id };
    const hasResource = resolveResourceUrls(job.resourceUrl).length > 0 && Boolean(job.keyword);
    if (!hasResource) {
      out.push({ ...base, status: "skipped", reason: "no keyword/resource" });
      continue;
    }
    const post = await getPost(zid).catch(() => null);
    if (!post) {
      out.push({ ...base, status: "skipped", reason: "zernio post not found" });
      continue;
    }
    if (isPostLive(post) || !isPostScheduled(post)) {
      out.push({ ...base, status: "skipped", reason: `post is ${post.status}` });
      continue;
    }
    try {
      const caption = job.caption || post.content || "";
      const copy = await draftPlatformCopy({
        keyword: job.keyword ?? "",
        caption,
        transcript: job.transcript ?? "",
        resourceUrl: job.resourceUrl,
        userProvided: true,
      });
      const story = captionWithoutCommentCta(caption) || caption;
      const legs = (post.platforms ?? [])
        .map((pl) => legOf(pl, job.profileId))
        .filter((l): l is PlatformLeg => Boolean(l));
      const thumbUrl = job.thumbnailUrl ?? "";
      const platforms = buildPlatformEntries({
        legs,
        copy: {
          story,
          youtubeTitle: job.youtubeTitle || post.title || copy.youtubeTitle,
          youtubeDescription: story,
          twitterCaption: copy.twitterCaption,
          linkedinCaption: copy.linkedinCaption,
          threadsCaption: copy.threadsCaption,
        },
        videoUrl: job.videoUrl,
        thumbUrl,
        keyword: job.keyword ?? "",
        dmText: job.dmText ?? "",
        resourceUrl: job.resourceUrl,
        hasResource: true,
      });
      const li = platforms.find((p) => p.platform.toLowerCase() === "linkedin");
      const tw = platforms.find((p) => ["twitter", "x"].includes(p.platform.toLowerCase()));
      const th = platforms.find((p) => p.platform.toLowerCase() === "threads");
      const preview = {
        linkedin: li?.customContent,
        firstComment: li?.platformSpecificData?.firstComment as string | undefined,
        twitterRoot: tw?.customContent,
        threads: th?.customContent,
      };
      if (opts.dryRun) {
        out.push({ ...base, status: "preview", ...preview });
        continue;
      }
      const r = await updatePost(zid, { platforms, mediaItems: echoMedia(post, thumbUrl) });
      if (!r.ok) {
        out.push({ ...base, status: "failed", reason: r.error, ...preview });
        continue;
      }
      const yt = platforms.find((p) => p.platform.toLowerCase() === "youtube");
      await patchAgentPost(job.id, {
        linkedinCaption: li?.customContent ?? copy.linkedinCaption,
        twitterCaption: tw?.customContent ?? copy.twitterCaption,
        threadsCaption: th?.customContent ?? copy.threadsCaption,
        ...(typeof yt?.platformSpecificData?.description === "string"
          ? { youtubeDescription: yt.platformSpecificData.description as string }
          : {}),
      });
      out.push({ ...base, status: "updated", ...preview });
    } catch (e) {
      out.push({ ...base, status: "failed", reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
