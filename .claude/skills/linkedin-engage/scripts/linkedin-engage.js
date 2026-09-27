#!/usr/bin/env node
/**
 * linkedin-engage.js — Like and comment on a LinkedIn profile's posts via CDP.
 *
 * Usage:
 *   node linkedin-engage.js --profile "kev-builds-apps-09b4a3189" [--commenter "Kev's Assistant"] [--limit 5] [--dry-run]
 *
 * Flow:
 *   1. Navigate to profile's recent activity page
 *   2. Scrape recent posts from article elements
 *   3. Dedup against DB (linkedin_engagements)
 *   4. Like + comment on new posts
 *   5. Store engagement records
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const WebSocket = require("ws");
const crypto = require("crypto");
const { execSync } = require("child_process");

// --- Args ---
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}
function hasFlag(name) { return args.includes(name); }

const profileSlug = getArg("--profile");
const commenter = getArg("--commenter") || "Kev's Assistant";
const limit = parseInt(getArg("--limit") || "5", 10);
const cdpPort = getArg("--cdp-port") || "18800";
const dryRun = hasFlag("--dry-run");

if (!profileSlug) {
  console.error("Error: --profile is required (LinkedIn profile slug)");
  process.exit(1);
}

const CDP_BASE = `http://127.0.0.1:${cdpPort}`;
const PROFILE_POSTS_URL = `https://www.linkedin.com/in/${profileSlug}/recent-activity/all/`;

// --- Helpers ---
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function hashPost(text) {
  return crypto.createHash("md5").update(text.trim().substring(0, 300)).digest("hex");
}

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
    CREATE TABLE IF NOT EXISTS linkedin_engagements (
      id SERIAL PRIMARY KEY,
      post_hash TEXT UNIQUE NOT NULL,
      profile_slug TEXT NOT NULL,
      post_text TEXT,
      liked BOOLEAN DEFAULT false,
      commented BOOLEAN DEFAULT false,
      comment_text TEXT,
      engaged_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function getEngagedHashes(db, slug) {
  const res = await db.query(
    "SELECT post_hash FROM linkedin_engagements WHERE profile_slug = $1",
    [slug]
  );
  return new Set(res.rows.map(r => r.post_hash));
}

async function storeEngagement(db, record) {
  await db.query(`
    INSERT INTO linkedin_engagements (post_hash, profile_slug, post_text, liked, commented, comment_text)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (post_hash) DO UPDATE SET
      liked = EXCLUDED.liked,
      commented = EXCLUDED.commented,
      comment_text = EXCLUDED.comment_text,
      engaged_at = NOW()
  `, [record.hash, record.profileSlug, record.postText, record.liked, record.commented, record.commentText]);
}

// --- Comment generation ---
function generateHypeComment(postText) {
  const text = postText.toLowerCase();

  const techKeywords = ["code", "build", "ship", "developer", "app", "api", "deploy", "launch", "tool", "stack", "saas", "software", "product", "claude", "ai agent", "automation"];
  const contentKeywords = ["video", "youtube", "content", "post", "podcast", "episode", "stream", "tutorial", "course", "editor"];
  const growthKeywords = ["grow", "follower", "audience", "subscriber", "milestone", "reach", "viral", "engagement"];
  const hustleKeywords = ["grind", "hustle", "work", "consistent", "discipline", "focus", "morning", "routine", "productive"];
  const resultKeywords = ["revenue", "client", "customer", "sale", "deal", "profit", "income", "money", "mrr", "arr"];
  const lessonKeywords = ["learn", "lesson", "mistake", "advice", "tip", "insight", "realize", "mindset"];

  const isTech = techKeywords.some(k => text.includes(k));
  const isContent = contentKeywords.some(k => text.includes(k));
  const isGrowth = growthKeywords.some(k => text.includes(k));
  const isHustle = hustleKeywords.some(k => text.includes(k));
  const isResult = resultKeywords.some(k => text.includes(k));
  const isLesson = lessonKeywords.some(k => text.includes(k));

  const comments = [];

  if (isTech) {
    comments.push(
      "This is exactly the kind of stuff builders need to see. The execution here is next level 🔥",
      "Love seeing the technical breakdown. Most people talk about building — you actually ship 💪",
      "The builder mindset is unmatched. This is what shipping looks like in practice 🚀",
      "Real builders ship. This is proof. Incredible work 🛠️",
      "This is what separates talkers from builders. Solid execution 👏"
    );
  }
  if (isContent) {
    comments.push(
      "The content game is strong. Consistently delivering value 🎯",
      "This kind of content is what actually moves the needle. Keep dropping gems 💎",
      "Quality content like this is rare. People are sleeping on this 🔥",
      "The consistency with content creation is inspiring. This hits different 📈",
      "Storytelling + value = this post. Nailed it 🎬"
    );
  }
  if (isGrowth) {
    comments.push(
      "Growth like this doesn't happen by accident. The work behind the scenes shows 📈",
      "This is what compounding effort looks like. Massive momentum 🚀",
      "The growth trajectory here is insane. Well deserved 🙌",
      "Numbers don't lie — this is what happens when you stay consistent 💯"
    );
  }
  if (isHustle) {
    comments.push(
      "The discipline here is unreal. This is what it takes 💪",
      "Outworking everyone quietly and letting results speak. Respect 🫡",
      "This kind of work ethic is contagious. Absolutely inspiring 🔥",
      "Consistency is the ultimate hack and you're proving it every day 💯"
    );
  }
  if (isResult) {
    comments.push(
      "Results speak louder than anything. This is incredible 🔥",
      "The ROI on this effort is showing. Massive respect for the execution 💰",
      "These numbers are insane. Proof the strategy is working 📊"
    );
  }
  if (isLesson) {
    comments.push(
      "This is the kind of raw honesty more people need to share. Gold 💎",
      "Lessons like this are worth more than any course. Appreciate the transparency 🙏",
      "Real talk. This hit home. More people need to hear this 💯"
    );
  }

  // Always include some generic-but-good options
  comments.push(
    "This is fire. The execution here speaks for itself 🔥",
    "People are sleeping on this. Incredible stuff right here 👏",
    "The energy in this post is contagious. Keep this up 🚀",
    "Absolutely crushing it. Love seeing this kind of work 🙌",
    "This is what it looks like when you're locked in. Massive respect 💪"
  );

  return comments[Math.floor(Math.random() * comments.length)];
}

// --- Browser bootstrap ---
async function ensureBrowser() {
  try {
    const res = await fetch(`${CDP_BASE}/json/version`);
    if (res.ok) return;
  } catch {}

  console.error("Browser not running. Starting...");
  try {
    execSync("clawdbot browser start --profile clawd", { timeout: 15000, stdio: "pipe" });
  } catch {
    try { await fetch("http://127.0.0.1:18791/start", { method: "POST" }); } catch {
      console.error("Could not start browser."); process.exit(1);
    }
  }
  for (let i = 0; i < 20; i++) {
    try { const res = await fetch(`${CDP_BASE}/json/version`); if (res.ok) return; } catch {}
    await sleep(500);
  }
  console.error("Browser not reachable."); process.exit(1);
}

// --- Main ---
async function run() {
  await ensureBrowser();

  // Connect to CDP
  const targets = await (await fetch(`${CDP_BASE}/json`)).json();
  let target = targets.find(t => t.type === "page" && t.url.includes("linkedin.com"));
  if (!target) {
    target = await (await fetch(`${CDP_BASE}/json/new?${encodeURIComponent(PROFILE_POSTS_URL)}`, { method: "PUT" })).json();
    await sleep(5000);
  }

  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) { console.error("No WebSocket URL."); process.exit(1); }

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });
  await cdpSend(ws, "DOM.enable");
  await cdpSend(ws, "Page.enable");

  // Navigate to profile's posts
  console.error(`\n📄 Navigating to ${profileSlug}'s recent activity...`);
  await cdpSend(ws, "Page.navigate", { url: PROFILE_POSTS_URL });
  await sleep(6000);

  // Check if logged in
  const currentUrl = await evaluate(ws, "window.location.href");
  if (currentUrl.includes("/login") || currentUrl.includes("/authwall")) {
    console.error("❌ Not logged in. Aborting.");
    ws.close();
    process.exit(1);
  }
  console.error(`   ✅ Page loaded: ${currentUrl}`);

  // Scroll to load posts
  console.error("📜 Scrolling to load posts...");
  for (let s = 0; s < 3; s++) {
    await evaluate(ws, "window.scrollBy(0, 800)");
    await sleep(1500);
  }
  await evaluate(ws, "window.scrollTo(0, 0)");
  await sleep(1000);

  // Scrape posts from div[role="article"] elements on the activity page
  console.error("🔍 Scraping posts from article role elements...");
  const posts = await evaluate(ws, `(() => {
    const results = [];
    // LinkedIn uses div[role="article"], not <article> tags
    const articles = document.querySelectorAll('[role="article"], .feed-shared-update-v2');
    
    for (const article of articles) {
      try {
        // Find the associated heading — may be inside or in a parent container
        const container = article.closest('li') || article.closest('[data-urn]') || article;
        const heading = container.querySelector('h2') || article.querySelector('h2');
        let postNum = '';
        if (heading) {
          const headingText = heading.textContent.trim();
          if (headingText.includes('Feed post number')) {
            postNum = headingText.replace('Feed post number ', '');
          }
        }
        if (!postNum) {
          // Try to generate a sequential number
          postNum = String(results.length + 1);
        }
        
        // Extract post body text from the actual content area
        // LinkedIn uses .break-words, .update-components-text, or .feed-shared-inline-show-more-text
        const searchArea = article.closest('li') || article.parentElement || article;
        let fullText = '';
        
        // Try specific content selectors in order of specificity
        const contentSelectors = [
          '.feed-shared-inline-show-more-text',
          '.update-components-text',
          'span.break-words'
        ];
        
        for (const sel of contentSelectors) {
          const el = searchArea.querySelector(sel);
          if (el) {
            fullText = el.textContent.trim().replace(/\\s+/g, ' ');
            break;
          }
        }
        
        if (!fullText || fullText.length < 20) continue;
        
        // Check like state via the react button
        const likeBtn = searchArea.querySelector('button[aria-label*="React Like"], button[aria-label*="Unreact"]');
        let alreadyLiked = false;
        if (likeBtn) {
          const label = likeBtn.getAttribute('aria-label') || '';
          alreadyLiked = label.includes('Unreact');
        }
        
        // Check if it's a repost (contains "reposted this")
        const isRepost = searchArea.textContent.includes('reposted this');
        
        results.push({
          text: fullText.substring(0, 500),
          postNum: postNum,
          alreadyLiked: alreadyLiked,
          isRepost: isRepost,
          index: results.length
        });
      } catch (e) {
        // skip broken article
      }
    }
    return results;
  })()`);

  console.error(`📋 Found ${posts ? posts.length : 0} posts`);
  if (posts && posts.length > 0) {
    for (const p of posts) {
      const liked = p.alreadyLiked ? '👍' : '⬜';
      const repost = p.isRepost ? ' [repost]' : '';
      console.error(`   ${liked} Post #${p.postNum}${repost}: "${p.text.substring(0, 70)}..."`);
    }
  }

  if (!posts || posts.length === 0) {
    console.error("📭 No posts found on profile activity page.");
    await cdpSend(ws, "Page.navigate", { url: "https://www.linkedin.com/feed/" });
    ws.close();
    console.log(JSON.stringify({ total: 0, new: 0, engaged: [] }));
    process.exit(0);
  }

  // Connect to DB for dedup
  let db = null;
  let engagedHashes = new Set();
  if (process.env.DATABASE_URL) {
    try {
      db = await getDbClient();
      await ensureTable(db);
      engagedHashes = await getEngagedHashes(db, profileSlug);
      console.error(`   📦 ${engagedHashes.size} previously engaged posts in DB`);
    } catch (e) {
      console.error(`   ⚠️ DB error: ${e.message}`);
    }
  }

  // Filter to un-engaged posts (skip reposts of our own content)
  const newPosts = [];
  for (const post of posts.slice(0, limit)) {
    // Skip reposts of Kev's Assistant/CreatorOS content
    if (post.isRepost && (post.text.toLowerCase().includes("kev's assistant") || post.text.toLowerCase().includes('creatoros'))) {
      console.error(`   ⏭️  Skipping repost of our content`);
      continue;
    }
    
    const hash = hashPost(post.text);
    if (engagedHashes.has(hash)) {
      console.error(`   ⏭️  Already engaged: Post #${post.postNum}`);
      continue;
    }
    newPosts.push({ ...post, hash });
  }

  console.error(`\n🆕 ${newPosts.length} new posts to engage with`);

  if (newPosts.length === 0) {
    await cdpSend(ws, "Page.navigate", { url: "https://www.linkedin.com/feed/" });
    ws.close();
    if (db) await db.end();
    console.log(JSON.stringify({ total: posts.length, new: 0, engaged: [] }));
    process.exit(0);
  }

  if (dryRun) {
    console.error("\n🏃 DRY RUN — skipping engagement");
    for (const post of newPosts) {
      const comment = generateHypeComment(post.text);
      console.error(`   📝 Would engage Post #${post.postNum}: "${post.text.substring(0, 70)}..."`);
      console.error(`      💬 Comment: "${comment}"`);
    }
    ws.close();
    if (db) await db.end();
    console.log(JSON.stringify({
      total: posts.length,
      new: newPosts.length,
      dryRun: true,
      engaged: newPosts.map(p => ({ text: p.text.substring(0, 200), hash: p.hash }))
    }));
    process.exit(0);
  }

  // Scroll back to top before engaging
  await evaluate(ws, "window.scrollTo(0, 0)");
  await sleep(1000);

  const engaged = [];

  for (let i = 0; i < newPosts.length; i++) {
    const post = newPosts[i];
    console.error(`\n🎯 Engaging with Post #${post.postNum} (${i + 1}/${newPosts.length}): "${post.text.substring(0, 60)}..."`);

    try {
      // Find this article by heading text or matching text content
      const found = await evaluate(ws, `(() => {
        // First try: find by heading
        const headings = document.querySelectorAll('h2');
        for (const h of headings) {
          if (h.textContent.trim() === 'Feed post number ${post.postNum}') {
            const container = h.closest('li') || h.closest('[data-urn]') || h.parentElement;
            if (container) {
              container.scrollIntoView({ block: 'center', behavior: 'smooth' });
              window.__targetContainer = container;
              return true;
            }
          }
        }
        // Fallback: find by matching text content
        const articles = document.querySelectorAll('[role="article"], .feed-shared-update-v2');
        const matchText = '${post.text.substring(0, 50).replace(/'/g, "\\'").replace(/\\/g, "\\\\").replace(/\n/g, " ")}';
        for (const a of articles) {
          if (a.textContent.includes(matchText)) {
            const container = a.closest('li') || a.closest('[data-urn]') || a;
            container.scrollIntoView({ block: 'center', behavior: 'smooth' });
            window.__targetContainer = container;
            return true;
          }
        }
        return false;
      })()`);

      if (!found) {
        console.error("   ⚠️ Could not find article on page, skipping");
        continue;
      }
      await sleep(2000);

      // --- LIKE ---
      let liked = post.alreadyLiked;
      if (!liked) {
        const likeResult = await evaluate(ws, `(() => {
          const a = window.__targetContainer;
          if (!a) return 'no_article';
          
          // Find the React Like button (not Unreact)
          const btn = a.querySelector('button[aria-label*="React Like"]');
          if (!btn) return 'no_button';
          
          // Check if it's already in Unreact state (already liked)
          if (btn.getAttribute('aria-label').includes('Unreact')) return 'already_liked';
          
          btn.scrollIntoView({ block: 'center' });
          btn.click();
          return 'clicked';
        })()`);

        if (likeResult === 'clicked') {
          console.error("   👍 Liked!");
          liked = true;
        } else if (likeResult === 'already_liked') {
          console.error("   👍 Already liked");
          liked = true;
        } else {
          console.error(`   ⚠️ Like failed: ${likeResult}`);
        }
        await sleep(2000);
      } else {
        console.error("   👍 Already liked (detected on scrape)");
      }

      // --- COMMENT ---
      const hypeComment = generateHypeComment(post.text);
      console.error(`   💬 Commenting: "${hypeComment}"`);

      // Click the Comment button to open the comment box
      const commentBtnClicked = await evaluate(ws, `(() => {
        const a = window.__targetContainer;
        if (!a) return false;
        
        // Find buttons with "Comment" in aria-label or text
        const buttons = a.querySelectorAll('button');
        for (const btn of buttons) {
          const label = btn.getAttribute('aria-label') || '';
          const text = btn.textContent.trim();
          if (label === 'Comment' || text === 'Comment') {
            btn.click();
            return true;
          }
        }
        return false;
      })()`);

      if (!commentBtnClicked) {
        console.error("   ⚠️ Could not find Comment button");
        if (db && liked) {
          await storeEngagement(db, {
            hash: post.hash, profileSlug, postText: post.text.substring(0, 500),
            liked: true, commented: false, commentText: null
          });
        }
        engaged.push({ text: post.text.substring(0, 200), liked, commented: false });
        continue;
      }
      await sleep(2500);

      // Find the comment editor and type using execCommand (innerHTML doesn't work on LinkedIn)
      const typed = await evaluate(ws, `(async () => {
        // Find the last visible contenteditable textbox (the one we just opened)
        let editor = null;
        const allEditors = document.querySelectorAll('[role="textbox"][contenteditable="true"], .ql-editor[contenteditable="true"]');
        for (const e of allEditors) {
          if (e.offsetParent !== null && e.offsetHeight > 0) editor = e;
        }
        
        if (!editor) return 'no_editor';
        
        // Focus and use execCommand to insert text
        // This properly triggers LinkedIn's rich text editor unlike innerHTML
        editor.focus();
        editor.textContent = '';
        
        const commentText = ${JSON.stringify(hypeComment)};
        document.execCommand('insertText', false, commentText);
        
        // Wait for LinkedIn to register the input
        await new Promise(r => setTimeout(r, 800));
        
        return 'typed';
      })()`);

      if (typed !== 'typed') {
        console.error(`   ⚠️ Comment typing failed: ${typed}`);
        if (db && liked) {
          await storeEngagement(db, {
            hash: post.hash, profileSlug, postText: post.text.substring(0, 500),
            liked: true, commented: false, commentText: null
          });
        }
        engaged.push({ text: post.text.substring(0, 200), liked, commented: false });
        continue;
      }
      await sleep(1000);

      // Submit the comment — click the submit button
      const submitted = await evaluate(ws, `(() => {
        // Primary: LinkedIn's comment submit button class
        const submitBtns = document.querySelectorAll('button[class*="comments-comment-box__submit-button"]');
        for (const btn of submitBtns) {
          if (!btn.disabled && btn.offsetParent !== null) {
            btn.click();
            return 'clicked_submit';
          }
        }
        
        // Fallback: any visible button with text "Comment" inside a comment-box area
        const allBtns = document.querySelectorAll('button');
        for (const btn of allBtns) {
          const text = btn.textContent.trim();
          const cl = btn.className || '';
          if (text === 'Comment' && cl.includes('comment') && !btn.disabled && btn.offsetParent !== null) {
            btn.click();
            return 'clicked_comment_btn';
          }
        }
        
        return false;
      })()`);

      if (submitted) {
        console.error(`   ✅ Comment submitted! (${submitted})`);
      } else {
        // Fallback: try Ctrl+Enter to submit
        console.error("   ⚠️ Submit button not found, trying keyboard submit...");
        await cdpSend(ws, "Input.dispatchKeyEvent", {
          type: "keyDown", key: "Enter", code: "Enter",
          modifiers: 0, windowsVirtualKeyCode: 13
        });
        await cdpSend(ws, "Input.dispatchKeyEvent", {
          type: "keyUp", key: "Enter", code: "Enter",
          modifiers: 0, windowsVirtualKeyCode: 13
        });
      }

      await sleep(3000);

      // Store engagement
      if (db) {
        await storeEngagement(db, {
          hash: post.hash, profileSlug, postText: post.text.substring(0, 500),
          liked: !!liked, commented: true, commentText: hypeComment
        });
      }

      engaged.push({
        text: post.text.substring(0, 200),
        liked: !!liked,
        commented: true,
        comment: hypeComment
      });

      // Natural delay between posts
      if (i < newPosts.length - 1) {
        const delay = 3000 + Math.floor(Math.random() * 3000);
        console.error(`   ⏳ Waiting ${(delay/1000).toFixed(1)}s before next post...`);
        await sleep(delay);
      }

    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
      engaged.push({ text: post.text.substring(0, 200), error: err.message });
    }
  }

  // Navigate away
  console.error("\n🏠 Navigating back to feed...");
  await cdpSend(ws, "Page.navigate", { url: "https://www.linkedin.com/feed/" });
  await sleep(1000);

  const output = {
    total: posts.length,
    new: newPosts.length,
    engaged: engaged
  };

  console.log(JSON.stringify(output));
  const successCount = engaged.filter(e => e.commented || e.liked).length;
  console.error(`\n✅ Done! Engaged with ${successCount}/${newPosts.length} posts`);

  if (db) await db.end();
  ws.close();
  process.exit(0);
}

run().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
