import "server-only";
import {
  AGENT_POSTS_PROFILE_ID,
  listAgentPosts,
  markAgentPostsPublished,
} from "@/lib/agent-posts/store";
import { listPosts } from "@/lib/zernio/client";
import type { ZernioPost } from "@/lib/zernio/types";
import { isPostLive, isPostPublishComplete, isPostScheduled, postWhen } from "@/lib/posts/status";
import type { Channel } from "./types";

function richer(a: ZernioPost, b: ZernioPost): ZernioPost {
  const score = (p: ZernioPost) =>
    (isPostLive(p) ? 8 : 0) +
    (p.platforms ?? []).filter((pl) => pl.platformPostId || pl.publishedAt).length +
    (p.mediaItems?.length ?? 0);
  return score(b) > score(a) ? b : a;
}

function dedupe(posts: ZernioPost[]): ZernioPost[] {
  const byId = new Map<string, ZernioPost>();
  for (const p of posts) {
    const prev = byId.get(p._id);
    byId.set(p._id, prev ? richer(prev, p) : p);
  }
  return [...byId.values()];
}

function stubFromAgent(job: {
  zernioPostId: string | null;
  youtubeTitle: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  videoUrl: string;
  status: string;
  scheduledFor: string | null;
  createdAt: string;
  updatedAt: string;
}): ZernioPost | null {
  if (!job.zernioPostId) return null;
  if (job.status === "failed") return null;
  const mediaItems: ZernioPost["mediaItems"] = [];
  if (job.thumbnailUrl) {
    mediaItems.push({ type: "image", url: job.thumbnailUrl });
  }
  mediaItems.push({
    type: "video",
    url: job.videoUrl,
    thumbnail: job.thumbnailUrl ?? undefined,
  });
  return {
    _id: job.zernioPostId,
    userId: "",
    title: job.youtubeTitle ?? undefined,
    content: job.caption ?? "",
    mediaItems,
    platforms: [],
    status: job.status === "published" ? "published" : "scheduled",
    scheduledFor: job.scheduledFor ?? undefined,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

/** Agent Posts always go to Kev Builds Apps, which may not be on the active channel. */
export async function mergeAgentCreatedPosts(
  posts: ZernioPost[],
): Promise<ZernioPost[]> {
  const jobs = await listAgentPosts(50).catch(() => []);
  if (!jobs.length) return posts;

  const have = new Set(posts.map((p) => p._id));
  const extras = jobs
    .map((j) =>
      !j.zernioPostId || have.has(j.zernioPostId) ? null : stubFromAgent(j),
    )
    .filter((p): p is ZernioPost => Boolean(p));
  if (!extras.length) return posts;
  return dedupe([...posts, ...extras.filter((p): p is ZernioPost => Boolean(p))]);
}

/** Posts for every Zernio profile on this channel, plus Agent Posts Done for You. */
export async function listChannelPosts(
  channel: Channel | null,
  params?: { limit?: number; status?: string; fresh?: boolean },
): Promise<ZernioPost[]> {
  const ids = channel?.zernioProfileIds ?? [];
  const limit = params?.limit ?? 50;
  const fresh = params?.fresh ?? false;
  const timeoutMs = fresh ? 4000 : 2500;

  const fetchFor = (pid: string, status?: string) =>
    listPosts({
      limit,
      profileId: pid,
      status,
      fresh,
      timeoutMs,
    }).catch(() => [] as ZernioPost[]);

  const tab = params?.status;
  const includeAgentProfile = !ids.includes(AGENT_POSTS_PROFILE_ID);
  const arrays = await Promise.all([
    ...ids.map((pid) =>
      fetchFor(pid, tab === "scheduled" || tab === "draft" ? tab : undefined),
    ),
    ...(includeAgentProfile
      ? [
          fetchFor(
            AGENT_POSTS_PROFILE_ID,
            tab === "scheduled" || tab === "draft" ? tab : undefined,
          ),
        ]
      : []),
  ]);

  let posts = dedupe(arrays.flat());
  if (includeAgentProfile) {
    const jobs = await listAgentPosts(50).catch(() => []);
    const agentIds = new Set(
      jobs
        .map((j) => j.zernioPostId)
        .filter((id): id is string => typeof id === "string"),
    );
    const channelSet = new Set(
      arrays.slice(0, ids.length).flat().map((p) => p._id),
    );
    posts = posts.filter((p) => channelSet.has(p._id) || agentIds.has(p._id));
  }
  posts = await mergeAgentCreatedPosts(posts);

  const liveIds = posts.filter(isPostPublishComplete).map((p) => p._id);
  if (liveIds.length) {
    void markAgentPostsPublished(liveIds).catch(() => 0);
  }

  if (tab === "published") posts = posts.filter(isPostLive);
  else if (tab === "scheduled") posts = posts.filter(isPostScheduled);
  else if (tab === "draft") {
    posts = posts.filter((p) => (p.status ?? "").toLowerCase() === "draft");
  }

  posts.sort((a, b) => (postWhen(b) ?? "").localeCompare(postWhen(a) ?? ""));
  return posts;
}
