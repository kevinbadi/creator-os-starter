#!/usr/bin/env node
/**
 * linkedin-notifications.js — Check LinkedIn notifications, dedup via DB, output new ones.
 *
 * Flow:
 *   1. Navigate to LinkedIn notifications page
 *   2. Scrape visible notifications
 *   3. Hash each notification, check DB for duplicates
 *   4. Store new ones, output summary
 *
 * Usage:
 *   node linkedin-notifications.js
 *   node linkedin-notifications.js --limit 20
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

const limit = parseInt(getArg("--limit") || "30", 10);
const cdpPort = getArg("--cdp-port") || "18800";
const CDP_BASE = `http://127.0.0.1:${cdpPort}`;

// --- Helpers ---
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function hashNotification(text) {
  return crypto.createHash("md5").update(text.trim().substring(0, 200)).digest("hex");
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

async function getSeenHashes(db) {
  const res = await db.query("SELECT notification_hash FROM linkedin_notifications");
  return new Set(res.rows.map(r => r.notification_hash));
}

async function storeNotification(db, notif) {
  await db.query(`
    INSERT INTO linkedin_notifications (notification_hash, notification_type, actor_name, content, link, reported)
    VALUES ($1, $2, $3, $4, $5, true)
    ON CONFLICT (notification_hash) DO NOTHING
  `, [notif.hash, notif.type, notif.actorName, notif.content, notif.link]);
}

// --- Classify notification type ---
function classifyNotification(text) {
  const t = text.toLowerCase();
  if (t.includes("accepted your invitation") || t.includes("now connected")) return "connection_accepted";
  if (t.includes("sent you a connection request") || t.includes("wants to connect")) return "connection_request";
  if (t.includes("liked your") || t.includes("reacted to your")) return "reaction";
  if (t.includes("commented on your")) return "comment";
  if (t.includes("shared your")) return "share";
  if (t.includes("mentioned you")) return "mention";
  if (t.includes("viewed your profile")) return "profile_view";
  if (t.includes("posted") || t.includes("new post")) return "new_post";
  if (t.includes("endorsed you")) return "endorsement";
  if (t.includes("birthday") || t.includes("anniversary") || t.includes("new position")) return "milestone";
  if (t.includes("job") || t.includes("hiring")) return "job";
  if (t.includes("invitation") || t.includes("event")) return "event";
  return "other";
}

// --- Extract actor name from notification text ---
function extractActor(text) {
  // Most notifications start with a name: "John Doe liked your post"
  const match = text.match(/^([A-Z][a-zA-Z\s.'-]+?)(?:\s+(?:liked|commented|shared|reacted|endorsed|viewed|accepted|sent|mentioned|posted|wants|is))/);
  if (match) return match[1].trim();
  
  // "X and Y others" pattern
  const match2 = text.match(/^([A-Z][a-zA-Z\s.'-]+?)\s+and\s+\d+/);
  if (match2) return match2[1].trim();
  
  return null;
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

  const targets = await (await fetch(`${CDP_BASE}/json`)).json();
  let target = targets.find(t => t.type === "page" && t.url.includes("linkedin.com"));
  if (!target) {
    target = await (await fetch(`${CDP_BASE}/json/new?${encodeURIComponent("https://www.linkedin.com/notifications/")}`)).json();
    await sleep(4000);
  }

  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) { console.error("No WebSocket URL."); process.exit(1); }

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });
  await cdpSend(ws, "DOM.enable");
  await cdpSend(ws, "Page.enable");

  // Navigate to notifications
  console.error("\n🔔 Opening LinkedIn Notifications...");
  await cdpSend(ws, "Page.navigate", { url: "https://www.linkedin.com/notifications/" });
  await sleep(5000);

  // Check if logged in
  const currentUrl = await evaluate(ws, "window.location.href");
  if (currentUrl.includes("/login") || currentUrl.includes("/authwall")) {
    console.error("❌ Not logged in. Aborting.");
    ws.close();
    process.exit(1);
  }

  // Scroll down to load more notifications
  for (let s = 0; s < 3; s++) {
    await evaluate(ws, "window.scrollBy(0, 800)");
    await sleep(1500);
  }

  // Scrape notifications
  console.error("🔍 Scraping notifications...");
  const notifications = await evaluate(ws, `(() => {
    // LinkedIn notifications are <article> elements in main
    const articles = document.querySelectorAll('main article');
    const notifs = [];
    
    for (const article of articles) {
      try {
        // The real content is in the main <a> link (not the <p> which just says "Unread notification.")
        // Find the link that contains the notification text (usually the longest link text)
        const links = Array.from(article.querySelectorAll('a'));
        let bestText = '';
        let bestLink = '';
        
        for (const link of links) {
          const text = link.textContent.trim().replace(/\\s+/g, ' ');
          // Skip very short texts and profile view links
          if (text.length > bestText.length && !text.startsWith('View ') && text.length > 15) {
            bestText = text;
            bestLink = link.href || '';
          }
        }
        
        // Remove "Unread notification." prefix
        bestText = bestText.replace(/^Unread notification\\.\\s*/i, '').trim();
        
        if (!bestText || bestText.length < 10) continue;
        
        // Get time
        const timeEl = article.querySelector('p:last-of-type');
        let time = '';
        if (timeEl) {
          const timeText = timeEl.textContent.trim();
          if (/^\\d+[mhdsw]$/.test(timeText) || /^\\d+\\s*(min|hour|day|week|month)/i.test(timeText)) {
            time = timeText;
          }
        }
        
        // Clean text
        const cleanText = bestText.substring(0, 500);
        
        notifs.push({ content: cleanText, link: bestLink, time });
      } catch (e) {}
    }
    return notifs;
  })()`);

  console.error(`📋 Scraped ${notifications ? notifications.length : 0} notifications`);

  if (!notifications || notifications.length === 0) {
    console.error("📭 No notifications found.");
    // Navigate away
    await cdpSend(ws, "Page.navigate", { url: "https://www.linkedin.com/feed/" });
    ws.close();
    console.log(JSON.stringify({ total: 0, new: 0, notifications: [] }));
    process.exit(0);
  }

  // Connect to DB
  let db = null;
  let seenHashes = new Set();
  if (process.env.DATABASE_URL) {
    try {
      db = await getDbClient();
      seenHashes = await getSeenHashes(db);
      console.error(`   📦 ${seenHashes.size} previously seen notifications in DB`);
    } catch (e) {
      console.error(`   ⚠️ DB connection failed: ${e.message}`);
    }
  }

  // Filter to new notifications only
  const newNotifications = [];
  const capped = notifications.slice(0, limit);

  for (const notif of capped) {
    const hash = hashNotification(notif.content);
    if (seenHashes.has(hash)) continue;

    const type = classifyNotification(notif.content);
    const actorName = extractActor(notif.content);

    const enriched = {
      ...notif,
      hash,
      type,
      actorName,
    };

    newNotifications.push(enriched);

    // Store in DB
    if (db) {
      await storeNotification(db, enriched);
    }
  }

  console.error(`\n🆕 ${newNotifications.length} new notifications (${capped.length - newNotifications.length} already seen)`);

  // Print new notifications
  for (const n of newNotifications) {
    const icon = {
      connection_accepted: "🤝",
      connection_request: "📩",
      reaction: "👍",
      comment: "💬",
      share: "🔄",
      mention: "📢",
      profile_view: "👀",
      new_post: "📝",
      endorsement: "⭐",
      milestone: "🎉",
      job: "💼",
      event: "📅",
      other: "🔔",
    }[n.type] || "🔔";
    console.error(`   ${icon} [${n.type}] ${n.content.substring(0, 120)}`);
  }

  // Navigate away from notifications
  await cdpSend(ws, "Page.navigate", { url: "https://www.linkedin.com/feed/" });
  await sleep(1000);

  // Output
  const output = {
    total: capped.length,
    new: newNotifications.length,
    alreadySeen: capped.length - newNotifications.length,
    notifications: newNotifications.map(n => ({
      type: n.type,
      actor: n.actorName,
      content: n.content.substring(0, 200),
      time: n.time,
    })),
  };

  console.log(JSON.stringify(output));

  if (db) await db.end();
  ws.close();
  process.exit(0);
}

run().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
