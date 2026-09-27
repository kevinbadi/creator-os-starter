#!/usr/bin/env node
/**
 * post-analytics — Sync post-level analytics from Late API → database
 *
 * Pulls performance metrics for each published post and stores per-platform
 * breakdowns into the platform-specific stats tables.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Config
// ============================================================================

const LATE_API_KEY = process.env.LATE_API_KEY;
const DATABASE_URL = process.env.INSFORGE_CONNECTION_STRING || process.env.DATABASE_URL;
const LATE_BASE_URL = 'https://zernio.com/api/v1';

// Read profile ID from SOCIALS.md
function loadPlatformConfig() {
  const ROOT_DIR = path.join(__dirname, '..', '..', '..');
  const socialsPath = path.join(ROOT_DIR, 'SOCIALS.md');
  let profileId = null;

  if (fs.existsSync(socialsPath)) {
    const content = fs.readFileSync(socialsPath, 'utf8');
    const profileMatch = content.match(/Profile ID[*:\s\x60]*([a-f0-9]{24,})/i);
    if (profileMatch) profileId = profileMatch[1];
  }

  return { profileId };
}

const { profileId: PROFILE_ID } = loadPlatformConfig();

const isRealDB = DATABASE_URL && !DATABASE_URL.includes('user:pass@host');
const pool = isRealDB ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

// ============================================================================
// CLI Args
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { postId: null, limit: 20, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--post-id': opts.postId = args[++i]; break;
      case '--limit': opts.limit = parseInt(args[++i], 10); break;
      case '--dry-run': opts.dryRun = true; break;
    }
  }
  return opts;
}

// ============================================================================
// Late API — Fetch Posts
// ============================================================================

async function fetchPosts(limit) {
  const res = await fetch(`${LATE_BASE_URL}/posts?profileId=${PROFILE_ID}&limit=${limit}`, {
    headers: { 'Authorization': `Bearer ${LATE_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch posts: ${res.status}`);
  const data = await res.json();
  return data.posts || [];
}

// ============================================================================
// Late API — Fetch Post Analytics
// ============================================================================

async function fetchPostAnalytics(postId) {
  const res = await fetch(`${LATE_BASE_URL}/analytics?postId=${postId}`, {
    headers: { 'Authorization': `Bearer ${LATE_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch analytics for ${postId}: ${res.status}`);
  return res.json();
}

// ============================================================================
// DB — Update platform_posts with URL + analytics
// ============================================================================

async function updatePlatformPost(latePostId, platform, platformPostUrl, analytics) {
  if (!pool) return;

  await pool.query(
    `UPDATE platform_posts SET
      post_url = COALESCE($1, post_url),
      raw_response = raw_response || $2::jsonb,
      updated_at = NOW()
    WHERE platform_post_id = $3 AND platform = $4`,
    [
      platformPostUrl,
      JSON.stringify({ analytics, synced_at: new Date().toISOString() }),
      latePostId,
      platform,
    ]
  );
}

// ============================================================================
// DB — Upsert per-platform post stats
// ============================================================================

async function upsertPlatformStats(latePostId, platform, analytics, platformPostUrl) {
  if (!pool || !analytics) return;

  // Find the platform_posts row ID
  const ppRes = await pool.query(
    `SELECT id FROM platform_posts WHERE platform_post_id = $1 AND platform = $2 LIMIT 1`,
    [latePostId, platform]
  );
  const platformPostDbId = ppRes.rows[0]?.id || null;

  const common = {
    impressions: analytics.impressions || 0,
    reach: analytics.reach || 0,
    likes: analytics.likes || 0,
    comments: analytics.comments || 0,
    shares: analytics.shares || 0,
    saves: analytics.saves || 0,
    views: analytics.views || 0,
    clicks: analytics.clicks || 0,
    engagementRate: analytics.engagementRate || 0,
  };

  const rawData = JSON.stringify(analytics);

  // Helper: check if row exists, then INSERT or UPDATE
  const upsert = async (table, idCol, idVal, insertCols, insertVals, updateSet) => {
    const existing = await pool.query(
      `SELECT id FROM ${table} WHERE ${idCol} = $1 LIMIT 1`, [idVal]
    );
    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE ${table} SET ${updateSet}, fetched_at = NOW(), updated_at = NOW() WHERE ${idCol} = $1`,
        [idVal, ...insertVals.slice(3)] // skip platform_post_id, id_col_val, post_url
      );
    } else {
      await pool.query(
        `INSERT INTO ${table} (${insertCols}) VALUES (${insertVals.map((_, i) => `$${i + 1}`).join(', ')}, NOW())`,
        insertVals
      );
    }
  };

  switch (platform) {
    case 'instagram': {
      const existing = await pool.query(`SELECT id FROM instagram_posts_stats WHERE ig_post_id = $1 LIMIT 1`, [latePostId]);
      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE instagram_posts_stats SET
            impressions = $2, reach = $3, likes = $4, comments = $5,
            saves = $6, shares = $7, video_views = $8,
            engagement_rate = $9, raw_data = $10, post_url = $11, fetched_at = NOW()
          WHERE ig_post_id = $1`,
          [latePostId, common.impressions, common.reach, common.likes, common.comments,
           common.saves, common.shares, common.views, common.engagementRate, rawData, platformPostUrl]
        );
      } else {
        await pool.query(
          `INSERT INTO instagram_posts_stats (
            platform_post_id, ig_post_id, post_url, post_type,
            impressions, reach, likes, comments, saves, shares, video_views,
            engagement_rate, raw_data, fetched_at
          ) VALUES ($1, $2, $3, 'reel', $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
          [platformPostDbId, latePostId, platformPostUrl,
           common.impressions, common.reach, common.likes, common.comments,
           common.saves, common.shares, common.views, common.engagementRate, rawData]
        );
      }
      break;
    }

    case 'tiktok': {
      const existing = await pool.query(`SELECT id FROM tiktok_posts_stats WHERE tiktok_post_id = $1 LIMIT 1`, [latePostId]);
      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE tiktok_posts_stats SET
            views = $2, likes = $3, comments = $4, shares = $5, saves = $6,
            engagement_rate = $7, raw_data = $8, post_url = $9, fetched_at = NOW()
          WHERE tiktok_post_id = $1`,
          [latePostId, common.views, common.likes, common.comments, common.shares, common.saves,
           common.engagementRate, rawData, platformPostUrl]
        );
      } else {
        await pool.query(
          `INSERT INTO tiktok_posts_stats (
            platform_post_id, tiktok_post_id, post_url,
            views, likes, comments, shares, saves,
            engagement_rate, raw_data, fetched_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
          [platformPostDbId, latePostId, platformPostUrl,
           common.views, common.likes, common.comments, common.shares, common.saves,
           common.engagementRate, rawData]
        );
      }
      break;
    }

    case 'youtube': {
      const existing = await pool.query(`SELECT id FROM youtube_posts_stats WHERE video_id = $1 LIMIT 1`, [latePostId]);
      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE youtube_posts_stats SET
            views = $2, likes = $3, comments = $4, shares = $5, impressions = $6,
            engagement_rate = $7, raw_data = $8, post_url = $9, fetched_at = NOW()
          WHERE video_id = $1`,
          [latePostId, common.views, common.likes, common.comments, common.shares, common.impressions,
           common.engagementRate, rawData, platformPostUrl]
        );
      } else {
        await pool.query(
          `INSERT INTO youtube_posts_stats (
            platform_post_id, video_id, post_url,
            views, likes, comments, shares, impressions,
            engagement_rate, raw_data, fetched_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
          [platformPostDbId, latePostId, platformPostUrl,
           common.views, common.likes, common.comments, common.shares, common.impressions,
           common.engagementRate, rawData]
        );
      }
      break;
    }

    case 'facebook': {
      const existing = await pool.query(`SELECT id FROM facebook_posts_stats WHERE fb_post_id = $1 LIMIT 1`, [latePostId]);
      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE facebook_posts_stats SET
            impressions = $2, reach = $3, likes = $4, shares = $5, comments = $6,
            engagement_rate = $7, raw_data = $8, post_url = $9, fetched_at = NOW()
          WHERE fb_post_id = $1`,
          [latePostId, common.impressions, common.reach, common.likes, common.shares, common.comments,
           common.engagementRate, rawData, platformPostUrl]
        );
      } else {
        await pool.query(
          `INSERT INTO facebook_posts_stats (
            platform_post_id, fb_post_id, post_url,
            impressions, reach, likes, shares, comments,
            engagement_rate, raw_data, fetched_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
          [platformPostDbId, latePostId, platformPostUrl,
           common.impressions, common.reach, common.likes, common.shares, common.comments,
           common.engagementRate, rawData]
        );
      }
      break;
    }

    case 'twitter': {
      const existing = await pool.query(`SELECT id FROM twitter_posts_stats WHERE tweet_id = $1 LIMIT 1`, [latePostId]);
      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE twitter_posts_stats SET
            impressions = $2, likes = $3, retweets = $4, replies = $5, clicks = $6,
            engagement_rate = $7, raw_data = $8, post_url = $9, fetched_at = NOW()
          WHERE tweet_id = $1`,
          [latePostId, common.impressions, common.likes, common.shares, common.comments, common.clicks,
           common.engagementRate, rawData, platformPostUrl]
        );
      } else {
        await pool.query(
          `INSERT INTO twitter_posts_stats (
            platform_post_id, tweet_id, post_url,
            impressions, likes, retweets, replies, clicks,
            engagement_rate, raw_data, fetched_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
          [platformPostDbId, latePostId, platformPostUrl,
           common.impressions, common.likes, common.shares, common.comments, common.clicks,
           common.engagementRate, rawData]
        );
      }
      break;
    }
  }
}

// ============================================================================
// DB — Update user_posts aggregate analytics
// ============================================================================

async function updateUserPostAnalytics(latePostId, aggregateAnalytics, platformUrls) {
  if (!pool) return;

  await pool.query(
    `UPDATE user_posts SET
      metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
      updated_at = NOW()
    WHERE late_post_id = $2`,
    [
      JSON.stringify({
        analytics: aggregateAnalytics,
        platform_urls: platformUrls,
        analytics_synced_at: new Date().toISOString(),
      }),
      latePostId,
    ]
  );
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const opts = parseArgs();

  if (!LATE_API_KEY) throw new Error('LATE_API_KEY not set in .env');

  console.log('\n=== POST ANALYTICS ===');

  let posts;
  if (opts.postId) {
    posts = [{ _id: opts.postId }];
    console.log(`Syncing single post: ${opts.postId}`);
  } else {
    posts = await fetchPosts(opts.limit);
    console.log(`Found ${posts.length} posts to sync`);
  }

  let totalSynced = 0;
  let totalSkipped = 0;

  for (const post of posts) {
    const postId = post._id;
    const contentPreview = (post.content || '').substring(0, 60);
    console.log(`\n--- Post: ${postId} ---`);
    console.log(`  Content: ${contentPreview}...`);

    try {
      const analytics = await fetchPostAnalytics(postId);

      // Aggregate stats
      const agg = analytics.analytics || {};
      console.log(`  Aggregate: ${agg.impressions || 0} impr | ${agg.reach || 0} reach | ${agg.likes || 0} likes | ${agg.comments || 0} comments | ${agg.views || 0} views`);

      const platformAnalytics = analytics.platformAnalytics || [];
      const platformUrls = {};

      for (const pa of platformAnalytics) {
        const plat = pa.platform;
        const url = pa.platformPostUrl;
        const stats = pa.analytics;
        const syncStatus = pa.syncStatus;

        if (url) platformUrls[plat] = url;

        if (syncStatus === 'pending' || !stats) {
          console.log(`  [${plat}] sync: ${syncStatus} — skipping`);
          continue;
        }

        console.log(`  [${plat}] ${stats.impressions || 0} impr | ${stats.likes || 0} likes | ${stats.views || 0} views | ${url || 'no url'}`);

        if (!opts.dryRun) {
          await updatePlatformPost(postId, plat, url, stats);
          await upsertPlatformStats(postId, plat, stats, url);
        }
      }

      if (!opts.dryRun) {
        await updateUserPostAnalytics(postId, agg, platformUrls);
      }

      totalSynced++;
    } catch (err) {
      console.log(`  Error: ${err.message}`);
      totalSkipped++;
    }
  }

  console.log('\n=== SYNC COMPLETE ===');
  console.log(`Synced: ${totalSynced} | Skipped: ${totalSkipped}`);

  if (opts.dryRun) console.log('[DRY RUN] No database writes made.');
  if (pool) await pool.end();
}

main().catch(async e => {
  console.error(`\nError: ${e.message}`);
  if (pool) await pool.end();
  process.exit(1);
});
