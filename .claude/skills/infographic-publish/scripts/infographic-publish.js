#!/usr/bin/env node
/**
 * infographic-publish — Publish infographic posts to IG, FB, Twitter/X via Late API
 *
 * 1. Find latest unpublished infographic sidecar
 * 2. Upload infographic image to Late cloud storage (presign → PUT)
 * 3. Generate platform-optimized captions via Gemini (long-form IG/FB, 280-char Twitter)
 * 4. Publish as image post via Late API
 * 5. Record in database (user_posts + platform_posts)
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { loadPersonaContext, getOutputDir } = require('../../../lib/persona');

// ============================================================================
// Config
// ============================================================================

const LATE_API_KEY = process.env.LATE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DATABASE_URL = process.env.INSFORGE_CONNECTION_STRING || process.env.DATABASE_URL;
const LATE_BASE_URL = 'https://zernio.com/api/v1';

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const persona = loadPersonaContext(ROOT_DIR);
const OUTPUT_BASE = getOutputDir('infographics', ROOT_DIR);

const isRealDB = DATABASE_URL && !DATABASE_URL.includes('user:pass@host');
const pool = isRealDB ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

// Read platform accounts from SOCIALS.md
function loadPlatformConfig() {
  const ROOT_DIR = path.join(__dirname, '..', '..', '..');
  const socialsPath = path.join(ROOT_DIR, 'SOCIALS.md');
  const accounts = {};
  let profileId = null;

  if (fs.existsSync(socialsPath)) {
    const content = fs.readFileSync(socialsPath, 'utf8');
    const profileMatch = content.match(/Profile ID[*:\s\x60]*([a-f0-9]{24,})/i);
    if (profileMatch) profileId = profileMatch[1];

    const platformNames = ['instagram', 'tiktok', 'facebook', 'twitter', 'youtube'];
    for (const plat of platformNames) {
      const re = new RegExp(`###?\\s*${plat}[\\s\\S]*?Late Account ID[:\\s]*\`?([a-f0-9]{24,})\`?`, 'i');
      const m = content.match(re);
      if (m) accounts[plat] = { accountId: m[1], platform: plat };
    }
  }

  return { accounts, profileId };
}

const { accounts: PLATFORM_ACCOUNTS, profileId: PROFILE_ID } = loadPlatformConfig();

// ============================================================================
// CLI
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { infographic: null, platforms: null, schedule: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--infographic': opts.infographic = args[++i]; break;
      case '--platforms': opts.platforms = args[++i].split(',').map(p => p.trim()); break;
      case '--schedule': opts.schedule = args[++i]; break;
      case '--dry-run': opts.dryRun = true; break;
    }
  }
  return opts;
}

// ============================================================================
// Find Latest Unpublished Infographic
// ============================================================================

function findLatestUnpublished() {
  if (!fs.existsSync(OUTPUT_BASE)) {
    throw new Error(`Infographics directory not found: ${OUTPUT_BASE}`);
  }

  const dirs = fs.readdirSync(OUTPUT_BASE, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
    .reverse();

  for (const dir of dirs) {
    const sidecarPath = path.join(OUTPUT_BASE, dir, 'infographic.json');
    if (!fs.existsSync(sidecarPath)) continue;
    const meta = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    if (!meta.published_at) return sidecarPath;
  }

  throw new Error(`No unpublished infographics found in ${OUTPUT_BASE}`);
}

// ============================================================================
// Upload Image to Late Cloud Storage
// ============================================================================

async function uploadImageToLate(imagePath) {
  const filename = path.basename(imagePath);

  const presignRes = await fetch(`${LATE_BASE_URL}/media/presign`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LATE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filename, contentType: 'image/png' }),
  });

  if (!presignRes.ok) {
    const err = await presignRes.text();
    throw new Error(`Late presign failed (${presignRes.status}): ${err}`);
  }

  const { uploadUrl, publicUrl } = await presignRes.json();

  const fileBuffer = fs.readFileSync(imagePath);
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    throw new Error(`Late upload failed (${uploadRes.status}) for ${filename}`);
  }

  return publicUrl;
}

// ============================================================================
// Gemini — Platform Captions
// ============================================================================

async function generatePlatformCaptions(meta) {
  const { topic, pillar, title, facts, caption, hashtags } = meta;
  const hashtagStr = (hashtags || []).join(' ');
  const factsStr = (facts || []).map((f, i) => `${i + 1}. ${f}`).join('\n');

  const prompt = `You are writing social media captions for ${persona.name} — the brand persona for ${persona.brand}.
${persona.voice ? `\nVoice guide:\n${persona.voice}\n` : ''}
The infographic is about: "${topic}" (pillar: ${pillar})
Infographic title: "${title}"
Key facts on the image:
${factsStr}
Base caption: "${caption}"
Hashtags: ${hashtagStr}

Generate platform-optimized captions for an INFOGRAPHIC post (single image with facts). Match the persona's voice — warm, punchy, authentic, educational.

Rules:
- Instagram: Long-form storytelling caption (3-5 sentences), educational tone, swipe-save CTA, end with hashtags. Max 2200 chars.
- Facebook: Warm engaging caption (2-3 sentences), educational, include a link to the brand website. 3-5 hashtags max.
- Twitter: MUST be under 280 characters total (including hashtags). Short, punchy, one sentence max. 2-3 hashtags. This is critical — count your characters.

Format EXACTLY like this:
INSTAGRAM:
[caption]

FACEBOOK:
[caption]

TWITTER:
[caption]`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 2048 },
      }),
    }
  );

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini error: ${JSON.stringify(data)}`);

  const get = (label) => {
    const re = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n(?:INSTAGRAM|FACEBOOK|TWITTER):|\$)`, 'i');
    const m = text.match(re);
    return m ? m[1].trim() : '';
  };

  const captions = {
    instagram: get('INSTAGRAM'),
    facebook: get('FACEBOOK'),
    twitter: get('TWITTER'),
  };

  // Safety check: truncate Twitter to 280 chars if Gemini exceeded
  if (captions.twitter.length > 280) {
    console.log(`  ⚠ Twitter caption was ${captions.twitter.length} chars, truncating to 280`);
    captions.twitter = captions.twitter.substring(0, 277) + '...';
  }

  return captions;
}

// ============================================================================
// Late API — Publish Infographic Post
// ============================================================================

async function publishToLate(imageUrl, captions, platformList, schedule) {
  const mediaItems = [{ type: 'image', url: imageUrl }];

  const platforms = platformList.map(name => {
    const acc = PLATFORM_ACCOUNTS[name];
    if (!acc) throw new Error(`Unknown or unsupported infographic platform: ${name}`);

    const entry = {
      platform: acc.platform,
      accountId: acc.accountId,
    };

    if (name === 'facebook') entry.customContent = captions.facebook;
    if (name === 'twitter') entry.customContent = captions.twitter;

    return entry;
  });

  const body = {
    profileId: PROFILE_ID,
    content: captions.instagram,
    mediaItems,
    platforms,
  };

  if (schedule) {
    body.scheduledFor = schedule;
    body.timezone = 'Pacific/Apia';
  }

  const response = await fetch(`${LATE_BASE_URL}/posts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LATE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Late API error (${response.status}): ${JSON.stringify(data)}`);
  }

  return data;
}

// ============================================================================
// Database
// ============================================================================

async function recordPostInDB({ meta, captions, imageUrl, platformList, lateResult, schedule }) {
  if (!pool) {
    console.log('  (No database connection — skipping DB insert)');
    return null;
  }

  const latePostId = lateResult.post?._id || lateResult.post?.id || lateResult._id || lateResult.id || null;
  const status = schedule ? 'scheduled' : 'posted';
  const postedAt = schedule ? null : new Date().toISOString();

  const postRes = await pool.query(
    `INSERT INTO user_posts (
      post_id, late_post_id, content, media_urls, platforms,
      status, scheduled_at, posted_at, hashtags, raw_response, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id`,
    [
      meta.infographic_id,
      latePostId,
      captions.instagram,
      [imageUrl],
      platformList,
      status,
      schedule || null,
      postedAt,
      meta.hashtags || [],
      JSON.stringify(lateResult),
      JSON.stringify({
        source: 'infographic-publish',
        type: meta.type || 'infographic',
        topic: meta.topic,
        pillar: meta.pillar,
        title: meta.title,
        ...(meta.type === 'news' ? {
          subheadline: meta.subheadline,
          body: meta.body,
          cta: meta.cta,
          news_source: meta.news_source,
          original_headline: meta.original_headline,
        } : {
          facts: meta.facts,
        }),
        captions: {
          instagram: captions.instagram,
          facebook: captions.facebook,
          twitter: captions.twitter,
        },
      }),
    ]
  );

  const userPostId = postRes.rows[0].id;
  console.log(`  DB: user_posts row #${userPostId} inserted`);

  for (const plat of platformList) {
    await pool.query(
      `INSERT INTO platform_posts (
        user_post_id, platform, platform_post_id, status, posted_at, raw_response
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userPostId,
        plat,
        latePostId,
        status,
        postedAt,
        JSON.stringify({ account_id: PLATFORM_ACCOUNTS[plat].accountId }),
      ]
    );
  }
  console.log(`  DB: ${platformList.length} platform_posts rows inserted`);

  return userPostId;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const opts = parseArgs();

  if (!LATE_API_KEY) throw new Error('LATE_API_KEY not set in .env');
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');

  // Find infographic sidecar
  const sidecarPath = opts.infographic || findLatestUnpublished();
  const meta = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  const outDir = path.dirname(sidecarPath);

  console.log(`\n=== ${persona.name.toUpperCase()} INFOGRAPHIC PUBLISH ===`);
  console.log(`Infographic: ${meta.infographic_id}`);
  console.log(`Topic:       ${meta.topic}`);
  console.log(`Pillar:      ${meta.pillar}`);
  console.log(`Title:       ${meta.title}`);
  console.log(`Facts:       ${meta.facts.length}`);
  console.log(`Sidecar:     ${sidecarPath}`);

  // Verify image exists
  if (!fs.existsSync(meta.image_path)) {
    throw new Error(`Infographic image missing: ${meta.image_path}`);
  }

  // Determine platforms
  const allPlatforms = ['instagram', 'facebook', 'twitter'];
  const platformList = opts.platforms
    ? opts.platforms.filter(p => PLATFORM_ACCOUNTS[p])
    : allPlatforms;
  console.log(`Platforms:   ${platformList.join(', ')}`);
  if (opts.schedule) console.log(`Schedule:    ${opts.schedule}`);

  // Step 1: Generate captions
  console.log('\n[Step 1] Generating platform-optimized captions via Gemini...');
  const captions = await generatePlatformCaptions(meta);

  console.log('\n--- CAPTIONS ---');
  for (const plat of platformList) {
    console.log(`\n[${plat.toUpperCase()}]`);
    console.log(captions[plat]);
    if (plat === 'twitter') console.log(`  (${captions[plat].length}/280 chars)`);
  }

  if (opts.dryRun) {
    console.log('\n[DRY RUN] Stopping here. No posts published.');
    if (pool) await pool.end();
    return;
  }

  // Step 2: Upload image to Late
  console.log('\n[Step 2] Uploading infographic image to Late cloud storage...');
  const imageUrl = await uploadImageToLate(meta.image_path);
  console.log(`  Image URL: ${imageUrl}`);

  // Step 3: Publish
  console.log('\n[Step 3] Publishing infographic via Late API...');
  const lateResult = await publishToLate(imageUrl, captions, platformList, opts.schedule);
  const latePostId = lateResult.post?._id || lateResult.post?.id || lateResult._id || lateResult.id || null;

  // Step 4: Record in database
  console.log('\n[Step 4] Recording in database...');
  const userPostId = await recordPostInDB({
    meta, captions, imageUrl, platformList, lateResult, schedule: opts.schedule,
  });

  // Mark sidecar as published
  meta.published_at = new Date().toISOString();
  meta.late_post_id = latePostId;
  meta.user_post_id = userPostId;
  meta.published_platforms = platformList;
  meta.image_url = imageUrl;
  fs.writeFileSync(sidecarPath, JSON.stringify(meta, null, 2));

  console.log('\n=== INFOGRAPHIC PUBLISH COMPLETE ===');
  console.log(`Late Post ID:  ${latePostId}`);
  if (userPostId) console.log(`DB Post ID:    #${userPostId}`);
  console.log(`Platforms:     ${platformList.join(', ')}`);
  console.log(`Status:        ${opts.schedule ? 'Scheduled' : 'Published'}`);
  console.log(`Sidecar:       ${sidecarPath}`);

  if (pool) await pool.end();
}

main().catch(async e => {
  console.error(`\nError: ${e.message}`);
  if (pool) await pool.end();
  process.exit(1);
});
