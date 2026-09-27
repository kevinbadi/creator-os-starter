#!/usr/bin/env node
/**
 * shorts-creatorclaw — Grab short videos from SHORTS FOR CREATORCLAW folder,
 * upload to Late, generate captions via Gemini, blast to all socials.
 *
 * Usage:
 *   node shorts-creatorclaw.js [--dry-run] [--platforms instagram,tiktok,youtube]
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

const WATCH_FOLDER = path.join(process.env.HOME, 'Downloads', 'SHORTS FOR CREATORCLAW');
const PUBLISHED_MARKER = '.published'; // We create {filename}.published to track what's been sent
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.avi', '.mkv'];

const ROOT_DIR = path.join(__dirname, '..', '..', '..');

const isRealDB = DATABASE_URL && !DATABASE_URL.includes('user:pass@host');
const pool = isRealDB ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

// ============================================================================
// Load Platform Config from Late API (uses whatever key is in .env)
// ============================================================================

let PLATFORM_ACCOUNTS = {};
let PROFILE_ID = null;

async function loadPlatformConfig() {
  // Get profile
  const profileRes = await fetchJSON(`${LATE_BASE_URL}/profiles`, {
    headers: { 'Authorization': `Bearer ${LATE_API_KEY}` },
  });
  if (profileRes.data?.profiles?.length) {
    PROFILE_ID = profileRes.data.profiles[0]._id;
  }

  // Get accounts
  const accountRes = await fetchJSON(`${LATE_BASE_URL}/accounts`, {
    headers: { 'Authorization': `Bearer ${LATE_API_KEY}` },
  });
  if (accountRes.data?.accounts) {
    for (const acc of accountRes.data.accounts) {
      PLATFORM_ACCOUNTS[acc.platform] = { accountId: acc._id, platform: acc.platform };
    }
  }

  return { accounts: PLATFORM_ACCOUNTS, profileId: PROFILE_ID };
}

// ============================================================================
// CLI Args
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { platforms: null, dryRun: false, schedule: null };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--platforms': opts.platforms = args[++i].split(',').map(p => p.trim()); break;
      case '--schedule': opts.schedule = args[++i]; break;
      case '--dry-run': opts.dryRun = true; break;
    }
  }
  return opts;
}

// ============================================================================
// Find Unpublished Videos in Watch Folder
// ============================================================================

function findUnpublishedVideos() {
  if (!fs.existsSync(WATCH_FOLDER)) {
    throw new Error(`Watch folder not found: ${WATCH_FOLDER}\nCreate it and drop your short-form videos there.`);
  }

  const files = fs.readdirSync(WATCH_FOLDER)
    .filter(f => {
      const ext = path.extname(f).toLowerCase();
      if (!VIDEO_EXTENSIONS.includes(ext)) return false;
      // Check if already published
      const markerPath = path.join(WATCH_FOLDER, f + PUBLISHED_MARKER);
      return !fs.existsSync(markerPath);
    })
    .sort(); // Process alphabetically

  return files.map(f => ({
    filename: f,
    filepath: path.join(WATCH_FOLDER, f),
    title: path.basename(f, path.extname(f)), // Use filename (minus ext) as the topic/title
  }));
}

// ============================================================================
// Late API — Upload Media
// ============================================================================

async function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

async function uploadToLate(filepath) {
  const filename = path.basename(filepath);
  const ext = path.extname(filename).toLowerCase();
  const contentType = ext === '.mov' ? 'video/quicktime' : ext === '.webm' ? 'video/webm' : 'video/mp4';
  const stats = fs.statSync(filepath);
  console.log(`  Uploading ${filename} (${(stats.size / 1024 / 1024).toFixed(1)} MB)...`);

  // Step 1: Get presigned upload URL
  const presignRes = await fetchJSON(`${LATE_BASE_URL}/media/presign`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LATE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filename, contentType }),
  });

  if (presignRes.status < 200 || presignRes.status >= 300 || !presignRes.data.uploadUrl) {
    throw new Error(`Presign failed: ${JSON.stringify(presignRes.data)}`);
  }

  const { uploadUrl, publicUrl: fileUrl } = presignRes.data;

  // Step 2: Upload file via PUT
  const fileBuffer = fs.readFileSync(filepath);
  await new Promise((resolve, reject) => {
    const url = new URL(uploadUrl);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'PUT',
      headers: {
        'Content-Length': fileBuffer.length,
        'Content-Type': contentType,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(`Upload failed (${res.statusCode}): ${data}`));
      });
    });
    req.on('error', reject);
    req.write(fileBuffer);
    req.end();
  });

  console.log(`  Uploaded → ${fileUrl}`);
  return fileUrl;
}

// ============================================================================
// Gemini — Generate Captions from Video Title
// ============================================================================

function loadCreatorContext() {
  // Load from onboarding-config.json (dynamic per user)
  const configPath = path.join(ROOT_DIR, 'onboarding-config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const p1 = config.phase1 || {};
      return {
        brandName: (p1.brand_name || '').trim(),
        brandUrl: (p1.brand_url || '').trim(),
        brandDescription: (p1.brand_description || '').trim(),
        targetAudience: (p1.target_audience || '').trim(),
        personaName: p1.persona_name || p1.brand_name || '',
        personaBackstory: (p1.persona_backstory || '').trim(),
        voice: (p1.voice_description || '').trim(),
        primaryCta: (p1.primary_cta || '').trim(),
        userName: p1.user?.name || '',
        userRole: p1.user?.role || '',
      };
    } catch (e) {
      console.log(`  Warning: Could not parse onboarding-config.json: ${e.message}`);
    }
  }

  // Fallback to PERSONA.md
  let personaName = '';
  let personaVoice = '';
  const personaPath = path.join(ROOT_DIR, 'PERSONA.md');
  if (fs.existsSync(personaPath)) {
    const content = fs.readFileSync(personaPath, 'utf8');
    const nameMatch = content.match(/Name[:\s]*(.+)/i);
    if (nameMatch) personaName = nameMatch[1].trim();
    const voiceMatch = content.match(/Voice[:\s]*([\s\S]*?)(?=\n#|\n---|\Z)/i);
    if (voiceMatch) personaVoice = voiceMatch[1].trim();
  }

  return {
    brandName: personaName || 'Creator',
    brandUrl: '',
    brandDescription: '',
    targetAudience: '',
    personaName: personaName,
    personaBackstory: '',
    voice: personaVoice || 'Direct, confident, builder energy. No fluff.',
    primaryCta: '',
    userName: '',
    userRole: '',
  };
}

async function generateCaptions(videoTitle) {
  const ctx = loadCreatorContext();

  const prompt = `You are writing social media captions for "${ctx.brandName}".

ABOUT THE CREATOR:
${ctx.personaBackstory ? `- Backstory: ${ctx.personaBackstory}` : ''}
${ctx.userRole ? `- Role: ${ctx.userRole}` : ''}
${ctx.brandDescription ? `- Brand: ${ctx.brandDescription}` : ''}
${ctx.brandUrl ? `- Academy/URL: ${ctx.brandUrl}` : ''}
${ctx.targetAudience ? `- Target audience: ${ctx.targetAudience}` : ''}
- Voice: ${ctx.voice || 'Direct, confident, real. No fluff.'}

The short-form video topic is: "${videoTitle}"

Write REAL captions — not generic placeholder text. Each caption should:
1. Reference specific insights from the video topic
2. Connect it back to the creator's core thesis and what they sell
3. Sound like a real human wrote it, not a marketing bot

CRITICAL CTA RULE — The FIRST sentence of EVERY caption (except Twitter) MUST be a comment-keyword CTA in this format:
"COMMENT '[KEYWORD]' and I'll send you [specific thing relevant to the video topic and what the creator sells]"
- The KEYWORD should be a single punchy word related to the video topic (e.g., "AI", "SYSTEM", "SCALE", "BUILD")
- The thing you send should be specific and valuable (e.g., "my free guide to building AI systems", "the exact framework I use", "a breakdown of how this works")
${ctx.primaryCta ? `- The creator's primary CTA is: "${ctx.primaryCta}" — weave this in naturally after the comment CTA` : ''}

Platform rules:
- Instagram: Comment CTA first line, then strong hook (pattern interrupt), then 3-5 sentences of real value/insight, end with "Link in bio" + hashtags on new line. Write a FULL caption. Max 2200 chars.
- TikTok: Comment CTA first, then one punchy follow-up line, trending hashtags. Under 300 chars total.
- YouTube Shorts: Title (max 100 chars, curiosity/controversy-driven). Description starts with comment CTA, then 2-3 sentences of value + hashtags.
- Facebook: Comment CTA first, then conversational take (3-4 sentences). Light on hashtags (2-3 max).
- Twitter/X: Hot take energy. One hard-hitting line. Max 280 chars total including hashtags. NO comment CTA on Twitter — just the hot take.
- LinkedIn: Comment CTA first, then professional but bold take. Lead with a contrarian insight, explain why, end with a question. 3-4 sentences.

Format EXACTLY like this:
INSTAGRAM:
[caption]

TIKTOK:
[caption]

YOUTUBE_TITLE:
[title]

YOUTUBE_DESCRIPTION:
[description]

FACEBOOK:
[caption]

TWITTER:
[tweet]

LINKEDIN:
[post]`;

  const res = await fetchJSON(
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

  const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini error: ${JSON.stringify(res.data)}`);

  const get = (label) => {
    const re = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n(?:INSTAGRAM|TIKTOK|YOUTUBE_TITLE|YOUTUBE_DESCRIPTION|FACEBOOK|TWITTER|LINKEDIN):|\$)`, 'i');
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
    linkedin: get('LINKEDIN'),
  };
}

// ============================================================================
// Late API — Create Post
// ============================================================================

async function publishToLate(mediaUrl, captions, platformList, schedule) {
  const platforms = platformList.map(name => {
    const acc = PLATFORM_ACCOUNTS[name];
    if (!acc) {
      console.log(`  ⚠ Skipping ${name} — no Late Account ID configured`);
      return null;
    }

    const entry = {
      platform: acc.platform,
      accountId: acc.accountId,
    };

    if (name === 'tiktok') entry.customContent = captions.tiktok;
    else if (name === 'facebook') entry.customContent = captions.facebook;
    else if (name === 'twitter') entry.customContent = captions.twitter;
    else if (name === 'youtube') {
      entry.customContent = captions.youtube_description;
      entry.platformSpecificData = {
        title: captions.youtube_title,
        visibility: 'public',
        shorts: true,
      };
    }

    return entry;
  }).filter(Boolean);

  if (platforms.length === 0) {
    throw new Error('No valid platform accounts configured. Check SOCIALS.md');
  }

  const body = {
    profileId: PROFILE_ID,
    content: captions.instagram,
    mediaItems: [{ type: 'video', url: mediaUrl }],
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
    body.timezone = 'America/Chicago';
  }

  const res = await fetchJSON(`${LATE_BASE_URL}/posts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LATE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Late API error (${res.status}): ${JSON.stringify(res.data)}`);
  }

  return res.data;
}

// ============================================================================
// Late API — Poll Post Status (up to 10 minutes)
// ============================================================================

async function pollPostStatus(postId, maxMinutes = 10) {
  const maxMs = maxMinutes * 60 * 1000;
  const intervalMs = 15000; // Poll every 15 seconds
  const startTime = Date.now();

  console.log(`  Polling post ${postId} for up to ${maxMinutes} minutes...`);

  while (Date.now() - startTime < maxMs) {
    await new Promise(r => setTimeout(r, intervalMs));
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    try {
      const res = await fetchJSON(`${LATE_BASE_URL}/posts/${postId}`, {
        headers: { 'Authorization': `Bearer ${LATE_API_KEY}` },
      });

      const post = res.data?.post || res.data;
      const status = post?.status;
      const platforms = post?.platforms || [];

      // Count platform statuses
      const published = platforms.filter(p => p.status === 'published').length;
      const failed = platforms.filter(p => p.status === 'failed').length;
      const pending = platforms.filter(p => !['published', 'failed'].includes(p.status)).length;

      console.log(`  [${elapsed}s] Status: ${status} | Published: ${published} | Failed: ${failed} | Pending: ${pending}`);

      // All done (no more pending)
      if (pending === 0 && platforms.length > 0) {
        console.log(`  ✅ All platforms resolved: ${published} published, ${failed} failed`);
        if (failed > 0) {
          for (const p of platforms.filter(p => p.status === 'failed')) {
            console.log(`    ❌ ${p.platform}: ${p.errorMessage || 'unknown error'}`);
          }
        }
        return { status: 'resolved', published, failed, post };
      }

      // Post-level terminal status
      if (status === 'published' && pending === 0) {
        console.log(`  ✅ Post fully published!`);
        return { status: 'published', published, failed, post };
      }

    } catch (e) {
      console.log(`  [${elapsed}s] Poll error: ${e.message}`);
    }
  }

  console.log(`  ⏰ Timed out after ${maxMinutes} minutes. Post may still be processing.`);
  return { status: 'timeout' };
}

// ============================================================================
// Database — Record Post
// ============================================================================

async function recordInDB({ video, captions, platformList, lateResult, mediaUrl, schedule }) {
  if (!pool) {
    console.log('  (No database — skipping DB insert)');
    return null;
  }

  const latePostId = lateResult.post?._id || lateResult.post?.id || lateResult._id || lateResult.id || null;
  const status = schedule ? 'scheduled' : 'posted';
  const postedAt = schedule ? null : new Date().toISOString();

  try {
    const postRes = await pool.query(
      `INSERT INTO user_posts (
        post_id, late_post_id, content, media_urls, platforms,
        status, scheduled_at, posted_at, hashtags, raw_response, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id`,
      [
        `creatorclaw-${Date.now()}`,
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
          source: 'shorts-creatorclaw',
          title: video.title,
          filename: video.filename,
          captions,
        }),
      ]
    );

    const userPostId = postRes.rows[0].id;
    console.log(`  DB: user_posts #${userPostId}`);

    for (const plat of platformList) {
      if (PLATFORM_ACCOUNTS[plat]) {
        await pool.query(
          `INSERT INTO platform_posts (
            user_post_id, platform, platform_post_id, status, posted_at, raw_response
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [userPostId, plat, latePostId, status, postedAt,
           JSON.stringify({ account_id: PLATFORM_ACCOUNTS[plat].accountId })]
        );
      }
    }
    console.log(`  DB: ${platformList.length} platform_posts rows`);
    return userPostId;
  } catch (e) {
    console.error(`  DB error: ${e.message}`);
    return null;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const opts = parseArgs();

  if (!LATE_API_KEY) throw new Error('LATE_API_KEY not set in .env');
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');

  // Load accounts from Late API dynamically
  await loadPlatformConfig();

  console.log('\n=== SHORTS FOR CREATORCLAW ===');
  console.log(`Watch folder: ${WATCH_FOLDER}`);
  console.log(`Profile ID: ${PROFILE_ID}`);
  console.log(`Platforms configured: ${Object.keys(PLATFORM_ACCOUNTS).join(', ')}`);

  // Find unpublished videos
  const videos = findUnpublishedVideos();
  if (videos.length === 0) {
    console.log('\nNo unpublished videos found. Drop .mp4/.mov/.webm files into:');
    console.log(`  ${WATCH_FOLDER}`);
    if (pool) await pool.end();
    return;
  }

  console.log(`\nFound ${videos.length} unpublished video(s):`);
  videos.forEach(v => console.log(`  • ${v.filename} → "${v.title}"`));

  // Determine platforms (skip facebook if no account configured)
  const allPlatforms = ['instagram', 'tiktok', 'youtube', 'facebook', 'twitter'];
  const platformList = (opts.platforms || allPlatforms).filter(p => {
    if (!PLATFORM_ACCOUNTS[p]) {
      console.log(`  ⚠ ${p} skipped — no Late Account ID in SOCIALS.md`);
      return false;
    }
    return true;
  });
  console.log(`\nPublishing to: ${platformList.join(', ')}`);

  // Process each video
  for (const video of videos) {
    console.log(`\n--- Processing: ${video.filename} ---`);

    // Step 1: Upload to Late
    console.log('\n[1/4] Uploading to Late...');
    let mediaUrl;
    if (opts.dryRun) {
      mediaUrl = 'https://example.com/dry-run-video.mp4';
      console.log('  [DRY RUN] Skipping upload');
    } else {
      mediaUrl = await uploadToLate(video.filepath);
    }

    // Step 2: Generate captions
    console.log('\n[2/4] Generating captions via Gemini...');
    const captions = await generateCaptions(video.title);

    console.log('\n--- CAPTIONS ---');
    for (const plat of platformList) {
      console.log(`\n[${plat.toUpperCase()}]`);
      if (plat === 'youtube') {
        console.log(`Title: ${captions.youtube_title}`);
        console.log(`Desc: ${captions.youtube_description}`);
      } else {
        console.log(captions[plat] || '(no caption)');
      }
    }

    if (opts.dryRun) {
      console.log('\n[DRY RUN] Stopping here. No posts published.');
      continue;
    }

    // Step 3: Publish to all platforms
    console.log('\n[3/5] Publishing via Late API...');
    const lateResult = await publishToLate(mediaUrl, captions, platformList, opts.schedule);
    const latePostId = lateResult.post?._id || lateResult.post?.id || lateResult._id || lateResult.id || null;
    console.log(`  Late Post ID: ${latePostId}`);

    // Step 4: Poll until all platforms resolve (up to 10 min)
    if (latePostId && !opts.schedule) {
      console.log('\n[4/5] Waiting for platforms to publish...');
      const pollResult = await pollPostStatus(latePostId);
      if (pollResult.status === 'timeout') {
        console.log('  ⚠ Post may still be processing — check Late dashboard');
      }
    }

    // Step 5: Record in DB
    console.log('\n[5/5] Recording in database...');
    await recordInDB({ video, captions, platformList, lateResult, mediaUrl, schedule: opts.schedule });

    // Mark as published
    fs.writeFileSync(
      path.join(WATCH_FOLDER, video.filename + PUBLISHED_MARKER),
      JSON.stringify({
        published_at: new Date().toISOString(),
        late_post_id: latePostId,
        platforms: platformList,
        media_url: mediaUrl,
      }, null, 2)
    );
    console.log(`\n✅ ${video.filename} published to ${platformList.join(', ')}`);
  }

  console.log('\n=== ALL DONE ===');
  if (pool) await pool.end();
}

main().catch(async e => {
  console.error(`\nError: ${e.message}`);
  if (pool) await pool.end();
  process.exit(1);
});
