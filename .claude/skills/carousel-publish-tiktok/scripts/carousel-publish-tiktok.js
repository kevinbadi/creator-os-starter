#!/usr/bin/env node
/**
 * carousel-publish-tiktok — Publish a photo carousel to TikTok via Zernio.
 *
 * TikTok photo carousels are IMAGES ONLY (no video). The trending sound is
 * NATIVE: `autoAddMusic: true` tells TikTok to pick recommended (trending)
 * music for the carousel — so there is no ffmpeg / no sound file on our side.
 * (The Instagram sibling skill is where we bake a downloaded sound into a
 * video first-slide, because Instagram's API can't attach audio.)
 *
 * Flow:
 *   1. Load the persona brand pack from the `personas` table (profileId + accounts.tiktok)
 *   2. Find the latest unpublished carousel sidecar (or --carousel <path>)
 *   3. Upload each slide-NN.png to Insforge storage → public URLs
 *   4. POST /posts to Zernio with tiktok platformSpecificData:
 *        mediaType:'photo', autoAddMusic:true, privacyLevel, allowComment,
 *        contentPreviewConfirmed:true, expressConsentGiven:true
 *   5. Stamp the sidecar with published_at + zernio_post_id
 *
 * SAFETY: dry-run by default. Pass --publish to actually post to TikTok.
 *
 * Usage:
 *   node carousel-publish-tiktok.js [--persona megan] [--carousel <dir-or-json>]
 *                                   [--schedule <ISO8601>] [--publish]
 */

const fs = require("fs");
const path = require("path");
const {
  loadPersona,
  getOutputDir,
  closePersonaPool,
} = require("../../../lib/persona");
const { writeSeoCaptions } = require("../../../lib/seo-caption");

const ROOT_DIR = path.join(__dirname, "..", "..", ".."); // creator-os/.claude
const ZERNIO_BASE = process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1";
const INSFORGE_BASE = process.env.INSFORGE_API_BASE_URL || "";
const INSFORGE_KEY = process.env.INSFORGE_API_KEY || "";
const BUCKET = "media";

// ── CLI ────────────────────────────────────────────────────────────────────
function parseArgs() {
  const a = process.argv.slice(2);
  const o = { persona: null, carousel: null, schedule: null, publish: false };
  for (let i = 0; i < a.length; i++) {
    switch (a[i]) {
      case "--persona": o.persona = a[++i]; break;
      case "--carousel": o.carousel = a[++i]; break;
      case "--schedule": o.schedule = a[++i]; break;
      case "--publish": o.publish = true; break;
      case "--dry-run": o.publish = false; break;
      default: throw new Error(`Unknown arg: ${a[i]}`);
    }
  }
  return o;
}

// ── Find the carousel sidecar ────────────────────────────────────────────────
function resolveSidecar(carouselArg, persona) {
  if (carouselArg) {
    const p = fs.statSync(carouselArg).isDirectory()
      ? path.join(carouselArg, "carousel.json")
      : carouselArg;
    if (!fs.existsSync(p)) throw new Error(`Sidecar not found: ${p}`);
    return p;
  }
  const base = getOutputDir("carousels", ROOT_DIR, persona.slug);
  const dirs = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();
  for (const dir of dirs) {
    const p = path.join(base, dir, "carousel.json");
    if (!fs.existsSync(p)) continue;
    const meta = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!meta.published_at) return p;
  }
  throw new Error(`No unpublished carousels in ${base}`);
}

