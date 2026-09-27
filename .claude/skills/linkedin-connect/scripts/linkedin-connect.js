#!/usr/bin/env node
/**
 * linkedin-connect.js — Search LinkedIn + send connection requests via CDP browser automation.
 *
 * Flow:
 *   1. Search LinkedIn for a keyword (People filter)
 *   2. Scrape search results (name, headline, company, profile URL)
 *   3. Send connection requests with personalized messages
 *
 * Usage:
 *   node linkedin-connect.js --keyword "AI startup founders" --limit 20 --message "Hey {{firstName}}, ..."
 *   node linkedin-connect.js --keyword "SaaS CEO Toronto" --limit 10 --dry-run
 *   node linkedin-connect.js --url "https://www.linkedin.com/in/someone/" --message "Hey..."
 *
 * Template variables: {{firstName}}, {{lastName}}, {{fullName}}, {{company}}, {{headline}}
 */

// Supabase uses self-signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const WebSocket = require("ws");
const { execSync } = require("child_process");

// --- Arg parsing ---
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}
function hasFlag(name) { return args.includes(name); }

const keyword = getArg("--keyword");
const singleUrl = getArg("--url");
const messageTemplate = getArg("--message") || "Hey {{firstName}}, I came across your profile and would love to connect. Always great to meet people in the {{company}} space.";
const limit = parseInt(getArg("--limit") || "20", 10);
const pages = parseInt(getArg("--pages") || "10", 10);
const dryRun = hasFlag("--dry-run");
const campaign = getArg("--campaign") || "linkedin-search";
const cdpPort = getArg("--cdp-port") || "18800";
const delayMin = parseInt(getArg("--delay-min") || "15", 10);
const delayMax = parseInt(getArg("--delay-max") || "35", 10);
const saveLeads = hasFlag("--save-leads");

const CDP_BASE = `http://127.0.0.1:${cdpPort}`;

// --- Helpers ---
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay() { return (delayMin + Math.random() * (delayMax - delayMin)) * 1000; }

async function fetchJSON(url) {
  const res = await fetch(url);
  return res.json();
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

async function waitForSelector(ws, selector, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = await evaluate(ws, `!!document.querySelector('${selector.replace(/'/g, "\\'")}')`);
    if (found) return true;
    await sleep(500);
  }
  throw new Error(`Timeout waiting for: ${selector}`);
}

function renderMessage(template, lead) {
  return template
    .replace(/\{\{firstName\}\}/g, lead.firstName || lead.fullName?.split(" ")[0] || "there")
    .replace(/\{\{lastName\}\}/g, lead.lastName || "")
    .replace(/\{\{fullName\}\}/g, lead.fullName || "")
    .replace(/\{\{company\}\}/g, lead.company || "your industry")
    .replace(/\{\{headline\}\}/g, lead.headline || "");
}

// --- Database helpers ---
async function getDbClient() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ 
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  return client;
}

async function saveLeadToDb(client, lead, campaignName, messageSent, status) {
  const nameParts = (lead.fullName || "").split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";
  
  await client.query(`
    INSERT INTO linkedin_agent_data (profile_url, full_name, first_name, last_name, headline, company, campaign_name, message_sent, status, sent_at, raw_data)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (profile_url) DO UPDATE SET
      status = EXCLUDED.status,
      message_sent = EXCLUDED.message_sent,
      sent_at = EXCLUDED.sent_at,
      updated_at = NOW()
  `, [
    lead.profileUrl,
    lead.fullName,
    firstName,
    lastName,
    lead.headline,
    lead.company,
    campaignName,
    messageSent,
    status,
    status === "sent" ? new Date() : null,
    JSON.stringify(lead)
  ]);
}

// --- Check existing leads in DB ---
async function getExistingUrls() {
  if (!process.env.DATABASE_URL) return new Set();
  try {
    const client = await getDbClient();
    const res = await client.query("SELECT profile_url FROM linkedin_agent_data WHERE status IN ('sent', 'accepted', 'pending')");
    await client.end();
    return new Set(res.rows.map(r => r.profile_url));
  } catch (e) {
    console.error(`   ⚠️ Could not check existing leads: ${e.message}`);
    return new Set();
  }
}

