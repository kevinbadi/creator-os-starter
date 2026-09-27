#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '..', '.env') });
/**
 * batch-connect.js — Send connection requests to leads from linkedin_leads DB table.
 *
 * Usage:
 *   node batch-connect.js --limit 20
 *   node batch-connect.js --limit 20 --dry-run
 */

const WebSocket = require("ws");
const { Pool } = require("pg");

// --- Args ---
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}
function hasFlag(name) { return args.includes(name); }

const limit = parseInt(getArg("--limit") || "20", 10);
const campaignFilter = getArg("--campaign") || null;
const dryRun = hasFlag("--dry-run");
const cdpPort = getArg("--cdp-port") || "18800";
const delayMin = parseInt(getArg("--delay-min") || "8", 10);
const delayMax = parseInt(getArg("--delay-max") || "15", 10);

const CDP_BASE = `http://127.0.0.1:${cdpPort}`;
const DATABASE_URL = process.env.INSFORGE_CONNECTION_STRING || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Error: DATABASE_URL or INSFORGE_CONNECTION_STRING not set");
  process.exit(1);
}

// --- Helpers ---
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay() { return (delayMin + Math.random() * (delayMax - delayMin)) * 1000; }

async function fetchJSON(url) {
  const res = await fetch(url);
  return res.json();
}

let msgId = 1;
function cdpSend(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
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

async function waitForNav(ws, timeout = 15000) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(), timeout);
    const handler = raw => {
      const msg = JSON.parse(raw.toString());
      if (msg.method === "Page.loadEventFired" || msg.method === "Page.frameStoppedLoading") {
        clearTimeout(timeoutId);
        ws.removeListener("message", handler);
        resolve();
      }
    };
    ws.on("message", handler);
  });
}

// --- DB ---
async function getDbClient() {
  const pool = new Pool({ 
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('insforge') ? { rejectUnauthorized: false } : false
  });
  return pool;
}

async function getUncontactedLeads(pool, campaign, count) {
  let query = `
    SELECT id, public_identifier, linkedin_url, first_name, last_name, 
           CONCAT(first_name, ' ', last_name) as full_name, headline, current_company
    FROM linkedin_leads
    WHERE (connection_sent = FALSE OR connection_sent IS NULL)
  `;
  const params = [];
  if (campaign) {
    params.push(campaign);
    query += ` AND campaign_name = $${params.length}`;
  }
  params.push(count);
  query += ` ORDER BY created_at ASC LIMIT $${params.length}`;
  
  const result = await pool.query(query, params);
  return result.rows;
}

async function markConnectionSent(pool, leadId, success, error = null, skipped = false) {
  await pool.query(`
    UPDATE linkedin_leads
    SET connection_sent = $2, 
        connection_sent_at = CASE WHEN $2 THEN NOW() ELSE connection_sent_at END,
        connection_skipped = $4,
        connection_error = $3
    WHERE id = $1
  `, [leadId, success, error, skipped]);
}

