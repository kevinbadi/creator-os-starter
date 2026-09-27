import "server-only";
import { query } from "@/lib/insforge/db";
import { getActiveChannel } from "@/lib/channels/store";
import { deleteInboxComment, hideInboxComment, listAccounts } from "@/lib/zernio/client";

export type CommentDeleteRow = {
  event_id: string;
  comment_id: string;
  account_id: string;
  post_id: string | null;
  platform_post_id: string | null;
  platform: string | null;
  author_username: string | null;
  comment_text: string | null;
};

export async function activeChannelAccountIds(): Promise<string[]> {
  const channel = await getActiveChannel().catch(() => null);
  if (!channel) return [];
  const lists = await Promise.all(
    (channel.zernioProfileIds ?? []).map((pid) => listAccounts(pid).catch(() => [])),
  );
  return [
    ...new Set(
      lists
        .flat()
        .map((a) => String((a as { _id?: string; id?: string })._id ?? (a as { id?: string }).id ?? ""))
        .filter(Boolean),
    ),
  ];
}

export async function loadDeletableComment(input: {
  eventId?: string;
  commentId?: string;
  accountIds: string[];
}): Promise<CommentDeleteRow | null> {
  if (!input.accountIds.length) return null;
  if (input.eventId) {
    const rows = await query<CommentDeleteRow>(
      `select event_id, comment_id, account_id, post_id, platform_post_id, platform, author_username, comment_text
         from comment_events
        where event_id = $1 and account_id = any($2) and coalesce(status, '') not in ('deleted', 'hidden')`,
      [input.eventId, input.accountIds],
    );
    return rows[0] ?? null;
  }
  if (input.commentId) {
    const rows = await query<CommentDeleteRow>(
      `select event_id, comment_id, account_id, post_id, platform_post_id, platform, author_username, comment_text
         from comment_events
        where comment_id = $1 and account_id = any($2) and coalesce(status, '') not in ('deleted', 'hidden')
        order by received_at desc
        limit 1`,
      [input.commentId, input.accountIds],
    );
    return rows[0] ?? null;
  }
  return null;
}

export async function removeComment(
  row: CommentDeleteRow,
): Promise<{ ok: true; hidden?: boolean } | { ok: false; error: string }> {
  const postIds = [...new Set([row.post_id, row.platform_post_id].filter((id): id is string => Boolean(id)))];
  if (!row.comment_id || !row.account_id || !postIds.length) {
    return { ok: false, error: "Comment is missing the Zernio post, account, or comment id needed to delete it." };
  }
  let lastErr = "Zernio could not delete that comment.";
  for (const postId of postIds) {
    const out = await deleteInboxComment({
      postId,
      accountId: row.account_id,
      commentId: row.comment_id,
    });
    if (out.ok) {
      await markGone(row.event_id, "deleted", "deleted_via_dashboard");
      return { ok: true };
    }
    lastErr = out.error;
    const canHide =
      out.status === 403 ||
      /permission|platform_error|platform_api_error/i.test(out.error) ||
      /threads/i.test(row.platform ?? "");
    if (!canHide) continue;
    const hid = await hideInboxComment({
      postId,
      accountId: row.account_id,
      commentId: row.comment_id,
    });
    if (hid.ok) {
      await markGone(row.event_id, "hidden", "hidden_via_dashboard");
      return { ok: true, hidden: true };
    }
    lastErr = hid.error;
  }
  return { ok: false, error: lastErr };
}

async function markGone(eventId: string, status: "deleted" | "hidden", reason: string) {
  await query(
    `update comment_events set status = $2, status_reason = $3 where event_id = $1`,
    [eventId, status, reason],
  );
}
