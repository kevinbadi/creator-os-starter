#!/usr/bin/env node
/**
 * proof-post — Jack Friks-style founder-aura X post for Creator OS.
 *
 * Picks one post from the persona's bank (day-rotated like the other content
 * crons), publishes it to the persona's Twitter account via Zernio, and
 * records it in content_posts. Friks doctrine is enforced by the bank shape:
 * numbers in every proof claim, full value free in the main post, the App
 * Store link ONLY in a reply (threadItems[1]), plugs disclosed as ours.
 *
 * Editorial direction lives in the outer project's marketing-advice-carousel
 * skill (references/jack-friks-breakdown.md); claims must match the
 * persona-claims canon so numbers never contradict the carousels.
 *
 * SAFETY: dry-run by default. Pass --publish to actually post.
 *
 * Usage:
 *   node proof-post.js [--persona megan] [--index N] [--publish]
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
const TWITTER_CAP = 280;

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { persona: "megan", publish: false, index: null };
  for (let i = 0; i < a.length; i++) {
    switch (a[i]) {
      case "--persona": o.persona = a[++i]; break;
      case "--publish": o.publish = true; break;
      case "--dry-run": o.publish = false; break;
      case "--index": o.index = Number(a[++i]); break;
      // Registry passes --slot for multi-hour jobs; a second daily slot just
      // advances the rotation so the two posts differ.
      case "--slot": o.slot = Number(a[++i]) || 0; break;
      default: throw new Error(`Unknown arg: ${a[i]}`);
    }
  }
  return o;
}

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
  const res = await fetch(`${ZERNIO_BASE}/posts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Zernio ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function cap(text) {
  if (text.length <= TWITTER_CAP) return text;
  console.warn(`  ! item over ${TWITTER_CAP} chars (${text.length}) — truncating`);
  return text.slice(0, TWITTER_CAP - 1).trimEnd() + "…";
}

async function recordContentPost(persona, entry, postId, itemCount) {
  try {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
    // ET date — toISOString (UTC) flips to tomorrow at 20:00 ET and would
    // mislabel evening catch-up posts as the next day's.
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    await pool.query(
      `insert into content_posts (persona, carousel_id, zernio_post_id, content, media_urls, platforms, status, posted_at, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        persona.slug,
        `proof-post-${date}-${entry.id}`,
        postId,
        entry.content,
        JSON.stringify([]),
        JSON.stringify(["twitter"]),
        "published",
        new Date().toISOString(),
        JSON.stringify({ topic: `Proof post — ${entry.id}`, proofPost: true, archetype: entry.archetype, items: itemCount }),
      ],
    );
    await pool.end();
    console.log("  ✓ Recorded in content_posts (twitter)");
  } catch (e) {
    console.error(`  ! content_posts record failed (post is live): ${e.message}`);
  }
}

async function main() {
  const opts = parseArgs();
  const templatePath = path.join(__dirname, "..", "templates", `proof-posts-${opts.persona}.json`);
  if (!fs.existsSync(templatePath)) throw new Error(`No proof-post bank for '${opts.persona}' (${path.basename(templatePath)})`);
  const bank = JSON.parse(fs.readFileSync(templatePath, "utf8"));

  const dayIndex = Math.floor(Date.now() / 86400000);
  const idx = opts.index != null ? opts.index : (dayIndex + (opts.slot || 0)) % bank.posts.length;
  const entry = bank.posts[idx % bank.posts.length];

  const persona = await loadPersona(ROOT_DIR, opts.persona);
  if (!persona.accounts?.twitter) throw new Error(`No twitter account configured for '${persona.slug}'`);

  const mediaLocal = entry.media
    ? (path.isAbsolute(entry.media) ? entry.media : path.join(REPO_ROOT, entry.media))
    : null;

  console.log(`\n=== PROOF POST (${persona.name}) — Friks-style founder post ===`);
  console.log(`Pick:    #${idx % bank.posts.length} '${entry.id}' (${entry.archetype})`);
  console.log(`Media:   ${mediaLocal ? path.basename(mediaLocal) : "none"}`);
  console.log(`Reply:   ${entry.reply ? "yes (link rides in the reply, per Friks doctrine)" : "no — pure value post"}`);
  console.log(`\n--- main (${entry.content.length}ch) ---\n${entry.content}`);
  if (entry.reply) console.log(`\n--- reply (${entry.reply.length}ch) ---\n${entry.reply}`);

  if (!opts.publish) {
    console.log("\n[DRY RUN] Not posting. Re-run with --publish to go live.");
    await closePersonaPool();
    return;
  }

  let mediaUrl = null;
  if (mediaLocal) {
    if (!fs.existsSync(mediaLocal)) console.warn(`  ! media missing, posting without: ${mediaLocal}`);
    else {
      mediaUrl = await uploadToInsforge(mediaLocal);
      console.log(`\n  ↑ ${path.basename(mediaLocal)} → uploaded`);
    }
  }

  const threadItems = [{ content: cap(entry.content) }];
  if (mediaUrl) threadItems[0].mediaItems = [{ type: "image", url: mediaUrl }];
  if (entry.reply) threadItems.push({ content: cap(entry.reply) });

  const body = {
    profileId: persona.profileId,
    content: threadItems[0].content,
    platforms: [{
      platform: "twitter",
      accountId: persona.accounts.twitter,
      platformSpecificData: { threadItems },
    }],
    publishNow: true,
  };

  console.log(`\nPosting to twitter (${threadItems.length} item${threadItems.length > 1 ? "s" : ""})…`);
  const result = await publishToZernio(body);
  const postId = result.post?._id || result.post?.id || result._id || result.id || null;
  console.log(`  ✓ twitter Zernio post id: ${postId}`);
  await recordContentPost(persona, entry, postId, threadItems.length);

  await closePersonaPool();
}

main().catch(async (e) => {
  console.error(`[proof-post] ❌ ${e.message}`);
  await closePersonaPool().catch(() => {});
  process.exit(1);
});
