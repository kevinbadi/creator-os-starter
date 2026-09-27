#!/usr/bin/env node
/**
 * carousel-publish — publish a rendered carousel to a persona's socials via Zernio.
 *
 * Flow: load carousel.json sidecar → upload each slide to Insforge storage →
 * POST /posts to Zernio for the persona's carousel platforms (IG + TikTok) using
 * captions authored in the plan → record in content_posts + mark sidecar published.
 *
 * SAFE BY DEFAULT: without --publish (or --schedule) it only dry-runs — prints the
 * captions and the exact Zernio payload, uploads nothing, posts nothing.
 *
 * Usage:
 *   node carousel-publish.js --carousel path/to/carousel.json            # dry-run
 *   node carousel-publish.js --carousel ... --publish                    # go live now
 *   node carousel-publish.js --carousel ... --schedule 2026-07-02T09:00  # schedule
 *   node carousel-publish.js --carousel ... --platforms instagram        # filter
 */
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const { loadPersona, closePersonaPool } = require("../../../lib/persona");
const { writeSeoCaptions } = require("../../../lib/seo-caption");

const ROOT_DIR = path.join(__dirname, "..", "..", "..");
const ZERNIO_BASE = process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1";
const ZERNIO_KEY = process.env.ZERNIO_API_KEY;
const INSFORGE_BASE = process.env.INSFORGE_API_BASE_URL;
const INSFORGE_KEY = process.env.INSFORGE_API_KEY;
const BUCKET = "media";

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { carousel: null, slug: null, platforms: null, schedule: null, publish: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--carousel") o.carousel = a[++i];
    else if (a[i] === "--slug") o.slug = a[++i];
    else if (a[i] === "--platforms") o.platforms = a[++i].split(",").map((s) => s.trim());
    else if (a[i] === "--schedule") o.schedule = a[++i];
    else if (a[i] === "--publish") o.publish = true;
  }
  return o;
}

// Upload a local file to Insforge storage — mirrors src/lib/insforge/storage.ts.
async function uploadToInsforge(localPath) {
  if (!INSFORGE_BASE || !INSFORGE_KEY) throw new Error("Insforge storage not configured");
  const buf = fs.readFileSync(localPath);
  // Unique per upload — same-named files from concurrent cron jobs raced in
  // Insforge and swapped URLs (megan video on danny tiktok, 2026-07-08).
  const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${path.basename(localPath)}`;
  const contentType = "image/png";
  const auth = { Authorization: `Bearer ${INSFORGE_KEY}` };

  const stratRes = await fetch(`${INSFORGE_BASE}/api/storage/buckets/${BUCKET}/upload-strategy`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ filename: name, contentType, size: buf.length }),
  });
  if (!stratRes.ok) throw new Error(`upload-strategy ${stratRes.status}`);
  const s = await stratRes.json();

  if (s.method === "presigned") {
    const fd = new FormData();
    for (const [k, v] of Object.entries(s.fields ?? {})) fd.append(k, v);
    fd.append("file", new Blob([buf], { type: contentType }), name);
    const up = await fetch(s.uploadUrl, { method: "POST", body: fd });
    if (up.status < 200 || up.status >= 300) throw new Error(`storage upload ${up.status}`);
    const cf = await fetch(`${INSFORGE_BASE}${s.confirmUrl}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ size: buf.length, contentType }),
    });
    if (!cf.ok) throw new Error(`confirm ${cf.status}`);
    return (await cf.json()).url;
  }
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: contentType }), name);
  const up = await fetch(`${INSFORGE_BASE}${s.uploadUrl}`, { method: "PUT", headers: auth, body: fd });
  if (!up.ok) throw new Error(`storage upload ${up.status}`);
  const j = await up.json().catch(() => ({}));
  return j.url || `${INSFORGE_BASE}/api/storage/buckets/${BUCKET}/objects/${s.key}`;
}

