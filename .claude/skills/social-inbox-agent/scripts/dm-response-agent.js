#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '..', '.env') });
/**
 * Social Inbox DM Response Agent
 * 
 * Responds to inbound DMs across all platforms via Late API.
 * Uses PostgreSQL (social_inbox table) as the single source of truth for
 * message tracking — prevents double-messaging, self-reply loops, and spam.
 *
 * Safety guarantees:
 *   1. ONE reply per conversation per run (even if multiple unreplied messages)
 *   2. NEVER double-message (if last message is ours → skip)
 *   3. NEVER reply to own messages (DB tracks all outgoing)
 *   4. Spam ratio guard (skip if our msgs > 2x theirs and > 3 total)
 *   5. All decisions persisted in PostgreSQL (survives restarts/isolated crons)
 *
 * Usage:
 *   node dm-response-agent.js [--dry-run] [--limit N] [--platform PLATFORM]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { Pool } = require('pg');

// ============================================================================
// Config
// ============================================================================

const LATE_API_KEY = process.env.LATE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DATABASE_URL = process.env.INSFORGE_CONNECTION_STRING || process.env.DATABASE_URL;
const LATE_BASE_URL = 'https://zernio.com/api/v1';
const ROOT_DIR = path.join(__dirname, '..', '..', '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 20;
const platformFilter = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : null;

const pool = new Pool({ connectionString: DATABASE_URL });

// ============================================================================
// Database Operations
// ============================================================================

/** Store an incoming message. ON CONFLICT = already tracked, skip. */
async function dbTrackIncoming(msg, conversationId, platform) {
  await pool.query(
    `INSERT INTO social_inbox
       (id, late_conversation_id, late_message_id, platform, sender_name, sender_id,
        message_text, direction, replied, raw_payload, received_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'incoming', false, $7, $8, NOW(), NOW())
     ON CONFLICT (late_message_id) DO NOTHING`,
    [
      conversationId, msg.id, platform,
      msg.senderName || 'Unknown', msg.senderId || null,
      msg.message || msg.text || '',
      JSON.stringify(msg),
      msg.createdAt ? new Date(msg.createdAt) : new Date(),
    ]
  );
}