// ── Insforge storage upload (mirrors src/lib/insforge/storage.ts) ─────────────
async function uploadToInsforge(localPath) {
  if (!INSFORGE_BASE || !INSFORGE_KEY) {
    throw new Error("Insforge storage not configured (INSFORGE_API_BASE_URL / INSFORGE_API_KEY)");
  }
  // Unique per upload — same-named files from concurrent cron jobs raced in
  // Insforge and swapped URLs (megan video on danny tiktok, 2026-07-08).
  const filename = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${path.basename(localPath)}`;
  const buf = fs.readFileSync(localPath);
  const contentType = filename.endsWith(".png")
    ? "image/png"
    : filename.endsWith(".jpg") || filename.endsWith(".jpeg")
      ? "image/jpeg"
      : "application/octet-stream";
  const size = buf.length;
  const auth = { Authorization: `Bearer ${INSFORGE_KEY}` };

  const stratRes = await fetch(
    `${INSFORGE_BASE}/api/storage/buckets/${BUCKET}/upload-strategy`,
    {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ filename, contentType, size }),
    },
  );
  if (!stratRes.ok) throw new Error(`Upload strategy failed (${stratRes.status})`);
  const s = await stratRes.json();

  if (s.method === "presigned") {
    const fd = new FormData();
    for (const [k, v] of Object.entries(s.fields ?? {})) fd.append(k, v);
    fd.append("file", new Blob([buf], { type: contentType }), filename);
    const up = await fetch(s.uploadUrl, { method: "POST", body: fd });
    if (up.status < 200 || up.status >= 300) {
      throw new Error(`Storage upload failed (${up.status}) for ${filename}`);
    }
    const cf = await fetch(`${INSFORGE_BASE}${s.confirmUrl}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ size, contentType }),
    });
    if (!cf.ok) throw new Error(`Upload confirm failed (${cf.status})`);
    return (await cf.json()).url;
  }

  // Local/direct backend
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: contentType }), filename);
  const up = await fetch(`${INSFORGE_BASE}${s.uploadUrl}`, {
    method: "PUT",
    headers: auth,
    body: fd,
  });
  if (!up.ok) throw new Error(`Storage upload failed (${up.status})`);
  const j = await up.json().catch(() => ({}));
  return j.url || `${INSFORGE_BASE}/api/storage/buckets/${BUCKET}/objects/${s.key}`;
}

