#!/usr/bin/env node
/**
 * comment-responder — Auto-respond to comments across all platforms via Late API
 *
 * Fetches comments, generates personalized replies via Gemini,
 * posts public replies + private DMs (IG/FB), and saves commenters as warm leads.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { loadPersonaContext, loadSkipUsernames } = require('../../../lib/persona');

// ============================================================================
// Config
// ============================================================================

const LATE_API_KEY = process.env.LATE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DATABASE_URL = process.env.INSFORGE_CONNECTION_STRING || process.env.DATABASE_URL;
const LATE_BASE_URL = 'https://zernio.com/api/v1';

const isRealDB = DATABASE_URL && !DATABASE_URL.includes('user:pass@host');
const pool = isRealDB ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

// Read platform accounts from SOCIALS.md
function loadPlatformConfig() {
  const ROOT_DIR = path.join(__dirname, '..', '..', '..');
  const socialsPath = path.join(ROOT_DIR, 'SOCIALS.md');
  const accounts = {};
  let profileId = null;

  if (fs.existsSync(socialsPath)) {
    const content = fs.readFileSync(socialsPath, 'utf8');
    const profileMatch = content.match(/Profile ID[*:\s\x60]*([a-f0-9]{24,})/i);
    if (profileMatch) profileId = profileMatch[1];

    const platformNames = ['instagram', 'tiktok', 'facebook', 'twitter', 'youtube'];
    for (const plat of platformNames) {
      const re = new RegExp(`###?\\s*${plat}[\\s\\S]*?Late Account ID[:\\s]*\`?([a-f0-9]{24,})\`?`, 'i');
      const m = content.match(re);
      if (m) accounts[plat] = m[1];
    }
  }

  return { accounts, profileId };
}

const { accounts: PLATFORM_ACCOUNTS, profileId: PROFILE_ID } = loadPlatformConfig();
const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const persona = loadPersonaContext(ROOT_DIR);

// Our own account usernames — skip comments from these (loaded from config/skip-usernames.json)
const OWN_USERNAMES = loadSkipUsernames(ROOT_DIR);

// Platforms that support private DM replies to commenters
const PRIVATE_REPLY_PLATFORMS = new Set(['instagram', 'facebook']);

// Platforms that support liking comments
const LIKE_PLATFORMS = new Set(['facebook', 'twitter']);

// ============================================================================
// CLI Args
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    platforms: null,
    limit: 50,
    dryRun: false,
    skipLeads: false,
    noPrivateReply: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--platforms': opts.platforms = args[++i].split(',').map(p => p.trim()); break;
      case '--limit': opts.limit = parseInt(args[++i], 10); break;
      case '--dry-run': opts.dryRun = true; break;
      case '--skip-leads': opts.skipLeads = true; break;
      case '--no-private-reply': opts.noPrivateReply = true; break;
    }
  }
  return opts;
}

// ============================================================================
// Late API — Fetch Posts with Comments
// ============================================================================

async function fetchPostsWithComments(platform) {
  const params = new URLSearchParams({
    profileId: PROFILE_ID,
    limit: '100',
    sortBy: 'date',
    sortOrder: 'desc',
  });
  if (platform) params.set('platform', platform);

  const res = await fetch(`${LATE_BASE_URL}/inbox/comments?${params}`, {
    headers: { 'Authorization': `Bearer ${LATE_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch posts: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

// ============================================================================
// Late API — Fetch Comments for a Post
// ============================================================================

async function fetchComments(postId, accountId) {
  const res = await fetch(
    `${LATE_BASE_URL}/inbox/comments/${postId}?accountId=${accountId}&limit=100`,
    { headers: { 'Authorization': `Bearer ${LATE_API_KEY}` } }
  );
  if (!res.ok) throw new Error(`Failed to fetch comments for ${postId}: ${res.status}`);
  const data = await res.json();
  return data.comments || [];
}

// ============================================================================
// Late API — Reply to Comment (Public)
// ============================================================================

async function replyToComment(postId, accountId, commentId, message) {
  const body = { accountId, message };
  if (commentId) body.commentId = commentId;

  const res = await fetch(`${LATE_BASE_URL}/inbox/comments/${postId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LATE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Reply failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

// ============================================================================
// Late API — Private Reply (DM) to Commenter (IG/FB only)
// ============================================================================

async function privateReply(postId, commentId, accountId, message) {
  const res = await fetch(
    `${LATE_BASE_URL}/inbox/comments/${postId}/${commentId}/private-reply`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LATE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accountId, message }),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    // Private reply may fail (already replied, >7 days, etc.) — non-fatal
    console.log(`    Private reply failed: ${JSON.stringify(data)}`);
    return null;
  }
  return data;
}

// ============================================================================
// Late API — Like Comment
// ============================================================================

async function likeComment(postId, commentId, accountId) {
  const res = await fetch(
    `${LATE_BASE_URL}/inbox/comments/${postId}/${commentId}/like`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LATE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accountId }),
    }
  );
  // Non-fatal if like fails
  if (!res.ok) {
    console.log(`    Like failed (${res.status}) — continuing`);
  }
}

// ============================================================================
// Gemini — Generate Reply
// ============================================================================

async function generateReply(platform, commentText, postContent, authorName) {
  const prompt = `You are ${persona.name} — the brand persona for ${persona.brand}.
${persona.voice ? `\nVoice guide:\n${persona.voice}\n` : ''}
Someone commented on your ${platform} post. Generate a warm, authentic reply.

Post content: "${(postContent || '').substring(0, 200)}"
Comment from ${authorName || 'someone'}: "${commentText}"

Rules:
- Be warm, genuine, and match the persona's voice (like a friend replying)
- Keep it SHORT — 1-2 sentences max
- Include a subtle CTA relevant to the brand
- Use 1-2 relevant emojis max
- Don't be salesy or robotic
- If the comment is negative, respond gracefully
- If they ask a question, answer it briefly then add the CTA
- Never use more than 1 hashtag in a reply
- Platform: ${platform} — adjust tone accordingly (Twitter = punchy, YouTube = friendly, etc.)

Reply ONLY with the response text, nothing else.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 256 },
      }),
    }
  );

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini error: ${JSON.stringify(data)}`);
  return text.trim();
}

// ============================================================================
// Gemini — Generate Private DM Message
// ============================================================================

async function generatePrivateDM(commentText, postContent, authorName) {
  const prompt = `You are ${persona.name} — the brand persona for ${persona.brand}.
${persona.voice ? `\nVoice guide:\n${persona.voice}\n` : ''}
Someone commented on your Instagram/Facebook post and you want to send them a friendly private DM to build a relationship.

Their comment: "${commentText}"
Their name: ${authorName || 'friend'}
Post was about: "${(postContent || '').substring(0, 200)}"

Write a short, warm DM (2-3 sentences) that:
- Thanks them for engaging with your content
- Feels personal and genuine (not copy-paste)
- Mentions the brand naturally
- Invites them to check it out or connect
- Sounds like a real person texting, not a brand

Reply ONLY with the DM text, nothing else.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 256 },
      }),
    }
  );

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini DM error: ${JSON.stringify(data)}`);
  return text.trim();
}

// ============================================================================
// DB — Check if Comment Already Responded
// ============================================================================

async function isAlreadyResponded(commentId) {
  if (!pool) return false;
  const res = await pool.query(
    `SELECT id FROM social_comments WHERE comment_id = $1 AND responded = TRUE LIMIT 1`,
    [commentId]
  );
  return res.rows.length > 0;
}

// ============================================================================
// DB — Store Comment + Response
// ============================================================================

async function storeComment({ platform, postUrl, commentId, authorName, authorUsername, content, responseText }) {
  if (!pool) return;

  const existing = await pool.query(
    `SELECT id FROM social_comments WHERE comment_id = $1 LIMIT 1`,
    [commentId]
  );

  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE social_comments SET
        responded = TRUE, response_text = $2, needs_response = FALSE, updated_at = NOW()
      WHERE comment_id = $1`,
      [commentId, responseText]
    );
  } else {
    await pool.query(
      `INSERT INTO social_comments (
        user_id, platform, post_url, comment_id, author_name, author_username,
        content, sentiment, needs_response, responded, response_text, commented_at
      ) VALUES (1, $1, $2, $3, $4, $5, $6, 'neutral', FALSE, TRUE, $7, NOW())`,
      [platform, postUrl, commentId, authorName, authorUsername, content, responseText]
    );
  }
}

// ============================================================================
// DB — Upsert Instagram Lead (warm lead from comment)
// ============================================================================

async function upsertInstagramLead(username, fullName, postUrl) {
  if (!pool || !username) return;

  await pool.query(
    `INSERT INTO instagram_leads (
      username, full_name, source_photo_url, status, campaign_name, scraped_at
    ) VALUES ($1, $2, $3, 'new', 'comment-responder', NOW())
    ON CONFLICT (username) DO UPDATE SET
      full_name = COALESCE(NULLIF($2, ''), instagram_leads.full_name),
      source_photo_url = COALESCE($3, instagram_leads.source_photo_url),
      updated_at = NOW()`,
    [username, fullName || null, postUrl || null]
  );
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const opts = parseArgs();

  if (!LATE_API_KEY) throw new Error('LATE_API_KEY not set in .env');
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');

  const allPlatforms = Object.keys(PLATFORM_ACCOUNTS);
  const platformList = opts.platforms || allPlatforms;

  console.log(`\n=== ${persona.name.toUpperCase()} COMMENT RESPONDER ===`);
  console.log(`Platforms: ${platformList.join(', ')}`);
  console.log(`Limit: ${opts.limit} comments`);
  if (opts.dryRun) console.log('[DRY RUN MODE]');

  let totalReplied = 0;
  let totalSkipped = 0;
  let totalLeads = 0;
  let totalPrivateDMs = 0;

  for (const platform of platformList) {
    const accountId = PLATFORM_ACCOUNTS[platform];
    if (!accountId) {
      console.log(`\n[${platform}] No account ID configured — skipping`);
      continue;
    }

    console.log(`\n--- ${platform.toUpperCase()} ---`);

    // Fetch posts for this platform
    let posts;
    try {
      posts = await fetchPostsWithComments(platform);
    } catch (err) {
      console.log(`  Error fetching posts: ${err.message}`);
      continue;
    }

    const postsWithComments = posts.filter(p => (p.commentCount || 0) > 0);
    console.log(`  ${posts.length} posts found, ${postsWithComments.length} with comments`);

    if (postsWithComments.length === 0) {
      console.log('  No comments to respond to.');
      continue;
    }

    for (const post of postsWithComments) {
      if (totalReplied >= opts.limit) break;

      const postId = post.id;
      const postContent = post.content || '';
      const postUrl = post.permalink || '';

      console.log(`\n  Post: ${postId}`);
      console.log(`  Content: ${postContent.substring(0, 60)}...`);
      console.log(`  Comments: ${post.commentCount}`);

      // Fetch comments
      let comments;
      try {
        comments = await fetchComments(postId, accountId);
      } catch (err) {
        console.log(`  Error fetching comments: ${err.message}`);
        continue;
      }

      for (const comment of comments) {
        if (totalReplied >= opts.limit) break;

        const commentId = comment.id;
        const authorName = comment.from?.name || '';
        const authorUsername = comment.from?.username || authorName;
        const commentText = comment.message || '';
        const isOwner = comment.from?.isOwner || false;
        const canReply = comment.canReply !== false; // default true if not specified

        // Skip our own comments
        if (isOwner || OWN_USERNAMES.has(authorUsername.toLowerCase())) {
          continue;
        }

        // Skip if can't reply
        if (!canReply) {
          console.log(`    [${commentId}] Can't reply — skipping`);
          totalSkipped++;
          continue;
        }

        // Skip if already responded
        if (await isAlreadyResponded(commentId)) {
          continue;
        }

        console.log(`    Comment by @${authorUsername}: "${commentText.substring(0, 80)}"`);

        // Generate reply
        const replyText = await generateReply(platform, commentText, postContent, authorName);
        console.log(`    Reply: "${replyText.substring(0, 80)}..."`);

        if (!opts.dryRun) {
          // 1. Post public reply
          try {
            await replyToComment(postId, accountId, commentId, replyText);
            console.log('    Public reply sent');
          } catch (err) {
            console.log(`    Public reply error: ${err.message}`);
            totalSkipped++;
            continue;
          }

          // 2. Like the comment (if platform supports it)
          if (LIKE_PLATFORMS.has(platform)) {
            await likeComment(postId, commentId, accountId);
          }

          // 3. Private DM reply (IG/FB only)
          if (PRIVATE_REPLY_PLATFORMS.has(platform) && !opts.noPrivateReply) {
            try {
              const dmText = await generatePrivateDM(commentText, postContent, authorName);
              const dmResult = await privateReply(postId, commentId, accountId, dmText);
              if (dmResult) {
                console.log(`    Private DM sent to @${authorUsername}`);
                totalPrivateDMs++;
              }
            } catch (err) {
              console.log(`    Private DM skipped: ${err.message}`);
            }
          }

          // 4. Store in social_comments
          await storeComment({
            platform, postUrl, commentId,
            authorName, authorUsername,
            content: commentText, responseText: replyText,
          });

          // 5. Save as Instagram lead
          if (platform === 'instagram' && !opts.skipLeads && authorUsername) {
            await upsertInstagramLead(authorUsername, authorName, postUrl);
            console.log(`    Lead saved: @${authorUsername}`);
            totalLeads++;
          }
        }

        totalReplied++;

        // Small delay between replies to avoid rate limits
        if (!opts.dryRun && totalReplied < opts.limit) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
  }

  console.log('\n=== COMPLETE ===');
  console.log(`Replied:      ${totalReplied}`);
  console.log(`Skipped:      ${totalSkipped}`);
  console.log(`Private DMs:  ${totalPrivateDMs}`);
  console.log(`Leads saved:  ${totalLeads}`);
  if (opts.dryRun) console.log('[DRY RUN] No actions taken.');

  if (pool) await pool.end();
}

main().catch(async e => {
  console.error(`\nError: ${e.message}`);
  if (pool) await pool.end();
  process.exit(1);
});
