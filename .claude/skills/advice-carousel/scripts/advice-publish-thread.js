#!/usr/bin/env node
/**
 * advice-publish-thread — repurpose an advice carousel as a written thread on
 * Twitter/X and Threads via Zernio's threadItems.
 *
 * Thread shape (built by advice-carousel.js into thread.json):
 *   item 0  — extended proof-first intro paragraph + the texted hook slide image
 *             (TWITTER ONLY — on Threads the root is ALWAYS text-only, media
 *             on the first item kills distribution; Kevin 2026-07-11)
 *   items   — one tip per item ("1. …" … "10. …"); the CreatorOS integration
 *             item carries the real app screenshot as media
 *   last    — CTA with the App Store link
 *
 * Zernio: `platformSpecificData.threadItems` — the first item is the root
 * post, each subsequent item replies to the previous one. The top-level
 * `content` field is display/search-only and NOT published, so the intro is
 * duplicated there. Same schema on both platforms.
 *
 * Twitter items are hard-capped at 280 chars (accounts are not assumed to
 * have Premium); Threads at 500. Over-long items are truncated with a warning.
 *
 * Missing accounts are SKIPPED, not fatal — Threads posts start flowing
 * automatically once `threads` is added to the persona's accounts in the
 * personas table (scripts/setup-personas.mjs).
 *
 * SAFETY: dry-run by default. Pass --publish to actually post.
 *
 * Usage:
 *   node advice-publish-thread.js --carousel <sidecar> --thread <thread.json>
 *                                 [--persona megan] [--publish]
 */

const fs = require("fs");
const path = require("path");
const { loadPersona, closePersonaPool } = require("../../../lib/persona");

const ROOT_DIR = path.join(__dirname, "..", "..", ".."); // creator-os/.claude
const REPO_ROOT = path.join(ROOT_DIR, "..");
const ZERNIO_BASE = process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1";
const INSFORGE_BASE = process.env.INSFORGE_API_BASE_URL || "";
const INSFORGE_KEY = process.env.INSFORGE_API_KEY || "";
const BUCKET = "media";
const CHAR_CAPS = { twitter: 280, threads: 500 };

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { persona: null, carousel: null, thread: null, publish: false, gifs: false, platforms: ["twitter", "threads"] };
  for (let i = 0; i < a.length; i++) {
    switch (a[i]) {
      case "--persona": o.persona = a[++i]; break;
      case "--carousel": o.carousel = a[++i]; break;
      case "--thread": o.thread = a[++i]; break;
      case "--publish": o.publish = true; break;
      case "--dry-run": o.publish = false; break;
      // Attach the thread.json `gifs` map (built by advice-thread-gifs.js) —
      // Insforge-hosted mp4s posted as video mediaItems so Threads renders
      // them as looping GIFs. Items with real media (hook slide, integration
      // screenshot) keep it; GIFs only ride items that would be text-only.
      case "--gifs": o.gifs = true; break;
      // Restrict targets, e.g. --platforms threads (avoids double-posting
      // twitter when re-running for a newly connected Threads account).
      case "--platforms": o.platforms = a[++i].split(",").map((s) => s.trim()).filter(Boolean); break;
      default: throw new Error(`Unknown arg: ${a[i]}`);
    }
  }
  if (!o.thread) throw new Error("--thread is required");
  return o;
}

