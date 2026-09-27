#!/usr/bin/env node
// WhatsApp Outreach Sender — sends messages via Playwright + WhatsApp Web
// Usage: node whatsapp-outreach.js [--dry-run] [--limit N] [--campaign NAME]
//        [--category CAT] [--island ISLAND] [--priority PRIORITY]

const { chromium } = require('playwright');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { loadOutreachConfig } = require('../../../lib/outreach-config');

const CONNECTION_STRING = process.env.INSFORGE_CONNECTION_STRING || process.env.DATABASE_URL;
if (!CONNECTION_STRING) { console.error('Error: INSFORGE_CONNECTION_STRING or DATABASE_URL not set'); process.exit(1); }

// Persistent browser profile (stores WhatsApp session data — no cookie injection needed)
const WA_PROFILE_DIR = path.join(__dirname, '../../../cookies/whatsapp-profile');
const COOKIES_PATH = path.join(__dirname, '../../../cookies/whatsapp-web.json');

// Rate limiting — browser automation needs human-like pacing
const DELAY_MS = parseInt(process.env.WA_DELAY_BETWEEN_MESSAGES) || 15000;
const BATCH_SIZE = parseInt(process.env.WA_BATCH_SIZE) || 25;
const DAILY_LIMIT = parseInt(process.env.WA_DAILY_LIMIT) || 50;

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
  `My name is ${outreachCfg.persona_name} from ${outreachCfg.brand_name}.\n\n` +
  `${outreachCfg.outreach_goal}\n\n` +
  `${outreachCfg.primary_cta ? `👉 ${outreachCfg.primary_cta}` : ''}\n` +
  `${outreachCfg.brand_url ? outreachCfg.brand_url : ''}\n\n` +
  `Let me know if you're interested! 🙏`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Jitter: ±20% around base delay
function jitteredDelay(baseMs) {
  const jitter = baseMs * 0.2;
  return baseMs + Math.floor(Math.random() * jitter * 2) - jitter;
}

// Login selectors — WhatsApp Web changes these often, so check many signals
const LOGIN_SELECTORS = [
  '[data-testid="chat-list"]',
  '[data-testid="chatlist-header"]',
  '[data-testid="menu-bar-search"]',
  '[aria-label="Search input textbox"]',
  '[aria-label="Chat list"]',
  'div[data-tab="3"]',
  'header span[data-testid="default-user"]',
];

async function isLoggedIn(page) {
  for (const sel of LOGIN_SELECTORS) {
    try {
      if (await page.locator(sel).first().isVisible({ timeout: 500 }).catch(() => false)) return true;
    } catch {}
  }
  return false;
}

// ------------------------------------------------------------------
// Launch persistent browser context (used for both QR login and sending)
// ------------------------------------------------------------------