// ── Zernio post ──────────────────────────────────────────────────────────────
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

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();
  const persona = await loadPersona(ROOT_DIR, opts.persona);

  const tiktokAccountId = persona.accounts?.tiktok;
  if (!tiktokAccountId) {
    throw new Error(`Persona '${persona.slug}' has no TikTok account in personas.accounts`);
  }

  const sidecarPath = resolveSidecar(opts.carousel, persona);
  const meta = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));

  // Images only — TikTok photo carousels reject video.
  const slides = (meta.slides || []).filter((s) => {
    const p = s.localPath;
    return p && /\.(png|jpe?g)$/i.test(p);
  });
  if (!slides.length) throw new Error("No image slides found in sidecar");
  for (const s of slides) {
    if (!fs.existsSync(s.localPath)) throw new Error(`Missing slide: ${s.localPath}`);
  }

  const caption = meta.caption?.tiktok || meta.caption?.instagram || meta.topic || "";
  const hashtags = (meta.hashtags || []).join(" ");
  // SEO captions (Kevin 2026-07-08): keyword-rich description tells TikTok's
  // algo who to show the carousel to — sidecar caption is seed + fallback.
  const seo = await writeSeoCaptions({
    persona: { name: persona.name, voice: persona.voice, niche: persona.niche },
    topic: meta.topic,
    onScreenTexts: (meta.slides || []).map((s) => s.overlayText).filter(Boolean).slice(0, 12),
    seedCaptions: { instagram: meta.caption?.instagram || caption, tiktok: caption },
    hashtags: meta.hashtags || [],
  });
  // Per Zernio docs: `content` becomes the photo TITLE (90 chars max, hashtags
  // and URLs auto-stripped) — full caption goes in tiktokSettings.description.
  const title = (seo.generated ? seo.tiktokTitle : meta.topic || caption).slice(0, 90);
  const description = (seo.generated
    ? seo.tiktok
    : [caption, hashtags].filter(Boolean).join("\n\n")
  ).slice(0, 4000);

  console.log(`\n=== TIKTOK CAROUSEL PUBLISH (${persona.name}) ===`);
  console.log(`Carousel: ${meta.carousel_id || path.basename(path.dirname(sidecarPath))}`);
  console.log(`Topic:    ${meta.topic}`);
  console.log(`Slides:   ${slides.length} (images only)`);
  console.log(`Profile:  ${persona.profileId}  TikTok acct: ${tiktokAccountId}`);
  console.log(`Sound:    auto_add_music=true (TikTok picks trending music)`);
  if (opts.schedule) console.log(`Schedule: ${opts.schedule}`);
  console.log(`\n--- Title (90ch) ---\n${title}`);
  console.log(`\n--- Description ---\n${description}\n`);

  if (!opts.publish) {
    console.log("[DRY RUN] Not uploading or posting. Re-run with --publish to go live.");
    await closePersonaPool();
    return;
  }

  console.log(`[1/2] Uploading ${slides.length} slides to Insforge…`);
  const mediaItems = [];
  for (const s of slides) {
    const url = await uploadToInsforge(s.localPath);
    mediaItems.push({ type: "image", url });
    console.log(`  slide ${s.index}: ${url}`);
  }

  // Mirrors Zernio's official photo-carousel example (root-level tiktokSettings,
  // snake_case fields — both casings are accepted, docs use snake_case).
  const body = {
    profileId: persona.profileId,
    content: title,
    mediaItems,
    platforms: [{ platform: "tiktok", accountId: tiktokAccountId }],
    tiktokSettings: {
      privacy_level: "PUBLIC_TO_EVERYONE",
      allow_comment: true,
      media_type: "photo",
      photo_cover_index: 0,
      description,
      auto_add_music: true,
      content_preview_confirmed: true,
      express_consent_given: true,
      // AIGC disclosure — persona slides are AI-generated people; TikTok
      // requires the label (megan's 2nd ban 2026-07-12 prompted this).
      is_aigc: true,
    },
  };
  if (opts.schedule) body.scheduledFor = opts.schedule;
  else body.publishNow = true;

  console.log(`[2/2] Posting to Zernio…`);
  const result = await publishToZernio(body);
  const postId =
    result.post?._id || result.post?.id || result._id || result.id || null;
  console.log(`  ✓ Zernio post id: ${postId}`);

  meta.published_at = new Date().toISOString();
  meta.zernio_post_id = postId;
  meta.zernio_platform = "tiktok";
  fs.writeFileSync(sidecarPath, JSON.stringify(meta, null, 2));
  console.log(`  ✓ Sidecar stamped: ${sidecarPath}`);

  // Record in content_posts — the Insforge source of truth the dashboard's
  // automations timeline reads to verify the daily cron actually ran.
  try {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
    await pool.query(`create table if not exists content_posts (
      id bigserial primary key, persona text, carousel_id text, zernio_post_id text,
      content text, media_urls jsonb, platforms jsonb, status text,
      scheduled_for timestamptz, posted_at timestamptz, metadata jsonb,
      created_at timestamptz not null default now())`);
    await pool.query(
      `insert into content_posts (persona, carousel_id, zernio_post_id, content, media_urls, platforms, status, scheduled_for, posted_at, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        persona.slug,
        meta.carousel_id || path.basename(path.dirname(sidecarPath)),
        postId,
        description,
        JSON.stringify(mediaItems.map((m) => m.url)),
        JSON.stringify(["tiktok"]),
        opts.schedule ? "scheduled" : "published",
        opts.schedule ? new Date(opts.schedule).toISOString() : null,
        opts.schedule ? null : new Date().toISOString(),
        JSON.stringify({ topic: meta.topic, auto_add_music: true }),
      ],
    );
    await pool.end();
    console.log(`  ✓ Recorded in content_posts (persona=${persona.slug})`);
  } catch (e) {
    console.error(`  ! content_posts record failed (post is live): ${e.message}`);
  }

  await closePersonaPool();
}

main().catch(async (e) => {
  console.error(`\n✗ ${e.message}`);
  await closePersonaPool().catch(() => {});
  process.exit(1);
});
