import "server-only";
import { query } from "@/lib/insforge/db";
import { replyInboxComment } from "@/lib/zernio/client";
import type { CommentDeleteRow } from "@/lib/comments/delete";

function scrubReply(text: string, platform?: string | null): string {
  const cleaned = text.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  const max = platform === "twitter" ? 280 : platform === "threads" ? 480 : 1000;
  return cleaned.slice(0, max);
}

export async function replyToComment(
  row: CommentDeleteRow,
  message: string,
): Promise<{ ok: true; reply: string; replyCommentId: string | null } | { ok: false; error: string }> {
  const reply = scrubReply(message, row.platform);
  if (!reply) return { ok: false, error: "Reply text is empty." };
  const postIds = [...new Set([row.post_id, row.platform_post_id].filter((id): id is string => Boolean(id)))];
  if (!row.comment_id || !row.account_id || !postIds.length) {
    return { ok: false, error: "Comment is missing the Zernio post, account, or comment id needed to reply." };
  }
  let lastErr = "Zernio could not post that reply.";
  for (const postId of postIds) {
    const out = await replyInboxComment({
      postId,
      accountId: row.account_id,
      commentId: row.comment_id,
      message: reply,
    });
    if (out.ok) {
      await query(
        `update comment_events
            set status = 'replied', replied_at = now(), reply_comment_id = $2, status_reason = 'replied_via_dashboard'
          where event_id = $1`,
        [row.event_id, out.replyCommentId],
      ).catch(() =>
        query(
          `update comment_events
              set status = 'replied', status_reason = 'replied_via_dashboard'
            where event_id = $1`,
          [row.event_id],
        ),
      );
      return { ok: true, reply, replyCommentId: out.replyCommentId };
    }
    lastErr = out.error;
  }
  return { ok: false, error: lastErr };
}
