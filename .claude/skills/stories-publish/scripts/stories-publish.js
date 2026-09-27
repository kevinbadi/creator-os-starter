#!/usr/bin/env node
/**
 * stories-publish — Publish stories to Instagram + Facebook via Late API
 *
 * 1. Find latest unpublished story sidecar
 * 2. Upload stitched video to Late cloud storage (presign → PUT)
 * 3. Generate platform-optimized captions via Gemini
 * 4. Publish as story via Late API (Instagram Stories + Facebook Stories)
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
const OUTPUT_BASE = getOutputDir('stories', ROOT_DIR);

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
  const opts = { story: null, platforms: null, schedule: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--story': opts.story = args[++i]; break;
      case '--platforms': opts.platforms = args[++i].split(',').map(p => p.trim()); break;
      case '--schedule': opts.schedule = args[++i]; break;
      case '--dry-run': opts.dryRun = true; break;
    }
  }
  return opts;
}

// ============================================================================
// Find Latest Unpublished Story
// ============================================================================

function findLatestUnpublished() {
  if (!fs.existsSync(OUTPUT_BASE)) {
    throw new Error(`Stories directory not found: ${OUTPUT_BASE}`);
  }

  const dirs = fs.readdirSync(OUTPUT_BASE, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
    .reverse();

  for (const dir of dirs) {
    const sidecarPath = path.join(OUTPUT_BASE, dir, 'story.json');
    if (!fs.existsSync(sidecarPath)) continue;
    const meta = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    if (!meta.published_at) return sidecarPath;
  }

  throw new Error(`No unpublished stories found in ${OUTPUT_BASE}`);
}

// ============================================================================
// Upload Video to Late Cloud Storage
// ============================================================================

async function uploadVideoToLate(videoPath) {
  const filename = path.basename(videoPath);

  const presignRes = await fetch(`${LATE_BASE_URL}/media/presign`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LATE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filename, contentType: 'video/mp4' }),
  });

  if (!presignRes.ok) {
    const err = await presignRes.text();
    throw new Error(`Late presign failed (${presignRes.status}): ${err}`);
  }

  const { uploadUrl, publicUrl } = await presignRes.json();

  const fileBuffer = fs.readFileSync(videoPath);
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4' },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    throw new Error(`Late upload failed (${uploadRes.status}) for ${filename}`);
  }

  return publicUrl;
}

// ============================================================================
// Gemini — Platform Captions (Story-Style)
// ============================================================================

async function generatePlatformCaptions(meta) {
  const { topic, pillar, frame_count, frames } = meta;
  const frameTexts = (frames || []).map(f => f.overlayText).join(' → ');

  const prompt = `You are writing social media captions for ${persona.name} — the brand persona for ${persona.brand}.
${persona.voice ? `\nVoice guide:\n${persona.voice}\n` : ''}
The story is about: "${topic}" (pillar: ${pillar}, ${frame_count} frames)
Frame text flow: ${frameTexts}

Generate platform-optimized captions for a STORY post (vertical video). Match the persona's voice. Stories captions should be SHORT.

Rules:
- Instagram: Short story caption (1 sentence), casual tone, 3-5 hashtags. Under 100 chars before hashtags.
- Facebook: Warm one-liner. 2-3 hashtags max.

Format EXACTLY like this:
INSTAGRAM:
[caption]

FACEBOOK:
[caption]`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 1024 },
      }),
    }
  );

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini error: ${JSON.stringify(data)}`);

  const get = (label) => {
    const re = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n(?:INSTAGRAM|FACEBOOK):|\$)`, 'i');
    const m = text.match(re);
    return m ? m[1].trim() : '';
  };

  return {
    instagram: get('INSTAGRAM'),
    facebook: get('FACEBOOK'),
  };
}

// ============================================================================
// Late API — Publish Story
// ============================================================================

async function publishToLate(videoUrl, captions, platformList, schedule) {
  const mediaItems = [{ type: 'video', url: videoUrl }];

  const platforms = platformList.map(name => {
    const acc = PLATFORM_ACCOUNTS[name];
    if (!acc) throw new Error(`Unknown or unsupported story platform: ${name}`);

    const entry = {
      platform: acc.platform,
      accountId: acc.accountId,
      platformSpecificData: { contentType: 'story' },
    };

    if (name === 'facebook') entry.customContent = captions.facebook;

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

async function recordPostInDB({ meta, captions, videoUrl, platformList, lateResult, schedule }) {
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
      meta.story_id,
      latePostId,
      captions.instagram,
      [videoUrl],
      platformList,
      status,
      schedule || null,
      postedAt,
      [],
      JSON.stringify(lateResult),
      JSON.stringify({
        source: 'stories-publish',
        type: 'story',
        topic: meta.topic,
        pillar: meta.pillar,
        frame_count: meta.frame_count,
        captions: {
          instagram: captions.instagram,
          facebook: captions.facebook,
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

  // Find story sidecar
  const sidecarPath = opts.story || findLatestUnpublished();
  const meta = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  const storyDir = path.dirname(sidecarPath);

  console.log(`\n=== ${persona.name.toUpperCase()} STORIES PUBLISH ===`);
  console.log(`Story:    ${meta.story_id}`);
  console.log(`Topic:    ${meta.topic}`);
  console.log(`Pillar:   ${meta.pillar}`);
  console.log(`Frames:   ${meta.frame_count}`);
  console.log(`Sidecar:  ${sidecarPath}`);

  // Verify video exists
  if (!fs.existsSync(meta.video_path)) {
    throw new Error(`Story video missing: ${meta.video_path}`);
  }

  // Determine platforms
  const allPlatforms = ['instagram', 'facebook'];
  const platformList = opts.platforms
    ? opts.platforms.filter(p => PLATFORM_ACCOUNTS[p])
    : allPlatforms;
  console.log(`Platforms: ${platformList.join(', ')}`);
  if (opts.schedule) console.log(`Schedule: ${opts.schedule}`);

  // Step 1: Generate captions
  console.log('\n[Step 1] Generating platform-optimized captions via Gemini...');
  const captions = await generatePlatformCaptions(meta);

  console.log('\n--- CAPTIONS ---');
  for (const plat of platformList) {
    console.log(`\n[${plat.toUpperCase()}]`);
    console.log(captions[plat]);
  }

  if (opts.dryRun) {
    console.log('\n[DRY RUN] Stopping here. No posts published.');
    if (pool) await pool.end();
    return;
  }

  // Step 2: Upload video to Late
  console.log('\n[Step 2] Uploading story video to Late cloud storage...');
  const videoUrl = await uploadVideoToLate(meta.video_path);
  console.log(`  Video URL: ${videoUrl}`);

  // Step 3: Publish
  console.log('\n[Step 3] Publishing story via Late API...');
  const lateResult = await publishToLate(videoUrl, captions, platformList, opts.schedule);
  const latePostId = lateResult.post?._id || lateResult.post?.id || lateResult._id || lateResult.id || null;

  // Step 4: Record in database
  console.log('\n[Step 4] Recording in database...');
  const userPostId = await recordPostInDB({
    meta, captions, videoUrl, platformList, lateResult, schedule: opts.schedule,
  });

  // Mark sidecar as published
  meta.published_at = new Date().toISOString();
  meta.late_post_id = latePostId;
  meta.user_post_id = userPostId;
  meta.published_platforms = platformList;
  meta.video_url = videoUrl;
  fs.writeFileSync(sidecarPath, JSON.stringify(meta, null, 2));

  console.log('\n=== STORIES PUBLISH COMPLETE ===');
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