// --- Browser automation ---
async function sendConnectionRequest(ws, lead) {
  const url = lead.linkedin_url || `https://www.linkedin.com/in/${lead.public_identifier}/`;
  
  // Navigate to profile
  console.error(`   🔗 Navigating to ${url}`);
  await cdpSend(ws, "Page.navigate", { url });
  await sleep(4000); // Wait for page to load
  
  // Check we're on a profile page
  const currentUrl = await evaluate(ws, `window.location.href`);
  if (!currentUrl.includes('/in/')) {
    return { status: 'nav_error', message: `Failed to navigate to profile: ${currentUrl}` };
  }
  
  // Check connection status
  const status = await evaluate(ws, `
    (function() {
      const body = document.body.innerText;
      
      // Check for pending invitation
      if (document.querySelector('[aria-label*="Pending"]') || 
          body.includes('Pending') ||
          Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Pending')) {
        return 'pending';
      }
      
      // Check if we're 1st degree connection (Message button + 1st badge)
      const distanceBadge = document.body.innerText.match(/·\\s*1st/);
      const msgBtn = document.querySelector('a[href*="messaging/compose"]') ||
                     Array.from(document.querySelectorAll('a, button')).find(el => 
                       el.textContent.trim() === 'Message' || 
                       (el.getAttribute('aria-label') || '').includes('Message'));
      if (msgBtn && distanceBadge) {
        return 'connected';
      }
      
      // Check for visible Connect button (primary action)
      const allButtons = Array.from(document.querySelectorAll('button'));
      const connectBtn = allButtons.find(b => {
        const text = b.textContent.trim();
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        return text === 'Connect' || label.includes('connect');
      });
      if (connectBtn) {
        return 'can_connect';
      }
      
      // Check for More button - Connect is often hidden there when Follow is primary
      const moreBtn = allButtons.find(b => {
        const text = b.textContent.trim();
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        return text === 'More' || label.includes('more actions');
      });
      if (moreBtn) {
        return 'check_more';
      }
      
      return 'no_button';
    })()
  `);
  
  console.error(`   📊 Status: ${status}`);
  
  if (status === 'pending') {
    return { status: 'pending', message: 'Connection already pending' };
  }
  if (status === 'connected') {
    return { status: 'already_connected', message: 'Already connected' };
  }
  if (status === 'no_button') {
    return { status: 'no_button', message: 'No connect button found' };
  }
  
  // Click Connect or open More menu
  if (status === 'check_more') {
    console.error(`   📋 Opening More menu...`);
    // Find and click the More button
    const moreClicked = await evaluate(ws, `
      (function() {
        const allButtons = Array.from(document.querySelectorAll('button'));
        const moreBtn = allButtons.find(b => {
          const text = b.textContent.trim();
          const label = (b.getAttribute('aria-label') || '').toLowerCase();
          return text === 'More' || label.includes('more actions');
        });
        if (moreBtn) {
          moreBtn.click();
          return true;
        }
        return false;
      })()
    `);
    
    if (!moreClicked) {
      return { status: 'no_button', message: 'Could not find More button' };
    }
    
    await sleep(2000);
    
    // Click Connect in dropdown - LinkedIn uses "Invite X to connect" text
    const foundConnect = await evaluate(ws, `
      (function() {
        // Look for dropdown items with "connect" or "Invite...to connect" text
        const menuItems = document.querySelectorAll('[role="menuitem"]');
        for (const item of menuItems) {
          const text = item.textContent.toLowerCase();
          // Match "Invite X to connect" or just "Connect" (not "Disconnect")
          if ((text.includes('to connect') || text === 'connect' || text.includes('invite') && text.includes('connect')) && 
              !text.includes('disconnect')) {
            item.click();
            return 'clicked';
          }
        }
        
        // Also try artdeco dropdown items
        const dropdownItems = document.querySelectorAll('.artdeco-dropdown__item');
        for (const item of dropdownItems) {
          const text = item.textContent.toLowerCase();
          if ((text.includes('to connect') || text === 'connect' || text.includes('invite') && text.includes('connect')) &&
              !text.includes('disconnect')) {
            item.click();
            return 'clicked';
          }
        }
        
        // Try finding any button/link in dropdown with Connect
        const dropdownContent = document.querySelector('.artdeco-dropdown__content') ||
                               document.querySelector('[data-control-name*="connect"]');
        if (dropdownContent) {
          const connectBtn = dropdownContent.querySelector('[data-control-name*="connect"]') ||
                            Array.from(dropdownContent.querySelectorAll('button, a, [role="button"]')).find(el => 
                              el.textContent.toLowerCase().includes('connect') && !el.textContent.toLowerCase().includes('disconnect')
                            );
          if (connectBtn) {
            connectBtn.click();
            return 'clicked_dropdown_btn';
          }
        }
        
        // List what's in the dropdown for debugging
        const allItems = Array.from(document.querySelectorAll('[role="menuitem"]')).map(i => i.textContent.trim().slice(0, 40));
        return 'not_found:' + allItems.join('|');
      })()
    `);
    
    console.error(`   📋 Connect search result: ${foundConnect}`);
    
    if (!foundConnect.startsWith('clicked')) {
      return { status: 'no_button', message: `No Connect option in More menu. Items: ${foundConnect}` };
    }
  } else {
    console.error(`   🖱️ Clicking Connect button...`);
    await evaluate(ws, `
      (function() {
        const allButtons = Array.from(document.querySelectorAll('button'));
        const connectBtn = allButtons.find(b => {
          const text = b.textContent.trim();
          const label = (b.getAttribute('aria-label') || '').toLowerCase();
          return text === 'Connect' || label.includes('connect');
        });
        if (connectBtn) connectBtn.click();
      })()
    `);
  }
  
  await sleep(2500);
  
  // Check for modal/dialog - specifically the artdeco modal for invites
  // Wait a bit more for modal to render, then check multiple selectors
  let hasModal = await evaluate(ws, `!!document.querySelector('.artdeco-modal.send-invite, .artdeco-modal[aria-labelledby*="invite"]')`);
  
  // Fallback: check for any visible artdeco-modal with the invite header text
  if (!hasModal) {
    await sleep(500);
    hasModal = await evaluate(ws, `
      (function() {
        const modals = document.querySelectorAll('.artdeco-modal');
        for (const m of modals) {
          // Skip hidden modals (video player dialogs)
          if (m.closest('.vjs-hidden') || m.classList.contains('vjs-hidden')) continue;
          // Check if modal text mentions invitation
          if (m.textContent.toLowerCase().includes('add a note') || 
              m.textContent.toLowerCase().includes('invitation')) {
            return true;
          }
        }
        return false;
      })()
    `);
  }
  console.error(`   📝 Modal appeared: ${hasModal}`);
  
  if (hasModal) {
    // For non-Premium: MUST click "Send without a note" button
    // The modal says "Add a note to your invitation?" with two buttons:
    // - "Add a note" (for Premium)
    // - "Send without a note" (for everyone - THIS IS REQUIRED)
    console.error(`   📝 Looking for 'Send without a note' button...`);
    
    // Wait for modal to fully render
    await sleep(1500);
    
    // Find and click "Send without a note" button - MUST succeed before continuing
    let sendClicked = false;
    let attempts = 0;
    
    while (!sendClicked && attempts < 5) {
      attempts++;
      
      const sendResult = await evaluate(ws, `
        (function() {
          // Try multiple selectors for the INVITE modal specifically (not video player dialogs)
          const dialog = document.querySelector('.artdeco-modal.send-invite') ||
                         document.querySelector('.artdeco-modal[aria-labelledby*="invite"]') ||
                         document.querySelector('[role="dialog"].send-invite') ||
                         document.querySelector('[data-test-modal]') ||
                         document.querySelector('.artdeco-modal');
          
          if (!dialog) {
            // Maybe modal closed automatically (some profiles)
            return 'no_dialog';
          }
          
          // CRITICAL: Only search buttons INSIDE the artdeco modal, not whole page
          const dialogBtns = dialog.querySelectorAll('button');
          const btnInfo = [];
          
          // First pass: exact match for "Send without a note"
          for (const btn of dialogBtns) {
            const text = btn.textContent.trim();
            const ariaLabel = btn.getAttribute('aria-label') || '';
            btnInfo.push(text.slice(0, 40));
            
            // Match "Send without a note" (case insensitive)
            if (text.toLowerCase().includes('without a note') || 
                text.toLowerCase() === 'send without a note' ||
                ariaLabel.toLowerCase().includes('without a note')) {
              btn.scrollIntoView({ behavior: 'instant', block: 'center' });
              btn.focus();
              btn.click();
              return 'clicked:' + text;
            }
          }
          
          // Second pass: look for standalone "Send" button (not "Add a note")
          for (const btn of dialogBtns) {
            const text = btn.textContent.trim().toLowerCase();
            if (text === 'send' || (text.includes('send') && !text.includes('add'))) {
              btn.scrollIntoView({ behavior: 'instant', block: 'center' });
              btn.focus();
              btn.click();
              return 'clicked_fallback:' + text;
            }
          }
          
          // Third pass: Look for action buttons in modal footer
          const modalFooter = dialog.querySelector('.artdeco-modal__actionbar') || 
                             dialog.querySelector('[class*="action"]');
          if (modalFooter) {
            const footerBtns = modalFooter.querySelectorAll('button');
            for (const btn of footerBtns) {
              const text = btn.textContent.trim().toLowerCase();
              // Click the secondary/dismiss action which sends without note
              if (text.includes('send') || text.includes('without')) {
                btn.click();
                return 'clicked_footer:' + text;
              }
            }
          }
          
          // Fourth pass: If buttons are outside dialog but in an overlay
          const overlay = document.querySelector('.artdeco-modal-overlay');
          if (overlay) {
            const overlayBtns = overlay.querySelectorAll('button');
            for (const btn of overlayBtns) {
              const text = btn.textContent.trim().toLowerCase();
              if (text.includes('without a note') || text === 'send without a note') {
                btn.click();
                return 'clicked_overlay:' + text;
              }
            }
          }
          
          return 'not_found:' + (btnInfo.length > 0 ? btnInfo.join('|') : 'no_buttons_in_dialog');
        })()
      `);
      
      console.error(`   📤 Attempt ${attempts}: ${sendResult}`);
      
      if (sendResult.startsWith('clicked') || sendResult === 'no_dialog') {
        sendClicked = true;
      } else if (attempts >= 2 && sendResult.startsWith('not_found')) {
        // Debug: log full dialog HTML to understand structure
        const dialogDebug = await evaluate(ws, `
          (function() {
            const d = document.querySelector('[role="dialog"]');
            if (!d) return 'NO_DIALOG_FOUND';
            const btns = d.querySelectorAll('button');
            const btnTexts = Array.from(btns).map(b => b.textContent.trim().slice(0, 50));
            return 'Dialog buttons: [' + btnTexts.join('] [') + ']';
          })()
        `);
        console.error(`   🔍 Debug: ${dialogDebug}`);
        await sleep(1000);
      } else {
        // Wait and retry
        await sleep(1000);
      }
    }
    
    if (!sendClicked) {
      console.error(`   ⚠️ WARNING: Could not click Send button after ${attempts} attempts`);
      // Last resort: try pressing Enter key to confirm any focused button
      await cdpSend(ws, "Input.dispatchKeyEvent", {
        type: "keyDown", key: "Enter", code: "Enter", nativeVirtualKeyCode: 13
      });
      await cdpSend(ws, "Input.dispatchKeyEvent", {
        type: "keyUp", key: "Enter", code: "Enter", nativeVirtualKeyCode: 13
      });
      await sleep(1000);
    }
    
    // Wait for the click to process
    await sleep(1500);
  }
  
  // Wait for action to complete
  await sleep(2000);
  
  // Check for weekly limit
  const hitLimit = await evaluate(ws, `
    document.body.innerText.toLowerCase().includes('weekly invitation limit') ||
    document.body.innerText.toLowerCase().includes("can't send invitations")
  `);
  
  if (hitLimit) {
    return { status: 'weekly_limit', message: 'Weekly invitation limit reached' };
  }
  
  // Verify connection was sent - wait for confirmation
  let verified = false;
  let verifyAttempts = 0;
  
  while (!verified && verifyAttempts < 3) {
    verifyAttempts++;
    
    const verifyStatus = await evaluate(ws, `
      (function() {
        // Modal should be gone
        const modal = document.querySelector('[role="dialog"]');
        if (modal) {
          const modalText = modal.textContent.toLowerCase();
          if (modalText.includes('add a note') || modalText.includes('connect')) {
            return 'modal_still_open';
          }
        }
        
        // Check for success toast "Invitation sent"
        const toast = document.body.innerText;
        if (toast.includes('Invitation sent')) {
          return 'sent_confirmed';
        }
        
        // Check if button changed to Pending
        const pendingBtn = document.querySelector('button[aria-label*="Pending"]') ||
                          Array.from(document.querySelectorAll('button')).find(b => 
                            b.textContent.trim() === 'Pending');
        if (pendingBtn) {
          return 'sent_pending';
        }
        
        // Check body text for Pending
        if (toast.includes('Pending')) {
          return 'sent_pending';
        }
        
        return 'unknown';
      })()
    `);
    
    console.error(`   ✓ Verify attempt ${verifyAttempts}: ${verifyStatus}`);
    
    if (verifyStatus === 'sent_confirmed' || verifyStatus === 'sent_pending') {
      verified = true;
      return { status: 'sent', message: 'Connection request sent and verified' };
    } else if (verifyStatus === 'modal_still_open') {
      // Try clicking Send again
      await evaluate(ws, `
        (function() {
          const btns = document.querySelectorAll('button');
          for (const btn of btns) {
            if (btn.textContent.toLowerCase().includes('without a note')) {
              btn.click();
              return;
            }
          }
        })()
      `);
      await sleep(1500);
    } else {
      await sleep(1000);
    }
  }
  
  // If we get here, assume it worked (some profiles may not show Pending immediately)
  console.error(`   ⚠️ Could not fully verify, assuming sent`);
  return { status: 'sent', message: 'Connection request sent (unverified)' };
}

