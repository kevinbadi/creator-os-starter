#!/usr/bin/env node
/**
 * short-publish-folder — Publish user-created short-form videos from a local folder
 *
 * Watches ~/Short form videos/ for new .mp4/.mov/.webm files, uploads to Late cloud,
 * generates platform-optimized captions via Gemini, publishes to all short-form
 * platforms (Instagram Reels, TikTok, YouTube Shorts, Facebook, Twitter/X).
 *
 * This is the core pipeline for creators who make their own content.
 *
 * Usage:
 *   node short-publish-folder.js                          # publish next unpublished video
 *   node short-publish-folder.js --all                    # publish all unpublished
 *   node short-publish-folder.js --file ~/path/video.mp4  # publish specific file
 *   node short-publish-folder.js --dry-run                # preview captions only
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ============================================================================
// Config
// ============================================================================

const LATE_API_KEY = process.env.LATE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DATABASE_URL = process.env.INSFORGE_CONNECTION_STRING || process.env.DATABASE_URL;
const LATE_BASE_URL = 'https://zernio.com/api/v1';

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const DEFAULT_FOLDER = path.join(require('os').homedir(), 'Desktop', 'Short form videos');
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm'];

const isRealDB = DATABASE_URL && !DATABASE_URL.includes('user:pass@host');
const pool = isRealDB ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

// ============================================================================
// Parse Platform Accounts from SOCIALS.md
// ============================================================================

function loadPlatformAccounts() {
  const socialsPath = path.join(ROOT_DIR, 'SOCIALS.md');
  const accounts = {};
  let profileId = null;

  if (!fs.existsSync(socialsPath)) {
    console.log('  Warning: SOCIALS.md not found — platform accounts must be configured');
    return { accounts, profileId };
  }

  const content = fs.readFileSync(socialsPath, 'utf8');

  // Extract Late Profile ID
  const profileMatch = content.match(/Profile ID[*:\s\x60]*([a-f0-9]{24,})/i);
  if (profileMatch) profileId = profileMatch[1];

  // Extract per-platform Late Account IDs
  const platformMap = {
    instagram: 'instagram',
    tiktok: 'tiktok',
    facebook: 'facebook',
    'twitter': 'twitter',
    youtube: 'youtube',
  };

  for (const [section, platform] of Object.entries(platformMap)) {
    // Look for "Late Account ID: `abc123`" or "**Late Account ID:** abc123" in each platform section
    const sectionRegex = new RegExp(`###?\\s*${section}[\\s\\S]*?Late Account ID[*:\\s]*\`?([a-f0-9]{24,})\`?`, 'i');
    const match = content.match(sectionRegex);
    if (match) {
      accounts[platform] = { accountId: match[1], platform };
    }
  }

  return { accounts, profileId };
}

// ============================================================================
// CLI Arg Parsing
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    file: null,
    folder: DEFAULT_FOLDER,
    platforms: null,
    schedule: null,
    topic: null,
    all: false,
    limit: 10,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file': opts.file = args[++i].replace(/^~/, require('os').homedir()); break;
      case '--folder': opts.folder = args[++i].replace(/^~/, require('os').homedir()); break;
      case '--platforms': opts.platforms = args[++i].split(',').map(p => p.trim()); break;
      case '--schedule': opts.schedule = args[++i]; break;
      case '--topic': opts.topic = args[++i]; break;
      case '--all': opts.all = true; break;
      case '--limit': opts.limit = parseInt(args[++i], 10); break;
      case '--dry-run': opts.dryRun = true; break;
    }
  }

  return opts;
}

// ============================================================================
// Find Unpublished Videos
// ============================================================================

function findUnpublished(folder) {
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
    console.log(`  Created watch folder: ${folder}`);
    return [];
  }

  const entries = fs.readdirSync(folder, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    if (entry.isFile()) {
      // Mode 1: Standalone video file (Gemini generates metadata)
      const ext = path.extname(entry.name).toLowerCase();
      if (!VIDEO_EXTENSIONS.includes(ext)) continue;
      const sidecar = path.join(folder, entry.name.replace(ext, '.published.json'));
      if (fs.existsSync(sidecar)) continue;
      results.push({ videoPath: path.join(folder, entry.name), metadata: null });
    } else if (entry.isDirectory()) {
      // Mode 2: Folder with video + metadata.json/content.json
      const subFolder = path.join(folder, entry.name);
      const publishedMarker = path.join(subFolder, '.published.json');
      if (fs.existsSync(publishedMarker)) continue;
      const subFiles = fs.readdirSync(subFolder);
      const videoFile = subFiles.find(f => VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase()));
      if (!videoFile) continue;
      // Load metadata if present
      let metadata = null;
      const metaFile = subFiles.find(f => f === 'metadata.json' || f === 'content.json');
      if (metaFile) {
        try { metadata = JSON.parse(fs.readFileSync(path.join(subFolder, metaFile), 'utf-8')); } catch (e) {}
      }
      results.push({ videoPath: path.join(subFolder, videoFile), metadata, folder: subFolder });
    }
  }

  return results.sort((a, b) => a.videoPath.localeCompare(b.videoPath));
}

// ============================================================================
// Upload Video to Late Cloud Storage
// ============================================================================

async function uploadToLate(filePath) {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();
  const contentType = ext === '.mov' ? 'video/quicktime' : ext === '.webm' ? 'video/webm' : 'video/mp4';

  console.log(`  Requesting presigned upload URL...`);

  // Get presigned URL
  const presignRes = await fetch(`${LATE_BASE_URL}/media/presign`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LATE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filename, contentType }),
  });

  const presignData = await presignRes.json();

  if (!presignRes.ok || !presignData.uploadUrl) {
    throw new Error(`Presign failed: ${JSON.stringify(presignData)}`);
  }

  // Upload file
  const fileBuffer = fs.readFileSync(filePath);
  const fileSizeMB = (fileBuffer.length / 1024 / 1024).toFixed(1);
  console.log(`  Uploading ${filename} (${fileSizeMB} MB)...`);

  const uploadRes = await fetch(presignData.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    throw new Error(`Upload failed (${uploadRes.status})`);
  }

  console.log(`  Uploaded to: ${presignData.publicUrl}`);
  return presignData.publicUrl;
}

// ============================================================================
// Generate Captions via Gemini
// ============================================================================

async function generateCaptions(videoFile, topicOverride) {
  // Derive topic from filename if not provided
  const basename = path.basename(videoFile, path.extname(videoFile));
  const topic = topicOverride || basename
    .replace(/[-_]/g, ' ')
    .replace(/\d{4}[-.]?\d{2}[-.]?\d{2}\s*/g, '') // strip dates
    .replace(/\s+/g, ' ')
    .trim();

  // Read persona context from SOUL.md if available
  let personaContext = '';
  const soulPath = path.join(ROOT_DIR, 'SOUL.md');
  if (fs.existsSync(soulPath)) {
    const soulContent = fs.readFileSync(soulPath, 'utf8');
    // Extract voice guide section
    const voiceMatch = soulContent.match(/## Voice Guide[\s\S]*?(?=\n## |\n---|\$)/i);
    if (voiceMatch) personaContext = voiceMatch[0].slice(0, 500);
  }

  // Read brand context from IDENTITY.md
  let brandContext = '';
  const idPath = path.join(ROOT_DIR, 'IDENTITY.md');
  if (fs.existsSync(idPath)) {
    brandContext = fs.readFileSync(idPath, 'utf8').slice(0, 800);
  }

  const prompt = `You are writing social media captions for a short-form video being published to multiple platforms.

${brandContext ? `BRAND CONTEXT:\n${brandContext}\n` : ''}
${personaContext ? `VOICE GUIDE:\n${personaContext}\n` : ''}

The video is about: "${topic}"
Filename: "${basename}"

Generate platform-optimized captions. Match the brand voice. Be authentic, not generic.

Rules:
- Instagram: Storytelling caption (2-3 sentences), end with CTA, then hashtags on new line. Max 2200 chars total. 15-20 relevant hashtags.
- TikTok: Short punchy caption (1-2 sentences), trending hashtags. Keep it under 150 chars before hashtags.
- YouTube Shorts: Provide a title (max 100 chars, curiosity-driven) and a description (2-3 sentences + hashtags).
- Facebook: Warm engaging caption (2-3 sentences). No hashtag overload (3-5 max).
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
    topic,
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

async function publishToLate(mediaUrl, captions, platformList, platformAccounts, profileId, schedule) {
  const mediaItem = { type: 'video', url: mediaUrl };

  const platforms = platformList.map(name => {
    const acc = platformAccounts[name];
    if (!acc) throw new Error(`No Late account ID for platform: ${name} — check SOCIALS.md`);

    const entry = {
      platform: acc.platform,
      accountId: acc.accountId,
    };

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
    profileId,
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
    body.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';
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
// Database — Record Post
// ============================================================================

async function recordPostInDB({ filename, mediaUrl, captions, platformList, platformAccounts, lateResult, schedule }) {
  if (!pool) {
    console.log('  (No database connection — skipping DB insert)');
    return null;
  }

  const latePostId = lateResult.post?._id || lateResult.post?.id || lateResult._id || lateResult.id || null;
  const status = schedule ? 'scheduled' : 'posted';
  const postedAt = schedule ? null : new Date().toISOString();
  const postId = `folder-short-${Date.now()}-${path.basename(filename, path.extname(filename))}`;

  const postRes = await pool.query(
    `INSERT INTO user_posts (
      post_id, late_post_id, content, media_urls, platforms,
      status, scheduled_at, posted_at, hashtags, raw_response, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id`,
    [
      postId,
      latePostId,
      captions.instagram,
      [mediaUrl],
      platformList,
      status,
      schedule || null,
      postedAt,
      [],
      JSON.stringify(lateResult),
      JSON.stringify({
        source: 'short-publish-folder',
        source_file: filename,
        topic: captions.topic,
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

  for (const plat of platformList) {
    const acc = platformAccounts[plat];
    await pool.query(
      `INSERT INTO platform_posts (
        user_post_id, platform, platform_post_id, status, posted_at, raw_response
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [userPostId, plat, latePostId, status, postedAt, JSON.stringify({ account_id: acc?.accountId })]
    );
  }
  console.log(`  DB: ${platformList.length} platform_posts rows inserted`);

  return userPostId;
}

