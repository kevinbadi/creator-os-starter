#!/usr/bin/env node
// Facebook Messenger Outreach — sends DMs as the Facebook PAGE via Playwright
// Also scrapes contact info (email, phone, website) from each page's About section.
//
// Usage: node facebook-outreach.js [--headed] [--dry-run] [--limit N] [--campaign NAME]
//        [--category CAT] [--island ISLAND] [--priority PRIORITY]
//
// First run: use --headed so you can log in as the Page account manually.
// Session persists in cookies/facebook-page-profile/ for subsequent headless runs.

const { chromium } = require('playwright');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { loadOutreachConfig } = require('../../../lib/outreach-config');

const CONNECTION_STRING = process.env.INSFORGE_CONNECTION_STRING || process.env.DATABASE_URL;
if (!CONNECTION_STRING) { console.error('Error: INSFORGE_CONNECTION_STRING or DATABASE_URL not set'); process.exit(1); }

// Persistent browser profile for Facebook (personal account — can cold DM pages)
// Page profile is at cookies/facebook-page-profile/ (used for inbox/engagement only)
const FB_PROFILE_DIR = path.join(__dirname, '../../../cookies/facebook-profile');

// Rate limiting — browser automation needs human-like pacing
const DELAY_MS = parseInt(process.env.FB_DELAY_BETWEEN_MESSAGES) || 30000;
const BATCH_SIZE = parseInt(process.env.FB_BATCH_SIZE) || 15;
const DAILY_LIMIT = parseInt(process.env.FB_DAILY_LIMIT) || 20;

// CLI args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const headed = args.includes('--headed');
const limitArg = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 0;
const campaign = args.includes('--campaign') ? args[args.indexOf('--campaign') + 1] : 'default_outreach';
const category = args.includes('--category') ? args[args.indexOf('--category') + 1] : null;
const island = args.includes('--island') ? args[args.indexOf('--island') + 1] : null;
const priority = args.includes('--priority') ? args[args.indexOf('--priority') + 1] : null;

// Dynamic outreach message from config
const outreachCfg = loadOutreachConfig(path.join(__dirname, '..', '..', '..'));
const DEFAULT_MESSAGE = (name) =>
  `Hey ${name}! 👋\n\n` +
  `This is ${outreachCfg.persona_name} from ${outreachCfg.brand_name}.\n\n` +
  `${outreachCfg.outreach_goal}\n\n` +
  `${outreachCfg.primary_cta ? `👉 ${outreachCfg.primary_cta}` : ''}\n` +
  `${outreachCfg.brand_url ? outreachCfg.brand_url : ''}\n\n` +
  `Let me know if you're interested! 🙏`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Jitter: ±30% around base delay
function jitteredDelay(baseMs) {
  const jitter = baseMs * 0.3;
  return baseMs + Math.floor(Math.random() * jitter * 2) - jitter;
}

