#!/usr/bin/env node
/**
 * account-analytics — Sync account-level daily analytics from Late API → database
 *
 * Pulls daily metrics per platform, follower counts from connected accounts,
 * and stores everything in daily_social_analytics for trend tracking.
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

// Read profile ID from SOCIALS.md, fallback to onboarding-config.json
function loadPlatformConfig() {
  const ROOT_DIR = path.join(__dirname, '..', '..', '..');
  const socialsPath = path.join(ROOT_DIR, 'SOCIALS.md');
  let profileId = null;

  if (fs.existsSync(socialsPath)) {
    const content = fs.readFileSync(socialsPath, 'utf8');
    const profileMatch = content.match(/Profile ID[:\s*`]+([a-f0-9]{24,})/i);
    if (profileMatch) profileId = profileMatch[1];
  }

  // Fallback to onboarding-config.json
  if (!profileId) {
    const onbPath = path.join(ROOT_DIR, 'onboarding-config.json');
    if (fs.existsSync(onbPath)) {
      try {
        const onb = JSON.parse(fs.readFileSync(onbPath, 'utf8'));
        if (onb.late_profile_id) profileId = onb.late_profile_id;
      } catch (e) {}
    }
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
  const opts = { dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

// ============================================================================
// Late API — Daily Metrics
// ============================================================================

async function fetchDailyMetrics() {
  const res = await fetch(`${LATE_BASE_URL}/analytics/daily-metrics?profileId=${PROFILE_ID}`, {
    headers: { 'Authorization': `Bearer ${LATE_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch daily metrics: ${res.status}`);
  return res.json();
}

// ============================================================================
// Late API — Account Info (follower counts)
// ============================================================================

async function fetchAccounts() {
  const res = await fetch(`${LATE_BASE_URL}/accounts?profileId=${PROFILE_ID}`, {
    headers: { 'Authorization': `Bearer ${LATE_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch accounts: ${res.status}`);
  const data = await res.json();
  return data.accounts || [];
}

// ============================================================================
// DB — Upsert daily_social_analytics
// ============================================================================

async function upsertDailyAnalytics(date, platform, metrics, followers) {
  if (!pool) return;

  await pool.query(
    `INSERT INTO daily_social_analytics (
      user_id, platform, date, followers, posts_count,
      likes, comments, shares, impressions, reach, engagement_rate,
      raw_data
    ) VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT ON CONSTRAINT unique_daily_social DO UPDATE SET
      followers = $3, posts_count = $4,
      likes = $5, comments = $6, shares = $7,
      impressions = $8, reach = $9, engagement_rate = $10,
      raw_data = $11, updated_at = NOW()`,
    [
      platform, date,
      followers || 0,
      metrics.postCount || 0,
      metrics.likes || 0,
      metrics.comments || 0,
      metrics.shares || 0,
      metrics.impressions || 0,
      metrics.reach || 0,
      metrics.engagementRate || 0,
      JSON.stringify(metrics),
    ]
  );
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const opts = parseArgs();

  if (!LATE_API_KEY) throw new Error('LATE_API_KEY not set in .env');

  console.log('\n=== ACCOUNT ANALYTICS ===');

  // 1. Fetch daily metrics
  console.log('\n[Step 1] Fetching daily metrics from Late...');
  const dailyData = await fetchDailyMetrics();

  // 2. Fetch account follower counts
  console.log('[Step 2] Fetching account follower counts...');
  const accounts = await fetchAccounts();

  const followersByPlatform = {};
  for (const acc of accounts) {
    followersByPlatform[acc.platform] = {
      followers: acc.followersCount || 0,
      displayName: acc.displayName || acc.username,
      lastUpdated: acc.followersLastUpdated,
    };
  }

  // 3. Print follower summary
  console.log('\n--- FOLLOWER COUNTS ---');
  for (const [plat, info] of Object.entries(followersByPlatform)) {
    console.log(`  ${plat.padEnd(12)} ${String(info.followers).padStart(6)} followers  (@${info.displayName})`);
  }

  // 4. Print & store daily metrics
  const days = dailyData.dailyData || [];
  console.log(`\n--- DAILY METRICS (${days.length} days) ---`);

  let totalDBWrites = 0;

  for (const day of days) {
    console.log(`\n  ${day.date} — ${day.postCount} posts`);
    const m = day.metrics || {};
    console.log(`    Total: ${m.impressions || 0} impr | ${m.reach || 0} reach | ${m.likes || 0} likes | ${m.comments || 0} comments | ${m.views || 0} views`);

    // Per-platform breakdown for this day
    const platformCounts = day.platforms || {};
    for (const [plat, postCount] of Object.entries(platformCounts)) {
      if (!opts.dryRun) {
        await upsertDailyAnalytics(day.date, plat, {
          postCount,
          likes: 0,
          comments: 0,
          shares: 0,
          impressions: 0,
          reach: 0,
          views: 0,
          engagementRate: 0,
          ...m, // daily aggregate (Late doesn't break down metrics per-platform in daily)
        }, followersByPlatform[plat]?.followers || 0);
        totalDBWrites++;
      }
    }
  }

  // 5. Print platform breakdown (aggregate)
  const breakdown = dailyData.platformBreakdown || [];
  console.log('\n--- PLATFORM BREAKDOWN (ALL TIME) ---');
  console.log('  Platform     Posts  Impr   Reach  Likes  Comments  Views');
  console.log('  ' + '-'.repeat(65));
  for (const pb of breakdown) {
    console.log(`  ${pb.platform.padEnd(12)} ${String(pb.postCount).padStart(5)}  ${String(pb.impressions).padStart(5)}  ${String(pb.reach).padStart(6)}  ${String(pb.likes).padStart(5)}  ${String(pb.comments).padStart(8)}  ${String(pb.views).padStart(6)}`);
  }

  // Totals
  const totals = breakdown.reduce((acc, pb) => {
    acc.posts += pb.postCount;
    acc.impressions += pb.impressions;
    acc.reach += pb.reach;
    acc.likes += pb.likes;
    acc.comments += pb.comments;
    acc.views += pb.views;
    return acc;
  }, { posts: 0, impressions: 0, reach: 0, likes: 0, comments: 0, views: 0 });

  console.log('  ' + '-'.repeat(65));
  console.log(`  ${'TOTAL'.padEnd(12)} ${String(totals.posts).padStart(5)}  ${String(totals.impressions).padStart(5)}  ${String(totals.reach).padStart(6)}  ${String(totals.likes).padStart(5)}  ${String(totals.comments).padStart(8)}  ${String(totals.views).padStart(6)}`);

  console.log('\n=== SYNC COMPLETE ===');
  if (opts.dryRun) {
    console.log('[DRY RUN] No database writes made.');
  } else {
    console.log(`DB: ${totalDBWrites} daily_social_analytics rows upserted`);
  }

  if (pool) await pool.end();
}

main().catch(async e => {
  console.error(`\nError: ${e.message}`);
  if (pool) await pool.end();
  process.exit(1);
});
