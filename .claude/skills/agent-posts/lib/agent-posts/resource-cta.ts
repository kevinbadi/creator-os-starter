import "server-only";
import { FOLLOW_ASK, resolveResourceUrls } from "@/lib/comments/dm-copy";
import { fitThreadsCaption, fitTwitterCaption } from "@/lib/twitter-caption";
import { withResourceLinks } from "./youtube";

// Resource delivery per platform (Kevin 2026-09-14). The comment-to-DM funnel
// only exists on Instagram/Facebook, so everywhere else the resource is
// delivered where the platform lets a link be clicked:
//   LinkedIn  -> caption says "link is in the first comment", firstComment carries it
//   Threads   -> caption says "link is in the reply", firstComment (a reply) carries it
//   X         -> threadItems: root (video) + reply with the link
//   YouTube   -> link block in the description (youtube.ts)
//   IG / FB / TikTok -> unchanged (comment KEYWORD -> DM)

export const LINKEDIN_CTA = "The link is in the first comment 👇";
export const REPLY_CTA = "Link to the resource is in the reply 👇";
const X_LIMIT = 280;
const THREADS_LIMIT = 500;

function scrub(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/[–—]/g, "-")
    .replace(/\[[^\]]*(insert\s+url|placeholder)[^\]]*\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Drop a CTA we previously appended so a rebuild does not stack it. */
export function stripAppendedCta(caption: string, cta: string): string {
  const t = scrub(caption);
  if (!cta) return t;
  if (t.endsWith(cta)) return t.slice(0, t.length - cta.length).replace(/\n+$/, "").trim();
  return t;
}

/** Drop the "you commented X" opener and any URLs from the DM body. */
function dmBodyWithoutFunnelTalk(dmText: string | null | undefined, urls: string[]): string {
  let t = scrub(dmText);
  for (const u of urls) t = t.split(u).join("");
  t = t.replace(FOLLOW_ASK, "");
  t = t
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !/^you commented\b/i.test(l) && !/^here('s| is) the (resource|link)\b.*:$/i.test(l))
    .join("\n");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/** LinkedIn / Threads first comment: the DM's value, with clickable links up top. */
export function resourceFirstComment(args: {
  dmText?: string | null;
  resourceUrl: string;
  limit?: number;
}): string {
  const urls = resolveResourceUrls(args.resourceUrl);
  const body = dmBodyWithoutFunnelTalk(args.dmText, urls);
  const parts = [
    "Here's the resource mentioned in the video:",
    urls.join("\n"),
    body,
    FOLLOW_ASK,
  ].filter(Boolean);
  const out = parts.join("\n\n");
  return args.limit ? out.slice(0, args.limit) : out;
}

/** X / Threads reply under the root post. */
export function resourceReply(resourceUrl: string, limit = X_LIMIT): string {
  const urls = resolveResourceUrls(resourceUrl);
  return `Here's the resource that is mentioned in the video: ${urls.join(" ")}`.slice(0, limit);
}

/** Append a CTA line while keeping the whole thing under the platform cap. */
export function withReplyCta(caption: string, cta: string, limit: number, fit: (s: string, l: number) => string): string {
  const room = limit - cta.length - 2;
  const head = fit(scrub(caption), Math.max(40, room));
  return `${head}\n\n${cta}`;
}

export type PlatformLeg = { platform: string; accountId: string; profileId: string };

export type EntryCopy = {
  story: string; // caption without the comment CTA
  youtubeTitle: string;
  youtubeDescription: string;
  twitterCaption: string;
  linkedinCaption: string;
  threadsCaption: string;
};

export type PlatformEntry = {
  platform: string;
  accountId: string;
  profileId: string;
  platformSpecificData?: Record<string, unknown>;
  customContent?: string;
};

/**
 * Build the per-platform Zernio entries for an agent post. Used both when
 * scheduling (run.ts) and when rewiring an already-scheduled post (rewire.ts)
 * so the two can never drift.
 */
export function buildPlatformEntries(args: {
  legs: PlatformLeg[];
  copy: EntryCopy;
  videoUrl: string;
  thumbUrl: string;
  keyword: string;
  dmText: string;
  resourceUrl: string;
  hasResource: boolean;
}): PlatformEntry[] {
  const { copy } = args;
  const urls = args.hasResource ? resolveResourceUrls(args.resourceUrl) : [];
  const hasResource = urls.length > 0;
  return args.legs.map((leg) => {
    const plat = leg.platform.toLowerCase();
    const entry: PlatformEntry = {
      platform: leg.platform,
      accountId: leg.accountId,
      profileId: leg.profileId,
    };

    if (plat === "youtube") {
      const description = hasResource
        ? withResourceLinks(copy.youtubeDescription || copy.story, args.resourceUrl, args.keyword)
        : copy.youtubeDescription || copy.story;
      // Zernio publishes the YouTube description from the leg's customContent (falling
      // back to the post's top-level content); platformSpecificData.description is
      // stored but never sent. Without this the resource link never reached YouTube.
      entry.customContent = description;
      entry.platformSpecificData = {
        title: copy.youtubeTitle,
        description,
        visibility: "public",
        shorts: true,
        madeForKids: false,
        thumbnailUrl: args.thumbUrl,
      };
    } else if (plat === "instagram") {
      entry.platformSpecificData = {
        instagramThumbnail: args.thumbUrl,
        thumbnailUrl: args.thumbUrl,
      };
    } else if (plat === "twitter" || plat === "x") {
      const base = copy.twitterCaption || fitTwitterCaption(copy.story);
      if (hasResource) {
        const root = withReplyCta(base, REPLY_CTA, X_LIMIT, fitTwitterCaption);
        entry.customContent = root;
        entry.platformSpecificData = {
          threadItems: [
            { content: root, mediaItems: [{ type: "video", url: args.videoUrl }] },
            { content: resourceReply(args.resourceUrl, X_LIMIT) },
          ],
        };
      } else {
        entry.customContent = base;
      }
    } else if (plat === "threads") {
      const base = copy.threadsCaption || fitThreadsCaption(copy.story);
      if (hasResource) {
        entry.customContent = withReplyCta(base, REPLY_CTA, THREADS_LIMIT, fitThreadsCaption);
        entry.platformSpecificData = {
          firstComment: resourceReply(args.resourceUrl, THREADS_LIMIT),
        };
      } else {
        entry.customContent = base;
      }
    } else if (plat === "linkedin") {
      const base = scrub(copy.linkedinCaption || copy.story);
      if (hasResource) {
        entry.customContent = `${base}\n\n${LINKEDIN_CTA}`.slice(0, 3000);
        entry.platformSpecificData = {
          firstComment: resourceFirstComment({ dmText: args.dmText, resourceUrl: args.resourceUrl }),
          disableLinkPreview: true,
        };
      } else {
        entry.customContent = base.slice(0, 3000);
      }
    } else if (plat === "tiktok") {
      entry.customContent = copy.story;
    }
    return entry;
  });
}
