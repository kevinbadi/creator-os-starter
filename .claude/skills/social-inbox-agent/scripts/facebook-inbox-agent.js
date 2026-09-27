#!/usr/bin/env node
// Facebook Inbox Agent — responds to inbound Page messages as brand persona
// Uses Gemini for response generation, Late API for sending
//
// Usage: node facebook-inbox-agent.js [--dry-run] [--limit N]

const { Client } = require('pg');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadPersonaContext } = require('../../../lib/persona');

const CONNECTION_STRING = process.env.INSFORGE_CONNECTION_STRING || process.env.DATABASE_URL;
if (!CONNECTION_STRING) { console.error('Error: INSFORGE_CONNECTION_STRING or DATABASE_URL not set'); process.exit(1); }

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const LATE_API_KEY = process.env.LATE_API_KEY;

// Read platform account IDs from SOCIALS.md
function loadAccountIds() {
  const ROOT_DIR = path.join(__dirname, '..', '..', '..');
  const socialsPath = path.join(ROOT_DIR, 'SOCIALS.md');
  const ids = {};

  if (fs.existsSync(socialsPath)) {
    const content = fs.readFileSync(socialsPath, 'utf8');
    const platformNames = ['instagram', 'tiktok', 'facebook', 'twitter', 'youtube'];
    for (const plat of platformNames) {
      const re = new RegExp(`###?\\s*${plat}[\\s\\S]*?Late Account ID[:\\s]*\`?([a-f0-9]{24,})\`?`, 'i');
      const m = content.match(re);
      if (m) ids[plat] = m[1];
    }
  }

  return ids;
}

const PERSONA_ACCOUNT_IDS = loadAccountIds();

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 20;

// ------------------------------------------------------------------
// Persona system prompt for message responses
// ------------------------------------------------------------------

const _persona = loadPersonaContext(path.join(__dirname, '..', '..', '..'));

const PERSONA_SYSTEM_PROMPT = `You are ${_persona.name} — the brand persona for ${_persona.brand}.
${_persona.voice ? `\nVoice guide:\n${_persona.voice}\n` : ''}
YOUR #1 GOAL IN EVERY CONVERSATION: Get them to engage with ${_persona.brand}.

PERSONALITY:
- Warm, authentic, casual — like a friend texting back
- Playful humor, easy going
- Never corporate, never robotic, never copy-paste feeling

CONVERSATION STRATEGY:
Every reply should move the conversation closer to engagement with the brand. Never push it awkwardly — weave it in naturally. Answer their question first, then bridge to the brand.

IF THE PERSON IS A BUSINESS:
- Goal: get them to engage and list their business (it's free)
- No sales pressure — proof over pitch
- Pricing if asked: "Basic listing is free. Boosted visibility is available if you want more reach."

IF THE PERSON IS A TOURIST/VISITOR:
- Be helpful, share recommendations, answer their question
- Then always bridge to the brand
- Make them feel like they're missing out

IF UNCLEAR WHO THEY ARE:
- Be friendly, figure out if they're visiting or local
- Either way, guide them to the brand within 1-2 messages

RULES:
- Keep responses under 300 characters for simple replies, up to 500 for detailed answers
- Use line breaks for readability — this is Messenger, not an essay
- Never use markdown formatting (no **, no #, no bullet points with -)
- Use emojis sparingly and naturally (1-2 per message max)
- Never say "I'm an AI" — you are ${_persona.name}`;

// ------------------------------------------------------------------
// Gemini API call
// ------------------------------------------------------------------