/** Store an outgoing reply AND mark the incoming message as replied (atomic). */
async function dbTrackReply(conversationId, platform, replyText, incomingMsgId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO social_inbox
         (id, late_conversation_id, late_message_id, platform, sender_name,
          message_text, direction, replied, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'self', $4, 'outgoing', false, NOW(), NOW())
       ON CONFLICT (late_message_id) DO NOTHING`,
      [conversationId, 'reply-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8), platform, replyText]
    );
    if (incomingMsgId) {
      await client.query(
        `UPDATE social_inbox SET replied = true, replied_at = NOW(), reply_text = $1, updated_at = NOW()
         WHERE late_message_id = $2`,
        [replyText, incomingMsgId]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Mark a message as skipped so we don't retry it. */
async function dbMarkSkipped(lateMessageId) {
  await pool.query(
    `UPDATE social_inbox SET replied = true, replied_at = NOW(), reply_text = '[SKIPPED]', updated_at = NOW()
     WHERE late_message_id = $1`,
    [lateMessageId]
  );
}

/** Check if a message is already replied to in the DB. */
async function dbIsReplied(lateMessageId) {
  const r = await pool.query(
    'SELECT replied FROM social_inbox WHERE late_message_id = $1', [lateMessageId]
  );
  return r.rows.length > 0 && r.rows[0].replied === true;
}

/** Check if a text matches one of our outgoing messages for this conversation. */
async function dbIsOurMessage(conversationId, messageText) {
  const r = await pool.query(
    `SELECT id FROM social_inbox
     WHERE late_conversation_id = $1 AND direction = 'outgoing' AND message_text = $2
     LIMIT 1`,
    [conversationId, messageText]
  );
  return r.rows.length > 0;
}

/** Get outgoing vs incoming counts for spam ratio check. */
async function dbGetRatio(conversationId) {
  const r = await pool.query(
    `SELECT direction, COUNT(*)::int as cnt FROM social_inbox
     WHERE late_conversation_id = $1 GROUP BY direction`,
    [conversationId]
  );
  const counts = { incoming: 0, outgoing: 0 };
  r.rows.forEach(row => { counts[row.direction] = row.cnt; });
  return counts;
}

// ============================================================================
// Load Creator Context from onboarding-config.json
// ============================================================================

function loadCreatorContext() {
  const configPath = path.join(ROOT_DIR, 'onboarding-config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const p1 = config.phase1 || {};
    const p2 = config.phase2 || {};
    const platforms = {};
    if (p2.platforms) {
      for (const [plat, info] of Object.entries(p2.platforms)) {
        if (info.late_id) platforms[plat] = info.late_id;
      }
    }
    return {
      brandName:        (p1.brand_name || '').trim(),
      brandUrl:         (p1.brand_url || '').trim(),
      brandDescription: (p1.brand_description || '').trim(),
      targetAudience:   (p1.target_audience || '').trim(),
      personaName:      (p1.persona_name || p1.brand_name || '').trim(),
      personaBackstory: (p1.persona_backstory || '').trim(),
      voice:            (p1.voice_description || '').trim(),
      primaryCta:       (p1.primary_cta || '').trim(),
      linksOffers:      p1.links_offers || [],
      platforms,
    };
  } catch {
    return {
      brandName: '', brandUrl: '', brandDescription: '',
      targetAudience: '', personaName: 'the persona', personaBackstory: '',
      voice: 'Direct, friendly, authentic.', primaryCta: '', linksOffers: [], platforms: {},
    };
  }
}

// ============================================================================
// HTTP Helper
// ============================================================================

function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const req = mod.request(parsed, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.setTimeout(options.timeout || 30000, () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

// ============================================================================
// Late API Wrappers
// ============================================================================

async function lateGetConversations() {
  const res = await fetchJSON(`${LATE_BASE_URL}/inbox/conversations`, {
    headers: { 'Authorization': `Bearer ${LATE_API_KEY}` },
  });
  if (res.status !== 200) {
    console.error(`  ❌ Failed to get conversations (${res.status})`);
    return [];
  }
  return res.data?.data || [];
}

async function lateGetMessages(conversationId, accountId) {
  const res = await fetchJSON(
    `${LATE_BASE_URL}/inbox/conversations/${encodeURIComponent(conversationId)}/messages?accountId=${encodeURIComponent(accountId)}`,
    { headers: { 'Authorization': `Bearer ${LATE_API_KEY}` } }
  );
  if (res.status !== 200) {
    console.error(`  ❌ Failed to get messages (${res.status})`);
    return [];
  }
  return res.data?.messages || [];
}

async function lateSendReply(conversationId, message, accountId) {
  const res = await fetchJSON(
    `${LATE_BASE_URL}/inbox/conversations/${encodeURIComponent(conversationId)}/messages?accountId=${encodeURIComponent(accountId)}`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${LATE_API_KEY}`, 'Content-Type': 'application/json' },
      body: { message, accountId },
    }
  );
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Reply failed (${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
  }
  return res.data;
}

// ============================================================================
// Gemini Reply Generation
// ============================================================================

