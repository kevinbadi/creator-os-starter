#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '..', '.env') });
/**
 * Comment Response Agent — Responds to comments from webhook-populated social_comments table.
 * 
 * Flow:
 *   1. Query social_comments for needs_response=true AND responded=false
 *   2. Generate reply via Gemini
 *   3. Send reply via Late API
 *   4. Update DB: responded=true, response_text=reply
 *
 * Usage:
 *   node comment-response-agent.js [--dry-run] [--limit N] [--platform PLATFORM]
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

const pool = new Pool({ 
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL?.includes('insforge') ? { rejectUnauthorized: false } : false
});

// ============================================================================
// HTTP Helper
// ============================================================================

async function fetchJSON(url, options = {}) {
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
    req.setTimeout(options.timeout || 30000, () => {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', reject);
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

// ============================================================================
// Load Creator Context
// ============================================================================

function loadCreatorContext() {
  const configPath = path.join(ROOT_DIR, 'onboarding-config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const p1 = config.phase1 || {};
      return {
        brandName: (p1.brand_name || '').trim(),
        brandUrl: (p1.brand_url || '').trim(),
        brandDescription: (p1.brand_description || '').trim(),
        targetAudience: (p1.target_audience || '').trim(),
        personaName: (p1.persona_name || p1.brand_name || '').trim(),
        voice: (p1.voice_description || '').trim(),
        primaryCta: (p1.primary_cta || '').trim(),
        linksOffers: p1.links_offers || [],
      };
    } catch (e) { /* fall through */ }
  }
  return {
    brandName: 'the brand', brandUrl: '', brandDescription: '',
    targetAudience: '', personaName: 'the persona', voice: 'Direct, friendly, authentic.',
    primaryCta: '', linksOffers: [],
  };
}

// ============================================================================
// Late API: Load accounts
// ============================================================================

let PLATFORM_ACCOUNTS = {};

async function loadPlatformAccounts() {
  const res = await fetchJSON(`${LATE_BASE_URL}/accounts`, {
    headers: { 'Authorization': `Bearer ${LATE_API_KEY}` },
  });
  if (res.data?.accounts) {
    for (const acc of res.data.accounts) {
      PLATFORM_ACCOUNTS[acc.platform] = { accountId: acc._id, platform: acc.platform, displayName: acc.displayName };
    }
  }
  return PLATFORM_ACCOUNTS;
}

// ============================================================================
// Late API: Reply to a comment
// POST /v1/inbox/comments/{postId}
// Body: { accountId, message, commentId? }
// ============================================================================

async function replyToComment(postId, accountId, message, commentId) {
  const body = { accountId, message };
  if (commentId) body.commentId = commentId;

  const res = await fetchJSON(`${LATE_BASE_URL}/inbox/comments/${encodeURIComponent(postId)}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LATE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Reply failed (${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
  }

  return res.data;
}

// ============================================================================
// Late API: Like a comment
// POST /v1/inbox/comments/{postId}/{commentId}/like
// ============================================================================

async function likeComment(postId, commentId, accountId) {
  const res = await fetchJSON(
    `${LATE_BASE_URL}/inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}/like`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LATE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: { accountId },
    }
  );

  if (res.status < 200 || res.status >= 300) {
    return null;
  }
  return res.data;
}

// ============================================================================
// Database: Get pending comments
// ============================================================================

async function getPendingComments(platformFilter, limit) {
  let query = `
    SELECT id, platform, post_url, comment_id, author_name, author_username, content, raw_data, commented_at
    FROM social_comments
    WHERE needs_response = true AND responded = false
  `;
  const params = [];
  
  if (platformFilter) {
    params.push(platformFilter);
    query += ` AND platform = $${params.length}`;
  }
  
  query += ` ORDER BY commented_at DESC`;
  params.push(limit);
  query += ` LIMIT $${params.length}`;

  const result = await pool.query(query, params);
  return result.rows;
}

// ============================================================================
// Database: Mark comment as responded
// ============================================================================

async function markCommentResponded(commentDbId, responseText, skipped = false) {
  await pool.query(
    `UPDATE social_comments 
     SET responded = true, response_text = $2, updated_at = NOW()
     WHERE id = $1`,
    [commentDbId, skipped ? '[SKIPPED]' : responseText]
  );
}

// ============================================================================
// Generate Reply via Gemini
// ============================================================================

async function generateCommentReply(comment, platform) {
  const ctx = loadCreatorContext();

  const prompt = `You are ${ctx.personaName}, replying to a comment on your ${platform} post.

ABOUT YOU:
${ctx.brandDescription ? `- ${ctx.brandDescription}` : ''}
- Voice: ${ctx.voice || 'Direct, friendly, authentic.'}
${ctx.primaryCta ? `- When relevant, guide people to: ${ctx.primaryCta}` : ''}
${ctx.linksOffers?.length ? `- Your offers: ${ctx.linksOffers.map(l => l.name).join(', ')}` : ''}

THE COMMENT from @${comment.author_username || comment.author_name || 'someone'}:
"${comment.content}"

RULES FOR COMMENT REPLIES:
- Keep it SHORT: 1-2 sentences max. Comments are not DMs.
- Be genuine and human — no corporate energy
- If they're praising you: thank them authentically (vary it up, don't always say "thanks!")
- If they're asking a question: give a quick answer, then point them to DMs or your link in bio if they want more
- If they said something funny: match their energy
- If negative/troll: one calm classy response, or just ignore (reply with [SKIP] to skip)
- If the comment is just an emoji or "🔥": reply with something quick and natural, or [SKIP]
- Never use hashtags in comment replies
- No markdown formatting
- If the comment mentions wanting to learn more or seems like a lead, casually mention DMing you or the link in bio
- If they ask about setup, the AI agents, or want workflows for Creator OS: point them to the YouTube channels — youtube.com/@Creator_oss (tutorials) or youtube.com/@KevBuildsApps (agent deep dives + workflows) — or tell them to DM you for the link
- Vary your responses — don't start every reply the same way