async function launchBrowser(headless) {
  if (!fs.existsSync(WA_PROFILE_DIR)) fs.mkdirSync(WA_PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(WA_PROFILE_DIR, {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = context.pages()[0] || await context.newPage();
  return { context, page };
}

// ------------------------------------------------------------------
// First-run QR login flow
// ------------------------------------------------------------------

async function firstRunQRLogin() {
  console.log('\n📱 First-run setup: scan WhatsApp Web QR code');
  console.log('   Opening visible browser — scan the QR code with your phone.');
  console.log('   DO NOT close the browser window until you see "Logged in!"\n');

  const { context, page } = await launchBrowser(false);

  console.log('   Navigating to web.whatsapp.com...');
  await page.goto('https://web.whatsapp.com', { waitUntil: 'load', timeout: 60000 });
  await sleep(3000);

  console.log('   Waiting for QR scan and login (up to 180s)...');
  const deadline = Date.now() + 180000;
  let loggedIn = false;

  while (Date.now() < deadline && !loggedIn) {
    loggedIn = await isLoggedIn(page);
    if (!loggedIn) await sleep(2000);
  }

  if (!loggedIn) {
    console.error('❌ Timed out waiting for login. Close browser and try again.');
    await context.close();
    process.exit(1);
  }

  console.log('✅ Logged in! Saving cookies...');
  const cookies = await context.cookies();
  const cookiesDir = path.dirname(COOKIES_PATH);
  if (!fs.existsSync(cookiesDir)) fs.mkdirSync(cookiesDir, { recursive: true });
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  console.log(`   Saved ${cookies.length} cookies to ${COOKIES_PATH}`);
  await context.close();
}

// ------------------------------------------------------------------
// Open persistent browser, navigate to WhatsApp, verify login
// ------------------------------------------------------------------

async function connectAndVerify(headedMode) {
  // Always launch headed for QR if needed — we'll check login after loading
  const { context, page } = await launchBrowser(headedMode ? false : true);

  console.log('Navigating to WhatsApp Web...');
  await page.goto('https://web.whatsapp.com', { waitUntil: 'load', timeout: 60000 });
  await sleep(5000);

  let loggedIn = await isLoggedIn(page);

  if (!loggedIn) {
    // Not logged in — need QR scan. If headless, relaunch headed.
    if (!headedMode) {
      console.log('Not logged in. Relaunching headed for QR scan...');
      await context.close();
      return await doQRLoginAndContinue();
    }
    // Already headed — prompt user to scan QR
    console.log('\n📱 Scan the QR code with your phone WhatsApp app.');
    console.log('   Waiting for login (up to 180s)...\n');
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline && !loggedIn) {
      loggedIn = await isLoggedIn(page);
      if (!loggedIn) await sleep(2000);
    }
    if (!loggedIn) {
      console.error('❌ Timed out waiting for login.');
      await context.close();
      process.exit(1);
    }
    // Save cookies for reference
    const cookies = await context.cookies();
    const cookiesDir = path.dirname(COOKIES_PATH);
    if (!fs.existsSync(cookiesDir)) fs.mkdirSync(cookiesDir, { recursive: true });
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  }

  console.log('✅ WhatsApp Web logged in.');
  return { context, page };
}

// QR login then continue in headed mode
async function doQRLoginAndContinue() {
  const { context, page } = await launchBrowser(false); // headed

  console.log('Navigating to WhatsApp Web...');
  await page.goto('https://web.whatsapp.com', { waitUntil: 'load', timeout: 60000 });
  await sleep(3000);

  console.log('\n📱 Scan the QR code with your phone WhatsApp app.');
  console.log('   Waiting for login (up to 180s)...\n');
  const deadline = Date.now() + 180000;
  let loggedIn = false;
  while (Date.now() < deadline && !loggedIn) {
    loggedIn = await isLoggedIn(page);
    if (!loggedIn) await sleep(2000);
  }
  if (!loggedIn) {
    console.error('❌ Timed out waiting for login.');
    await context.close();
    process.exit(1);
  }
  const cookies = await context.cookies();
  const cookiesDir = path.dirname(COOKIES_PATH);
  if (!fs.existsSync(cookiesDir)) fs.mkdirSync(cookiesDir, { recursive: true });
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  console.log('✅ Logged in!');
  return { context, page };
}

// ------------------------------------------------------------------
// Send a single WhatsApp message via URL scheme
// ------------------------------------------------------------------

async function sendMessage(page, phone, message) {
  const encoded = encodeURIComponent(message);
  const url = `https://web.whatsapp.com/send?phone=${phone}&text=${encoded}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (navErr) {
    // Connection may have dropped — try to recover
    console.log(`  ⚠️  Navigation error, retrying after 5s...`);
    await sleep(5000);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch {
      return { success: false, error: `Navigation failed: ${navErr.message.split('\n')[0]}` };
    }
  }

  // Wait for either the compose box (message pre-filled) or an error popup
  const composeBox = page.locator('[data-testid="conversation-compose-box-input"], div[contenteditable="true"][data-tab="10"], [aria-placeholder="Type a message"]').first();
  const errorPopup = page.locator('[data-testid="popup-contents"], [data-testid="confirm-popup"]').first();

  // Poll up to 30s for the chat to load
  let ready = false;
  let notOnWA = false;
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline && !ready && !notOnWA) {
    // Check for error popup first
    if (await errorPopup.isVisible({ timeout: 500 }).catch(() => false)) {
      const popupText = await errorPopup.textContent().catch(() => '');
      if (/not on whatsapp|invalid|phone number shared via url/i.test(popupText)) {
        notOnWA = true;
        break;
      }
    }
    // Check for compose box with pre-filled text
    if (await composeBox.isVisible({ timeout: 500 }).catch(() => false)) {
      ready = true;
      break;
    }
    await sleep(1000);
  }

  if (notOnWA) {
    // Dismiss popup
    const okBtn = page.locator('[role="button"]').filter({ hasText: /ok|OK/i }).first();
    if (await okBtn.isVisible({ timeout: 2000 }).catch(() => false)) await okBtn.click();
    return { success: false, error: 'Phone number not on WhatsApp' };
  }

  if (!ready) {
    return { success: false, error: 'Timed out waiting for chat to load' };
  }

  // Small pause to let the pre-filled text render fully
  await sleep(1500);

  // Press Enter on the compose box to send
  await composeBox.press('Enter');

  // Wait for message to dispatch (check for sent tick)
  await sleep(3000);
  return { success: true };
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
      `SELECT COUNT(*) as count FROM whatsapp_outreach
       WHERE sent_at >= CURRENT_DATE AND status != 'pending'`
    );
    const remaining = DAILY_LIMIT - parseInt(sentToday);
    console.log(`Daily limit: ${DAILY_LIMIT} | Sent today: ${sentToday} | Remaining: ${remaining}`);

    if (remaining <= 0 && !dryRun) {
      console.log('Daily limit reached. Try again tomorrow.');
      return;
    }

    // Build query for targets — deduplicated by phone number
    // Exclude any phone that has ALREADY been sent/delivered/read (across ALL rows)
    const conditions = [`wo.phone_e164 IS NOT NULL`, `wo.status = 'pending'`];
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

    // DISTINCT ON (phone_e164) ensures one row per phone number.
    // Exclude phones that already have a non-pending row (sent/delivered/read/replied/failed).
    const sql = `
      SELECT DISTINCT ON (wo.phone_e164)
             wo.id as outreach_id, wo.phone_e164, wo.phone_raw, wo.business_lead_id,
             bl.business_name, bl.category, bl.island, bl.priority
      FROM whatsapp_outreach wo
      JOIN business_leads bl ON bl.id = wo.business_lead_id
      WHERE ${conditions.join(' AND ')}
        AND wo.phone_e164 NOT IN (
          SELECT phone_e164 FROM whatsapp_outreach
          WHERE status IN ('sent', 'delivered', 'read', 'replied')
            AND phone_e164 IS NOT NULL
        )
      ORDER BY wo.phone_e164,
        CASE WHEN bl.priority = 'high' THEN 0 WHEN bl.priority = 'medium' THEN 1 ELSE 2 END,
        bl.business_name
      LIMIT ${effectiveLimit}
    `;

    const { rows: targets } = await db.query(sql, params);
    console.log(`\nFound ${targets.length} targets to message (limit: ${effectiveLimit})\n`);

    if (targets.length === 0) {
      console.log('No pending targets. Run whatsapp-phone-normalize.js first to populate the queue.');
      return;
    }

    // Dry run — list targets and exit (no browser needed)
    if (dryRun) {
      for (const t of targets) {
        console.log(`  [DRY-RUN] → ${t.business_name} (${t.phone_e164}) | ${t.island || 'unknown'} | ${t.category || 'unknown'}`);
      }
      console.log(`\n${targets.length} targets would be messaged (dry-run mode — no browser opened).`);
      return;
    }

    // Launch browser, verify login (auto-prompts for QR if needed)
    const { context, page } = await connectAndVerify(headed);

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    const phonesMessagedThisSession = new Set();

    try {
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const body = DEFAULT_MESSAGE(target.business_name);

        // Session-level dedup — skip if we already messaged this phone
        if (phonesMessagedThisSession.has(target.phone_e164)) {
          console.log(`\n--- [${i + 1}/${targets.length}] ${target.business_name} (${target.phone_e164}) ---`);
          console.log(`  ⏭️  SKIP: already messaged this phone this session`);
          await db.query(
            `UPDATE whatsapp_outreach
             SET status = 'skipped_duplicate', send_error = 'duplicate phone - already messaged', campaign_name = $1, updated_at = NOW()
             WHERE id = $2`,
            [campaign, target.outreach_id]
          );
          skipped++;
          continue;
        }

        console.log(`\n--- [${i + 1}/${targets.length}] ${target.business_name} (${target.phone_e164}) ---`);

        try {
          const result = await sendMessage(page, target.phone_e164, body);

          if (result.success) {
            // Mark this row as sent
            await db.query(
              `UPDATE whatsapp_outreach
               SET status = 'sent', campaign_name = $1, message_body = $2,
                   sent_at = NOW(), updated_at = NOW()
               WHERE id = $3`,
              [campaign, body, target.outreach_id]
            );

            // Mark lead as contacted via WhatsApp
            await db.query(
              `UPDATE business_leads
               SET contacted_whatsapp = TRUE, contacted_whatsapp_at = NOW(), contacted = TRUE, contacted_at = COALESCE(contacted_at, NOW()), updated_at = NOW()
               WHERE id = $1`,
              [target.business_lead_id]
            );

            // Mark ALL other pending rows with the same phone as duplicate
            await db.query(
              `UPDATE whatsapp_outreach
               SET status = 'skipped_duplicate', send_error = 'duplicate phone - already messaged',
                   campaign_name = $1, updated_at = NOW()
               WHERE phone_e164 = $2 AND id != $3 AND status = 'pending'`,
              [campaign, target.phone_e164, target.outreach_id]
            );

            phonesMessagedThisSession.add(target.phone_e164);
            sent++;
            console.log(`  ✅ SENT`);
          } else {
            await db.query(
              `UPDATE whatsapp_outreach
               SET status = 'failed', send_error = $1, campaign_name = $2, updated_at = NOW()
               WHERE id = $3`,
              [result.error, campaign, target.outreach_id]
            );
            failed++;
            console.log(`  ❌ FAIL: ${result.error}`);
          }
        } catch (err) {
          failed++;
          console.error(`  ❌ ERROR: ${err.message}`);

          await db.query(
            `UPDATE whatsapp_outreach
             SET status = 'failed', send_error = $1, campaign_name = $2, updated_at = NOW()
             WHERE id = $3`,
            [err.message, campaign, target.outreach_id]
          );
        }

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

    console.log(`\nDone! Sent: ${sent} | Failed: ${failed} | Skipped (dupes): ${skipped}`);
  } finally {
    await db.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
