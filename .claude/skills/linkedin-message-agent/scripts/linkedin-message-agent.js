#!/usr/bin/env node
/**
 * linkedin-message-agent.js — Check LinkedIn inbox, read unread messages, respond via CDP.
 *
 * Flow:
 *   1. Open LinkedIn Messaging
 *   2. Find unread conversations
 *   3. Open each, read context, generate response, send
 *   4. Log to database
 *
 * Usage:
 *   node linkedin-message-agent.js
 *   node linkedin-message-agent.js --dry-run
 *   node linkedin-message-agent.js --limit 5
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const WebSocket = require("ws");
const { execSync } = require("child_process");

// --- Args ---
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}
function hasFlag(name) { return args.includes(name); }

const dryRun = hasFlag("--dry-run");
const limit = parseInt(getArg("--limit") || "10", 10);
const cdpPort = getArg("--cdp-port") || "18800";
const CDP_BASE = `http://127.0.0.1:${cdpPort}`;

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

async function logMessage(db, { conversationId, senderName, senderUsername, content, direction, receivedAt }) {
  if (!db) return;
  try {
    await db.query(`
      INSERT INTO social_messages (platform, conversation_id, sender_name, sender_username, content, direction, is_read, received_at, created_at, updated_at)
      VALUES ('linkedin', $1, $2, $3, $4, $5, true, $6, NOW(), NOW())
    `, [conversationId, senderName, senderUsername || null, content, direction, receivedAt || new Date()]);
  } catch (e) {
    console.error(`   ⚠️ DB log failed: ${e.message}`);
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

// --- Generate AI response ---
function generateResponse(senderName, lastMessages, conversationContext) {
  // Analyze the conversation to generate a contextual response
  // We'll use simple heuristic-based responses since we can't call Claude from within this script
  // The cron job wrapper (agent turn) will handle complex AI generation
  
  const lastMsg = lastMessages[lastMessages.length - 1];
  if (!lastMsg) return null;
  
  const msgLower = lastMsg.content.toLowerCase();
  // Extract a reasonable first name
  let firstName = senderName.split(' ')[0];
  if (firstName === 'The' || firstName === 'LinkedIn') firstName = 'there';
  
  // Skip automated/spam messages
  // Skip LinkedIn system messages
  if (senderName.toLowerCase().includes('linkedin team') || senderName.toLowerCase() === 'linkedin') {
    return { skip: true, reason: 'LinkedIn system message' };
  }
  
  const spamPatterns = [
    'i noticed you viewed my profile',
    'congratulations on your new',
    'i want to offer you',
    'buy now', 'limited time', 'click here',
    'unsubscribe', 'opt out',
    'i am writing to inform',
    'dear sir', 'dear madam',
    'we have a great opportunity',
    'welcome to linkedin',
  ];
  if (spamPatterns.some(p => msgLower.includes(p))) {
    return { skip: true, reason: 'spam/automated' };
  }
  
  // Skip if the last message is from us (already responded)
  if (lastMsg.isFromMe) {
    return { skip: true, reason: 'already responded' };
  }
  
  // Connection acceptance messages
  if (msgLower.includes('accepted your invitation') || msgLower.includes('now connected')) {
    return {
      response: `Hey ${firstName}! Thanks for connecting. I'm Kev's Assistant, an AI employee at CreatorOS — we build AI automation for businesses. Would love to hear what you're working on. What's keeping you busy these days?`
    };
  }
  
  // Greetings
  if (/^(hey|hi|hello|what'?s up|howdy|sup)\b/i.test(msgLower)) {
    return {
      response: `Hey ${firstName}! Good to hear from you. I'm Kev's Assistant from CreatorOS — we help businesses automate with AI agents. What brings you to my inbox?`
    };
  }
  
  // Questions about what we do / services
  if (msgLower.includes('what do you do') || msgLower.includes('what does') || msgLower.includes('tell me about') || msgLower.includes('your company') || msgLower.includes('your services') || msgLower.includes('creatoros')) {
    return {
      response: `Great question! CreatorOS builds AI employees for businesses — think of us as your always-on team member that handles social media, lead gen, outreach, analytics, and more. We're essentially replacing entire workflow stacks with a single AI agent. Happy to share more if you're curious about a specific use case!`
    };
  }
  
  // Meeting/call requests
  if (msgLower.includes('meet') || msgLower.includes('call') || msgLower.includes('schedule') || msgLower.includes('zoom') || msgLower.includes('chat') || msgLower.includes('coffee')) {
    return {
      response: `Appreciate the interest, ${firstName}! I'd love to connect you with Kevin, our founder — he handles all partnerships and demos directly. Would that work for you?`
    };
  }
  
  // Job/hiring related
  if (msgLower.includes('hiring') || msgLower.includes('job') || msgLower.includes('position') || msgLower.includes('opportunity') || msgLower.includes('role') || msgLower.includes('recruit')) {
    return {
      response: `Thanks for reaching out, ${firstName}! We're a lean AI-first team right now. Our founder Kevin handles all hiring decisions — I can pass along your info if you'd like?`
    };
  }
  
  // Investment/funding
  if (msgLower.includes('invest') || msgLower.includes('funding') || msgLower.includes('raise') || msgLower.includes('capital') || msgLower.includes('vc') || msgLower.includes('angel')) {
    return {
      response: `Appreciate you reaching out about investment, ${firstName}! I'll flag this for Kevin, our founder — he handles all fundraising conversations directly. Can I connect you two?`
    };
  }
  
  // Default conversational response
  return {
    response: `Hey ${firstName}, thanks for the message! I'm Kev's Assistant, an AI employee at CreatorOS. ${lastMsg.content.length > 100 ? "Interesting stuff." : "What can I help you with?"} Feel free to ask me anything about AI automation or what we're building.`
  };
}

// --- Main workflow ---
async function run() {
  await ensureBrowser();

  const targets = await (await fetch(`${CDP_BASE}/json`)).json();
  let target = targets.find(t => t.type === "page" && t.url.includes("linkedin.com"));
  if (!target) {
    target = await (await fetch(`${CDP_BASE}/json/new?${encodeURIComponent("https://www.linkedin.com/messaging/")}`, { method: "PUT" })).json();
    await sleep(4000);
  }

  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) { console.error("No WebSocket URL."); process.exit(1); }

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });
  await cdpSend(ws, "DOM.enable");
  await cdpSend(ws, "Page.enable");

  // Navigate away from messaging first to clear any active conversation
  console.error("\n🔄 Clearing active conversations...");
  await cdpSend(ws, "Page.navigate", { url: "https://www.linkedin.com/feed/" });
  await sleep(3000);

  // Now navigate to messaging fresh
  console.error("📬 Opening LinkedIn Messaging...");
  await cdpSend(ws, "Page.navigate", { url: "https://www.linkedin.com/messaging/" });
  await sleep(5000);

  // Check if logged in
  const currentUrl = await evaluate(ws, "window.location.href");
  if (currentUrl.includes("/login") || currentUrl.includes("/authwall")) {
    console.error("❌ Not logged in. Aborting.");
    ws.close();
    process.exit(1);
  }

  // Click the "Unread" filter tab to show only unread conversations
  console.error("🔍 Clicking Unread filter...");
  await evaluate(ws, `(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const unreadBtn = buttons.find(b => b.textContent.trim() === 'Unread');
    if (unreadBtn) { unreadBtn.click(); return true; }
    return false;
  })()`);
  await sleep(3000);

  // Scroll the conversation list to load more
  await evaluate(ws, `(() => {
    const list = document.querySelector('.msg-conversations-container__conversations-list, .msg-overlay-list-bubble');
    if (list) list.scrollTop = 0;
  })()`);
  await sleep(2000);

  // Find unread conversations (now filtered by LinkedIn's Unread tab)
  console.error("📨 Scanning conversation list...");
  const conversations = await evaluate(ws, `(() => {
    const items = document.querySelectorAll('.msg-conversation-listitem, li.msg-conversation-listitem, li[class*="msg-conversation"]');
    const convos = [];
    
    for (const item of items) {
      // Get name
      const nameEl = item.querySelector('h3, .msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names');
      const name = nameEl ? nameEl.textContent.trim() : 'Unknown';
      
      // Get preview
      const previewEl = item.querySelector('p, .msg-conversation-card__message-snippet, .msg-conversation-listitem__message-snippet');
      const preview = previewEl ? previewEl.textContent.trim() : '';
      
      // Get time
      const timeEl = item.querySelector('time, .msg-conversation-card__time-stamp');
      const time = timeEl ? timeEl.textContent.trim() : '';
      
      if (name && name !== 'Unknown') {
        convos.push({ name, preview, time, index: convos.length });
      }
    }
    return convos;
  })()`);

  if (!conversations || conversations.length === 0) {
    console.error("✅ No unread messages found.");
    const output = { checked: true, unread: 0, responded: 0, skipped: 0, errors: 0 };
    console.log(JSON.stringify(output));
    ws.close();
    process.exit(0);
  }

  console.error(`📨 Found ${conversations.length} unread conversation(s)`);
  const toProcess = conversations.slice(0, limit);

  // Connect to DB
  let db = null;
  if (process.env.DATABASE_URL) {
    try {
      db = await getDbClient();
    } catch (e) {
      console.error(`   ⚠️ DB connection failed: ${e.message}`);
    }
  }

  const results = { checked: true, unread: conversations.length, responded: 0, skipped: 0, errors: 0, details: [] };

  for (let i = 0; i < toProcess.length; i++) {
    const convo = toProcess[i];
    console.error(`\n[${i + 1}/${toProcess.length}] ${convo.name} — "${convo.preview.substring(0, 60)}..."`);

    try {
      // Click into the conversation (we're already on the Unread tab, so all items are unread)
      const clicked = await evaluate(ws, `(() => {
        const items = document.querySelectorAll('.msg-conversation-listitem, li.msg-conversation-listitem, li[class*="msg-conversation"]');
        if (items[${i}]) {
          items[${i}].click();
          return true;
        }
        return false;
      })()`);

      if (!clicked) {
        console.error("   ❌ Could not click conversation");
        results.errors++;
        continue;
      }

      await sleep(3000);

      // Read the last messages in the conversation
      const messages = await evaluate(ws, `(() => {
        const msgElements = document.querySelectorAll('.msg-s-event-listitem, .msg-s-message-list-content .msg-s-event-listitem__message-event, li.msg-s-message-list__event');
        const msgs = [];
        
        // Get last 5 messages for context
        const recent = Array.from(msgElements).slice(-5);
        
        for (const el of recent) {
          const senderEl = el.querySelector('.msg-s-message-group__name, .msg-s-event-listitem__name, span.msg-s-message-group__name');
          const sender = senderEl ? senderEl.textContent.trim() : '';
          
          const bodyEl = el.querySelector('.msg-s-event-listitem__body, .msg-s-event__content, p.msg-s-event-listitem__body');
          const body = bodyEl ? bodyEl.textContent.trim() : '';
          
          const timeEl = el.querySelector('.msg-s-message-group__timestamp, time');
          const time = timeEl ? timeEl.textContent.trim() : '';
          
          // Check if from me (Kev's Assistant)
          const isFromMe = sender.toLowerCase().includes("kev's assistant") ||
            el.classList.contains('msg-s-event-listitem--is-from-me') ||
            !!el.querySelector('.msg-s-event-listitem--other');
          
          if (body) {
            msgs.push({ sender, content: body, time, isFromMe });
          }
        }
        return msgs;
      })()`);

      console.error(`   📖 Read ${messages.length} messages`);
      messages.forEach(m => console.error(`      ${m.isFromMe ? '→ ME' : '← THEM'}: "${m.content.substring(0, 80)}..."`));

      // Generate response
      const responseData = generateResponse(convo.name, messages, convo);

      if (responseData.skip) {
        console.error(`   ⏩ Skipping: ${responseData.reason}`);
        results.skipped++;
        results.details.push({ name: convo.name, action: 'skipped', reason: responseData.reason });
        
        // Log inbound message to DB anyway
        if (db && messages.length > 0) {
          const lastInbound = messages.filter(m => !m.isFromMe).pop();
          if (lastInbound) {
            await logMessage(db, {
              conversationId: convo.name,
              senderName: convo.name,
              content: lastInbound.content,
              direction: 'inbound',
            });
          }
        }
        continue;
      }

      if (dryRun) {
        console.error(`   🔍 DRY RUN — Would respond: "${responseData.response.substring(0, 80)}..."`);
        results.skipped++;
        results.details.push({ name: convo.name, action: 'dry_run', response: responseData.response });
        continue;
      }

      // Type and send the response
      console.error(`   💬 Sending: "${responseData.response.substring(0, 80)}..."`);
      
      // Focus the message input
      const focused = await evaluate(ws, `(() => {
        const input = document.querySelector('.msg-form__contenteditable, div[contenteditable="true"].msg-form__contenteditable, .msg-form__msg-content-container div[contenteditable="true"]');
        if (input) {
          input.focus();
          input.click();
          return true;
        }
        return false;
      })()`);

      if (!focused) {
        console.error("   ❌ Could not focus message input");
        results.errors++;
        continue;
      }

      await sleep(500);

      // Type the message using innerHTML injection (same approach as LinkedIn posting)
      const escapedResponse = responseData.response.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
      await evaluate(ws, `(() => {
        const input = document.querySelector('.msg-form__contenteditable, div[contenteditable="true"].msg-form__contenteditable, .msg-form__msg-content-container div[contenteditable="true"]');
        if (!input) return false;
        const p = input.querySelector('p') || input;
        p.innerHTML = \`${escapedResponse}\`;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);

      await sleep(1000);

      // Click send
      const sent = await evaluate(ws, `(() => {
        const sendBtn = document.querySelector('.msg-form__send-button, button[type="submit"].msg-form__send-button, button.msg-form__send-btn');
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
          return true;
        }
        // Try finding by aria-label
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b => b.getAttribute('aria-label')?.toLowerCase().includes('send') && !b.disabled);
        if (btn) { btn.click(); return true; }
        return false;
      })()`);

      if (!sent) {
        // Try pressing Enter as fallback
        await evaluate(ws, `(() => {
          const input = document.querySelector('.msg-form__contenteditable, div[contenteditable="true"]');
          if (input) {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            return true;
          }
          return false;
        })()`);
        await sleep(500);
      }

      await sleep(2000);
      console.error(`   ✅ Responded to ${convo.name}`);
      results.responded++;
      results.details.push({ name: convo.name, action: 'responded', response: responseData.response });

      // Log to DB
      if (db) {
        // Log inbound
        const lastInbound = messages.filter(m => !m.isFromMe).pop();
        if (lastInbound) {
          await logMessage(db, {
            conversationId: convo.name,
            senderName: convo.name,
            content: lastInbound.content,
            direction: 'inbound',
          });
        }
        // Log outbound
        await logMessage(db, {
          conversationId: convo.name,
          senderName: "Kev's Assistant by CreatorOS",
          senderUsername: 'kevsassistantbycreatoros',
          content: responseData.response,
          direction: 'outbound',
        });
      }

    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
      results.errors++;
      results.details.push({ name: convo.name, action: 'error', error: err.message });
    }

    // Delay between conversations
    if (i < toProcess.length - 1) {
      const delay = 5000 + Math.random() * 5000;
      console.error(`   ⏱️ Waiting ${(delay / 1000).toFixed(0)}s...`);
      await sleep(delay);
    }
  }

  // Navigate away from messaging so the browser doesn't auto-read future messages
  console.error("🔄 Navigating away from messaging...");
  await cdpSend(ws, "Page.navigate", { url: "https://www.linkedin.com/feed/" });
  await sleep(2000);

  // Summary
  console.error(`\n📊 Results: ${results.responded} responded, ${results.skipped} skipped, ${results.errors} errors out of ${results.unread} unread`);
  console.log(JSON.stringify({ unread: results.unread, responded: results.responded, skipped: results.skipped, errors: results.errors }));

  if (db) await db.end();
  ws.close();
  process.exit(0);
}

run().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