// --- Browser bootstrap ---
async function ensureBrowser() {
  try {
    const res = await fetch(`${CDP_BASE}/json/version`);
    if (res.ok) return;
  } catch {}
  
  console.error("Browser not running. Starting...");
  try {
    execSync("clawdbot browser start --profile clawd --headless", { timeout: 15000, stdio: "pipe" });
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

// --- Search LinkedIn ---
async function searchLinkedIn(ws, query, maxPages, existingUrls = new Set()) {
  const allResults = [];
  
  for (let page = 1; page <= maxPages; page++) {
    const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}&page=${page}`;
    console.error(`\n🔍 Searching page ${page}: ${query}`);
    
    await cdpSend(ws, "Page.navigate", { url: searchUrl });
    await sleep(4000);
    
    // Check if logged in
    const currentUrl = await evaluate(ws, "window.location.href");
    if (currentUrl.includes("/login") || currentUrl.includes("/authwall")) {
      throw new Error("Not logged in — redirected to login page");
    }
    
    // Scroll down to load all results
    for (let s = 0; s < 3; s++) {
      await evaluate(ws, "window.scrollBy(0, 800)");
      await sleep(1000);
    }
    
    // Scrape search results from the page
    const results = await evaluate(ws, `(() => {
      const cards = document.querySelectorAll('.reusable-search__result-container, li.reusable-search-simple-insight, div[data-view-name="search-entity-result-universal-template"]');
      const people = [];
      
      // Try multiple selector strategies
      const entities = cards.length > 0 ? cards : document.querySelectorAll('li.list-style-none');
      
      for (const card of entities) {
        try {
          // Get profile link
          const link = card.querySelector('a[href*="/in/"]');
          if (!link) continue;
          
          const profileUrl = link.href.split('?')[0];
          
          // Get name
          const nameEl = card.querySelector('.entity-result__title-text a span[dir="ltr"] span:first-child, .entity-result__title-text a span:first-child, a[href*="/in/"] span[dir="ltr"] span:first-child');
          const fullName = nameEl ? nameEl.textContent.trim() : (link.textContent.trim().split('\\n')[0] || '');
          
          if (!fullName || fullName === '') continue;
          
          // Get headline / subtitle
          const headlineEl = card.querySelector('.entity-result__primary-subtitle, .entity-result__summary, div.t-14.t-normal');
          const headline = headlineEl ? headlineEl.textContent.trim() : '';
          
          // Get company from headline or secondary subtitle
          const secondaryEl = card.querySelector('.entity-result__secondary-subtitle');
          const secondary = secondaryEl ? secondaryEl.textContent.trim() : '';
          
          // Extract company - usually in headline or secondary
          let company = secondary || '';
          if (!company && headline) {
            // Try to parse company from headline like "CEO at CompanyName"
            const atMatch = headline.match(/(?:at|@)\\s+(.+?)(?:·|\\||$)/i);
            if (atMatch) company = atMatch[1].trim();
          }
          
          // Check connection degree
          const degreeEl = card.querySelector('.entity-result__badge-text, span.dist-value');
          const degree = degreeEl ? degreeEl.textContent.trim() : '';
          
          // Get connection button state
          const connectBtn = card.querySelector('button[aria-label*="connect" i], button[aria-label*="invite" i]');
          const hasConnect = !!connectBtn;
          
          people.push({
            profileUrl,
            fullName,
            headline,
            company,
            degree,
            hasConnect
          });
        } catch (e) {
          // Skip malformed cards
        }
      }
      return people;
    })()`);
    
    if (results && results.length > 0) {
      console.error(`   Found ${results.length} profiles on page ${page}`);
      allResults.push(...results);
    } else {
      console.error(`   No results on page ${page} — stopping`);
      break;
    }
    
    // Don't go beyond what we need
    if (allResults.length >= limit) break;
    
    // Delay between pages
    if (page < maxPages) {
      await sleep(2000 + Math.random() * 2000);
    }
  }
  
  // Deduplicate by profile URL and filter out already-sent
  const seen = new Set();
  const unique = allResults.filter(r => {
    if (seen.has(r.profileUrl)) return false;
    if (existingUrls.has(r.profileUrl)) {
      console.error(`   ⏩ Skipping ${r.fullName} (already in DB)`);
      return false;
    }
    seen.add(r.profileUrl);
    return true;
  });
  
  return unique.slice(0, limit);
}

// --- Send connection request from profile page ---
async function sendConnectionRequest(ws, profileUrl, message) {
  console.error(`\n→ Navigating to: ${profileUrl}`);
  await cdpSend(ws, "Page.navigate", { url: profileUrl });
  await sleep(4000);
  
  const currentUrl = await evaluate(ws, "window.location.href");
  if (currentUrl.includes("/login") || currentUrl.includes("/authwall")) {
    throw new Error("Not logged in");
  }
  
  const profileName = await evaluate(ws, `(() => {
    const h1 = document.querySelector('h1.text-heading-xlarge, h1.inline');
    return h1 ? h1.textContent.trim() : 'Unknown';
  })()`);
  console.error(`   Profile: ${profileName}`);
  
  // Find and click Connect button
  const connectResult = await evaluate(ws, `(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    
    // Direct Connect button
    let connectBtn = buttons.find(b => {
      const text = b.textContent.trim();
      const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
      return (text === 'Connect' || ariaLabel.includes('connect with') || ariaLabel.includes('invite'))
        && !b.disabled;
    });
    if (connectBtn) { connectBtn.click(); return 'clicked_connect'; }
    
    // More dropdown
    const moreBtn = buttons.find(b => {
      const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
      return ariaLabel.includes('more actions') || b.textContent.trim() === 'More';
    });
    if (moreBtn) { moreBtn.click(); return 'clicked_more'; }
    
    // Already states
    if (buttons.find(b => b.textContent.trim() === 'Pending')) return 'already_pending';
    if (buttons.find(b => b.textContent.trim() === 'Message') && !connectBtn) return 'already_connected';
    
    return 'no_connect_button';
  })()`);
  
  if (connectResult === "already_pending") {
    console.error("   ⏳ Already pending");
    return { status: "already_pending", name: profileName };
  }
  if (connectResult === "already_connected") {
    console.error("   ✅ Already connected");
    return { status: "already_connected", name: profileName };
  }
  
  if (connectResult === "clicked_more") {
    await sleep(1000);
    const found = await evaluate(ws, `(() => {
      const items = Array.from(document.querySelectorAll('[role="menuitem"], .artdeco-dropdown__content-inner li span, div[role="listbox"] div'));
      const connectItem = items.find(el => el.textContent.trim().includes('Connect'));
      if (connectItem) { connectItem.click(); return true; }
      return false;
    })()`);
    if (!found) {
      console.error("   ❌ No Connect in dropdown");
      return { status: "no_connect_option", name: profileName };
    }
    await sleep(1500);
  } else if (connectResult === "clicked_connect") {
    await sleep(1500);
  } else {
    console.error(`   ❌ ${connectResult}`);
    return { status: connectResult, name: profileName };
  }
  
  // Handle "How do you know" modal if it appears
  const howKnow = await evaluate(ws, `(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const otherLabel = labels.find(l => l.textContent.includes('Other'));
    if (otherLabel) { otherLabel.click(); return 'clicked_other'; }
    return 'no_how_know';
  })()`);
  
  if (howKnow === "clicked_other") {
    await sleep(500);
    // Click Connect after selecting "Other"
    const connectAfter = await evaluate(ws, `(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find(b => b.textContent.trim() === 'Connect' && !b.disabled);
      if (btn) { btn.click(); return true; }
      return false;
    })()`);
    if (connectAfter) await sleep(1500);
  }
  
  // Add a note
  const addNoteClicked = await evaluate(ws, `(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const addNote = buttons.find(b => b.textContent.trim().includes('Add a note'));
    if (addNote) { addNote.click(); return true; }
    const textarea = document.querySelector('textarea[name="message"], textarea#custom-message');
    if (textarea) return true;
    return false;
  })()`);
  
  if (addNoteClicked && message) {
    await sleep(1000);
    const escapedMsg = message.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
    await evaluate(ws, `(() => {
      const textarea = document.querySelector('textarea[name="message"], textarea#custom-message, textarea.connect-button-send-invite__custom-message');
      if (!textarea) return false;
      textarea.focus();
      textarea.value = '${escapedMsg}';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    console.error(`   📝 Note: "${message.substring(0, 60)}..."`);
    await sleep(500);
  }
  
  // Click Send
  await sleep(500);
  const sent = await evaluate(ws, `(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const sendBtn = buttons.find(b => {
      const text = b.textContent.trim();
      return (text === 'Send' || text === 'Send invitation' || text === 'Send now') && !b.disabled;
    });
    if (sendBtn) { sendBtn.click(); return true; }
    return false;
  })()`);
  
  if (!sent) {
    await sleep(1000);
    const retry = await evaluate(ws, `(() => {
      const btns = Array.from(document.querySelectorAll('button.artdeco-button--primary'));
      const btn = btns.find(b => !b.disabled);
      if (btn) { btn.click(); return true; }
      return false;
    })()`);
    if (!retry) {
      console.error("   ❌ Send button not found");
      return { status: "send_failed", name: profileName };
    }
  }
  
  await sleep(2000);
  console.error(`   ✅ Sent to ${profileName}`);
  return { status: "sent", name: profileName };
}