// ── Insforge storage upload (same flow as the carousel publishers) ──────────
async function uploadToInsforge(localPath) {
  if (!INSFORGE_BASE || !INSFORGE_KEY) {
    throw new Error("Insforge storage not configured (INSFORGE_API_BASE_URL / INSFORGE_API_KEY)");
  }
  const filename = path.basename(localPath);
  const buf = fs.readFileSync(localPath);
  const contentType = /\.png$/i.test(filename) ? "image/png" : /\.jpe?g$/i.test(filename) ? "image/jpeg" : "application/octet-stream";
  const size = buf.length;
  const auth = { Authorization: `Bearer ${INSFORGE_KEY}` };

  const stratRes = await fetch(`${INSFORGE_BASE}/api/storage/buckets/${BUCKET}/upload-strategy`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType, size }),
  });
  if (!stratRes.ok) throw new Error(`Upload strategy failed (${stratRes.status})`);
  const s = await stratRes.json();

  if (s.method === "presigned") {
    const fd = new FormData();
    for (const [k, v] of Object.entries(s.fields ?? {})) fd.append(k, v);
    fd.append("file", new Blob([buf], { type: contentType }), filename);
    const up = await fetch(s.uploadUrl, { method: "POST", body: fd });
    if (up.status < 200 || up.status >= 300) throw new Error(`Storage upload failed (${up.status}) for ${filename}`);
    const cf = await fetch(`${INSFORGE_BASE}${s.confirmUrl}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ size, contentType }),
    });
    if (!cf.ok) throw new Error(`Upload confirm failed (${cf.status})`);
    return (await cf.json()).url;
  }

  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: contentType }), filename);
  const up = await fetch(`${INSFORGE_BASE}${s.uploadUrl}`, { method: "PUT", headers: auth, body: fd });
  if (!up.ok) throw new Error(`Storage upload failed (${up.status})`);
  const j = await up.json().catch(() => ({}));
  return j.url || `${INSFORGE_BASE}/api/storage/buckets/${BUCKET}/objects/${s.key}`;
}

async function publishToZernio(body) {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) throw new Error("ZERNIO_API_KEY not set");
  // Network failures can lose the RESPONSE after the post already landed
  // (2026-07-09 danny GIF thread: "fetch failed" client-side, post live
  // server-side). Retry once; Zernio's 24h content dedup turns the retry of
  // an already-landed post into a 409 carrying the existing post id — treat
  // that as success rather than a failure.
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${ZERNIO_BASE}/posts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (attempt < 1) { console.warn(`  ! Zernio POST network failure (${e.message}) — retrying`); await new Promise((r) => setTimeout(r, 3000)); continue; }
      throw e;
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data?.details?.existingPostId) {
      console.warn("  ! Zernio 24h dedup: content already posted — reusing existing post id");
      return { post: { _id: data.details.existingPostId } };
    }
    if (!res.ok) throw new Error(`Zernio ${res.status}: ${JSON.stringify(data)}`);
    return data;
  }
}

// Em/en dashes read as AI-written (Kevin's tell rule, 2026-07-09: extended
// from on-screen text to thread copy) — scrub every outbound item.
const deDash = (s) => String(s).replace(/\s*[—–]\s*/g, " - ");

function capFor(platform, text) {
  const cap = CHAR_CAPS[platform];
  if (text.length <= cap) return text;
  console.warn(`  ! ${platform} item over ${cap} chars (${text.length}) — truncating`);
  return text.slice(0, cap - 1).trimEnd() + "…";
}

async function recordContentPost(persona, meta, platform, postId, itemCount, gifCount = 0, threadHash = null) {
  try {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
    await pool.query(
      `insert into content_posts (persona, carousel_id, zernio_post_id, content, media_urls, platforms, status, posted_at, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        persona.slug,
        meta.carousel_id || "advice-thread",
        postId,
        `thread (${itemCount} items)`,
        JSON.stringify([]),
        JSON.stringify([platform]),
        "published",
        new Date().toISOString(),
        JSON.stringify({ topic: meta.topic, thread: true, items: itemCount, ...(threadHash ? { thread_hash: threadHash } : {}), ...(gifCount ? { gifs: gifCount } : {}) }),
      ],
    );
    await pool.end();
    console.log(`  ✓ Recorded in content_posts (${platform})`);
  } catch (e) {
    console.error(`  ! content_posts record failed (post is live): ${e.message}`);
  }
}