Reply (just the text, or [SKIP] to not reply):`;

  const res = await fetchJSON(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 200 },
      }),
    }
  );

  const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini error: ${JSON.stringify(res.data)}`);
  return text.trim();
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  if (!LATE_API_KEY) throw new Error('LATE_API_KEY not set');
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  if (!DATABASE_URL) throw new Error('INSFORGE_CONNECTION_STRING or DATABASE_URL not set');

  await loadPlatformAccounts();

  console.log(`\n💬 Comment Response Agent (DB-powered)`);
  console.log(`Platforms: ${platformFilter || 'all'}`);
  console.log(`Limit: ${limit}`);
  if (dryRun) console.log('🏃 DRY RUN MODE');
  console.log('');

  // Get pending comments from DB (populated by webhook)
  const pendingComments = await getPendingComments(platformFilter, limit);
  console.log(`📥 Found ${pendingComments.length} pending comment(s) to respond to\n`);

  if (pendingComments.length === 0) {
    console.log('No pending comments. Done!');
    await pool.end();
    process.exit(0);
  }

  let totalReplied = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let totalLiked = 0;

  for (const comment of pendingComments) {
    const platform = comment.platform?.toLowerCase() || 'unknown';
    const acc = PLATFORM_ACCOUNTS[platform];
    
    if (!acc) {
      console.log(`⚠️ No account for platform "${platform}", skipping comment ${comment.id}`);
      continue;
    }

    const username = comment.author_username || comment.author_name || 'someone';
    console.log(`\n--- @${username} (${platform}): "${(comment.content || '').slice(0, 80)}" ---`);

    try {
      // Generate reply
      const replyText = await generateCommentReply(comment, platform);

      if (replyText === '[SKIP]' || replyText.includes('[SKIP]')) {
        console.log('  ⏭ Skipped by AI');
        await markCommentResponded(comment.id, null, true);
        totalSkipped++;
        continue;
      }

      console.log(`  💬 Reply: "${replyText}"`);

      if (dryRun) {
        console.log('  [DRY RUN] Not sending');
        continue;
      }

      // Get postId from raw_data if available
      const rawData = comment.raw_data || {};
      const postId = rawData.post?.id || rawData.post?.platformPostId || comment.post_url;
      const commentId = comment.comment_id;

      if (!postId) {
        console.log('  ⚠️ No postId found, cannot reply via Late API');
        totalFailed++;
        continue;
      }

      // Send reply via Late API
      await replyToComment(postId, acc.accountId, replyText, commentId);
      console.log('  ✅ Reply sent!');
      totalReplied++;

      // Update DB
      await markCommentResponded(comment.id, replyText, false);

      // Like the comment too
      try {
        if (commentId) {
          const liked = await likeComment(postId, commentId, acc.accountId);
          if (liked) {
            console.log('  ❤️ Liked');
            totalLiked++;
          }
        }
      } catch (e) {
        // Non-critical
      }

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 1500));

    } catch (e) {
      console.error(`  ❌ Error: ${e.message}`);
      totalFailed++;
    }
  }

  await pool.end();
  console.log(`\n=== DONE: ${totalReplied} replied, ${totalLiked} liked, ${totalSkipped} skipped, ${totalFailed} failed ===`);
  process.exit(0);
}

main().catch(async e => {
  console.error(`Error: ${e.message}`);
  await pool.end();
  process.exit(1);
});
