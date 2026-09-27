#!/usr/bin/env node
/**
 * longform-publish-folder — Publish long-form videos to YouTube from a local folder
 *
 * Watches ~/Long form videos/ for new .mp4/.mov/.webm files, uploads to Late cloud,
 * generates YouTube-optimized titles/descriptions/tags via Gemini, publishes to YouTube.
 *
 * Usage:
 *   node longform-publish-folder.js                          # publish next unpublished video
 *   node longform-publish-folder.js --all --limit 3          # publish up to 3 videos
 *   node longform-publish-folder.js --file ~/path/video.mp4  # publish specific file
 *   node longform-publish-folder.js --dry-run                # preview metadata only
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ============================================================================
// Config
// ============================================================================

const LATE_API_KEY = process.env.LATE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const LATE_BASE_URL = 'https://zernio.com/api/v1';

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const DEFAULT_FOLDER = path.join(require('os').homedir(), 'Desktop', 'Long form videos');
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm'];

// ============================================================================
// Parse Platform Accounts from SOCIALS.md
// ============================================================================

function loadPlatformAccounts() {
  const socialsPath = path.join(ROOT_DIR, 'SOCIALS.md');
  const accounts = {};
  let profileId = null;

  if (!fs.existsSync(socialsPath)) {
    console.log('  Warning: SOCIALS.md not found');
    return { accounts, profileId };
  }

  const content = fs.readFileSync(socialsPath, 'utf8');

  const profileMatch = content.match(/Profile ID[*:\s\x60]*([a-f0-9]{24,})/i);
  if (profileMatch) profileId = profileMatch[1];

  // Only need YouTube for long-form
  const ytMatch = content.match(/###?\s*youtube[\s\S]*?Late Account ID[:\s]*`?([a-f0-9]{24,})`?/i);
  if (ytMatch) {
    accounts.youtube = { accountId: ytMatch[1], platform: 'youtube' };
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
    schedule: null,
    topic: null,
    visibility: 'public',
    all: false,
    limit: 3,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file': opts.file = args[++i].replace(/^~/, require('os').homedir()); break;
      case '--folder': opts.folder = args[++i].replace(/^~/, require('os').homedir()); break;
      case '--schedule': opts.schedule = args[++i]; break;
      case '--topic': opts.topic = args[++i]; break;
      case '--visibility': opts.visibility = args[++i]; break;
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
      const ext = path.extname(entry.name).toLowerCase();
      if (!VIDEO_EXTENSIONS.includes(ext)) continue;
      const sidecar = path.join(folder, entry.name.replace(ext, '.published.json'));
      if (fs.existsSync(sidecar)) continue;
      results.push({ videoPath: path.join(folder, entry.name), metadata: null });
    } else if (entry.isDirectory()) {
      const subFolder = path.join(folder, entry.name);
      if (fs.existsSync(path.join(subFolder, '.published.json'))) continue;
      const subFiles = fs.readdirSync(subFolder);
      const videoFile = subFiles.find(f => VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase()));
      if (!videoFile) continue;
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
// Find Matching Thumbnail
// ============================================================================

function findThumbnail(videoPath) {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  const thumbDir = path.join(dir, 'thumbnails');
  
  const extensions = ['.jpg', '.jpeg', '.png', '.webp'];
  
  for (const ext of extensions) {
    // Check in thumbnails subfolder
    const thumbPath = path.join(thumbDir, base + ext);
    if (fs.existsSync(thumbPath)) return thumbPath;
    
    // Check in same folder
    const sameDirPath = path.join(dir, base + ext);
    if (fs.existsSync(sameDirPath)) return sameDirPath;
  }
  
  return null;
}

// ============================================================================
// HTTP Helpers
// ============================================================================

function httpRequest(url, options, body = null) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ============================================================================
// Upload Video to Late
// ============================================================================

async function uploadToLate(filePath) {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();
  const contentType = ext === '.mov' ? 'video/quicktime' : ext === '.webm' ? 'video/webm' : 'video/mp4';

  // Step 1: Get upload URL
  const { data: uploadData } = await httpRequest(`${LATE_BASE_URL}/media/upload-url`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LATE_API_KEY}`,
      'Content-Type': 'application/json',
    },
  }, { filename, contentType });

  if (!uploadData.uploadUrl) {
    throw new Error('Failed to get upload URL: ' + JSON.stringify(uploadData));
  }

  // Step 2: Upload file
  const fileBuffer = fs.readFileSync(filePath);
  const uploadUrl = new URL(uploadData.uploadUrl);
  
  await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: uploadUrl.hostname,
      path: uploadUrl.pathname + uploadUrl.search,
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length,
      },
    }, res => {
      res.on('data', () => {});
      res.on('end', () => res.statusCode < 400 ? resolve() : reject(new Error(`Upload failed: ${res.statusCode}`)));
    });
    req.on('error', reject);
    req.write(fileBuffer);
    req.end();
  });

  return uploadData.mediaUrl;
}

// ============================================================================
// Upload Thumbnail to Late
// ============================================================================

async function uploadThumbnail(thumbPath) {
  if (!thumbPath) return null;
  
  const filename = path.basename(thumbPath);
  const ext = path.extname(filename).toLowerCase();
  const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

  const { data: uploadData } = await httpRequest(`${LATE_BASE_URL}/media/upload-url`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LATE_API_KEY}`,
      'Content-Type': 'application/json',
    },
  }, { filename, contentType });

  if (!uploadData.uploadUrl) return null;

  const fileBuffer = fs.readFileSync(thumbPath);
  const uploadUrl = new URL(uploadData.uploadUrl);
  
  await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: uploadUrl.hostname,
      path: uploadUrl.pathname + uploadUrl.search,
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length,
      },
    }, res => {
      res.on('data', () => {});
      res.on('end', () => res.statusCode < 400 ? resolve() : reject(new Error(`Thumbnail upload failed: ${res.statusCode}`)));
    });
    req.on('error', reject);
    req.write(fileBuffer);
    req.end();
  });

  return uploadData.mediaUrl;
}

// ============================================================================
// Generate YouTube Metadata with Gemini
// ============================================================================

async function generateYouTubeMetadata(filename, topic) {
  const context = topic || filename.replace(/[-_]/g, ' ').replace(/\.[^.]+$/, '');

  const prompt = `Generate YouTube video metadata for a video about: "${context}"

Return ONLY valid JSON in this exact format:
{
  "title": "Clickable YouTube title under 100 characters",
  "description": "Full YouTube description (2-3 paragraphs). Include:\\n- Hook in first line\\n- Key points covered\\n- Call to action\\n- [TIMESTAMPS] placeholder\\n- Relevant hashtags at the end",
  "tags": ["tag1", "tag2", "tag3", "...up to 15 relevant tags"]
}

Make the title compelling and clickable. Description should be SEO-optimized.`;

  const response = await httpRequest(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7 },
    }
  );

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse Gemini response');
  
  return JSON.parse(jsonMatch[0]);
}

// ============================================================================
// Publish to YouTube via Late
// ============================================================================

async function publishToYouTube(mediaUrl, metadata, thumbnailUrl, accountId, profileId, schedule, visibility) {
  const postData = {
    profileId,
    posts: [{
      accountId,
      platform: 'youtube',
      type: 'video',
      mediaUrls: [mediaUrl],
      text: metadata.description,
      youtubeOptions: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        privacy: visibility,
        ...(thumbnailUrl && { thumbnailUrl }),
      },
      ...(schedule && { scheduledAt: schedule }),
    }],
  };

  const { data } = await httpRequest(`${LATE_BASE_URL}/posts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LATE_API_KEY}`,
      'Content-Type': 'application/json',
    },
  }, postData);

  return data;
}

// ============================================================================
// Process Single Video
// ============================================================================

async function processVideo(filePath, opts, accounts, profileId) {
  const filename = path.basename(filePath);
  console.log(`\n📹 Processing: ${filename}`);

  // Check for YouTube account
  if (!accounts.youtube) {
    console.log('  ❌ No YouTube account configured in SOCIALS.md');
    return { success: false, error: 'No YouTube account' };
  }

  // Find thumbnail
  const thumbnailPath = findThumbnail(filePath);
  if (thumbnailPath) {
    console.log(`  🖼️  Found thumbnail: ${path.basename(thumbnailPath)}`);
  }

  // Generate metadata
  console.log('  🤖 Generating YouTube metadata...');
  const metadata = await generateYouTubeMetadata(filename, opts.topic);
  console.log(`  📝 Title: ${metadata.title}`);

  if (opts.dryRun) {
    console.log('  🔍 DRY RUN — would publish with:');
    console.log(`     Title: ${metadata.title}`);
    console.log(`     Tags: ${metadata.tags.slice(0, 5).join(', ')}...`);
    return { success: true, dryRun: true, metadata };
  }

  // Upload video
  console.log('  ⬆️  Uploading video to Late...');
  const mediaUrl = await uploadToLate(filePath);
  console.log(`  ✅ Uploaded: ${mediaUrl.slice(0, 60)}...`);

  // Upload thumbnail if exists
  let thumbnailUrl = null;
  if (thumbnailPath) {
    console.log('  ⬆️  Uploading thumbnail...');
    thumbnailUrl = await uploadThumbnail(thumbnailPath);
  }

  // Publish
  console.log('  🚀 Publishing to YouTube...');
  const result = await publishToYouTube(
    mediaUrl,
    metadata,
    thumbnailUrl,
    accounts.youtube.accountId,
    profileId,
    opts.schedule,
    opts.visibility
  );

  // Write sidecar
  const ext = path.extname(filePath);
  const sidecarPath = filePath.replace(ext, '.published.json');
  const sidecar = {
    source_file: filename,
    media_url: mediaUrl,
    thumbnail_url: thumbnailUrl,
    late_post_id: result.posts?.[0]?.id || result.id,
    published_at: new Date().toISOString(),
    visibility: opts.visibility,
    scheduled_at: opts.schedule || null,
    title: metadata.title,
    description: metadata.description,
    tags: metadata.tags,
  };
  fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));

  console.log('  ✅ Published to YouTube!');
  return { success: true, metadata, result };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('🎬 Longform Publish — Folder Method');
  console.log('===================================');

  if (!LATE_API_KEY) {
    console.error('❌ LATE_API_KEY not set');
    process.exit(1);
  }
  if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY not set');
    process.exit(1);
  }

  const opts = parseArgs();
  const { accounts, profileId } = loadPlatformAccounts();

  if (!profileId) {
    console.error('❌ No Late Profile ID found in SOCIALS.md');
    process.exit(1);
  }

  // Find videos to process
  let videos = [];
  if (opts.file) {
    if (!fs.existsSync(opts.file)) {
      console.error(`❌ File not found: ${opts.file}`);
      process.exit(1);
    }
    videos = [opts.file];
  } else {
    videos = findUnpublished(opts.folder);
    console.log(`📂 Watch folder: ${opts.folder}`);
    console.log(`📹 Found ${videos.length} unpublished video(s)`);
    
    if (videos.length === 0) {
      console.log('\n✅ No videos to publish');
      console.log(JSON.stringify({ published: 0, skipped: 0, errors: 0 }));
      return;
    }

    if (!opts.all) {
      videos = videos.slice(0, 1);
    } else {
      videos = videos.slice(0, opts.limit);
    }
  }

  // Process videos
  const results = { published: 0, skipped: 0, errors: 0 };

  for (const video of videos) {
    try {
      const result = await processVideo(video, opts, accounts, profileId);
      if (result.success) {
        results.published++;
      } else {
        results.skipped++;
      }
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
      results.errors++;
    }
  }

  console.log('\n===================================');
  console.log(JSON.stringify(results));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
