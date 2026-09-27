#!/usr/bin/env node
/**
 * stories-publish-folder — Publish Instagram and Facebook Stories from a folder
 *
 * Watches ~/Stories/ for images and short videos, publishes as Stories
 * to Instagram and Facebook via Late API.
 *
 * Usage:
 *   node stories-publish-folder.js                          # publish next story
 *   node stories-publish-folder.js --all --limit 5          # batch publish
 *   node stories-publish-folder.js --file ~/Stories/pic.jpg # specific file
 *   node stories-publish-folder.js --dry-run                # preview only
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ============================================================================
// Config
// ============================================================================

const LATE_API_KEY = process.env.LATE_API_KEY;
const LATE_BASE_URL = 'https://zernio.com/api/v1';

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const DEFAULT_FOLDER = path.join(require('os').homedir(), 'Desktop', 'Stories');
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov'];
const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];
const DEFAULT_PLATFORMS = ['instagram', 'facebook'];

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

  // Only Instagram and Facebook support stories
  const platformMap = { instagram: 'instagram', facebook: 'facebook' };

  for (const [section, platform] of Object.entries(platformMap)) {
    const sectionRegex = new RegExp(`###?\\s*${section}[\\s\\S]*?Late Account ID[:\\s]*\`?([a-f0-9]{24,})\`?`, 'i');
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
    all: false,
    limit: 10,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file': opts.file = args[++i].replace(/^~/, require('os').homedir()); break;
      case '--folder': opts.folder = args[++i].replace(/^~/, require('os').homedir()); break;
      case '--platforms': opts.platforms = args[++i].split(',').map(p => p.trim().toLowerCase()); break;
      case '--all': opts.all = true; break;
      case '--limit': opts.limit = parseInt(args[++i], 10); break;
      case '--dry-run': opts.dryRun = true; break;
    }
  }

  return opts;
}

// ============================================================================
// Find Unpublished Stories
// ============================================================================

function findUnpublished(folder) {
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
    console.log(`  Created watch folder: ${folder}`);
    return [];
  }

  const entries = fs.readdirSync(folder, { withFileTypes: true });
  const stories = [];

  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);

    // Skip published items
    if (entry.name.endsWith('.published.json')) continue;

    // Individual media files
    const ext = path.extname(entry.name).toLowerCase();
    if (MEDIA_EXTENSIONS.includes(ext) && !entry.isDirectory()) {
      const baseName = path.basename(entry.name, ext);
      const sidecar = path.join(folder, baseName + '.published.json');
      if (!fs.existsSync(sidecar)) {
        const isVideo = VIDEO_EXTENSIONS.includes(ext);
        stories.push({ type: isVideo ? 'video' : 'image', path: fullPath, baseName });
      }
      continue;
    }

    // Folders (sequence or single media + metadata)
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const sidecar = path.join(folder, entry.name + '.published.json');
      const publishedMarker = path.join(fullPath, '.published.json');
      if (!fs.existsSync(sidecar) && !fs.existsSync(publishedMarker)) {
        const subFiles = fs.readdirSync(fullPath);
        const items = subFiles.filter(f => MEDIA_EXTENSIONS.includes(path.extname(f).toLowerCase())).sort();
        let metadata = null;
        const metaFile = subFiles.find(f => f === 'metadata.json' || f === 'content.json');
        if (metaFile) {
          try { metadata = JSON.parse(fs.readFileSync(path.join(fullPath, metaFile), 'utf-8')); } catch (e) {}
        }
        if (items.length > 0) {
          stories.push({ type: items.length > 1 ? 'sequence' : (VIDEO_EXTENSIONS.includes(path.extname(items[0]).toLowerCase()) ? 'video' : 'image'), path: fullPath, baseName: entry.name, items, metadata, folder: fullPath });
        }
      }
    }
  }

  return stories.sort((a, b) => a.baseName.localeCompare(b.baseName));
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
// Upload Media to Late
// ============================================================================

async function uploadToLate(filePath) {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();
  
  let contentType;
  if (ext === '.png') contentType = 'image/png';
  else if (ext === '.webp') contentType = 'image/webp';
  else if (ext === '.mov') contentType = 'video/quicktime';
  else if (ext === '.mp4') contentType = 'video/mp4';
  else contentType = 'image/jpeg';

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

  return { mediaUrl: uploadData.mediaUrl, isVideo: VIDEO_EXTENSIONS.includes(ext) };
}

// ============================================================================
// Publish Story via Late
// ============================================================================

async function publishStory(mediaUrl, isVideo, platforms, accounts, profileId) {
  const posts = [];

  for (const platform of platforms) {
    if (!accounts[platform]) {
      console.log(`  ⚠️  Skipping ${platform} — not configured`);
      continue;
    }

    posts.push({
      accountId: accounts[platform].accountId,
      platform,
      type: 'story',
      mediaUrls: [mediaUrl],
      mediaType: isVideo ? 'video' : 'image',
    });
  }

  if (posts.length === 0) {
    throw new Error('No valid platforms to publish to');
  }

  const { data } = await httpRequest(`${LATE_BASE_URL}/posts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LATE_API_KEY}`,
      'Content-Type': 'application/json',
    },
  }, { profileId, posts });

  return data;
}

// ============================================================================
// Process Single Story
// ============================================================================

async function processStory(story, opts, accounts, profileId) {
  console.log(`\n📸 Processing: ${story.baseName} (${story.type})`);

  const platforms = opts.platforms || DEFAULT_PLATFORMS;

  if (opts.dryRun) {
    console.log('  🔍 DRY RUN — would publish to:', platforms.join(', '));
    return { success: true, dryRun: true };
  }

  // Handle sequences
  if (story.type === 'sequence') {
    console.log(`  📚 Sequence with ${story.items.length} items`);
    const mediaUrls = [];
    
    for (const item of story.items) {
      console.log(`  ⬆️  Uploading: ${item}`);
      const { mediaUrl, isVideo } = await uploadToLate(path.join(story.path, item));
      mediaUrls.push({ mediaUrl, isVideo });
    }

    // Publish each item as a separate story
    let results = [];
    for (const { mediaUrl, isVideo } of mediaUrls) {
      const result = await publishStory(mediaUrl, isVideo, platforms, accounts, profileId);
      results.push(result);
    }

    // Write sidecar
    const sidecarPath = story.path + '.published.json';
    const sidecar = {
      source_folder: story.baseName,
      type: 'sequence',
      items: story.items,
      published_at: new Date().toISOString(),
      published_platforms: platforms.filter(p => accounts[p]),
    };
    fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));

    console.log(`  ✅ Published ${story.items.length} stories!`);
    return { success: true, results };
  }

  // Single story
  console.log('  ⬆️  Uploading...');
  const { mediaUrl, isVideo } = await uploadToLate(story.path);

  console.log('  🚀 Publishing to:', platforms.join(', '));
  const result = await publishStory(mediaUrl, isVideo, platforms, accounts, profileId);

  // Write sidecar
  const ext = path.extname(story.path);
  const sidecarPath = story.path.replace(ext, '.published.json');
  const sidecar = {
    source_file: story.baseName,
    type: story.type,
    media_url: mediaUrl,
    late_post_id: result.posts?.[0]?.id || result.id,
    published_at: new Date().toISOString(),
    published_platforms: platforms.filter(p => accounts[p]),
  };
  fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));

  console.log('  ✅ Published!');
  return { success: true, result };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('📸 Stories Publish — Folder Method');
  console.log('===================================');

  if (!LATE_API_KEY) {
    console.error('❌ LATE_API_KEY not set');
    process.exit(1);
  }

  const opts = parseArgs();
  const { accounts, profileId } = loadPlatformAccounts();

  if (!profileId) {
    console.error('❌ No Late Profile ID found in SOCIALS.md');
    process.exit(1);
  }

  // Find stories to process
  let stories = [];
  if (opts.file) {
    if (!fs.existsSync(opts.file)) {
      console.error(`❌ File not found: ${opts.file}`);
      process.exit(1);
    }
    const ext = path.extname(opts.file).toLowerCase();
    const baseName = path.basename(opts.file, ext);
    const isVideo = VIDEO_EXTENSIONS.includes(ext);
    stories = [{ type: isVideo ? 'video' : 'image', path: opts.file, baseName }];
  } else {
    stories = findUnpublished(opts.folder);
    console.log(`📂 Watch folder: ${opts.folder}`);
    console.log(`📸 Found ${stories.length} unpublished stor${stories.length === 1 ? 'y' : 'ies'}`);
    
    if (stories.length === 0) {
      console.log('\n✅ No stories to publish');
      console.log(JSON.stringify({ published: 0, skipped: 0, errors: 0 }));
      return;
    }

    if (!opts.all) {
      stories = stories.slice(0, 1);
    } else {
      stories = stories.slice(0, opts.limit);
    }
  }

  // Process stories
  const results = { published: 0, skipped: 0, errors: 0 };

  for (const story of stories) {
    try {
      const result = await processStory(story, opts, accounts, profileId);
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