async function zernioCreatePost(body) {
  const res = await fetch(`${ZERNIO_BASE}/posts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ZERNIO_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Zernio ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

const CONTENT_POSTS_SCHEMA = `
create table if not exists content_posts (
  id            bigserial primary key,
  persona       text,
  carousel_id   text,
  zernio_post_id text,
  content       text,
  media_urls    jsonb,
  platforms     jsonb,
  status        text,
  scheduled_for timestamptz,
  posted_at     timestamptz,
  metadata      jsonb,
  created_at    timestamptz not null default now()
);`;

async function main() {
  const opts = parseArgs();
  if (!opts.carousel) throw new Error("--carousel <path> is required");
  if (!ZERNIO_KEY) throw new Error("ZERNIO_API_KEY not set");

  const meta = JSON.parse(fs.readFileSync(opts.carousel, "utf8"));
  const persona = await loadPersona(ROOT_DIR, opts.slug || meta.persona);

  const live = opts.publish || opts.schedule;
  const platformList = (opts.platforms || persona.carouselPlatforms).filter(
    (p) => persona.accounts[p],
  );
  if (platformList.length === 0) throw new Error("No matching platform accounts for persona");

  let igCaption = meta.caption?.instagram || "";
  let ttCaption = meta.caption?.tiktok || igCaption;
  const hashtags = (meta.hashtags || []).join(" ");
  // SEO captions (Kevin 2026-07-08): keyword-rich descriptions tell the
  // algos who to show this to — plan captions are seed + fallback.
  const seo = await writeSeoCaptions({
    persona: { name: persona.name, voice: persona.voice, niche: persona.niche },
    topic: meta.topic,
    onScreenTexts: (meta.slides || []).map((s) => s.overlayText).filter(Boolean).slice(0, 12),
    seedCaptions: { instagram: igCaption, tiktok: ttCaption },
    hashtags: meta.hashtags || [],
  });
  if (seo.generated) {
    igCaption = seo.instagram;
    ttCaption = seo.tiktok;
  }
  const igFull = seo.generated ? igCaption : igCaption + (hashtags ? `\n\n${hashtags}` : "");

  console.log(`\n=== CAROUSEL PUBLISH — ${persona.name} ===`);
  console.log(`Carousel:  ${meta.carousel_id}`);
  console.log(`Topic:     ${meta.topic}`);
  console.log(`Slides:    ${meta.slide_count}`);
  console.log(`Platforms: ${platformList.join(", ")} → ${platformList.map((p) => `@${p}:${persona.accounts[p]}`).join(", ")}`);
  console.log(`Mode:      ${opts.schedule ? `SCHEDULE ${opts.schedule}` : opts.publish ? "PUBLISH NOW" : "DRY RUN"}`);
  console.log(`\n--- INSTAGRAM CAPTION ---\n${igFull}`);
  console.log(`\n--- TIKTOK CAPTION ---\n${ttCaption}`);

  // Verify slide files exist.
  for (const s of meta.slides) {
    if (!fs.existsSync(s.localPath)) throw new Error(`Missing slide: ${s.localPath}`);
  }

  const platforms = platformList.map((p) => {
    const entry = { platform: p, accountId: persona.accounts[p], profileId: persona.profileId };
    if (p === "tiktok") entry.customContent = ttCaption;
    return entry;
  });

  if (!live) {
    console.log(`\n[DRY RUN] Would upload ${meta.slides.length} slides to Insforge, then POST /posts:`);
    console.log(JSON.stringify({ profileId: persona.profileId, content: "<ig caption>", mediaItems: `<${meta.slides.length} images>`, platforms, tiktokSettings: "<tiktok defaults>" }, null, 2));
    console.log(`\nTo go live:   add --publish   (or --schedule <ISO datetime>)`);
    await closePersonaPool();
    return;
  }

  // Upload slides.
  console.log(`\n[1/3] Uploading ${meta.slides.length} slides to Insforge…`);
  const mediaUrls = [];
  for (const s of meta.slides) {
    const url = await uploadToInsforge(s.localPath);
    mediaUrls.push(url);
    console.log(`  slide ${s.index}: ${url}`);
  }

  // Build + send. Per Zernio's photo-carousel docs: `content` becomes the
  // TikTok photo TITLE (90 chars, hashtags/URLs auto-stripped) — the full
  // caption belongs in tiktokSettings.description (up to 4000 chars).
  const ttFull = seo.generated ? ttCaption : ttCaption + (hashtags ? `\n\n${hashtags}` : "");
  const body = {
    profileId: persona.profileId,
    content: igFull,
    mediaItems: mediaUrls.map((url) => ({ type: "image", url })),
    platforms,
    tiktokSettings: {
      draft: false,
      mediaType: "photo",
      photoCoverIndex: 0,
      autoAddMusic: true, // TikTok auto-picks recommended/trending music for photo posts
      description: ttFull.slice(0, 4000),
      privacyLevel: "PUBLIC_TO_EVERYONE",
      allowComment: true,
      contentPreviewConfirmed: true,
      expressConsentGiven: true,
    },
  };
  if (opts.schedule) body.scheduledFor = new Date(opts.schedule).toISOString();
  else body.publishNow = true;

  console.log(`\n[2/3] ${opts.schedule ? "Scheduling" : "Publishing"} via Zernio…`);
  const result = await zernioCreatePost(body);
  const postId = result.post?._id || result.post?.id || result._id || result.id || null;
  console.log(`  Zernio post id: ${postId}`);

  // Record.
  console.log(`\n[3/3] Recording…`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
  try {
    await pool.query(CONTENT_POSTS_SCHEMA);
    await pool.query(
      `insert into content_posts (persona, carousel_id, zernio_post_id, content, media_urls, platforms, status, scheduled_for, posted_at, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        persona.slug, meta.carousel_id, postId, igFull, JSON.stringify(mediaUrls),
        JSON.stringify(platformList), opts.schedule ? "scheduled" : "posted",
        opts.schedule ? new Date(opts.schedule).toISOString() : null,
        opts.schedule ? null : new Date().toISOString(),
        JSON.stringify({ topic: meta.topic, content_pillar: meta.content_pillar, visual_pillar: meta.visual_pillar, tiktok_caption: ttCaption }),
      ],
    );
    console.log(`  content_posts row inserted`);
  } finally {
    await pool.end();
  }

  meta.published_at = opts.schedule ? null : new Date().toISOString();
  meta.scheduled_for = opts.schedule ? new Date(opts.schedule).toISOString() : null;
  meta.zernio_post_id = postId;
  meta.media_urls = mediaUrls;
  meta.published_platforms = platformList;
  fs.writeFileSync(opts.carousel, JSON.stringify(meta, null, 2));

  console.log(`\n=== ${opts.schedule ? "SCHEDULED" : "PUBLISHED"} — post ${postId} → ${platformList.join(", ")} ===`);
  await closePersonaPool();
}

main().catch(async (e) => {
  console.error(`\nError: ${e.message}`);
  await closePersonaPool();
  process.exit(1);
});
