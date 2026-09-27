import "server-only";
import { query } from "@/lib/insforge/db";

// Comment-CTA engine: when someone comments the keyword (default "OS") on a
// persona's Instagram post, reply publicly with the Creator OS App Store link.
// Fed by the Zernio `comment.received` webhook (see /api/zernio/webhook);
// events are logged to `comment_events` which doubles as the retry queue.

const ZERNIO_BASE = process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api/v1";

// Tracked redirect (302 → App Store, logs to link_clicks) so comment-CTA
// traffic shows up per-source in the Analytics table. IG comment links are
// not tappable, but the click-through still counts whenever it's copied.
export const APP_URL =
  process.env.COMMENT_CTA_APP_URL ??
  "https://your-app.up.railway.app/go/comment-cta";

const KEYWORD = (process.env.COMMENT_CTA_KEYWORD ?? "OS").toLowerCase();

/** Public reply posted under a matching comment. */
export function replyText(): string {
  return `here you go 🤍 ${APP_URL}`;
}

/**
 * Exact keyword match (trimmed, case-insensitive, trailing punctuation/emoji
 * tolerated). `contains` would false-trigger — "os" is inside "most"/"photos".
 */
export function matchesKeyword(text: string | null | undefined): boolean {
  if (!text) return false;
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/[\s!.…"'🤍❤️🔥🙌👀✨]+$/gu, "");
  return cleaned === KEYWORD;
}

/** Instagram account ids that participate in the CTA (from the personas table). */
export async function ctaInstagramAccountIds(): Promise<Set<string>> {
  const rows = await query<{ ig: string | null }>(
    `select accounts->>'instagram' as ig from personas`,
  );
  return new Set(rows.map((r) => r.ig).filter(Boolean) as string[]);
}

export type ReplyOutcome =
  | { ok: true; replyCommentId: string | null }
  | { ok: false; retryable: boolean; error: string };

/**
 * Post the public reply via Zernio's inbox API. `INBOX_REQUIRED` (addon not
 * active yet) and 5xx are retryable — the row stays pending for the retry skill.
 */
export async function postCommentReply(args: {
  postId: string;
  accountId: string;
  commentId: string;
}): Promise<ReplyOutcome> {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) return { ok: false, retryable: false, error: "ZERNIO_API_KEY not set" };

  const res = await fetch(
    `${ZERNIO_BASE}/inbox/comments/${encodeURIComponent(args.postId)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: args.accountId,
        commentId: args.commentId,
        message: replyText(),
      }),
    },
  );

  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: { commentId?: string };
    error?: string;
    code?: string;
  };

  if (res.ok && data.success !== false) {
    return { ok: true, replyCommentId: data.data?.commentId ?? null };
  }
  const retryable = data.code === "INBOX_REQUIRED" || res.status === 403 || res.status >= 500;
  return {
    ok: false,
    retryable,
    error: `${res.status} ${data.code ?? ""} ${data.error ?? ""}`.trim().slice(0, 500),
  };
}
