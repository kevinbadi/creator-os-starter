#!/usr/bin/env node
/**
 * short-publish — Publish short-form videos to all platforms via Late API
 *
 * Reads sidecar JSON from short-video, generates platform-optimized captions
 * via Gemini, publishes to Instagram/TikTok/YouTube/Facebook/Twitter via Late,
 * and records everything in the database (user_posts + platform_posts + heygen_videos).
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
const OUTPUT_DIR = getOutputDir('videos', ROOT_DIR);

const isRealDB = DATABASE_URL && !DATABASE_URL.includes('user:pass@host');
const pool = isRealDB ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

// Read platform accounts from SOCIALS.md
function loadPlatformConfig() {
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
// CLI Arg Parsing
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    video: null,
    platforms: null,
    schedule: null,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--video': opts.video = args[++i]; break;
      case '--platforms': opts.platforms = args[++i].split(',').map(p => p.trim()); break;
      case '--schedule': opts.schedule = args[++i]; break;
      case '--dry-run': opts.dryRun = true; break;
    }
  }

  return opts;
}

// ============================================================================
// Find Latest Unpublished Video
// ============================================================================

function findLatestUnpublished() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    throw new Error(`Output directory not found: ${OUTPUT_DIR}`);
  }

  const jsonFiles = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith('.json') && !f.includes('-dryrun'))
    .sort()
    .reverse();

  for (const file of jsonFiles) {
    const filePath = path.join(OUTPUT_DIR, file);
    const meta = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!meta.published_at) {
      return filePath;
    }
  }

  throw new Error(`No unpublished videos found in ${OUTPUT_DIR}`);
}

// ============================================================================
// Gemini Caption Generation
// ============================================================================

async function generatePlatformCaptions(meta) {
  const { topic, script, caption, hashtags, pillar } = meta;
  const hashtagStr = hashtags.join(' ');

  const prompt = `You are writing social media captions for ${persona.name} — the brand persona for ${persona.brand}.
${persona.voice ? `\nVoice guide:\n${persona.voice}\n` : ''}
The video is about: "${topic}" (pillar: ${pillar})
Video script: "${script}"
Base caption: "${caption}"
Hashtags: ${hashtagStr}

Generate platform-optimized captions for each platform. Match the persona's voice — warm, punchy, authentic.

Rules:
- Instagram: Storytelling caption (2-3 sentences), end with CTA, then hashtags on new line. Max 2200 chars total.
- TikTok: Short punchy caption (1-2 sentences), trending hashtags. Keep it under 150 chars before hashtags.
- YouTube Shorts: Provide a title (max 100 chars, curiosity-driven) and a description (2-3 sentences + hashtags).
- Facebook: Warm engaging caption (2-3 sentences), include a link to the brand website naturally. No hashtag overload (3-5 max).
- Twitter/X: One punchy line that makes people stop scrolling. Max 280 chars total including hashtags.

Format your response EXACTLY like this:
INSTAGRAM:
[caption here]

TIKTOK:
[caption here]

YOUTUBE_TITLE:
[title here]

YOUTUBE_DESCRIPTION:
[description here]

FACEBOOK:
[caption here]

TWITTER:
[tweet here]`;

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

  if (!text) {
    throw new Error(`Gemini error: ${JSON.stringify(data)}`);
  }

  // Parse sections
  const get = (label) => {
    const re = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n(?:INSTAGRAM|TIKTOK|YOUTUBE_TITLE|YOUTUBE_DESCRIPTION|FACEBOOK|TWITTER):|\$)`, 'i');
    const m = text.match(re);
    return m ? m[1].trim() : '';
  };

  return {
    instagram: get('INSTAGRAM'),
    tiktok: get('TIKTOK'),
    youtube_title: get('YOUTUBE_TITLE'),
    youtube_description: get('YOUTUBE_DESCRIPTION'),
    facebook: get('FACEBOOK'),
    twitter: get('TWITTER'),
  };
}

// ============================================================================
// Late API — Create Post
// ============================================================================

async function publishToLate(mediaUrl, captions, platformList, schedule) {
  const mediaItem = { type: 'video', url: mediaUrl };

  const platforms = platformList.map(name => {
    const acc = PLATFORM_ACCOUNTS[name];
    if (!acc) throw new Error(`Unknown platform: ${name}`);

    const entry = {
      platform: acc.platform,
      accountId: acc.accountId,
    };

    // Per-platform custom content
    if (name === 'tiktok') {
      entry.customContent = captions.tiktok;
    } else if (name === 'facebook') {
      entry.customContent = captions.facebook;
    } else if (name === 'twitter') {
      entry.customContent = captions.twitter;
    } else if (name === 'youtube') {
      entry.customContent = captions.youtube_description;
      entry.platformSpecificData = {
        title: captions.youtube_title,
        visibility: 'public',
        shorts: true,
      };
    }
    // instagram uses the top-level content

    return entry;
  });

  const body = {
    profileId: PROFILE_ID,
    content: captions.instagram,
    mediaItems: [mediaItem],
    platforms,
    tiktokSettings: {
      draft: false,
      privacyLevel: 'PUBLIC_TO_EVERYONE',
      allowComment: true,
      contentPreviewConfirmed: true,
      expressConsentGiven: true,
    },
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
// Database — Record Post + Per-Platform Distribution
// ============================================================================

async function recordPostInDB({ meta, captions, platformList, lateResult, schedule }) {
  if (!pool) {
    console.log('  (No database connection — skipping DB insert)');
    return null;
  }

  const latePostId = lateResult.post?._id || lateResult.post?.id || lateResult._id || lateResult.id || null;
  const status = schedule ? 'scheduled' : 'posted';
  const postedAt = schedule ? null : new Date().toISOString();

  // 1. Insert into user_posts (main post record)
  const postRes = await pool.query(
    `INSERT INTO user_posts (
      post_id, late_post_id, content, media_urls, platforms,
      status, scheduled_at, posted_at, hashtags, raw_response, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id`,
    [
      meta.video_id,
      latePostId,
      captions.instagram,
      [meta.media_url],
      platformList,
      status,
      schedule || null,
      postedAt,
      meta.hashtags || [],
      JSON.stringify(lateResult),
      JSON.stringify({
        source: 'short-publish',
        topic: meta.topic,
        pillar: meta.pillar,
        heygen_video_id: meta.heygen_video_id,
        duration_secs: meta.duration_secs,
        captions: {
          instagram: captions.instagram,
          tiktok: captions.tiktok,
          youtube_title: captions.youtube_title,
          youtube_description: captions.youtube_description,
          facebook: captions.facebook,
          twitter: captions.twitter,
        },
      }),
    ]
  );

  const userPostId = postRes.rows[0].id;
  console.log(`  DB: user_posts row #${userPostId} inserted`);

  // 2. Insert per-platform rows into platform_posts
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

  // 3. Update heygen_videos to link back to the post (if we have a heygen_video_id)
  if (meta.heygen_video_id) {
    await pool.query(
      `UPDATE heygen_videos SET
        raw_response = raw_response || $1::jsonb,
        updated_at = NOW()
      WHERE heygen_video_id = $2`,
      [
        JSON.stringify({
          late_post_id: latePostId,
          user_post_id: userPostId,
          published_at: postedAt || schedule,
          published_platforms: platformList,
        }),
        meta.heygen_video_id,
      ]
    );
    console.log(`  DB: heygen_videos linked (${meta.heygen_video_id})`);
  }

  return userPostId;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const opts = parseArgs();

  if (!LATE_API_KEY) {
    throw new Error('LATE_API_KEY not set in .env');
  }
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not set in .env');
  }

  // Find video sidecar
  const sidecarPath = opts.video || findLatestUnpublished();
  const meta = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));

  console.log(`\n=== ${persona.name.toUpperCase()} SHORT PUBLISH ===`);
  console.log(`Video:    ${meta.video_id}`);
  console.log(`Topic:    ${meta.topic}`);
  console.log(`Pillar:   ${meta.pillar}`);
  console.log(`Sidecar:  ${sidecarPath}`);

  // Check for media URL
  if (!meta.media_url) {
    throw new Error(
      'No media_url in sidecar — run short-video first to upload to Late cloud storage.\n' +
      'Or manually upload: GET /v1/media/presigned-url → PUT file → add media_url to sidecar JSON.'
    );
  }
  console.log(`Media:    ${meta.media_url}`);

  // Determine platforms
  const allPlatforms = ['instagram', 'tiktok', 'youtube', 'facebook', 'twitter'];
  const platformList = opts.platforms || allPlatforms;
  console.log(`Platforms: ${platformList.join(', ')}`);
  if (opts.schedule) console.log(`Schedule: ${opts.schedule}`);

  // Generate platform captions
  console.log('\n[Step 1] Generating platform-optimized captions via Gemini...');
  const captions = await generatePlatformCaptions(meta);

  console.log('\n--- CAPTIONS ---');
  for (const plat of platformList) {
    console.log(`\n[${plat.toUpperCase()}]`);
    if (plat === 'youtube') {
      console.log(`Title: ${captions.youtube_title}`);
      console.log(`Description: ${captions.youtube_description}`);
    } else {
      console.log(captions[plat]);
    }
  }

  if (opts.dryRun) {
    console.log('\n[DRY RUN] Stopping here. No posts published.');
    if (pool) await pool.end();
    return;
  }

  // Publish
  console.log('\n[Step 2] Publishing via Late API...');
  const lateResult = await publishToLate(meta.media_url, captions, platformList, opts.schedule);
  const latePostId = lateResult.post?._id || lateResult.post?.id || lateResult._id || lateResult.id || null;

  // Record in database
  console.log('\n[Step 3] Recording in database...');
  const userPostId = await recordPostInDB({
    meta, captions, platformList, lateResult, schedule: opts.schedule,
  });

  // Mark sidecar as published
  meta.published_at = new Date().toISOString();
  meta.late_post_id = latePostId;
  meta.user_post_id = userPostId;
  meta.published_platforms = platformList;
  fs.writeFileSync(sidecarPath, JSON.stringify(meta, null, 2));

  console.log('\n=== PUBLISH COMPLETE ===');
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