async function generateReply(message, senderName, platform, conversationHistory) {
  const ctx = loadCreatorContext();

  const historyText = conversationHistory.map(m => {
    return m.isFromOwner ? `${ctx.personaName}: ${m.text}` : `${senderName}: ${m.text}`;
  }).join('\n');

  const prompt = `You are ${ctx.personaName}, responding to a DM on ${platform}.

ABOUT YOU:
${ctx.personaBackstory ? `- ${ctx.personaBackstory}` : ''}
${ctx.brandDescription ? `- Brand: ${ctx.brandDescription}` : ''}
${ctx.brandUrl ? `- URL: ${ctx.brandUrl}` : ''}
${ctx.targetAudience ? `- Target audience: ${ctx.targetAudience}` : ''}
- Voice: ${ctx.voice || 'Direct, friendly, authentic.'}
${ctx.primaryCta ? `- Primary CTA: ${ctx.primaryCta}` : ''}
${ctx.linksOffers?.length ? `
YOUR LINKS (use these EXACT URLs when relevant):
${ctx.linksOffers.map(l => `- ${l.name}: ${l.url}${l.when ? ` (${l.when})` : ''}`).join('\n')}
` : ''}
HELP RESOURCES (always available, share the exact URL):
- Creator OS YouTube channel (official tutorials + feature walkthroughs): https://www.youtube.com/@Creator_oss
- KevBuildsApps YouTube channel (the founder's channel: AI agent deep dives + workflows): https://www.youtube.com/@KevBuildsApps

CONVERSATION RULES:
- If they have setup questions, questions about the AI agents, or are looking for workflows to implement in Creator OS: give the quick answer inline, then direct them to the YouTube channels above for the full walkthrough (pick whichever fits — Creator OS for setup/tutorials, KevBuildsApps for agent deep dives and workflows)
- Respond like a real human texting — casual, warm, authentic
- Keep it short: 1-3 sentences max for simple messages, up to 5 for detailed questions
- No markdown formatting (no **, no #, no bullets). This is a DM, not a document.
- No emoji overload — max 1-2 per message, and only if natural
- Answer their question FIRST, then naturally guide toward your offer if relevant
- Don't be salesy or pushy. Be genuinely helpful.
- If they're clearly a potential customer/lead, mention your offer organically
- If it's just casual chat, be human — don't force a pitch
- When sharing links, use the EXACT URLs from "YOUR LINKS" above — never use placeholder text like [link]
- If someone asks for a link or booking, give them the actual URL immediately
- Never say "as an AI" or break character
- If the message is just an emoji or seems low-effort, reply with [SKIP] to skip

${historyText ? `CONVERSATION SO FAR:\n${historyText}\n` : ''}
NEW MESSAGE FROM ${senderName}: "${message}"

Reply as ${ctx.personaName} (just the reply text, or [SKIP] to not reply):`;

  const res = await fetchJSON(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 500 },
      }),
    }
  );

  const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini error: ${JSON.stringify(res.data)}`);
  return text.trim();
}

// ============================================================================
// Core: Determine the newest incoming message that needs a reply
// Returns { msg, context } or null if nothing to reply to
// ============================================================================

async function findMessageToReply(conversation, messages) {
  const conversationId = conversation.id;
  const senderName = conversation.participantName || 'Unknown';
  const platform = conversation.platform;
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;

  // Step 1: Sync all visible incoming messages to DB
  for (const m of messages) {
    if (m.direction === 'incoming') {
      const t = m.createdAt ? new Date(m.createdAt).getTime() : 0;
      if (t >= cutoff) await dbTrackIncoming(m, conversationId, platform);
    }
  }

  // Step 2: Determine the TRUE last message in the conversation.
  //   The messages endpoint may be capped (e.g., 100 msgs). If the conversation
  //   was updated after the last visible message, there's a newer message beyond
  //   the pagination window. We use conversation.lastMessage to detect this.
  const lastVisible = messages[messages.length - 1];
  const lastVisibleTime = lastVisible?.createdAt ? new Date(lastVisible.createdAt).getTime() : 0;
  const convoUpdatedTime = conversation.updatedTime ? new Date(conversation.updatedTime).getTime() : 0;
  const convoLastMsg = (conversation.lastMessage || '').trim();

  const hasMsgBeyondPagination = convoUpdatedTime > lastVisibleTime + 30000 && convoLastMsg;

  // Step 3: Is the true last message ours? → skip (never double-message)
  if (hasMsgBeyondPagination) {
    // The true last message is beyond pagination. Check if it's ours via DB.
    if (await dbIsOurMessage(conversationId, convoLastMsg)) {
      return { skip: true, reason: 'Last msg beyond pagination is our own reply' };
    }
    // It's an incoming message we can't see in the API. Create a synthetic record.
    // Use a hash of the message text (not updatedTime) as the dedup key so that
    // repeated cron runs with the same lastMessage don't create new synthetic IDs.
    const syntheticId = `convo-last-${conversationId}-${Buffer.from(convoLastMsg).toString('base64url').slice(0, 40)}`;
    const syntheticMsg = {
      id: syntheticId,
      message: convoLastMsg,
      senderName, senderId: conversation.participantId,
      direction: 'incoming', createdAt: conversation.updatedTime,
    };
    await dbTrackIncoming(syntheticMsg, conversationId, platform);

    if (await dbIsReplied(syntheticId)) {
      return { skip: true, reason: 'Already replied to latest (beyond pagination)' };
    }

    // Build context from last 10 visible messages + the new one
    const context = messages.slice(-10).map(m => ({
      text: m.message || m.text || '', isFromOwner: m.direction === 'outgoing',
    }));
    context.push({ text: convoLastMsg, isFromOwner: false });

    return { msg: syntheticMsg, context, msgText: convoLastMsg };
  }

  // Normal path: last message is visible in the API
  if (lastVisible && lastVisible.direction === 'outgoing') {
    return { skip: true, reason: 'Last msg is ours, no double-message' };
  }

  // Step 4: Find unreplied incoming messages within the 48h window
  const unreplied = [];
  for (const m of messages) {
    if (m.direction !== 'incoming') continue;
    const text = (m.message || m.text || '').trim();
    if (!text) continue;
    const t = m.createdAt ? new Date(m.createdAt).getTime() : 0;
    if (t < cutoff) continue;
    if (await dbIsReplied(m.id)) continue;
    unreplied.push(m);
  }

  if (!unreplied.length) return { skip: true, reason: 'No unreplied messages' };

  // Reply to the LATEST unreplied message only
  const latest = unreplied[unreplied.length - 1];
  const context = messages.slice(-10).map(m => ({
    text: m.message || m.text || '', isFromOwner: m.direction === 'outgoing',
  }));

  return { msg: latest, context, msgText: latest.message || latest.text || '' };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  if (!LATE_API_KEY) throw new Error('LATE_API_KEY not set');
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  if (!DATABASE_URL) throw new Error('DATABASE_URL not set');

  const ctx = loadCreatorContext();
  console.log(`\n💬 DM Response Agent (DB-tracked)`);
  console.log(`Persona: ${ctx.personaName}`);
  if (platformFilter) console.log(`Platform filter: ${platformFilter}`);
  if (dryRun) console.log('🏃 DRY RUN MODE\n');

  let totalReplied = 0, totalSkipped = 0, totalFailed = 0, processed = 0;

  const conversations = await lateGetConversations();
  if (!conversations.length) { console.log('No conversations found.'); await pool.end(); return; }
  console.log(`Found ${conversations.length} conversation(s)\n`);

  for (const conversation of conversations) {
    if (processed >= limit) break;
    const { platform, id: conversationId, participantName: senderName, accountId } = conversation;
    if (platformFilter && platform !== platformFilter) continue;
    if (!accountId) continue;

    // Fetch messages with timeout
    let messages;
    try {
      messages = await Promise.race([
        lateGetMessages(conversationId, accountId),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 15000)),
      ]);
    } catch (e) {
      console.log(`  ⚠️ ${platform}/${senderName} — ${e.message}, skipping`);
      continue;
    }
    if (!messages.length) continue;

    // Determine what to reply to (or skip)
    const result = await findMessageToReply(conversation, messages);

    if (result.skip) {
      console.log(`  ⏭ ${platform}/${senderName} — ${result.reason}`);
      continue;
    }

    // Safety: spam ratio check
    const ratio = await dbGetRatio(conversationId);
    if (ratio.outgoing > 3 && ratio.outgoing > ratio.incoming * 2) {
      console.log(`  ⏭ ${platform}/${senderName} — Spam ratio (${ratio.outgoing} out vs ${ratio.incoming} in)`);
      continue;
    }

    processed++;
    const { msg, context, msgText } = result;
    console.log(`  💬 ${platform}/${senderName}: "${msgText.slice(0, 80)}"`);

    try {
      const replyText = await generateReply(msgText, senderName || 'Unknown', platform, context);

      if (replyText === '[SKIP]' || replyText.includes('[SKIP]')) {
        console.log(`     ⏭ Skipped by AI`);
        await dbMarkSkipped(msg.id);
        totalSkipped++;
        continue;
      }

      console.log(`     → "${replyText}"`);

      if (dryRun) {
        console.log(`     [DRY RUN] Not sending`);
        continue;
      }

      await lateSendReply(conversationId, replyText, accountId);
      await dbTrackReply(conversationId, platform, replyText, msg.id);
      console.log(`     ✅ Sent & tracked`);
      totalReplied++;

      // Rate limit between replies
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.error(`     ❌ ${e.message}`);
      totalFailed++;
    }
  }

  await pool.end();
  console.log(`\n=== DONE: ${totalReplied} replied, ${totalSkipped} skipped, ${totalFailed} failed ===`);
  process.exit(0);
}

main().catch(async e => {
  console.error(`Fatal: ${e.message}`);
  try { await pool.end(); } catch {}
  process.exit(1);
});
