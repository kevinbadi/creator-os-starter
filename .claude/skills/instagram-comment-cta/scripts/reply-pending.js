#!/usr/bin/env node
/**
 * instagram-comment-cta — retry/backfill pass over the `comment_events` queue.
 *
 * The live path is the webhook route (src/app/api/zernio/webhook/route.ts),
 * which replies inline the moment a comment arrives. Rows stay `pending` only
 * when the reply couldn't be sent (Zernio Inbox addon off, transient 5xx).
 * This script drains those: replies with the Creator OS App Store link and
 * marks each row replied/failed.
 *
 * Usage:
 *   node reply-pending.js [--limit 50] [--dry-run]
 */

const path = require("path");
const { Pool } = require("pg");

process.loadEnvFile(path.join(__dirname, "..", "..", "..", "..", ".env.local"));

const ZERNIO_BASE = process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1";
const APP_URL =
  process.env.COMMENT_CTA_APP_URL ||
  "https://your-app.up.railway.app/go/comment-cta";
const REPLY = `here you go 🤍 ${APP_URL}`;

function arg(n, fb) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : fb; }
const LIMIT = Number(arg("--limit", 50));
const DRY = process.argv.includes("--dry-run");

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const { rows } = await pool.query(
    `select event_id, account_id, account_username, post_id, platform_post_id,
            comment_id, comment_text, author_username
       from comment_events
      where status = 'pending' and platform = 'instagram'
      order by received_at asc
      limit $1`,
    [LIMIT],
  );

  console.log(`\n=== COMMENT CTA RETRY — ${rows.length} pending ===`);
  console.log(`Reply: ${REPLY}\n`);

  let replied = 0, failed = 0;
  for (const r of rows) {
    const label = `@${r.author_username ?? "?"} "${(r.comment_text ?? "").slice(0, 30)}" on ${r.account_username}`;
    if (DRY) { console.log(`  [dry] would reply → ${label}`); continue; }

    const res = await fetch(
      `${ZERNIO_BASE}/inbox/comments/${encodeURIComponent(r.post_id || r.platform_post_id)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accountId: r.account_id,
          commentId: r.comment_id,
          message: REPLY,
        }),
      },
    );
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.success !== false) {
      await pool.query(
        `update comment_events
            set status='replied', replied_at=now(),
                reply_comment_id=$2, status_reason=null
          where event_id=$1`,
        [r.event_id, data.data?.commentId ?? null],
      );
      replied++;
      console.log(`  ✓ replied → ${label}`);
    } else {
      const err = `${res.status} ${data.code ?? ""} ${data.error ?? ""}`.trim().slice(0, 500);
      const retryable = data.code === "INBOX_REQUIRED" || res.status === 403 || res.status >= 500;
      await pool.query(
        `update comment_events set status=$2, status_reason=$3 where event_id=$1`,
        [r.event_id, retryable ? "pending" : "failed", err],
      );
      failed++;
      console.log(`  ✗ ${retryable ? "still pending" : "failed"} (${err}) → ${label}`);
      if (data.code === "INBOX_REQUIRED") {
        console.log("\n→ Zernio Inbox addon still not active; the rest will fail the same way. Stopping.");
        break;
      }
    }
  }

  console.log(`\nDone: ${replied} replied, ${failed} failed/deferred.`);
  await pool.end();
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
