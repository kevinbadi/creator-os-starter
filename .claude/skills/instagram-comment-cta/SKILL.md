---
name: instagram-comment-cta
description: Reply to "OS" comments on persona Instagram posts with the Creator OS App Store link. Live path is the Zernio webhook → /api/zernio/webhook (replies inline); this skill drains the pending retry queue in comment_events. Trigger when asked to retry comment replies, drain the comment queue, or check comment CTA status.
---

# instagram-comment-cta

Answers the carousels' `comment "OS"` CTA on Instagram with a public reply containing the app link:
**https://apps.apple.com/app/id0000000000**

## Architecture

1. **Zernio webhook** (`comment.received`, HMAC-signed) → `POST /api/zernio/webhook` on the dashboard (Railway, always-on).
2. The route logs every comment to the Insforge **`comment_events`** table, then — for comments that are exactly the keyword (`OS`, case-insensitive, trailing emoji/punctuation tolerated) on a persona Instagram account (from the `personas` table) — **replies inline** via `POST /v1/inbox/comments/{postId}`. Timely by construction: no polling.
3. Rows stay **`pending`** only if the reply couldn't be sent (Zernio Inbox addon inactive → `INBOX_REQUIRED`, or transient 5xx). This script retries them.

Statuses: `replied` | `pending` (retryable) | `skipped` (`no_keyword` / `own_comment` / `not_instagram` / `not_cta_account`) | `failed` (hard error).

## Usage

```bash
node .claude/skills/instagram-comment-cta/scripts/reply-pending.js [--limit 50] [--dry-run]
```

Check queue state:

```sql
select status, count(*) from comment_events group by status;
```

## Config (creator-os/.env.local + Railway service vars)

- `ZERNIO_WEBHOOK_SECRET` — HMAC secret shared with the Zernio webhook registration
- `COMMENT_CTA_KEYWORD` — default `OS`
- `COMMENT_CTA_APP_URL` — the App Store link above

## Blockers / notes

- Replies require the **Zernio Inbox addon** (`INBOX_REQUIRED` until upgraded). Events are still captured meanwhile; run this skill to drain the backlog after upgrading.
- Instagram/Facebook only — Zernio does not surface TikTok comments (decision: TikTok stays manual).
- The keyword match is exact-with-tolerance, not `contains` — "os" is a substring of "most"/"photos".