// Timeout wrapper — rejects after ms
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout (${ms/1000}s): ${label}`)), ms))
  ]);
}

// ------------------------------------------------------------------
// Launch persistent browser context (Page profile)
// ------------------------------------------------------------------

async function launchBrowser(headless) {
  if (!fs.existsSync(FB_PROFILE_DIR)) fs.mkdirSync(FB_PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(FB_PROFILE_DIR, {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = context.pages()[0] || await context.newPage();
  return { context, page };
}

// ------------------------------------------------------------------
// Check if logged into Facebook
// ------------------------------------------------------------------

const LOGIN_SELECTORS = [
  '[aria-label="Your profile"]',
  '[aria-label="Account"]',
  '[data-pagelet="Stories"]',
  '[aria-label="Create a post"]',
  '[role="banner"] [aria-label="Search Facebook"]',
];

async function isLoggedIn(page) {
  for (const sel of LOGIN_SELECTORS) {
    try {
      if (await page.locator(sel).first().isVisible({ timeout: 1000 }).catch(() => false)) return true;
    } catch {}
  }
  return false;
}

// ------------------------------------------------------------------
// Connect — auto-login flow with headed fallback
// ------------------------------------------------------------------

async function connectAndVerify() {
  // Always start headed if --headed or if no profile exists yet
  const profileExists = fs.existsSync(path.join(FB_PROFILE_DIR, 'Default', 'Cookies'));
  const useHeaded = headed || !profileExists;

  const { context, page } = await launchBrowser(!useHeaded);

  console.log('Navigating to facebook.com...');
  try {
    await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch {
    // Retry once
    await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  await sleep(5000);

  let loggedIn = await isLoggedIn(page);

  if (!loggedIn && !useHeaded) {
    // Session expired — relaunch headed
    console.log('Session expired. Relaunching headed for manual login...');
    await context.close();
    return await connectAndVerify_headed();
  }

  if (!loggedIn && useHeaded) {
    // Headed mode — wait for user to log in
    console.log('\n🔐 Please log in to Facebook and switch to the Page account.');
    console.log('   → Profile icon → "See all profiles" → select your brand page');
    console.log('   Waiting up to 300s...\n');
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline && !loggedIn) {
      loggedIn = await isLoggedIn(page);
      if (!loggedIn) await sleep(3000);
    }
    if (!loggedIn) {
      console.error('❌ Timed out waiting for login.');
      await context.close();
      process.exit(1);
    }
    console.log('✅ Logged in! Waiting 5s for page to settle...');
    await sleep(5000);
  }

  console.log('✅ Facebook session active (personal profile).');
  return { context, page };
}

async function connectAndVerify_headed() {
  const { context, page } = await launchBrowser(false);

  await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);

  console.log('\n🔐 Please log in to Facebook (personal account).');
  console.log('   Waiting up to 300s...\n');
  const deadline = Date.now() + 300000;
  let loggedIn = false;
  while (Date.now() < deadline && !loggedIn) {
    loggedIn = await isLoggedIn(page);
    if (!loggedIn) await sleep(3000);
  }
  if (!loggedIn) {
    console.error('❌ Timed out waiting for login.');
    await context.close();
    process.exit(1);
  }
  console.log('✅ Logged in! Waiting 5s for page to settle...');
  await sleep(5000);
  return { context, page };
}

// ------------------------------------------------------------------
// Scrape contact info from a Facebook page's About section
// ------------------------------------------------------------------

async function scrapeContactInfo(page, facebookUrl) {
  const info = { emails: [], phones: [], website: null, address: null };

  // Facebook pages show contact info on the main page in the About card.
  // Navigate to the page itself (not /about) — the contact section is on the homepage sidebar.
  try {
    await page.goto(facebookUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(3000);
  } catch {
    return info;
  }

  // Strategy 1: Extract from structured href links (most reliable — no text parsing issues)
  try {
    // mailto: links → emails
    const mailLinks = await page.locator('a[href^="mailto:"]').all();
    for (const link of mailLinks.slice(0, 5)) {
      const href = await link.getAttribute('href').catch(() => '');
      const email = href.replace('mailto:', '').split('?')[0].trim().toLowerCase();
      if (email && !email.includes('facebook.com') && !info.emails.includes(email)) {
        info.emails.push(email);
      }
    }

    // tel: links → phones
    const telLinks = await page.locator('a[href^="tel:"]').all();
    for (const link of telLinks.slice(0, 5)) {
      const href = await link.getAttribute('href').catch(() => '');
      const phone = href.replace('tel:', '').trim();
      if (phone && !info.phones.includes(phone)) info.phones.push(phone);
    }

    // External website links (look for links with external URL icons or explicit website sections)
    const extLinks = await page.locator('a[href*="l.facebook.com/l.php"], a[role="link"][target="_blank"]').all();
    for (const link of extLinks.slice(0, 10)) {
      const href = await link.getAttribute('href').catch(() => '');
      // Facebook wraps external links: l.facebook.com/l.php?u=<encoded_url>
      const urlMatch = href.match(/[?&]u=([^&]+)/);
      const url = urlMatch ? decodeURIComponent(urlMatch[1]) : href;
      if (url && /^https?:\/\//.test(url) && !url.includes('facebook.com') && !url.includes('fb.com')) {
        if (!info.website) info.website = url.split('?')[0]; // strip tracking params
        break;
      }
    }
  } catch {}

  // Strategy 2: Also try the /about page for additional contact details
  try {
    const aboutUrl = facebookUrl.replace(/\/?$/, '/about');
    await page.goto(aboutUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(2000);

    // Get mailto/tel links from about page too
    const mailLinks = await page.locator('a[href^="mailto:"]').all();
    for (const link of mailLinks.slice(0, 5)) {
      const href = await link.getAttribute('href').catch(() => '');
      const email = href.replace('mailto:', '').split('?')[0].trim().toLowerCase();
      if (email && !email.includes('facebook.com') && !info.emails.includes(email)) {
        info.emails.push(email);
      }
    }

    const telLinks = await page.locator('a[href^="tel:"]').all();
    for (const link of telLinks.slice(0, 5)) {
      const href = await link.getAttribute('href').catch(() => '');
      const phone = href.replace('tel:', '').trim();
      if (phone && !info.phones.includes(phone)) info.phones.push(phone);
    }
  } catch {}

  return info;
}

// ------------------------------------------------------------------
// Update business_leads with scraped contact info
// ------------------------------------------------------------------

async function updateLeadContactInfo(db, businessLeadId, contactInfo, businessName) {
  const updates = [];
  const params = [];
  let idx = 1;

  // Only update fields that are currently empty in the DB
  if (contactInfo.emails.length > 0) {
    updates.push(`email = COALESCE(NULLIF(email, ''), $${idx})`);
    params.push(contactInfo.emails[0]);
    idx++;
  }
  if (contactInfo.phones.length > 0) {
    updates.push(`phone = COALESCE(NULLIF(phone, ''), $${idx})`);
    params.push(contactInfo.phones[0]);
    idx++;
  }
  if (contactInfo.website) {
    updates.push(`website = COALESCE(NULLIF(website, ''), $${idx})`);
    params.push(contactInfo.website);
    idx++;
  }

  if (updates.length === 0) return 0;

  params.push(businessLeadId);
  const sql = `UPDATE business_leads SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`;
  const result = await db.query(sql, params);

  const found = [];
  if (contactInfo.emails.length) found.push(`email: ${contactInfo.emails[0]}`);
  if (contactInfo.phones.length) found.push(`phone: ${contactInfo.phones[0]}`);
  if (contactInfo.website) found.push(`web: ${contactInfo.website}`);
  console.log(`  📋 Contact info found: ${found.join(', ')}`);

  return result.rowCount;
}

// ------------------------------------------------------------------
// Send a single Facebook message (as Page)
// ------------------------------------------------------------------

async function sendMessage(page, facebookUrl, message) {
  // Navigate to the target page
  try {
    await page.goto(facebookUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (navErr) {
    console.log(`  ⚠️  Navigation error, retrying after 5s...`);
    await sleep(5000);
    try {
      await page.goto(facebookUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch {
      return { success: false, error: `Navigation failed: ${navErr.message.split('\n')[0]}` };
    }
  }

  await sleep(4000);

  // Check for 404 / page not found
  const pageTitle = await page.title().catch(() => '');
  if (/page not found|content isn't available/i.test(pageTitle)) {
    return { success: false, error: 'Page not found (404)' };
  }

  // Lightweight check for "not available"
  const notAvailable = await page.locator('text=/this content isn\'t available|this page isn\'t available/i')
    .first().isVisible({ timeout: 2000 }).catch(() => false);
  if (notAvailable) {
    return { success: false, error: 'Page not available' };
  }

  // Close any lingering Messenger overlay from a previous send
  const staleClose = page.locator(
    '[aria-label="Close chat"], [aria-label="Close"], [aria-label="close"]'
  ).first();
  if (await staleClose.isVisible({ timeout: 1000 }).catch(() => false)) {
    await staleClose.click();
    await sleep(1000);
  }

  // Look for "Message" button on the page
  const messageBtn = page.locator(
    '[aria-label="Message"], [aria-label="Send message"], [aria-label="Send Message"]'
  ).first();

  // Also try text-based selector as fallback
  const messageBtnAlt = page.locator('div[role="button"]').filter({ hasText: /^Message$/i }).first();

  let btnFound = false;

  if (await messageBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await messageBtn.click();
    btnFound = true;
  } else if (await messageBtnAlt.isVisible({ timeout: 3000 }).catch(() => false)) {
    await messageBtnAlt.click();
    btnFound = true;
  }

  if (!btnFound) {
    return { success: false, error: 'no_message_btn' };
  }

  // Wait for Messenger overlay / chat input to appear
  await sleep(3000);

  // Find the message input in the Messenger overlay
  const chatInput = page.locator(
    '[aria-label="Message"], [aria-label="Aa"], div[role="textbox"][contenteditable="true"]'
  ).last();

  const inputReady = await chatInput.isVisible({ timeout: 10000 }).catch(() => false);
  if (!inputReady) {
    return { success: false, error: 'Messenger input did not appear' };
  }

  // Click to focus the input
  await chatInput.click();
  await sleep(500);

  // Type message line by line — use Shift+Enter for newlines
  const lines = message.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      await chatInput.press('Shift+Enter');
    }
    if (lines[i]) {
      await chatInput.type(lines[i], { delay: 10 });
    }
  }

  await sleep(1000);

  // Send with Enter
  await chatInput.press('Enter');

  // Wait for message to dispatch
  await sleep(3000);

  // Close the Messenger overlay so it doesn't bleed into the next page
  const closeBtn = page.locator(
    '[aria-label="Close chat"], [aria-label="Close"], [aria-label="close"]'
  ).first();
  if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await closeBtn.click();
    await sleep(1000);
  }

  return { success: true };
}

// Navigate home between targets to reset state
async function goHome(page) {
  try {
    await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch {
    // Non-fatal
  }
  await sleep(2000);
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------

async function main() {
  const db = new Client({ connectionString: CONNECTION_STRING, ssl: { rejectUnauthorized: false } });
  await db.connect();

  try {
    // Check daily send count
    const { rows: [{ count: sentToday }] } = await db.query(
      `SELECT COUNT(*) as count FROM facebook_outreach
       WHERE sent_at >= CURRENT_DATE AND status NOT IN ('pending', 'skipped_duplicate')`
    );
    const remaining = DAILY_LIMIT - parseInt(sentToday);
    console.log(`Daily limit: ${DAILY_LIMIT} | Sent today: ${sentToday} | Remaining: ${remaining}`);

    if (remaining <= 0 && !dryRun) {
      console.log('Daily limit reached. Try again tomorrow.');
      return;
    }

    // Build query for targets — deduplicated by facebook_url
    const conditions = [`fo.facebook_url IS NOT NULL`, `fo.status = 'pending'`];
    const params = [];
    let paramIdx = 1;

    if (category) {
      conditions.push(`bl.category ILIKE $${paramIdx}`);
      params.push(`%${category}%`);
      paramIdx++;
    }
    if (island) {
      conditions.push(`bl.island ILIKE $${paramIdx}`);
      params.push(`%${island}%`);
      paramIdx++;
    }
    if (priority) {
      conditions.push(`bl.priority = $${paramIdx}`);
      params.push(priority);
      paramIdx++;
    }

    const effectiveLimit = Math.min(
      limitArg > 0 ? limitArg : BATCH_SIZE,
      remaining,
      BATCH_SIZE
    );

    const sql = `
      SELECT DISTINCT ON (fo.facebook_url)
             fo.id as outreach_id, fo.facebook_url, fo.facebook_handle, fo.business_lead_id,
             bl.business_name, bl.category, bl.island, bl.priority
      FROM facebook_outreach fo
      JOIN business_leads bl ON bl.id = fo.business_lead_id
      WHERE ${conditions.join(' AND ')}
        AND fo.facebook_url NOT IN (
          SELECT facebook_url FROM facebook_outreach
          WHERE status IN ('sent', 'no_message_btn')
            AND facebook_url IS NOT NULL
        )
      ORDER BY fo.facebook_url,
        CASE WHEN bl.priority = 'high' THEN 0 WHEN bl.priority = 'medium' THEN 1 ELSE 2 END,
        bl.business_name
      LIMIT ${effectiveLimit}
    `;

    const { rows: targets } = await db.query(sql, params);
    console.log(`\nFound ${targets.length} targets to message (limit: ${effectiveLimit})\n`);

    if (targets.length === 0) {
      console.log('No pending targets. Run facebook-url-normalize.js first to populate the queue.');
      return;
    }

    // Dry run — list targets and exit
    if (dryRun) {
      for (const t of targets) {
        console.log(`  [DRY-RUN] → ${t.business_name} (${t.facebook_url}) | ${t.island || 'unknown'} | ${t.category || 'unknown'}`);
      }
      console.log(`\n${targets.length} targets would be messaged (dry-run mode — no browser opened).`);
      return;
    }

    // Launch browser with Page profile
    const { context, page } = await connectAndVerify();

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let enriched = 0;
    const urlsMessagedThisSession = new Set();

    try {
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const body = DEFAULT_MESSAGE(target.business_name);

        // Session-level dedup
        if (urlsMessagedThisSession.has(target.facebook_url)) {
          console.log(`\n--- [${i + 1}/${targets.length}] ${target.business_name} (${target.facebook_url}) ---`);
          console.log(`  ⏭️  SKIP: already messaged this page this session`);
          await db.query(
            `UPDATE facebook_outreach
             SET status = 'skipped_duplicate', send_error = 'duplicate page - already messaged', campaign_name = $1, updated_at = NOW()
             WHERE id = $2`,
            [campaign, target.outreach_id]
          );
          skipped++;
          continue;
        }

        console.log(`\n--- [${i + 1}/${targets.length}] ${target.business_name} (${target.facebook_url}) ---`);

        // Wrap entire target flow in a 90s timeout so one hanging page can't kill the run
        try {
          await withTimeout(async function processTarget() {
            // Step 1: Scrape contact info from the page's About section
            try {
              console.log(`  🔍 Scraping contact info...`);
              const contactInfo = await scrapeContactInfo(page, target.facebook_url);
              if (contactInfo.emails.length || contactInfo.phones.length || contactInfo.website) {
                const updated = await updateLeadContactInfo(db, target.business_lead_id, contactInfo, target.business_name);
                if (updated > 0) enriched++;
              } else {
                console.log(`  📋 No new contact info found`);
              }
            } catch (err) {
              console.log(`  ⚠️  Contact scrape error: ${err.message.split('\n')[0]}`);
            }

            // Step 2: Navigate back to the main page to send message
            console.log(`  💬 Sending message...`);
            const result = await sendMessage(page, target.facebook_url, body);

            if (result.success) {
              await db.query(
                `UPDATE facebook_outreach
                 SET status = 'sent', campaign_name = $1, message_body = $2,
                     sent_at = NOW(), updated_at = NOW()
                 WHERE id = $3`,
                [campaign, body, target.outreach_id]
              );

              // Mark lead as contacted via Facebook
              await db.query(
                `UPDATE business_leads
                 SET contacted_facebook = TRUE, contacted_facebook_at = NOW(), contacted = TRUE, contacted_at = COALESCE(contacted_at, NOW()), updated_at = NOW()
                 WHERE id = $1`,
                [target.business_lead_id]
              );

              // Mark all other pending rows with the same URL as duplicate
              await db.query(
                `UPDATE facebook_outreach
                 SET status = 'skipped_duplicate', send_error = 'duplicate page - already messaged',
                     campaign_name = $1, updated_at = NOW()
                 WHERE facebook_url = $2 AND id != $3 AND status = 'pending'`,
                [campaign, target.facebook_url, target.outreach_id]
              );

              urlsMessagedThisSession.add(target.facebook_url);
              sent++;
              console.log(`  ✅ SENT`);
            } else {
              const status = result.error === 'no_message_btn' ? 'no_message_btn' : 'failed';
              await db.query(
                `UPDATE facebook_outreach
                 SET status = $1, send_error = $2, campaign_name = $3, updated_at = NOW()
                 WHERE id = $4`,
                [status, result.error, campaign, target.outreach_id]
              );
              failed++;
              console.log(`  ❌ FAIL: ${result.error}`);
            }
          }(), 90000, target.business_name);
        } catch (err) {
          failed++;
          const errMsg = err.message || String(err);
          console.error(`  ❌ ERROR: ${errMsg.split('\n')[0]}`);

          await db.query(
            `UPDATE facebook_outreach
             SET status = 'failed', send_error = $1, campaign_name = $2, updated_at = NOW()
             WHERE id = $3`,
            [errMsg.slice(0, 500), campaign, target.outreach_id]
          ).catch(() => {});
        }

        // Navigate home to reset state
        await goHome(page);

        // Rate limit with jitter (skip after last message)
        if (i < targets.length - 1) {
          const delay = jitteredDelay(DELAY_MS);
          console.log(`  ⏳ ${(delay / 1000).toFixed(1)}s delay...`);
          await sleep(delay);
        }
      }
    } finally {
      await context.close();
    }

    console.log(`\n✅ Done! Sent: ${sent} | Failed: ${failed} | Skipped (dupes): ${skipped} | Leads enriched: ${enriched}`);
  } finally {
    await db.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
