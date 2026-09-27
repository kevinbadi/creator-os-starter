import "server-only";
import { query } from "@/lib/insforge/db";

/**
 * Agent-post keyword comments on Instagram are DM'd by Zernio's native
 * comment-to-DM automation (comment_dm_setups.zernio_automation_id), not by
 * our webhook. The webhook only knows the persona "OS" keyword, so those
 * comments were logged as "skipped / no_keyword" even though Zernio replied
 * (Kevin 2026-09-18: "why are some being skipped today?"). This resolves the
 * live keyword for the post so the row can be stamped `automated`.
 */
export async function automatedKeywordFor(
  postId: string | null | undefined,
  platformPostId: string | null | undefined,
  text: string | null | undefined,
): Promise<string | null> {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return null;
  if (!postId && !platformPostId) return null;
  const rows = await query<{ keyword: string }>(
    `select keyword from comment_dm_setups
      where platform = 'instagram'
        and status in ('wired', 'pending')
        and (($1::text is not null and zernio_post_id = $1) or ($2::text is not null and platform_post_id = $2))
      order by wired_at desc nulls last
      limit 5`,
    [postId ?? null, platformPostId ?? null],
  ).catch(() => []);
  for (const r of rows) {
    const k = String(r.keyword || "").trim().toLowerCase();
    if (!k) continue;
    const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
    if (re.test(t)) return r.keyword;
  }
  return null;
}
