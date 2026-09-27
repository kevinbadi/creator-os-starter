#!/usr/bin/env node
/**
 * twitter-engage.js — Like, retweet, and comment on Twitter/X posts via CDP.
 *
 * Usage:
 *   node twitter-engage.js --account your-account [--limit 5] [--dry-run]
 *
 * Flow:
 *   1. Navigate to account's profile page
 *   2. Scrape recent tweets
 *   3. Dedup against DB (twitter_engagements)
 *   4. Like + retweet + comment on new tweets
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

const accountHandle = getArg("--account") || (phase2.platforms?.twitter?.username || "your-account");
const commenter = getArg("--commenter") || "Kev's Assistant";
const limit = parseInt(getArg("--limit") || "5", 10);
const cdpPort = getArg("--cdp-port") || "18800";
const dryRun = hasFlag("--dry-run");

const CDP_BASE = `http://127.0.0.1:${cdpPort}`;
const PROFILE_URL = `https://x.com/${accountHandle}`;

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
    CREATE TABLE IF NOT EXISTS twitter_engagements (
      id SERIAL PRIMARY KEY,
      tweet_id TEXT UNIQUE NOT NULL,
      account_handle TEXT NOT NULL,
      tweet_text TEXT,
      liked BOOLEAN DEFAULT false,
      retweeted BOOLEAN DEFAULT false,
      commented BOOLEAN DEFAULT false,
      comment_text TEXT,
      engaged_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function getEngagedTweetIds(db, accountHandle) {
  const res = await db.query(
    `SELECT tweet_id FROM twitter_engagements WHERE account_handle = $1`,
    [accountHandle]
  );
  return new Set(res.rows.map(r => r.tweet_id));
}

async function recordEngagement(db, { tweetId, accountHandle, tweetText, liked, retweeted, commented, commentText }) {
  await db.query(`
    INSERT INTO twitter_engagements (tweet_id, account_handle, tweet_text, liked, retweeted, commented, comment_text)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (tweet_id) DO UPDATE SET
      liked = EXCLUDED.liked,
      retweeted = EXCLUDED.retweeted,
      commented = EXCLUDED.commented,
      comment_text = EXCLUDED.comment_text,
      engaged_at = NOW()
  `, [tweetId, accountHandle, tweetText, liked, retweeted, commented, commentText]);
}

// --- Hype Comments ---
const HYPE_COMMENTS = [
  "This is fire 🔥",
  "W tweet 🏆",
  "Facts 💯",
  "Let's goooo 🚀",
  "Big W 🙌",
  "This hits different 🎯",
  "Absolutely 💪",
  "The goat 🐐",
  "Real talk 💎",
  "Massive 🔥🔥",
  "Pure value 💯",
  "This is the way 🚀",
  "Hard agree 🙌",
  "Banger tweet 🏆",
  "Couldn't agree more 💪",
];

function pickComment() {
  return HYPE_COMMENTS[Math.floor(Math.random() * HYPE_COMMENTS.length)];
}

// --- Extract tweet ID from URL ---
function extractTweetId(url) {
  const match = url.match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

// --- Main ---
async function main() {
  console.error(`Twitter Engage: @${accountHandle} (limit=${limit}, dryRun=${dryRun})`);

  // Connect to DB
  let db;
  try {
    db = await getDbClient();
    await ensureTable(db);
  } catch (err) {
    console.error("DB connection failed:", err.message);
    process.exit(1);
  }

  // Get already engaged tweet IDs
  const engagedIds = await getEngagedTweetIds(db, accountHandle);
  console.error(`Already engaged with ${engagedIds.size} tweets from @${accountHandle}`);

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

  // Find Twitter tab or open new one
  let target = targets.find(t => t.url?.includes(`x.com/${accountHandle}`) && t.type === "page");
  if (!target) {
    target = targets.find(t => (t.url?.includes("x.com") || t.url?.includes("twitter.com")) && t.type === "page");
  }
  if (!target) {
    console.error("Opening new Twitter tab...");
    const newTab = await fetch(`${CDP_BASE}/json/new?${encodeURIComponent(PROFILE_URL)}`);
    target = await newTab.json();
    await sleep(5000);
  }

  // Connect WebSocket
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });

  await cdpSend(ws, "Runtime.enable");
  await cdpSend(ws, "Page.enable");

  // Navigate to profile page
  console.error(`Navigating to ${PROFILE_URL}`);
  await cdpSend(ws, "Page.navigate", { url: PROFILE_URL });
  await sleep(5000);

  // Scroll to load more tweets
  await evaluate(ws, `window.scrollBy(0, 800)`);
  await sleep(2000);
  await evaluate(ws, `window.scrollBy(0, 800)`);
  await sleep(2000);

  // Scrape tweets
  const tweets = await evaluate(ws, `
    (() => {
      const results = [];
      // Twitter article elements contain tweets
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      articles.forEach(article => {
        try {
          // Get tweet link for ID
          const timeLink = article.querySelector('a[href*="/status/"] time')?.parentElement;
          const tweetUrl = timeLink?.href || '';
          const tweetIdMatch = tweetUrl.match(/\\/status\\/(\\d+)/);
          if (!tweetIdMatch) return;
          
          const tweetId = tweetIdMatch[1];
          
          // Get tweet text
          const tweetTextEl = article.querySelector('[data-testid="tweetText"]');
          const tweetText = tweetTextEl?.textContent?.trim() || '';
          
          // Check if it's a retweet (skip those)
          const isRetweet = article.querySelector('[data-testid="socialContext"]')?.textContent?.includes('reposted');
          if (isRetweet) return;
          
          results.push({
            tweetId,
            url: tweetUrl,
            text: tweetText.substring(0, 280)
          });
        } catch (e) {}
      });
      return results;
    })()
  `);

  console.error(`Found ${tweets?.length || 0} tweets on profile page`);

  if (!tweets || tweets.length === 0) {
    console.error("No tweets found. Page might not have loaded correctly.");
    ws.close();
    await db.end();
    console.log(JSON.stringify({ 
      account: accountHandle, 
      tweetsFound: 0, 
      alreadyEngaged: 0, 
      newlyEngaged: 0, 
      engagements: [],
      error: "No tweets found on profile page"
    }));
    return;
  }

  // Filter out already engaged
  const newTweets = tweets.filter(t => !engagedIds.has(t.tweetId)).slice(0, limit);

  console.error(`${newTweets.length} new tweets to engage with`);

  const engagements = [];

  for (const tweet of newTweets) {
    console.error(`\nEngaging with: "${tweet.text.substring(0, 50)}..."`);

    if (dryRun) {
      console.error("  [DRY RUN] Would like, retweet, and comment");
      engagements.push({
        tweetId: tweet.tweetId,
        text: tweet.text,
        liked: false,
        retweeted: false,
        commented: false,
        comment: null,
        dryRun: true
      });
      continue;
    }

    // Navigate to individual tweet page for cleaner engagement
    await cdpSend(ws, "Page.navigate", { url: tweet.url });
    await sleep(4000);

    let liked = false;
    let retweeted = false;
    let commented = false;
    let commentText = pickComment();

    // Try to Like
    try {
      const likeResult = await evaluate(ws, `
        (() => {
          const likeBtn = document.querySelector('[data-testid="like"]');
          if (likeBtn) {
            likeBtn.click();
            return 'clicked';
          }
          // Check if already liked
          const unlikeBtn = document.querySelector('[data-testid="unlike"]');
          if (unlikeBtn) return 'already-liked';
          return 'not-found';
        })()
      `);
      liked = likeResult === 'clicked' || likeResult === 'already-liked';
      console.error(`  Like: ${liked ? '✅' : '❌'}`);
      await sleep(1500);
    } catch (err) {
      console.error(`  Like error: ${err.message}`);
    }

    // Try to Retweet
    try {
      const retweetResult = await evaluate(ws, `
        (() => {
          const retweetBtn = document.querySelector('[data-testid="retweet"]');
          if (retweetBtn) {
            retweetBtn.click();
            return 'clicked';
          }
          // Check if already retweeted
          const unretweetBtn = document.querySelector('[data-testid="unretweet"]');
          if (unretweetBtn) return 'already-retweeted';
          return 'not-found';
        })()
      `);
      
      if (retweetResult === 'clicked') {
        await sleep(1000);
        // Click "Repost" option in the menu
        const repostClicked = await evaluate(ws, `
          (() => {
            const menuItems = document.querySelectorAll('[role="menuitem"]');
            for (const item of menuItems) {
              if (item.textContent?.includes('Repost')) {
                item.click();
                return true;
              }
            }
            return false;
          })()
        `);
        retweeted = repostClicked === true;
      } else if (retweetResult === 'already-retweeted') {
        retweeted = true;
      }
      console.error(`  Retweet: ${retweeted ? '✅' : '❌'}`);
      await sleep(1500);
    } catch (err) {
      console.error(`  Retweet error: ${err.message}`);
    }

    // Try to Comment/Reply
    try {
      // Click reply button
      const replyClicked = await evaluate(ws, `
        (() => {
          const replyBtn = document.querySelector('[data-testid="reply"]');
          if (replyBtn) {
            replyBtn.click();
            return true;
          }
          return false;
        })()
      `);

      if (replyClicked) {
        await sleep(2500);

        // Focus the reply textbox and type using keyboard simulation
        const focused = await evaluate(ws, `
          (() => {
            // Try multiple selectors for the reply textbox
            const selectors = [
              '[data-testid="tweetTextarea_0"]',
              '[data-testid="tweetTextarea_0_label"]',
              '[role="textbox"][data-testid]',
              '[contenteditable="true"][role="textbox"]',
              '.DraftEditor-root [contenteditable="true"]'
            ];
            for (const sel of selectors) {
              const box = document.querySelector(sel);
              if (box) {
                box.focus();
                box.click();
                return sel;
              }
            }
            return null;
          })()
        `);

        if (focused) {
          await sleep(500);
          
          // Use CDP Input.insertText for reliable text input
          await cdpSend(ws, "Input.insertText", { text: commentText });
          await sleep(1500);

          // Click the Reply button
          const posted = await evaluate(ws, `
            (() => {
              const selectors = [
                '[data-testid="tweetButtonInline"]',
                '[data-testid="tweetButton"]',
                'button[data-testid*="reply"]'
              ];
              for (const sel of selectors) {
                const btn = document.querySelector(sel);
                if (btn && !btn.disabled) {
                  btn.click();
                  return true;
                }
              }
              // Fallback: find button with "Reply" text
              const buttons = document.querySelectorAll('button');
              for (const btn of buttons) {
                if (btn.textContent?.trim() === 'Reply' && !btn.disabled) {
                  btn.click();
                  return true;
                }
              }
              return false;
            })()
          `);
          commented = posted === true;
        }
      }
      console.error(`  Comment: ${commented ? '✅' : '❌'} "${commentText}"`);
      await sleep(2000);
    } catch (err) {
      console.error(`  Comment error: ${err.message}`);
    }

    // Record engagement
    if (liked || retweeted || commented) {
      await recordEngagement(db, {
        tweetId: tweet.tweetId,
        accountHandle,
        tweetText: tweet.text,
        liked,
        retweeted,
        commented,
        commentText: commented ? commentText : null
      });
    }

    engagements.push({
      tweetId: tweet.tweetId,
      text: tweet.text,
      liked,
      retweeted,
      commented,
      comment: commented ? commentText : null
    });

    // Delay between tweets
    await sleep(3000);
  }

  // Close connections
  ws.close();
  await db.end();

  // Output results
  const result = {
    account: accountHandle,
    tweetsFound: tweets.length,
    alreadyEngaged: engagedIds.size,
    newlyEngaged: engagements.filter(e => e.liked || e.retweeted || e.commented).length,
    engagements
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