// --- Main ---
async function main() {
  console.error("🔗 LinkedIn Batch Connect (v2)");
  console.error("=".repeat(50));
  console.error(`📅 ${new Date().toISOString()}`);
  if (campaignFilter) console.error(`🎯 Campaign: ${campaignFilter}`);
  console.error(`📊 Limit: ${limit}`);
  console.error(`⏱️  Delay: ${delayMin}-${delayMax}s`);
  if (dryRun) console.error("🏃 DRY RUN MODE");
  
  const pool = await getDbClient();
  const leads = await getUncontactedLeads(pool, campaignFilter, limit);
  
  console.error(`\n👥 Found ${leads.length} uncontacted leads`);
  for (const l of leads) {
    console.error(`   👤 ${l.full_name || l.public_identifier} | ${(l.headline || '').slice(0, 40)}...`);
  }
  
  if (leads.length === 0) {
    console.error("\n✅ No leads to contact");
    console.log(JSON.stringify({ sent: 0, skipped: 0, errors: 0 }));
    await pool.end();
    return;
  }
  
  if (dryRun) {
    console.error("\n🏃 DRY RUN — not sending requests");
    console.log(JSON.stringify({
      dryRun: true,
      wouldSend: leads.length,
      leads: leads.map(l => ({ name: l.full_name, url: l.linkedin_url }))
    }));
    await pool.end();
    return;
  }
  
  // Connect to Chrome CDP
  console.error("\n🌐 Connecting to Chrome...");
  const targets = await fetchJSON(`${CDP_BASE}/json`);
  const linkedinTab = targets.find(t => t.url?.includes("linkedin.com/feed") || t.url?.includes("linkedin.com/in/"));
  
  if (!linkedinTab) {
    console.error("❌ No LinkedIn tab found. Please open linkedin.com/feed first.");
    await pool.end();
    process.exit(1);
  }
  
  const ws = new WebSocket(linkedinTab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  
  console.error(`   ✅ Connected to: ${linkedinTab.url}`);
  
  // Enable Page events
  await cdpSend(ws, "Page.enable");
  
  let sent = 0, skipped = 0, errors = 0;
  let hitWeeklyLimit = false;
  
  for (const lead of leads) {
    const name = lead.full_name || lead.public_identifier;
    console.error(`\n📤 ${name}...`);
    
    try {
      const result = await sendConnectionRequest(ws, lead);
      
      if (result.status === 'sent') {
        sent++;
        console.error(`   ✅ SENT`);
        await markConnectionSent(pool, lead.id, true);
      } else if (result.status === 'weekly_limit') {
        console.error(`   🛑 Weekly limit reached! Stopping.`);
        hitWeeklyLimit = true;
        break;
      } else if (result.status === 'already_connected' || result.status === 'pending') {
        skipped++;
        console.error(`   ⏭️  ${result.message}`);
        await markConnectionSent(pool, lead.id, false, result.message, true);
      } else {
        skipped++;
        console.error(`   ⚠️  ${result.message}`);
        await markConnectionSent(pool, lead.id, false, result.message, true);
      }
    } catch (e) {
      errors++;
      console.error(`   ❌ Error: ${e.message}`);
      await markConnectionSent(pool, lead.id, false, e.message);
    }
    
    if (!hitWeeklyLimit && leads.indexOf(lead) < leads.length - 1) {
      const delay = randomDelay();
      console.error(`   ⏳ Waiting ${(delay/1000).toFixed(0)}s...`);
      await sleep(delay);
    }
  }
  
  ws.close();
  await pool.end();
  
  console.error(`\n✅ Done: ${sent} sent, ${skipped} skipped, ${errors} errors`);
  console.log(JSON.stringify({ sent, skipped, errors, hitWeeklyLimit }));
}

main().catch(e => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
