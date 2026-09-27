#!/usr/bin/env node
/**
 * instagram-engage.js — Like & comment on Instagram posts via Playwright CDP.
 *
 * Visits a profile, finds posts, likes and comments on ones not yet engaged.
 * Deduplicates via DB (instagram_engagements table).
 *
 * Usage:
 *   node instagram-engage.js --profile your-profile
 *   node instagram-engage.js --profile your-profile --dry-run
 *   node instagram-engage.js --profile your-profile --limit 5
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

// --- Args ---
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}
function hasFlag(name) { return args.includes(name); }

// --- Onboarding Config ---
const onboardingConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'onboarding-config.json'), 'utf8'));
const phase2 = onboardingConfig.phase2 || {};

const profileSlug = getArg("--profile") || (phase2.platforms?.instagram?.username || "your-profile");
const dryRun = hasFlag("--dry-run");
const limitPosts = parseInt(getArg("--limit") || "10", 10);
const cdpPort = getArg("--cdp-port") || "18800";
const commenter = getArg("--commenter") || "Kev's Assistant";

const CDP_URL = `http://127.0.0.1:${cdpPort}`;
const COOKIES_PATH = path.join(__dirname, "../../../cookies/instagram-session.json");
const PROFILE_URL = `https://www.instagram.com/${profileSlug}/`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function md5(text) { return crypto.createHash("md5").update(text).digest("hex"); }

// --- Hype comments ---
const HYPE_COMMENTS = [
  "This is fire 🔥",
  "Absolutely love this 💯",
  "Let's gooo 🚀🔥",
  "Hard 🔥💪",
  "This goes crazy 🙌",
  "W post 🏆",
  "Massive 💪🔥",
  "Keep going king 👑",
  "This hits different 🎯",
  "Insane content 🔥🔥",
  "The grind is real 💪",
  "Pure value 💎",
  "Big moves 🚀",
  "Top tier content right here 🏆",
  "Nothing but W's 🔥",
];

function pickComment(postText) {
  return HYPE_COMMENTS[Math.floor(Math.random() * HYPE_COMMENTS.length)];
}

// --- DB ---
async function getDbClient() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

async function ensureTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS instagram_engagements (
      id SERIAL PRIMARY KEY,
      post_url TEXT UNIQUE NOT NULL,
      post_hash TEXT NOT NULL,
      profile_slug TEXT NOT NULL,
      post_caption TEXT,
      liked BOOLEAN DEFAULT FALSE,
      commented BOOLEAN DEFAULT FALSE,
      comment_text TEXT,
      engaged_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ig_engage_post ON instagram_engagements(post_url);
    CREATE INDEX IF NOT EXISTS idx_ig_engage_profile ON instagram_engagements(profile_slug);
  `);
}

async function isEngaged(db, postUrl) {
  const result = await db.query("SELECT id FROM instagram_engagements WHERE post_url = $1", [postUrl]);
  return result.rows.length > 0;
}

async function recordEngagement(db, postUrl, profileSlug, caption, liked, commented, commentText) {
  await db.query(
    `INSERT INTO instagram_engagements (post_url, post_hash, profile_slug, post_caption, liked, commented, comment_text, engaged_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (post_url) DO UPDATE SET liked = $5, commented = $6, comment_text = $7, engaged_at = NOW()`,
    [postUrl, md5(postUrl), profileSlug, (caption || "").substring(0, 200), liked, commented, commentText]
  );
}

// --- Browser ---
async function ensureBrowser() {
  try {
    const res = await fetch(`${CDP_URL}/json/version`);
    if (res.ok) { console.error("✅ Browser running."); return; }
  } catch {}
  console.error("🚀 Starting browser...");
  // try { execSync("clawdbot browser start --profile clawd --headless", { timeout: 15000, stdio: "pipe" }); } catch {}
  for (let i = 0; i < 20; i++) {
    try { const res = await fetch(`${CDP_URL}/json/version`); if (res.ok) return; } catch {}
    await sleep(500);
  }
  throw new Error("Browser not reachable");
}

// --- Main ---
(async () => {
  console.error("🚀 Instagram Engage (Like & Comment)");
  console.error("=".repeat(50));
  console.error(`👤 Profile: @${profileSlug}`);
  console.error(`📊 Limit: ${limitPosts} | Dry run: ${dryRun}`);

  if (!process.env.DATABASE_URL) { console.error("❌ DATABASE_URL not set"); process.exit(1); }

  const db = await getDbClient();
  await ensureTable(db);

  await ensureBrowser();

  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();

  // Inject cookies
  const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, "utf8"));
  await context.addCookies(cookies.map(c => ({
    ...c,
    sameSite: (c.sameSite || "Lax"),
    expires: c.expires > 0 ? c.expires : undefined,
  })));
  console.error(`🍪 Injected ${cookies.length} cookies`);

  let page = context.pages().find(p => p.url().includes("instagram.com"));
  if (!page) page = context.pages()[0] || await context.newPage();

  // 1. Navigate to profile
  console.error(`\n📱 Loading @${profileSlug}...`);
  await page.goto(PROFILE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(3000);

  // 2. Scrape post URLs from the grid
  const postUrls = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/p/"]'));
    return [...new Set(links.map(a => a.getAttribute("href")).filter(Boolean))];
  });
  console.error(`📸 Found ${postUrls.length} posts on profile`);

  if (postUrls.length === 0) {
    console.error("📭 No posts found.");
    console.log(JSON.stringify({ engaged: 0, skipped: 0, total: 0 }));
    await db.end();
    process.exit(0);
  }

  // 3. Check which ones are already engaged
  const toEngage = [];
  for (const url of postUrls.slice(0, limitPosts)) {
    const fullUrl = url.startsWith("http") ? url : `https://www.instagram.com${url}`;
    const already = await isEngaged(db, fullUrl);
    if (already) {
      console.error(`  ⏭️  Already engaged: ${url}`);
    } else {
      toEngage.push(fullUrl);
    }
  }

  console.error(`\n🎯 ${toEngage.length} new posts to engage with`);

  if (toEngage.length === 0) {
    console.error("✅ All posts already engaged!");
    console.log(JSON.stringify({ engaged: 0, skipped: postUrls.length, total: postUrls.length }));
    await db.end();
    process.exit(0);
  }

  if (dryRun) {
    console.error("\n🏃 DRY RUN:");
    for (const url of toEngage) console.error(`  📸 Would engage: ${url}`);
    console.log(JSON.stringify({ dryRun: true, wouldEngage: toEngage.length }));
    await db.end();
    process.exit(0);
  }

  // 4. Engage with each post
  let engaged = 0;
  let failed = 0;
  const results = [];

  for (let i = 0; i < toEngage.length; i++) {
    const postUrl = toEngage[i];
    console.error(`\n--- [${i + 1}/${toEngage.length}] ${postUrl} ---`);

    try {
      // Navigate to the post
      await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(3000);

      // Get caption
      const caption = await page.evaluate(() => {
        const h1 = document.querySelector('h1');
        return h1 ? h1.textContent.trim() : "";
      });
      console.error(`  📝 Caption: "${caption.substring(0, 60)}${caption.length > 60 ? "..." : ""}"`);

      // Like the post — click the heart icon (last Like SVG = main post like, not comment likes)
      console.error(`  ❤️ Liking...`);
      let liked = false;
      try {
        // The main post Like is the LAST svg[aria-label="Like"] on the page.
        // Comment likes come first in the DOM; the action bar is after all comments.
        // Instagram uses div[role="button"], not <button>, for the main action bar.
        const likeResult = await page.evaluate(() => {
          // Check already liked first — look for Unlike in a div[role="button"]
          const unlikes = document.querySelectorAll('svg[aria-label="Unlike"]');
          for (const svg of unlikes) {
            const roleBtn = svg.closest('[role="button"]');
            if (roleBtn && roleBtn.tagName === 'DIV') return 'already_liked';
          }
          // Find the last Like SVG (main post like) and click its role="button" ancestor
          const likes = document.querySelectorAll('svg[aria-label="Like"]');
          if (likes.length === 0) return 'no_like_svg';
          const mainLikeSvg = likes[likes.length - 1];
          const roleBtn = mainLikeSvg.closest('[role="button"]');
          if (roleBtn) {
            roleBtn.click();
            return 'clicked_role_btn';
          }
          // Fallback: try <button> ancestor
          const btn = mainLikeSvg.closest('button');
          if (btn) {
            btn.click();
            return 'clicked_btn';
          }
          return 'no_clickable_ancestor';
        });

        console.error(`    → like result: ${likeResult}`);
        if (likeResult === 'already_liked') {
          liked = true;
          console.error(`  ⏭️ Already liked`);
        } else if (likeResult === 'clicked_role_btn' || likeResult === 'clicked_btn') {
          await sleep(1500);
          // Verify
          const verified = await page.evaluate(() => !!document.querySelector('svg[aria-label="Unlike"]'));
          if (verified) {
            liked = true;
            console.error(`  ✅ Liked (heart icon)!`);
          } else {
            console.error(`  ⚠️ Clicked heart but unlike not detected, trying double-click...`);
            // Fallback: double-click image
            const postImg = page.locator('img[alt*="Photo by"], img[alt*="Video by"], img[alt*="Reel by"]').first();
            if (await postImg.isVisible({ timeout: 3000 })) {
              await postImg.dblclick();
              await sleep(1500);
              liked = true;
              console.error(`  ✅ Liked (double-click fallback)!`);
            }
          }
        } else {
          // No Like SVG or no clickable ancestor — try double-click
          console.error(`  🔄 Heart icon issue (${likeResult}), trying double-click...`);
          const postImg = page.locator('img[alt*="Photo by"], img[alt*="Video by"], img[alt*="Reel by"]').first();
          if (await postImg.isVisible({ timeout: 5000 })) {
            await postImg.dblclick();
            await sleep(1500);
            liked = true;
            console.error(`  ✅ Liked (double-click)!`);
          }
        }
      } catch (e) {
        console.error(`  ⚠️ Like failed: ${e.message}`);
      }
      await sleep(1500);

      // Comment on the post
      console.error(`  💬 Commenting...`);
      let commented = false;
      let commentText = pickComment(caption);

      try {
        const commentInput = page.locator('textarea[placeholder="Add a comment…"], [aria-label="Add a comment…"]').first();
        await commentInput.waitFor({ state: "visible", timeout: 5000 });
        await commentInput.click();
        await sleep(500);

        // After clicking, it might turn into a contenteditable or expand
        // Re-locate the active input
        const activeInput = page.locator('textarea:focus, [contenteditable="true"]:focus, [aria-label="Add a comment…"]').first();
        await activeInput.pressSequentially(commentText, { delay: 30 });
        await sleep(1000);

        // Click Post button
        const postBtn = page.getByRole("button", { name: "Post", exact: true });
        await postBtn.waitFor({ state: "visible", timeout: 3000 });
        await postBtn.click();
        commented = true;
        console.error(`  ✅ Commented: "${commentText}"`);
      } catch (e) {
        console.error(`  ⚠️ Comment failed: ${e.message}`);
      }
      await sleep(2000);

      // Record in DB
      await recordEngagement(db, postUrl, profileSlug, caption, liked, commented, commented ? commentText : null);
      engaged++;
      results.push({ postUrl, caption: caption.substring(0, 60), liked, commented, commentText: commented ? commentText : null });

      // Delay between posts
      if (i < toEngage.length - 1) {
        const delay = 10 + Math.floor(Math.random() * 10);
        console.error(`  ⏳ ${delay}s delay...`);
        await sleep(delay * 1000);
      }
    } catch (e) {
      console.error(`  ❌ Error: ${e.message}`);
      failed++;
    }
  }

  // Summary
  console.error(`\n${"=".repeat(50)}`);
  console.error(`✅ Engaged: ${engaged} | Failed: ${failed} | Skipped: ${postUrls.length - toEngage.length}`);
  console.log(JSON.stringify({ engaged, failed, skipped: postUrls.length - toEngage.length, total: postUrls.length, results }));

  await db.end();
  process.exit(0);
})().catch(e => { console.error(`Fatal: ${e.message}`); process.exit(1); });
