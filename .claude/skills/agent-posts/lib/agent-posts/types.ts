export const AGENT_POST_STATUSES = [
  "queued",
  "working",
  "scheduled",
  "published",
  "failed",
] as const;
export type AgentPostStatus = (typeof AGENT_POST_STATUSES)[number];

/** Optional display-name overrides keyed by Creator OS profile id. Forks leave this empty. */
export const AGENT_POST_TARGET_NAMES: Record<string, string> = {};

/** Cover identity pack for the vertical-video-thumbnail skill. */
export type AgentPostThumbnailPersona = "kevbuildsapps" | "megan";

export function thumbnailPersonaForProfile(
  _profileId: string,
): AgentPostThumbnailPersona {
  const pinned = (process.env.CREATOR_OS_THUMBNAIL_PERSONA || "").trim();
  return pinned === "megan" ? "megan" : "kevbuildsapps";
}

export function agentPostTargetName(profileId: string, fallback = "Socials"): string {
  return AGENT_POST_TARGET_NAMES[profileId] || fallback;
}

/** Video platforms Agent Posts can publish to. Default is all of these that are connected. */
export const AGENT_POST_VIDEO_PLATFORMS = [
  "instagram",
  "tiktok",
  "youtube",
  "twitter",
  "threads",
  "linkedin",
  "facebook",
] as const;

export type AgentPostVideoPlatform = (typeof AGENT_POST_VIDEO_PLATFORMS)[number];

const VIDEO_PLATFORM_SET = new Set<string>(AGENT_POST_VIDEO_PLATFORMS);

export function canonicalizeAgentPlatform(platform: string): string {
  const p = platform.toLowerCase().trim();
  return p === "x" ? "twitter" : p;
}

export function isAgentPostVideoPlatform(platform: string): boolean {
  return VIDEO_PLATFORM_SET.has(canonicalizeAgentPlatform(platform));
}

/** Empty / missing = every connected video platform (the historical default). */
export function parseAgentPostPlatforms(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: string[] = [];
  for (const v of raw) {
    const p = canonicalizeAgentPlatform(String(v ?? ""));
    if (VIDEO_PLATFORM_SET.has(p) && !out.includes(p)) out.push(p);
  }
  return out.length ? out : null;
}

export function agentPostPlatformSet(platforms: string[] | null | undefined): Set<string> {
  return new Set(parseAgentPostPlatforms(platforms) ?? AGENT_POST_VIDEO_PLATFORMS);
}

export function accountMatchesAgentPlatforms(
  accountPlatform: string,
  selected: Set<string>,
): boolean {
  return selected.has(canonicalizeAgentPlatform(accountPlatform));
}

export function agentPostPlatformsOverlap(
  a: string[] | null | undefined,
  b: string[] | null | undefined,
): boolean {
  const sb = agentPostPlatformSet(b);
  for (const p of agentPostPlatformSet(a)) {
    if (sb.has(p)) return true;
  }
  return false;
}

export function videoPlatformsForTargets(
  targets: AgentPostTarget[],
  profileIds?: string[],
): string[] {
  const source =
    profileIds?.length
      ? targets.filter((t) => profileIds.includes(t.profileId))
      : targets;
  const have = new Set<string>();
  for (const t of source) {
    for (const p of t.platforms) {
      const c = canonicalizeAgentPlatform(p);
      if (VIDEO_PLATFORM_SET.has(c)) have.add(c);
    }
  }
  return AGENT_POST_VIDEO_PLATFORMS.filter((p) => have.has(p));
}

export type AgentPostTarget = {
  profileId: string;
  name: string;
  handles: string[];
  platforms: string[];
  nextSlot: string | null;
};

export type AgentPost = {
  id: string;
  status: AgentPostStatus;
  step: string | null;
  error: string | null;
  profileId: string;
  videoUrl: string;
  resourceUrl: string;
  dmNote: string | null;
  transcript: string | null;
  keyword: string | null;
  caption: string | null;
  youtubeTitle: string | null;
  youtubeDescription: string | null;
  twitterCaption: string | null;
  linkedinCaption: string | null;
  threadsCaption: string | null;
  dmText: string | null;
  commentReply: string | null;
  thumbnailUrl: string | null;
  scheduledFor: string | null;
  zernioPostId: string | null;
  followupZernioPostId: string | null;
  commentDmStatus: string | null;
  /** Subset of video platforms for this cut. Null = every connected video platform. */
  platforms: string[] | null;
  createdAt: string;
  updatedAt: string;
};