// ============================================================================
// Write Sidecar (marks video as published)
// ============================================================================

function writeSidecar(videoPath, data) {
  const ext = path.extname(videoPath);
  const sidecarPath = videoPath.replace(ext, '.published.json');
  fs.writeFileSync(sidecarPath, JSON.stringify(data, null, 2) + '\n');
  return sidecarPath;
}

// ============================================================================
// Publish Single Video
// ============================================================================

async function publishOne(videoPath, opts, platformAccounts, profileId) {
  const filename = path.basename(videoPath);
  console.log(`\n--- Publishing: ${filename} ---`);

  // Step 1: Upload to Late cloud
  console.log('\n[Step 1] Uploading to Late cloud storage...');
  const mediaUrl = await uploadToLate(videoPath);

  // Step 2: Generate captions
  console.log('\n[Step 2] Generating platform-optimized captions via Gemini...');
  const captions = await generateCaptions(videoPath, opts.topic);

  // Determine platforms (only those with configured accounts)
  const allPlatforms = ['instagram', 'tiktok', 'youtube', 'facebook', 'twitter'];
  const availablePlatforms = allPlatforms.filter(p => platformAccounts[p]);
  const platformList = opts.platforms
    ? opts.platforms.filter(p => availablePlatforms.includes(p))
    : availablePlatforms;

  if (platformList.length === 0) {
    throw new Error('No platforms available — check SOCIALS.md for Late Account IDs');
  }

  console.log(`\n  Topic:     ${captions.topic}`);
  console.log(`  Platforms: ${platformList.join(', ')}`);
  if (opts.schedule) console.log(`  Schedule:  ${opts.schedule}`);

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
    console.log('\n[DRY RUN] Stopping here. No post published.');
    return null;
  }

  // Step 3: Publish via Late API
  console.log('\n[Step 3] Publishing via Late API...');
  const lateResult = await publishToLate(mediaUrl, captions, platformList, platformAccounts, profileId, opts.schedule);
  const latePostId = lateResult.post?._id || lateResult.post?.id || lateResult._id || lateResult.id || null;

  // Step 4: Record in database
  console.log('\n[Step 4] Recording in database...');
  const userPostId = await recordPostInDB({
    filename, mediaUrl, captions, platformList, platformAccounts, lateResult, schedule: opts.schedule,
  });

  // Step 5: Write sidecar to mark as published
  const sidecarData = {
    source_file: filename,
    media_url: mediaUrl,
    topic: captions.topic,
    late_post_id: latePostId,
    user_post_id: userPostId,
    published_at: new Date().toISOString(),
    published_platforms: platformList,
    status: opts.schedule ? 'scheduled' : 'posted',
    scheduled_for: opts.schedule || null,
    captions: {
      instagram: captions.instagram,
      tiktok: captions.tiktok,
      youtube_title: captions.youtube_title,
      youtube_description: captions.youtube_description,
      facebook: captions.facebook,
      twitter: captions.twitter,
    },
  };
  const sidecarPath = writeSidecar(videoPath, sidecarData);

  console.log(`\n  Late Post ID: ${latePostId}`);
  if (userPostId) console.log(`  DB Post ID:   #${userPostId}`);
  console.log(`  Sidecar:      ${sidecarPath}`);
  console.log(`  Status:       ${opts.schedule ? 'Scheduled' : 'Published'}`);

  return sidecarData;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const opts = parseArgs();

  if (!LATE_API_KEY) throw new Error('LATE_API_KEY not set in .env');
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');

  // Load platform accounts from SOCIALS.md
  const { accounts: platformAccounts, profileId } = loadPlatformAccounts();

  if (!profileId) {
    throw new Error('No Late Profile ID found in SOCIALS.md — complete onboarding first');
  }

  const accountCount = Object.keys(platformAccounts).length;
  console.log('\n=== SHORT PUBLISH — FOLDER METHOD ===');
  console.log(`Profile ID: ${profileId}`);
  console.log(`Accounts:   ${accountCount} platforms configured`);
  for (const [plat, acc] of Object.entries(platformAccounts)) {
    console.log(`  ${plat}: ${acc.accountId}`);
  }

  // Determine which videos to publish
  let videoItems = [];

  if (opts.file) {
    // Specific file
    if (!fs.existsSync(opts.file)) {
      throw new Error(`File not found: ${opts.file}`);
    }
    videoItems = [{ videoPath: opts.file, metadata: null }];
  } else {
    // Scan watch folder
    console.log(`\nWatch folder: ${opts.folder}`);
    const unpublished = findUnpublished(opts.folder);

    if (unpublished.length === 0) {
      console.log('\nNo unpublished videos found.');
      console.log(`Drop .mp4/.mov/.webm files (or folders with video + metadata.json) into: ${opts.folder}`);
      if (pool) await pool.end();
      return;
    }

    console.log(`Found ${unpublished.length} unpublished video(s):`);
    unpublished.forEach(item => {
      const label = path.basename(item.videoPath);
      console.log(`  ${label}${item.metadata ? ' (with metadata)' : ' (auto-generate caption)'}`);
    });

    if (opts.all) {
      videoItems = unpublished.slice(0, opts.limit);
      console.log(`\nPublishing ${videoItems.length} video(s)...`);
    } else {
      videoItems = [unpublished[0]];
    }
  }

  // Publish each video
  let published = 0;
  let failed = 0;

  for (const item of videoItems) {
    const videoPath = typeof item === 'string' ? item : item.videoPath;
    const metadata = typeof item === 'object' ? item.metadata : null;
    try {
      await publishOne(videoPath, { ...opts, metadata }, platformAccounts, profileId);
      // Mark folder as published
      if (item.folder) {
        fs.writeFileSync(path.join(item.folder, '.published.json'), JSON.stringify({ publishedAt: new Date().toISOString() }));
      }
      published++;
    } catch (e) {
      console.error(`\nError publishing ${path.basename(videoPath)}: ${e.message}`);
      failed++;
    }
  }

  console.log('\n=== DONE ===');
  console.log(`Published: ${published}`);
  if (failed > 0) console.log(`Failed:    ${failed}`);
  if (opts.dryRun) console.log('(Dry run — nothing was actually published)');

  if (pool) await pool.end();
}

main().catch(async e => {
  console.error(`\nError: ${e.message}`);
  if (pool) await pool.end();
  process.exit(1);
});
