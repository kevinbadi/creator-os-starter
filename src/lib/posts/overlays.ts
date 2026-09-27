import "server-only";
import { ttlRemember } from "@/lib/cache/ttl";
import { listAgentPostsByZernioIds } from "@/lib/agent-posts/store";
import { listCommentDmByPostIds } from "@/lib/comments/automations";
import type { PostFeedOverlay } from "@/lib/posts/status";

export type { PostFeedOverlay };

function blank(): PostFeedOverlay {
  return {
    thumbnailUrl: null,
    keyword: null,
    dmText: null,
    commentReply: null,
    commentDmStatus: null,
    resourceUrl: null,
    agentPostId: null,
  };
}

/** Thumbnail + comment-to-DM copy keyed by Zernio post id. */
export async function loadPostFeedOverlays(
  postIds: string[],
): Promise<Record<string, PostFeedOverlay>> {
  const ids = [...new Set(postIds.filter(Boolean))].sort();
  if (!ids.length) return {};
  return ttlRemember(`overlays:${ids.join(",")}`, 30_000, () =>
    loadPostFeedOverlaysFresh(ids),
  );
}

async function loadPostFeedOverlaysFresh(
  ids: string[],
): Promise<Record<string, PostFeedOverlay>> {
  const out: Record<string, PostFeedOverlay> = {};
  const [dms, jobs] = await Promise.all([
    listCommentDmByPostIds(ids).catch(() => new Map()),
    listAgentPostsByZernioIds(ids).catch(() => []),
  ]);

  for (const job of jobs) {
    if (!job.zernioPostId || !ids.includes(job.zernioPostId)) continue;
    const cur = out[job.zernioPostId] ?? blank();
    cur.thumbnailUrl = cur.thumbnailUrl || job.thumbnailUrl;
    cur.keyword = cur.keyword || job.keyword;
    cur.dmText = cur.dmText || job.dmText;
    cur.commentReply = cur.commentReply || job.commentReply;
    cur.commentDmStatus = cur.commentDmStatus || job.commentDmStatus;
    cur.resourceUrl = cur.resourceUrl || job.resourceUrl;
    cur.agentPostId = cur.agentPostId || job.id;
    out[job.zernioPostId] = cur;
  }

  for (const [id, dm] of dms) {
    const cur = out[id] ?? blank();
    cur.keyword = dm.keyword || cur.keyword;
    cur.dmText = dm.dmMessage || cur.dmText;
    cur.commentReply = dm.commentReply || cur.commentReply;
    cur.commentDmStatus = dm.status || cur.commentDmStatus;
    cur.resourceUrl = dm.resourceUrl || cur.resourceUrl;
    out[id] = cur;
  }

  return out;
}
