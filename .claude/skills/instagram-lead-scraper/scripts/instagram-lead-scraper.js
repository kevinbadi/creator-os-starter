#!/usr/bin/env node
/**
 * instagram-lead-scraper.js
 * Scrapes Instagram post likers using Apify actor WxPRaG9gfg5KZ4gY1
 * No cookies needed.
 *
 * Usage:
 *   node instagram-lead-scraper.js --posts "https://instagram.com/p/ABC/,https://instagram.com/p/DEF/"
 *   node instagram-lead-scraper.js --posts "https://instagram.com/p/ABC/" --campaign "my_campaign"
 *   node instagram-lead-scraper.js --posts "https://instagram.com/p/ABC/" --dry-run
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const { ApifyClient } = require('apify-client');
const { Client } = require('pg');

const ACTOR_ID = 'WxPRaG9gfg5KZ4gY1'; // datadoping/instagram-likes-scraper — no cookies needed

// --- CLI args ---
const args = process.argv.slice(2);
const getArg = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};
const hasFlag = (flag) => args.includes(flag);

const postsArg = getArg('--posts');
const campaign = getArg('--campaign') || 'competitor_likers';
const maxCount = parseInt(getArg('--max') || '1000', 10);
const dryRun = hasFlag('--dry-run');

if (!postsArg) {
  console.error('Usage: node instagram-lead-scraper.js --posts "url1,url2" [--campaign name] [--max 1000] [--dry-run]');
  process.exit(1);
}

const postUrls = postsArg.split(',').map(u => u.trim()).filter(u => u.includes('instagram.com'));
if (postUrls.length === 0) {
  console.error('No valid Instagram post URLs provided.');
  process.exit(1);
}

const APIFY_KEY = process.env.APIFY_API_KEY;
const DB_URL = process.env.INSFORGE_CONNECTION_STRING;

if (!APIFY_KEY) { console.error('Missing APIFY_API_KEY'); process.exit(1); }
if (!DB_URL && !dryRun) { console.error('Missing INSFORGE_CONNECTION_STRING'); process.exit(1); }

// --- Helpers ---

async function fetchAllItems(apify, datasetId) {
  const all = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const { items } = await apify.dataset(datasetId).listItems({ offset, limit });
    all.push(...items);
    if (items.length < limit) break;
    offset += limit;
  }
  return all;
}

// --- Main ---

async function main() {
  const apify = new ApifyClient({ token: APIFY_KEY });

  console.log(`\n📸 Instagram Lead Scraper`);
  console.log(`Actor: ${ACTOR_ID} (no cookies needed)`);
  console.log(`Posts: ${postUrls.join(', ')}`);
  console.log(`Max likers per post: ${maxCount}`);
  console.log(`Campaign: ${campaign}`);
  if (dryRun) console.log('DRY RUN — no DB insert\n');

  // Run Apify actor
  console.log('🚀 Starting Apify run...');
  const run = await apify.actor(ACTOR_ID).call({
    posts: postUrls,
    max_count: maxCount,
  }, { waitSecs: 600 });

  console.log(`✅ Run ${run.id} — status: ${run.status}`);

  const items = await fetchAllItems(apify, run.defaultDatasetId);
  console.log(`📦 Fetched ${items.length} likers`);

  if (items.length === 0) {
    console.log('No likers returned. Exiting.');
    return;
  }

  if (dryRun) {
    console.log('\nSample (first 3):');
    items.slice(0, 3).forEach(i => console.log(` @${i.username} — ${i.full_name || '(no name)'} — private: ${i.is_private}`));
    console.log('\nDry run complete. No DB writes.');
    return;
  }

  // Insert into DB
  const db = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();

  let inserted = 0;
  let skipped = 0;

  for (const item of items) {
    const username = (item.username || '').toLowerCase().trim();
    if (!username) { skipped++; continue; }

    try {
      const result = await db.query(`
        INSERT INTO instagram_leads (
          username, full_name, profile_url, profile_picture_url,
          instagram_id, is_verified, source_photo_url, scraped_at, campaign_name
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
        ON CONFLICT (username) DO NOTHING
        RETURNING id
      `, [
        username,
        item.full_name || null,
        `https://www.instagram.com/${username}/`,
        item.profile_pic_url || null,
        item.id ? String(item.id) : null,
        item.is_verified || false,
        item.liked_post || item.post_url || postUrls[0],
        campaign,
      ]);
      if (result.rows.length > 0) inserted++;
      else skipped++;
    } catch (e) {
      console.error(`  Row error for @${username}:`, e.message);
      skipped++;
    }
  }

  await db.end();

  console.log(`\n✅ Done: ${inserted} inserted, ${skipped} skipped (dupes or errors)`);
  console.log(`📊 Total instagram_leads in DB: run "SELECT COUNT(*) FROM instagram_leads" to verify`);
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