async function main() {
  const opts = parseArgs();
  const persona = await loadPersona(ROOT_DIR, opts.persona);

  // Carousel sidecar is optional — without it the thread posts text-only
  // (no hook image), e.g. a manual Threads-only run on a fresh machine.
  const meta = opts.carousel && fs.existsSync(opts.carousel)
    ? JSON.parse(fs.readFileSync(opts.carousel, "utf8"))
    : { carousel_id: `advice-thread-${new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date())}`, topic: "advice thread", slides: [] };
  const thread = JSON.parse(fs.readFileSync(opts.thread, "utf8"));

  const targets = opts.platforms.filter((p) => {
    if (persona.accounts?.[p]) return true;
    console.log(`  · no ${p} account for '${persona.slug}' — skipping (add it to personas.accounts to enable)`);
    return false;
  });
  if (!targets.length) {
    console.log("Nothing to post — no twitter/threads accounts configured.");
    await closePersonaPool();
    return;
  }

  // Media: the texted hook slide leads the thread; the CreatorOS screenshot
  // rides on the integration tip. Uploaded once, reused on both platforms.
  const hookSlide = (meta.slides || [])[0];
  const integIdx = thread.media?.integrationItemIndex ?? -1;
  const integShotRel = thread.media?.integrationScreenshot;
  const integShot = integShotRel
    ? (path.isAbsolute(integShotRel) ? integShotRel : path.join(REPO_ROOT, integShotRel))
    : null;

  const items = [
    { content: deDash(thread.intro), mediaLocal: hookSlide?.localPath },
    ...thread.items.map((content, i) => ({
      content: deDash(content),
      mediaLocal: i === integIdx && integShot && fs.existsSync(integShot) ? integShot : null,
    })),
    { content: deDash(thread.cta) },
  ];

  let gifCount = 0;
  if (opts.gifs && thread.gifs) {
    for (const [idx, gif] of Object.entries(thread.gifs)) {
      const it = items[Number(idx)];
      if (!it || it.mediaLocal || !gif?.url) continue;
      it.mediaRemote = gif.url;
      it.mediaType = gif.type || "video";
      it.gifTitle = gif.title;
      gifCount++;
    }
  }

  console.log(`\n=== ADVICE THREAD PUBLISH (${persona.name}) ===`);
  console.log(`Carousel: ${meta.carousel_id}`);
  console.log(`Targets:  ${targets.join(" + ")}`);
  console.log(`Items:    ${items.length} (intro + ${thread.items.length} tips + CTA)\n`);
  items.forEach((it, i) => {
    const media = it.mediaLocal
      ? ` [media: ${path.basename(it.mediaLocal)}]`
      : it.mediaRemote
        ? ` [gif: ${it.gifTitle ?? "video"}]`
        : "";
    console.log(`  ${String(i).padStart(2)}. (${it.content.length}ch)${media} ${it.content.split("\n")[0].slice(0, 70)}`);
  });

  if (!opts.publish) {
    console.log("\n[DRY RUN] Not uploading or posting. Re-run with --publish to go live.");
    await closePersonaPool();
    return;
  }

  // Upload media once. Insforge storage has intermittent 503 windows (07-25
  // killed the 20:00 megan + 21:00 danny slots mid-publish) — retry with
  // backoff, and if the upload still fails post WITHOUT the image: a lost
  // screenshot is cosmetic, a lost thread slot is a missed publish.
  const mediaUrls = new Map();
  for (const it of items) {
    if (it.mediaLocal && !mediaUrls.has(it.mediaLocal)) {
      if (!fs.existsSync(it.mediaLocal)) { console.warn(`  ! media missing, posting without: ${it.mediaLocal}`); continue; }
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          mediaUrls.set(it.mediaLocal, await uploadToInsforge(it.mediaLocal));
          console.log(`  ↑ ${path.basename(it.mediaLocal)} → uploaded`);
          break;
        } catch (e) {
          if (attempt < 2) {
            console.warn(`  ! upload failed (${e.message}) — retry ${attempt + 1}/2`);
            await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
          } else {
            console.warn(`  ! upload failed 3x (${e.message}) — posting without ${path.basename(it.mediaLocal)}`);
          }
        }
      }
    }
  }

  // Exact-content guard (2026-07-26 danny X incident): if this thread's text
  // already went to a platform in the last 7 days (rotation collision, manual
  // re-run, watchdog catch-up), X rejects the duplicate items mid-thread and
  // Zernio's server-side retry re-posts the ROOT each attempt — the timeline
  // showed the same root ~10x. Skip the leg instead; the skipped row still
  // matches verifyMatch so the cron health check treats the slot as handled.
  // Hash the ROOT item only: thread tips rotate via the LRU bank and rarely
  // repeat, but the intro/hook is bank-rotated and is exactly what showed up
  // duplicated — a repeated root is the signal that this thread already ran.
  const threadHash = require("crypto").createHash("sha256")
    .update(items[0].content).digest("hex").slice(0, 32);

  for (const platform of targets) {
    // Guard the X leg only: Threads has no dup rejection and Kevin wants the
    // volume there; X is where a repeated root triggers the retry spam.
    if (platform === "twitter") try {
      const { Pool } = require("pg");
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
      const dup = await pool.query(
        `select zernio_post_id from content_posts
          where persona = $1 and platforms @> $2::jsonb
            and metadata->>'thread_hash' = $3
            and posted_at > now() - interval '7 days' limit 1`,
        [persona.slug, JSON.stringify([platform]), threadHash],
      );
      if (dup.rows.length) {
        console.warn(`\n  ! ${platform}: identical thread posted within 7 days (${dup.rows[0].zernio_post_id}) — skipping this leg`);
        await pool.query(
          `insert into content_posts (persona, carousel_id, zernio_post_id, content, media_urls, platforms, status, posted_at, metadata)
           values ($1,$2,null,$3,'[]',$4,'skipped',now(),$5)`,
          [persona.slug, meta.carousel_id || "advice-thread", `thread skipped (duplicate within 7d)`,
           JSON.stringify([platform]), JSON.stringify({ topic: meta.topic, thread: true, thread_hash: threadHash, skipped_reason: "duplicate-7d" })],
        );
        await pool.end();
        continue;
      }
      await pool.end();
    } catch (e) {
      console.warn(`  ! dup-guard check failed (posting anyway): ${e.message}`);
    }
    const threadItems = items.map((it, i) => {
      const entry = { content: capFor(platform, it.content) };
      // THREADS ROOT IS TEXT-ONLY (Kevin 2026-07-11): any media on the first
      // Threads item kills distribution — a danny root with the hook slide
      // did 9 impressions in 30 min. No photo, no GIF on item 0; the hook
      // image and GIFs ride later items. Twitter keeps root media.
      if (platform === "threads" && i === 0) return entry;
      const url = it.mediaLocal ? mediaUrls.get(it.mediaLocal) : null;
      if (url) entry.mediaItems = [{ type: "image", url }];
      else if (it.mediaRemote) entry.mediaItems = [{ type: it.mediaType || "video", url: it.mediaRemote }];
      return entry;
    });
    const body = {
      profileId: persona.profileId,
      // Display/search only — threadItems[0] is what actually publishes.
      content: threadItems[0].content,
      platforms: [{
        platform,
        accountId: persona.accounts[platform],
        platformSpecificData: { threadItems },
      }],
      publishNow: true,
    };
    console.log(`\nPosting ${platform} thread (${threadItems.length} items)…`);
    try {
      const result = await publishToZernio(body);
      const postId = result.post?._id || result.post?.id || result._id || result.id || null;
      console.log(`  ✓ ${platform} Zernio post id: ${postId}`);
      await recordContentPost(persona, meta, platform, postId, threadItems.length, gifCount, threadHash);
      // Fetch the live URL (fills in once the platform finishes publishing).
      for (let i = 0; i < 8 && postId; i++) {
        const check = await (await fetch(`${ZERNIO_BASE}/posts/${postId}`, {
          headers: { Authorization: `Bearer ${process.env.ZERNIO_API_KEY}` },
        })).json().catch(() => ({}));
        const pl = ((check.post || check).platforms || [])[0] || {};
        const url = pl.platformPostUrl || pl.postUrl;
        if (url) { console.log(`  🔗 ${platform} live: ${url}`); break; }
        await new Promise((r) => setTimeout(r, 8000));
      }
    } catch (e) {
      // One platform failing shouldn't kill the other (e.g. Threads not yet connected).
      console.error(`  ✗ ${platform} failed: ${e.message}`);
    }
  }

  await closePersonaPool();
}

main().catch(async (e) => {
  console.error(`\n✗ ${e.message}`);
  await closePersonaPool().catch(() => {});
  process.exit(1);
});
