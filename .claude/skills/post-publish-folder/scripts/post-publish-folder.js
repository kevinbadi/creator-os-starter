#!/usr/bin/env node
/**
 * post-publish-folder — Publish text and image posts from a local folder
 *
 * Watches ~/Posts/ for images with caption files or text-only posts,
 * publishes to LinkedIn, Twitter/X, Facebook, and Instagram via Late API.
 *
 * Usage:
 *   node post-publish-folder.js                         # publish next unpublished
 *   node post-publish-folder.js --all --limit 5         # batch publish
 *   node post-publish-folder.js --file ~/Posts/post.jpg # specific file
 *   node post-publish-folder.js --dry-run               # preview only
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
const DEFAULT_FOLDER = path.join(require('os').homedir(), 'Desktop', 'Posts');
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm'];
const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];
const DEFAULT_PLATFORMS = ['linkedin', 'twitter', 'facebook', 'instagram'];

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

  const platformMap = {
    instagram: 'instagram',
    tiktok: 'tiktok',
    facebook: 'facebook',
    twitter: 'twitter',
    youtube: 'youtube',
    linkedin: 'linkedin',
  };

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
    schedule: null,
    all: false,
    limit: 10,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file': opts.file = args[++i].replace(/^~/, require('os').homedir()); break;
      case '--folder': opts.folder = args[++i].replace(/^~/, require('os').homedir()); break;
      case '--platforms': opts.platforms = args[++i].split(',').map(p => p.trim().toLowerCase()); break;
      case '--schedule': opts.schedule = args[++i]; break;
      case '--all': opts.all = true; break;
      case '--limit': opts.limit = parseInt(args[++i], 10); break;
      case '--dry-run': opts.dryRun = true; break;
    }
  }

  return opts;
}

// ============================================================================
// Find Unpublished Posts
// ============================================================================

function findUnpublished(folder) {
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
    console.log(`  Created watch folder: ${folder}`);
    return [];
  }

  const entries = fs.readdirSync(folder, { withFileTypes: true });
  const posts = [];

  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);

    // Skip published items
    if (entry.name.endsWith('.published.json')) continue;
    if (entry.name.endsWith('.txt') && !entry.isDirectory()) {
      // Check if it's a caption for an image (skip) or standalone text post
      const baseName = entry.name.replace('.txt', '');
      const hasImage = IMAGE_EXTENSIONS.some(ext => 
        fs.existsSync(path.join(folder, baseName + ext))
      );
      if (hasImage) continue; // Skip caption files
      
      // Standalone text post
      const sidecar = path.join(folder, baseName + '.published.json');
      if (!fs.existsSync(sidecar)) {
        posts.push({ type: 'text', path: fullPath, baseName });
      }
      continue;
    }

    // Image files
    const ext = path.extname(entry.name).toLowerCase();
    if (IMAGE_EXTENSIONS.includes(ext) && !entry.isDirectory()) {
      const baseName = path.basename(entry.name, ext);
      const sidecar = path.join(folder, baseName + '.published.json');
      if (!fs.existsSync(sidecar)) {
        posts.push({ type: 'image', path: fullPath, baseName });
      }
      continue;
    }

    // Folders: carousel (multiple images), single post with metadata, or video
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const sidecar = path.join(folder, entry.name + '.published.json');
      const publishedMarker = path.join(fullPath, '.published.json');
      if (!fs.existsSync(sidecar) && !fs.existsSync(publishedMarker)) {
        const subFiles = fs.readdirSync(fullPath);
        const images = subFiles.filter(f => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase())).sort();
        const videos = subFiles.filter(f => VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase())).sort();
        let metadata = null;
        const metaFile = subFiles.find(f => f === 'metadata.json' || f === 'content.json');
        if (metaFile) {
          try { metadata = JSON.parse(fs.readFileSync(path.join(fullPath, metaFile), 'utf-8')); } catch (e) {}
        }
        if (images.length > 1) {
          posts.push({ type: 'carousel', path: fullPath, baseName: entry.name, images, metadata, folder: fullPath });
        } else if (videos.length > 0) {
          posts.push({ type: 'video', path: path.join(fullPath, videos[0]), baseName: entry.name, metadata, folder: fullPath });
        } else if (images.length === 1) {
          posts.push({ type: 'image', path: path.join(fullPath, images[0]), baseName: entry.name, metadata, folder: fullPath });
        }
      }
    }
  }

  return posts.sort((a, b) => a.baseName.localeCompare(b.baseName));
}

// ============================================================================
// Parse Caption File
// ============================================================================

function parseCaption(captionPath) {
  if (!fs.existsSync(captionPath)) {
    return { default: '' };
  }

  const content = fs.readFileSync(captionPath, 'utf8').trim();
  const captions = { default: content };

  // Check for platform-specific sections
  const platforms = ['twitter', 'instagram', 'linkedin', 'facebook'];
  for (const platform of platforms) {
    const regex = new RegExp(`---${platform}---\\s*([\\s\\S]*?)(?=---\\w+---|$)`, 'i');
    const match = content.match(regex);
    if (match) {
      captions[platform] = match[1].trim();
    }
  }

  // If we found platform sections, extract the default (before first ---)
  if (Object.keys(captions).length > 1) {
    const defaultMatch = content.match(/^([\s\S]*?)(?=---\w+---)/);
    if (defaultMatch) {
      captions.default = defaultMatch[1].trim();
    }
  }

  return captions;
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
// Upload Image to Late
// ============================================================================

async function uploadToLate(filePath) {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();
  const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

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

  return uploadData.mediaUrl;
}

// ============================================================================
// Publish Post via Late
// ============================================================================

async function publishPost(mediaUrls, captions, platforms, accounts, profileId, schedule) {
  const posts = [];

  for (const platform of platforms) {
    if (!accounts[platform]) {
      console.log(`  ⚠️  Skipping ${platform} — not configured`);
      continue;
    }

    // Instagram requires an image
    if (platform === 'instagram' && mediaUrls.length === 0) {
      console.log(`  ⚠️  Skipping ${platform} — requires image`);
      continue;
    }

    const caption = captions[platform] || captions.default || '';
    
    posts.push({
      accountId: accounts[platform].accountId,
      platform,
      type: mediaUrls.length > 0 ? (mediaUrls.length > 1 ? 'carousel' : 'image') : 'text',
      ...(mediaUrls.length > 0 && { mediaUrls }),
      text: caption,
      ...(schedule && { scheduledAt: schedule }),
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
// Process Single Post
// ============================================================================

async function processPost(post, opts, accounts, profileId) {
  console.log(`\n📝 Processing: ${post.baseName} (${post.type})`);

  const folder = path.dirname(post.path);
  const platforms = opts.platforms || DEFAULT_PLATFORMS;

  // Load captions
  let captionPath;
  if (post.type === 'carousel') {
    captionPath = path.join(post.path, 'caption.txt');
  } else if (post.type === 'text') {
    captionPath = post.path;
  } else {
    captionPath = path.join(folder, post.baseName + '.txt');
  }
  
  const captions = parseCaption(captionPath);
  console.log(`  📄 Caption: ${captions.default.slice(0, 50)}...`);

  if (opts.dryRun) {
    console.log('  🔍 DRY RUN — would publish to:', platforms.join(', '));
    return { success: true, dryRun: true };
  }

  // Upload images
  let mediaUrls = [];
  if (post.type === 'image') {
    console.log('  ⬆️  Uploading image...');
    mediaUrls = [await uploadToLate(post.path)];
  } else if (post.type === 'carousel') {
    console.log(`  ⬆️  Uploading ${post.images.length} images...`);
    for (const img of post.images) {
      const url = await uploadToLate(path.join(post.path, img));
      mediaUrls.push(url);
    }
  }

  // Publish
  console.log('  🚀 Publishing to:', platforms.join(', '));
  const result = await publishPost(mediaUrls, captions, platforms, accounts, profileId, opts.schedule);

  // Write sidecar
  let sidecarPath;
  if (post.type === 'carousel') {
    sidecarPath = post.path + '.published.json';
  } else {
    const ext = path.extname(post.path);
    sidecarPath = post.path.replace(ext, '.published.json');
  }

  const sidecar = {
    source_file: post.baseName,
    type: post.type,
    media_urls: mediaUrls,
    late_post_id: result.posts?.[0]?.id || result.id,
    published_at: new Date().toISOString(),
    published_platforms: platforms.filter(p => accounts[p]),
    captions,
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
  console.log('📝 Post Publish — Folder Method');
  console.log('================================');

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

  // Find posts to process
  let posts = [];
  if (opts.file) {
    if (!fs.existsSync(opts.file)) {
      console.error(`❌ File not found: ${opts.file}`);
      process.exit(1);
    }
    const ext = path.extname(opts.file).toLowerCase();
    const baseName = path.basename(opts.file, ext);
    const type = ext === '.txt' ? 'text' : 'image';
    posts = [{ type, path: opts.file, baseName }];
  } else {
    posts = findUnpublished(opts.folder);
    console.log(`📂 Watch folder: ${opts.folder}`);
    console.log(`📝 Found ${posts.length} unpublished post(s)`);
    
    if (posts.length === 0) {
      console.log('\n✅ No posts to publish');
      console.log(JSON.stringify({ published: 0, skipped: 0, errors: 0 }));
      return;
    }

    if (!opts.all) {
      posts = posts.slice(0, 1);
    } else {
      posts = posts.slice(0, opts.limit);
    }
  }

  // Process posts
  const results = { published: 0, skipped: 0, errors: 0 };

  for (const post of posts) {
    try {
      const result = await processPost(post, opts, accounts, profileId);
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

  console.log('\n================================');
  console.log(JSON.stringify(results));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
