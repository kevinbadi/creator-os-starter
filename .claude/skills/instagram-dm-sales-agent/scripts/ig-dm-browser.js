#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '..', '.env') });
/**
 * ig-dm-browser.js — Send Instagram DMs via Playwright CDP browser automation.
 *
 * Connects to existing Clawdbot browser via CDP. Uses saved IG cookies.
 *
 * Usage:
 *   node ig-dm-browser.js --limit 10
 *   node ig-dm-browser.js --limit 10 --dry-run
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// --- Args ---
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}
function hasFlag(name) { return args.includes(name); }

const limit = parseInt(getArg("--limit") || "10", 10);
const campaign = getArg("--campaign") || null;
const dryRun = hasFlag("--dry-run");
const cdpPort = getArg("--cdp-port") || "18800";
const delayBetweenDMs = parseInt(getArg("--delay") || "45", 10);

const CDP_URL = `http://127.0.0.1:${cdpPort}`;
const COOKIES_PATH = path.join(__dirname, "../../../cookies/instagram.json");
const IG_DM_URL = "https://www.instagram.com/direct/inbox/";

// --- Onboarding Config ---
const onboardingConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'onboarding-config.json'), 'utf8'));
const phase2 = onboardingConfig.phase2 || {};
const { loadOutreachConfig } = require('../../../lib/outreach-config');
const outreachCfg = loadOutreachConfig(path.join(__dirname, '..', '..', '..'));

const SKIP_USERNAMES = new Set([(phase2.platforms?.instagram?.username || "your-account").toLowerCase(), "zeusbycreatoros", "creatoros"]);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- DB ---
async function getDbClient() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.INSFORGE_CONNECTION_STRING || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

async function loadLeads(db, count, campaignFilter) {
  let query = `SELECT username, full_name, campaign_name FROM instagram_leads
    WHERE (contacted = FALSE OR contacted IS NULL) AND (dm_success = FALSE OR dm_success IS NULL)`;
  const params = [];
  if (campaignFilter) { params.push(campaignFilter); query += ` AND campaign_name = $${params.length}`; }
  params.push(count);
  query += ` ORDER BY created_at ASC LIMIT $${params.length}`;
  const result = await db.query(query, params);
  return result.rows.filter(r => !SKIP_USERNAMES.has(r.username.toLowerCase()));
}

async function markContacted(db, username, message, success, error = null) {
  await db.query(
    `UPDATE instagram_leads SET contacted = TRUE, contacted_at = NOW(), message_sent = $1,
     dm_success = $2, dm_error = $3, status = CASE WHEN $2 THEN 'contacted' ELSE 'new' END,
     template_used = 'whatsup', updated_at = NOW() WHERE username = $4`,
    [message, success, error, username]
  );
}

// --- Browser ---
async function ensureBrowser() {
  try {
    const res = await fetch(`${CDP_URL}/json/version`);
    if (res.ok) { console.error("✅ Browser running."); return; }
  } catch {}
  console.error("🚀 Starting browser...");
  try { execSync("clawdbot browser start --profile clawd --headless", { timeout: 15000, stdio: "pipe" }); } catch {}
  for (let i = 0; i < 20; i++) {
    try { const res = await fetch(`${CDP_URL}/json/version`); if (res.ok) return; } catch {}
    await sleep(500);
  }
  throw new Error("Browser not reachable");
}

async function sendDM(page, username, message) {
  console.error(`\n📨 @${username}...`);
  try {
    // 1. Go to DM inbox
    await page.goto(IG_DM_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(2000);

    // Dismiss popups
    try {
      const notNow = page.locator('button:has-text("Not Now")');
      if (await notNow.isVisible({ timeout: 1000 })) await notNow.click();
    } catch {}

    // 2. Click compose (New message)
    console.error("  ✏️ Compose...");
    const compose = page.locator('[aria-label="New message"]').first();
    await compose.waitFor({ state: "visible", timeout: 10000 });
    await compose.click();
    await sleep(2000);

    // 3. Search for username (use pressSequentially to trigger React onChange)
    console.error(`  🔍 Searching...`);
    const searchInput = page.locator('[role="dialog"] input[type="text"], [role="dialog"] input[placeholder="Search..."]').first();
    await searchInput.waitFor({ state: "visible", timeout: 5000 });
    await searchInput.click();
    await sleep(300);
    await searchInput.pressSequentially(username, { delay: 50 });
    await sleep(4000);

    // Check for "No account found"
    const dialogText = await page.locator('[role="dialog"]').textContent();
    if (dialogText.includes("No account found")) {
      console.error(`  ⚠️ Account not found — skipping`);
      await page.locator('[role="dialog"]').getByRole("button", { name: "Close" }).click().catch(() => {});
      return { success: false, error: "No account found" };
    }

    // 4. Click first search result (skip Chat/Close buttons, pick first with real text)
    console.error(`  👆 Selecting user...`);
    
    // Use role-based locator since IG uses div[role="button"], not <button>
    const dialog = page.locator('[role="dialog"]').first();
    const resultButtons = dialog.getByRole("button");
    const count = await resultButtons.count();
    let clicked = false;
    for (let j = 0; j < count; j++) {
      const btn = resultButtons.nth(j);
      const text = (await btn.textContent().catch(() => "")).trim();
      // Skip utility buttons and empty ones
      if (!text || text === "Chat" || text === "Close") continue;
      // Must have more than just a short label (real results have name + username)
      if (text.length < 4) continue;
      await btn.click();
      console.error(`  ✅ Selected: ${text.substring(0, 50)}`);
      clicked = true;
      break;
    }
    if (!clicked) {
      console.error(`  ❌ No search results found`);
      await dialog.getByRole("button", { name: "Close" }).click().catch(() => {});
      return { success: false, error: "No search results" };
    }
    await sleep(1500);

    // 5. Click Chat button
    console.error(`  💬 Chat...`);
    const chatBtn = dialog.getByRole("button", { name: "Chat" });
    await chatBtn.waitFor({ state: "visible", timeout: 5000 });
    await chatBtn.click();
    await sleep(3000);

    // 6. Type message
    console.error(`  ✏️ Typing...`);
    const msgInput = page.locator('[aria-label="Message"]').first();
    await msgInput.waitFor({ state: "visible", timeout: 10000 });
    await msgInput.click();
    await sleep(300);
    await msgInput.fill(message);
    await sleep(1000);

    // 7. Click Send
    console.error(`  📤 Sending...`);
    const sendBtn = page.getByRole('button', { name: 'Send', exact: true });
    if (await sendBtn.isVisible({ timeout: 2000 })) {
      await sendBtn.click();
    } else {
      await msgInput.press("Enter");
    }
    await sleep(2000);

    console.error(`  ✅ DM sent to @${username}!`);
    return { success: true };
  } catch (e) {
    console.error(`  ❌ Error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// --- Main ---
(async () => {
  console.error("🚀 Instagram DM Bot (Playwright CDP)");
  console.error("=".repeat(50));
  console.error(`📊 Limit: ${limit} | Delay: ${delayBetweenDMs}s | Dry run: ${dryRun}`);

  if (!process.env.DATABASE_URL && !process.env.INSFORGE_CONNECTION_STRING) { console.error("❌ DATABASE_URL not set"); process.exit(1); }

  const db = await getDbClient();
  const leads = await loadLeads(db, limit, campaign);
  console.error(`📋 Loaded ${leads.length} uncontacted leads`);

  if (leads.length === 0) {
    console.error("📭 No leads. Done.");
    await db.end();
    process.exit(0);
  }

  for (const lead of leads.slice(0, 5)) {
    console.error(`  👤 @${lead.username} (${lead.full_name || "no name"})`);
  }
  if (leads.length > 5) console.error(`  ... and ${leads.length - 5} more`);

  if (dryRun) {
    console.error("\n🏃 DRY RUN:");
    for (const lead of leads) {
      const msg = outreachCfg.dm_opener_template
        ? outreachCfg.dm_opener_template.replace(/\(profile\)/gi, `@${lead.username}`)
        : `Hey @${lead.username} — ${outreachCfg.persona_name} here from ${outreachCfg.brand_name}. ${outreachCfg.outreach_goal}`;
      console.error(`  📨 @${lead.username}: "${msg.substring(0, 80)}..."`);
    }
    console.log(JSON.stringify({ dryRun: true, count: leads.length }));
    await db.end();
    process.exit(0);
  }

  // Connect to browser
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

  // Get or create a page
  let page = context.pages().find(p => p.url().includes("instagram.com"));
  if (!page) {
    page = context.pages()[0] || await context.newPage();
  }

  // Verify login
  await page.goto(IG_DM_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(2000);
  const loggedIn = await page.locator('svg[aria-label="Home"], svg[aria-label="Messenger"], img[alt*="profile picture"]').first().isVisible({ timeout: 5000 }).catch(() => false);

  if (!loggedIn) {
    console.error("❌ Not logged in. Cookies expired?");
    await db.end();
    process.exit(1);
  }
  console.error("✅ Logged in");

  let sent = 0, failed = 0;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const message = outreachCfg.dm_opener_template
      ? outreachCfg.dm_opener_template.replace(/\(profile\)/gi, `@${lead.username}`)
      : `Hey @${lead.username} — ${outreachCfg.persona_name} here from ${outreachCfg.brand_name}. ${outreachCfg.outreach_goal}`;

    console.error(`\n--- [${i + 1}/${leads.length}] ---`);
    const result = await sendDM(page, lead.username, message);
    await markContacted(db, lead.username, message, result.success, result.error || null);

    if (result.success) sent++;
    else failed++;

    if (i < leads.length - 1) {
      const delay = delayBetweenDMs + Math.floor(Math.random() * 20) - 10;
      console.error(`  ⏳ ${delay}s delay...`);
      await sleep(delay * 1000);
    }
  }

  console.error(`\n${"=".repeat(50)}`);
  console.error(`✅ Done! Sent: ${sent} | Failed: ${failed} | Total: ${leads.length}`);
  console.log(JSON.stringify({ sent, failed, total: leads.length }));

  await db.end();
  process.exit(0);
})().catch(e => { console.error(`Fatal: ${e.message}`); process.exit(1); });
