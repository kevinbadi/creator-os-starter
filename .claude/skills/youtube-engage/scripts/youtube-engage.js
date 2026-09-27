#!/usr/bin/env node
/**
 * youtube-engage.js — Like and comment on YouTube videos via CDP.
 *
 * Usage:
 *   node youtube-engage.js --channel your-channel [--limit 5] [--dry-run]
 *
 * Flow:
 *   1. Navigate to channel's videos page
 *   2. Scrape recent video URLs and titles
 *   3. Dedup against DB (youtube_engagements)
 *   4. Like + comment on new videos
 *   5. Store engagement records
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { execSync } = require("child_process");

// --- Onboarding Config ---
const onboardingConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'onboarding-config.json'), 'utf8'));
const phase2 = onboardingConfig.phase2 || {};

// --- Args ---
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}
function hasFlag(name) { return args.includes(name); }

const channelHandle = getArg("--channel") || (phase2.platforms?.youtube?.username || "your-channel");
const commenter = getArg("--commenter") || "Kev's Assistant";
const limit = parseInt(getArg("--limit") || "5", 10);
const cdpPort = getArg("--cdp-port") || "18800";
const dryRun = hasFlag("--dry-run");

const CDP_BASE = `http://127.0.0.1:${cdpPort}`;
const CHANNEL_VIDEOS_URL = `https://www.youtube.com/@${channelHandle}/videos`;

// --- Helpers ---
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cdpSend(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const timeout = setTimeout(() => {
      ws.removeListener("message", handler);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30000);
    const handler = raw => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === id) {
        clearTimeout(timeout);
        ws.removeListener("message", handler);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const result = await cdpSend(ws, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`JS error: ${JSON.stringify(result.exceptionDetails.exception)}`);
  }
  return result.result ? result.result.value : undefined;
}

// --- DB ---
async function getDbClient() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  return client;
}

async function ensureTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS youtube_engagements (
      id SERIAL PRIMARY KEY,
      video_id TEXT UNIQUE NOT NULL,
      channel_handle TEXT NOT NULL,
      video_title TEXT,
      liked BOOLEAN DEFAULT false,
      commented BOOLEAN DEFAULT false,
      comment_text TEXT,
      engaged_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function getEngagedVideoIds(db, channelHandle) {
  const res = await db.query(
    `SELECT video_id FROM youtube_engagements WHERE channel_handle = $1`,
    [channelHandle]
  );
  return new Set(res.rows.map(r => r.video_id));
}

async function recordEngagement(db, { videoId, channelHandle, videoTitle, liked, commented, commentText }) {
  await db.query(`
    INSERT INTO youtube_engagements (video_id, channel_handle, video_title, liked, commented, comment_text)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (video_id) DO UPDATE SET
      liked = EXCLUDED.liked,
      commented = EXCLUDED.commented,
      comment_text = EXCLUDED.comment_text,
      engaged_at = NOW()
  `, [videoId, channelHandle, videoTitle, liked, commented, commentText]);
}

// --- Hype Comments ---
const HYPE_COMMENTS = [
  "This is incredible content 🔥",
  "Banger video as always 💯",
  "Let's goooo 🚀",
  "This is exactly what I needed to see 🙌",
  "Pure value right here 💎",
  "Kevin never misses 🎯",
  "Game changing content 🔥🔥",
  "This hits different 💪",
  "W video 🏆",
  "The goat of AI content 🐐",
  "Insane value as always 🚀",
  "This is fire 🔥",
  "Absolutely crushing it 💯",
  "Best content on YouTube fr 🙌",
  "Taking notes 📝🔥",
];

function pickComment() {
  return HYPE_COMMENTS[Math.floor(Math.random() * HYPE_COMMENTS.length)];
}

// --- Extract video ID from URL ---
function extractVideoId(url) {
  const match = url.match(/\/watch\?v=([^&]+)/) || url.match(/\/shorts\/([^?]+)/);
  return match ? match[1] : null;
}

// --- Main ---
async function main() {
  console.error(`YouTube Engage: @${channelHandle} (limit=${limit}, dryRun=${dryRun})`);

  // Connect to DB
  let db;
  try {
    db = await getDbClient();
    await ensureTable(db);
  } catch (err) {
    console.error("DB connection failed:", err.message);
    process.exit(1);
  }

  // Get already engaged video IDs
  const engagedIds = await getEngagedVideoIds(db, channelHandle);
  console.error(`Already engaged with ${engagedIds.size} videos from @${channelHandle}`);

  // Get CDP targets
  let targets;
  try {
    const res = await fetch(`${CDP_BASE}/json`);
    targets = await res.json();
  } catch (err) {
    console.error("Failed to connect to CDP. Is browser running?");
    console.error("Start with: clawdbot browser start --profile clawd --headless");
    process.exit(1);
  }

  // Find YouTube tab for this channel, or open new one
  let target = targets.find(t => t.url?.includes(`youtube.com/@${channelHandle}`));
  if (!target) {
    // Try any youtube.com tab
    target = targets.find(t => t.url?.includes("youtube.com") && t.type === "page" && !t.url.includes("studio.youtube.com"));
  }
  if (!target) {
    // Open new tab
    console.error("Opening new YouTube tab...");
    const newTab = await fetch(`${CDP_BASE}/json/new?${encodeURIComponent(CHANNEL_VIDEOS_URL)}`);
    target = await newTab.json();
    await sleep(4000);
  }

  // Connect WebSocket
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });

  await cdpSend(ws, "Runtime.enable");
  await cdpSend(ws, "Page.enable");

  // Navigate to channel videos page
  console.error(`Navigating to ${CHANNEL_VIDEOS_URL}`);
  await cdpSend(ws, "Page.navigate", { url: CHANNEL_VIDEOS_URL });
  await sleep(4000);

  // Scroll to load more videos
  await evaluate(ws, `window.scrollBy(0, 1000)`);
  await sleep(2000);

  // Scrape video links
  const videos = await evaluate(ws, `
    (() => {
      const results = [];
      // YouTube video links - multiple selector strategies
      const selectors = [
        'a#video-title-link',
        'a#video-title', 
        'ytd-rich-item-renderer a#thumbnail',
        'ytd-grid-video-renderer a#video-title',
        'a[href*="/watch?v="]'
      ];
      const seen = new Set();
      for (const sel of selectors) {
        const links = document.querySelectorAll(sel);
        links.forEach(a => {
          const href = a.href;
          if (!href || !href.includes('/watch?v=')) return;
          if (seen.has(href)) return;
          seen.add(href);
          // Get title from aria-label, title attr, or text content
          const title = a.getAttribute('aria-label') || a.getAttribute('title') || a.textContent?.trim() || '';
          results.push({ url: href, title: title.split('\\n')[0].trim() });
        });
      }
      return results.slice(0, 20); // Get up to 20 videos
    })()
  `);

  console.error(`Found ${videos?.length || 0} videos on channel page`);

  if (!videos || videos.length === 0) {
    console.error("No videos found. Page might not have loaded correctly.");
    ws.close();
    await db.end();
    console.log(JSON.stringify({ 
      channel: channelHandle, 
      videosFound: 0, 
      alreadyEngaged: 0, 
      newlyEngaged: 0, 
      engagements: [],
      error: "No videos found on channel page"
    }));
    return;
  }

  // Filter out already engaged
  const newVideos = videos.filter(v => {
    const id = extractVideoId(v.url);
    return id && !engagedIds.has(id);
  }).slice(0, limit);

  console.error(`${newVideos.length} new videos to engage with`);

  const engagements = [];

  for (const video of newVideos) {
    const videoId = extractVideoId(video.url);
    console.error(`\nEngaging with: ${video.title.substring(0, 50)}...`);

    if (dryRun) {
      console.error("  [DRY RUN] Would like and comment");
      engagements.push({
        videoId,
        title: video.title,
        liked: false,
        commented: false,
        comment: null,
        dryRun: true
      });
      continue;
    }

    // Navigate to video
    await cdpSend(ws, "Page.navigate", { url: video.url });
    await sleep(4000);

    // Scroll down a bit to load buttons
    await evaluate(ws, `window.scrollBy(0, 300)`);
    await sleep(1500);

    // Try to click Like button
    let liked = false;
    try {
      // YouTube like button - look for the like button that's not already pressed
      const likeResult = await evaluate(ws, `
        (() => {
          // Find the like button segment
          const btns = document.querySelectorAll('like-button-view-model button, ytd-toggle-button-renderer button, button[aria-label*="like" i]');
          for (const btn of btns) {
            const label = btn.getAttribute('aria-label') || '';
            // Skip if already liked (aria-pressed="true" or contains "unlike")
            if (btn.getAttribute('aria-pressed') === 'true') continue;
            if (label.toLowerCase().includes('unlike')) continue;
            if (label.toLowerCase().includes('dislike')) continue;
            // This should be the like button
            if (label.toLowerCase().includes('like')) {
              btn.click();
              return 'clicked';
            }
          }
          // Alternative: look for segmented like button
          const segmented = document.querySelector('ytd-segmented-like-dislike-button-renderer');
          if (segmented) {
            const likeBtn = segmented.querySelector('button');
            if (likeBtn && likeBtn.getAttribute('aria-pressed') !== 'true') {
              likeBtn.click();
              return 'clicked-segmented';
            }
          }
          return 'not-found';
        })()
      `);
      liked = likeResult?.includes('clicked');
      console.error(`  Like: ${liked ? '✅' : '❌ (may already be liked)'}`);
      await sleep(1500);
    } catch (err) {
      console.error(`  Like error: ${err.message}`);
    }

    // Try to comment
    let commented = false;
    let commentText = pickComment();
    try {
      // Scroll to comments
      await evaluate(ws, `window.scrollBy(0, 500)`);
      await sleep(2000);

      // Click on comment placeholder to open comment box
      const openedComment = await evaluate(ws, `
        (() => {
          // Look for the comment placeholder
          const placeholder = document.querySelector('#simplebox-placeholder, #placeholder-area, [placeholder*="comment" i]');
          if (placeholder) {
            placeholder.click();
            return true;
          }
          // Alternative: contenteditable div
          const commentBox = document.querySelector('#contenteditable-root, [contenteditable="true"]');
          if (commentBox) {
            commentBox.focus();
            return true;
          }
          return false;
        })()
      `);

      if (openedComment) {
        await sleep(1500);

        // Type the comment
        await evaluate(ws, `
          (() => {
            const commentBox = document.querySelector('#contenteditable-root, [contenteditable="true"]');
            if (commentBox) {
              commentBox.focus();
              commentBox.textContent = ${JSON.stringify(commentText)};
              // Trigger input event
              commentBox.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            }
            return false;
          })()
        `);
        await sleep(1000);

        // Wait for submit button to become enabled
        await sleep(1500);

        // Click submit button - try multiple selectors
        const submitted = await evaluate(ws, `
          (() => {
            // Try various submit button selectors
            const selectors = [
              '#submit-button button:not([disabled])',
              '#submit-button:not([disabled])',
              'ytd-button-renderer#submit-button button',
              'button[aria-label="Comment"]',
              'button[aria-label="Submit"]'
            ];
            for (const sel of selectors) {
              const btn = document.querySelector(sel);
              if (btn && !btn.disabled) {
                btn.click();
                return 'clicked: ' + sel;
              }
            }
            // Fallback: find any button with "Comment" text that's enabled
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
              if (btn.textContent?.trim() === 'Comment' && !btn.disabled) {
                btn.click();
                return 'clicked-fallback';
              }
            }
            return 'not-found';
          })()
        `);

        commented = submitted?.includes('clicked');
        console.error(`  Comment: ${commented ? '✅' : '❌'} "${commentText}"`);
        await sleep(2000);
      } else {
        console.error(`  Comment: ❌ (couldn't open comment box)`);
      }
    } catch (err) {
      console.error(`  Comment error: ${err.message}`);
    }

    // Record engagement
    if (liked || commented) {
      await recordEngagement(db, {
        videoId,
        channelHandle,
        videoTitle: video.title,
        liked,
        commented,
        commentText: commented ? commentText : null
      });
    }

    engagements.push({
      videoId,
      title: video.title,
      liked,
      commented,
      comment: commented ? commentText : null
    });

    // Delay between videos
    await sleep(3000);
  }

  // Close connections
  ws.close();
  await db.end();

  // Output results
  const result = {
    channel: channelHandle,
    videosFound: videos.length,
    alreadyEngaged: engagedIds.size,
    newlyEngaged: engagements.filter(e => e.liked || e.commented).length,
    engagements
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