// --- Main ---
(async () => {
  try {
    if (!keyword && !singleUrl) {
      console.error("Usage: --keyword <search term> [--limit N] [--dry-run]");
      console.error("   or: --url <profileUrl> --message <msg>");
      process.exit(1);
    }
    
    await ensureBrowser();
    
    const targets = await fetchJSON(`${CDP_BASE}/json`);
    let target = targets.find(t => t.type === "page" && t.url.includes("linkedin.com"));
    if (!target) {
      target = await fetchJSON(`${CDP_BASE}/json/new?${encodeURIComponent("https://www.linkedin.com/feed/")}`);
      await sleep(3000);
    }
    
    const wsUrl = target.webSocketDebuggerUrl;
    if (!wsUrl) { console.error("No WebSocket URL."); process.exit(1); }
    
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });
    await cdpSend(ws, "DOM.enable");
    await cdpSend(ws, "Page.enable");
    
    // --- Single URL mode ---
    if (singleUrl) {
      const msg = renderMessage(messageTemplate, { firstName: "", fullName: "", company: "", headline: "" });
      const result = await sendConnectionRequest(ws, singleUrl, msg);
      console.log(JSON.stringify(result));
      ws.close();
      process.exit(result.status === "sent" ? 0 : 1);
    }
    
    // --- Search + Connect mode ---
    console.error(`\n🎯 LinkedIn Search → Connect Pipeline`);
    console.error(`   Keyword: "${keyword}"`);
    console.error(`   Limit: ${limit}`);
    console.error(`   Dry run: ${dryRun}`);
    
    // Step 1: Check existing leads in DB
    const existingUrls = await getExistingUrls();
    console.error(`   📦 ${existingUrls.size} existing leads in DB (will skip)`);
    
    // Step 2: Search
    const leads = await searchLinkedIn(ws, keyword, pages, existingUrls);
    console.error(`\n📋 Found ${leads.length} profiles total`);
    
    if (leads.length === 0) {
      console.error("No profiles found.");
      ws.close();
      process.exit(0);
    }
    
    // Print found leads
    leads.forEach((l, i) => {
      console.error(`   ${i + 1}. ${l.fullName} — ${l.headline?.substring(0, 60) || 'No headline'}`);
    });
    
    // Connect to DB if saving
    let db = null;
    if (process.env.DATABASE_URL && !dryRun) {
      try {
        db = await getDbClient();
      } catch (e) {
        console.error(`   ⚠️ DB connection failed: ${e.message} — continuing without DB`);
      }
    }
    
    // Step 2: Send connection requests
    const results = { sent: 0, skipped: 0, errors: 0, leads: [] };
    
    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      const message = renderMessage(messageTemplate, lead);
      
      console.error(`\n[${i + 1}/${leads.length}] ${lead.fullName}`);
      
      if (dryRun) {
        console.error(`   🔍 DRY RUN → ${lead.profileUrl}`);
        console.error(`   📝 Message: "${message.substring(0, 80)}..."`);
        results.skipped++;
        results.leads.push({ ...lead, status: "dry_run" });
        
        // Save lead to DB even in dry run if requested
        if (db && saveLeads) {
          await saveLeadToDb(db, lead, campaign, null, "pending");
        }
        continue;
      }
      
      try {
        const result = await sendConnectionRequest(ws, lead.profileUrl, message);
        results.leads.push({ ...lead, status: result.status });
        
        if (result.status === "sent") {
          results.sent++;
          if (db) await saveLeadToDb(db, lead, campaign, message, "sent");
        } else if (result.status === "already_pending" || result.status === "already_connected") {
          results.skipped++;
          if (db) await saveLeadToDb(db, lead, campaign, null, result.status === "already_pending" ? "sent" : "accepted");
        } else {
          results.errors++;
          if (db) await saveLeadToDb(db, lead, campaign, null, "error");
        }
      } catch (err) {
        console.error(`   ❌ Error: ${err.message}`);
        results.errors++;
        if (db) await saveLeadToDb(db, lead, campaign, null, "error");
      }
      
      // Random delay
      if (i < leads.length - 1) {
        const delay = randomDelay();
        console.error(`   ⏱️  Waiting ${(delay / 1000).toFixed(0)}s...`);
        await sleep(delay);
      }
    }
    
    console.error(`\n📊 Results: ${results.sent} sent, ${results.skipped} skipped, ${results.errors} errors`);
    console.log(JSON.stringify({ sent: results.sent, skipped: results.skipped, errors: results.errors, totalFound: leads.length }));
    
    if (db) await db.end();
    ws.close();
    process.exit(0);
    
  } catch (err) {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
  }
})();
