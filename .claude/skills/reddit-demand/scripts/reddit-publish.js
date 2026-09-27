#!/usr/bin/env node
/**
 * reddit-publish — post the reddit-demand drafts via Zernio (u/creator_os).
 *
 * Zernio reddit text post: `content` first line = title, rest = body;
 * platformSpecificData.subreddit targets the sub. Posted state is stamped
 * back into data/drafts.json (posted drafts are skipped on re-run).
 *
 * NOTE: Reddit automod can silently remove posts from low-karma accounts
 * AFTER publish — the API reports success either way. Check the URLs.
 *
 * Usage: node --env-file=.env.local reddit-publish.js [--only <subreddit>]
 *        [--publish]   (dry-run prints the payloads)
 */
const fs = require("fs");
const path = require("path");

const ZERNIO_BASE = process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1";
const PROFILE_ID = "ZERNIO_PROFILE_BRAND"; // Creator OS branded socials (2026-07-07 profile)
// BLOCKED: u/creator_os is not connected on the new profile yet — reconnect
// Reddit in Zernio and update this id before publishing.
const ACCOUNT_ID = "";
const DRAFTS = path.join(__dirname, "..", "data", "drafts.json");

function arg(n) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; }
const PUBLISH = process.argv.includes("--publish");
const ONLY = arg("--only");

async function zernio(pathname, body) {
  const res = await fetch(`${ZERNIO_BASE}${pathname}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Zernio ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

async function recordContentPost(id, postId, title, sub) {
  try {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
    await pool.query(
      `insert into content_posts (persona, carousel_id, zernio_post_id, content, media_urls, platforms, status, posted_at, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      ["creatoros", id, postId, title, "[]", JSON.stringify(["reddit"]), "published", new Date().toISOString(), JSON.stringify({ subreddit: sub })],
    );
    await pool.end();
  } catch (e) { console.error(`  ! content_posts record failed: ${e.message}`); }
}

async function main() {
  if (PUBLISH && !ACCOUNT_ID) {
    throw new Error("Reddit account not connected on the Creator OS profile — reconnect u/creator_os in Zernio and set ACCOUNT_ID.");
  }
  const doc = JSON.parse(fs.readFileSync(DRAFTS, "utf8"));
  const todo = doc.drafts.filter((d) => !d.posted && (!ONLY || d.subreddit.toLowerCase() === ONLY.toLowerCase()));
  console.log(`${todo.length} drafts to post${PUBLISH ? "" : " (DRY RUN)"}\n`);

  for (const d of todo) {
    const content = `${d.title}\n\n${d.body}`;
    console.log(`r/${d.subreddit} [${d.promo_level}] — "${d.title.slice(0, 70)}"`);
    if (!PUBLISH) continue;
    try {
      const result = await zernio("/posts", {
        profileId: PROFILE_ID,
        content,
        platforms: [{ platform: "reddit", accountId: ACCOUNT_ID, platformSpecificData: { subreddit: d.subreddit } }],
        publishNow: true,
      });
      const postId = result.post?._id || result.post?.id || null;
      d.posted = { at: new Date().toISOString(), zernio_post_id: postId };
      // Poll for the live URL.
      for (let i = 0; i < 8 && postId; i++) {
        const check = await zernio(`/posts/${postId}`);
        const pl = ((check.post || check).platforms || [])[0] || {};
        if (pl.platformPostUrl || pl.postUrl) { d.posted.url = pl.platformPostUrl || pl.postUrl; break; }
        if (pl.status === "failed" || (check.post || check).status === "failed") { d.posted.status = "failed"; d.posted.error = pl.error || "platform failed"; break; }
        await new Promise((r) => setTimeout(r, 8000));
      }
      fs.writeFileSync(DRAFTS, JSON.stringify(doc, null, 2));
      console.log(`  ✓ ${d.posted.url || `zernio ${postId} (url pending)`}${d.posted.status === "failed" ? ` FAILED: ${d.posted.error}` : ""}`);
      await recordContentPost(`reddit-${d.subreddit}-${new Date().toISOString().slice(0, 10)}`, postId, d.title, d.subreddit);
      // Space posts out — burst-posting 8 subs in a minute reads as spam.
      await new Promise((r) => setTimeout(r, 15000));
    } catch (e) {
      console.error(`  ✗ r/${d.subreddit}: ${e.message}`);
      d.posted = { at: new Date().toISOString(), status: "failed", error: e.message.slice(0, 300) };
      fs.writeFileSync(DRAFTS, JSON.stringify(doc, null, 2));
    }
  }
  console.log("\nDone.");
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