function callGemini(messageText, senderName, conversationHistory) {
  return new Promise((resolve, reject) => {
    const historyContext = conversationHistory.length > 0
      ? `\n\nPREVIOUS MESSAGES IN THIS CONVERSATION:\n${conversationHistory.map(m =>
          `${m.direction === 'inbound' ? senderName : _persona.name}: ${m.message_text}`
        ).join('\n')}`
      : '';

    const userPrompt = `${senderName || 'Someone'} just sent this message to the ${_persona.name} ${_persona.brand} Facebook page:

"${messageText}"${historyContext}

Write ${_persona.name}'s reply. Just the reply text, nothing else.`;

    const body = JSON.stringify({
      contents: [
        { role: 'user', parts: [{ text: PERSONA_SYSTEM_PROMPT + '\n\n' + userPrompt }] }
      ],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 256,
      }
    });

    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`);

    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) resolve(text.trim());
          else reject(new Error('No text in Gemini response: ' + data.slice(0, 200)));
        } catch (e) {
          reject(new Error('Failed to parse Gemini response: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ------------------------------------------------------------------
// Late API — send DM message
// ------------------------------------------------------------------

function sendLateMessage(conversationId, message, platform) {
  const accountId = PERSONA_ACCOUNT_IDS[platform] || PERSONA_ACCOUNT_IDS.facebook;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      accountId,
      message,
    });

    console.log(`  📡 Late API (DM): conversationId=${conversationId}, accountId=${accountId}, platform=${platform}`);

    const url = new URL(`https://zernio.com/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages`);

    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LATE_API_KEY}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`  📡 Late response (${res.statusCode}): ${data.slice(0, 200)}`);
        try {
          if (!data || data.trim() === '') {
            if (res.statusCode >= 200 && res.statusCode < 300) resolve({ ok: true });
            else reject(new Error(`Late API ${res.statusCode}: empty response`));
            return;
          }
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(`Late API ${res.statusCode}: ${data.slice(0, 300)}`));
        } catch (e) {
          reject(new Error('Failed to parse Late response: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ------------------------------------------------------------------
// Late API — reply to comment
// ------------------------------------------------------------------

function sendLateCommentReply(postId, commentId, text, platform) {
  const accountId = PERSONA_ACCOUNT_IDS[platform] || PERSONA_ACCOUNT_IDS.facebook;
  return new Promise((resolve, reject) => {
    const bodyObj = {
      accountId,
      message: text,
    };
    // Instagram requires commentId to reply to a specific comment
    if (commentId) bodyObj.commentId = commentId;
    const body = JSON.stringify(bodyObj);

    console.log(`  📡 Late API (Comment): postId=${postId}, accountId=${accountId}, platform=${platform}`);

    const url = new URL(`https://zernio.com/api/v1/inbox/comments/${encodeURIComponent(postId)}`);

    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LATE_API_KEY}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`  📡 Late response (${res.statusCode}): ${data.slice(0, 200)}`);
        try {
          if (!data || data.trim() === '') {
            if (res.statusCode >= 200 && res.statusCode < 300) resolve({ ok: true });
            else reject(new Error(`Late API ${res.statusCode}: empty response`));
            return;
          }
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(`Late API ${res.statusCode}: ${data.slice(0, 300)}`));
        } catch (e) {
          reject(new Error('Failed to parse Late response: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------

async function main() {
  if (!GEMINI_API_KEY) { console.error('Missing GEMINI_API_KEY'); process.exit(1); }
  if (!LATE_API_KEY) { console.error('Missing LATE_API_KEY'); process.exit(1); }

  const db = new Client({ connectionString: CONNECTION_STRING, ssl: { rejectUnauthorized: false } });
  await db.connect();

  try {
    // Get unreplied inbound messages across all platforms
    const { rows: messages } = await db.query(`
      SELECT id, late_conversation_id, late_message_id, platform, sender_name, sender_id,
             message_text, raw_payload, received_at
      FROM social_inbox
      WHERE direction = 'inbound' AND replied = FALSE AND message_text IS NOT NULL
      ORDER BY received_at ASC
      LIMIT $1
    `, [limitArg]);

    console.log(`Found ${messages.length} unreplied messages\n`);

    if (messages.length === 0) {
      console.log('No messages to respond to.');
      return;
    }

    let replied = 0;
    let failed = 0;

    for (const msg of messages) {
      const platformLabel = (msg.platform || 'unknown').toUpperCase();
      console.log(`--- [${platformLabel}] ${msg.sender_name || 'Unknown'}: "${msg.message_text.slice(0, 80)}${msg.message_text.length > 80 ? '...' : ''}" ---`);

      // Get conversation history for context
      const { rows: history } = await db.query(`
        SELECT direction, message_text FROM social_inbox
        WHERE late_conversation_id = $1 AND id != $2
        ORDER BY received_at ASC
        LIMIT 10
      `, [msg.late_conversation_id, msg.id]);

      // Generate response
      let replyText;
      try {
        replyText = await callGemini(msg.message_text, msg.sender_name, history);
        // Strip any quotes Gemini might wrap the response in
        replyText = replyText.replace(/^["']|["']$/g, '');
        console.log(`  💬 Reply: "${replyText.slice(0, 100)}${replyText.length > 100 ? '...' : ''}"`);
      } catch (err) {
        console.error(`  ❌ Gemini error: ${err.message}`);
        failed++;
        continue;
      }

      if (dryRun) {
        console.log(`  [DRY-RUN] Would send via Late API`);
        replied++;
        continue;
      }

      // Send via Late API — detect comment vs DM
      const isComment = msg.raw_payload?._type === 'comment';
      try {
        if (isComment) {
          // For comments, late_conversation_id is the post ID (from webhook comment.postId)
          if (!msg.late_conversation_id) {
            console.log(`  ⚠️  No post ID — cannot reply to comment via Late API`);
            failed++;
            continue;
          }
          await sendLateCommentReply(msg.late_conversation_id, msg.late_message_id, replyText, msg.platform);
        } else {
          // For DMs, late_conversation_id is the conversation to send to
          if (!msg.late_conversation_id) {
            console.log(`  ⚠️  No conversation ID — cannot reply via Late API`);
            failed++;
            continue;
          }
          await sendLateMessage(msg.late_conversation_id, replyText, msg.platform);
        }

        // Mark original message as replied
        await db.query(`
          UPDATE social_inbox
          SET replied = TRUE, replied_at = NOW(), reply_text = $1, updated_at = NOW()
          WHERE id = $2
        `, [replyText, msg.id]);

        // Store outbound message
        await db.query(`
          INSERT INTO social_inbox (late_conversation_id, sender_name, message_text, direction, received_at)
          VALUES ($1, '${_persona.name}', $2, 'outbound', NOW())
        `, [msg.late_conversation_id, replyText]);

        // If this was a comment, also mark it as responded in social_comments
        if (isComment && msg.late_message_id) {
          await db.query(`
            UPDATE social_comments
            SET responded = TRUE, response_text = $1, updated_at = NOW()
            WHERE comment_id = $2
          `, [replyText, msg.late_message_id]);
        }

        replied++;
        console.log(`  ✅ Sent`);
      } catch (err) {
        console.error(`  ❌ Send error: ${err.message}`);
        failed++;
      }
    }

    console.log(`\nDone! Replied: ${replied} | Failed: ${failed}`);
  } finally {
    await db.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
