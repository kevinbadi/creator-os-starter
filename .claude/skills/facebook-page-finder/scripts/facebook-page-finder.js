#!/usr/bin/env node
/**
 * facebook-page-finder.js
 * Finds Facebook page URLs for businesses in business_leads using Google Search via Apify.
 *
 * Usage:
 *   node facebook-page-finder.js [--limit 50] [--dry-run]
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const { ApifyClient } = require('apify-client');
const { Client } = require('pg');

const GOOGLE_SEARCH_ACTOR = 'nFJndFXA5zjCTuudP';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 100;

const APIFY_KEY = process.env.APIFY_API_KEY;
const DB_URL = process.env.INSFORGE_CONNECTION_STRING;

if (!APIFY_KEY) { console.error('Missing APIFY_API_KEY'); process.exit(1); }
if (!DB_URL) { console.error('Missing INSFORGE_CONNECTION_STRING'); process.exit(1); }

async function main() {
  const apify = new ApifyClient({ token: APIFY_KEY });
  const db = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();

  // Get leads missing Facebook handles
  const { rows } = await db.query(`
    SELECT id, name, city FROM business_leads
    WHERE facebook IS NULL AND name IS NOT NULL
    ORDER BY created_at DESC
    LIMIT $1
  `, [limitArg]);

  console.log(`\n🔍 Facebook Page Finder`);
  console.log(`Found ${rows.length} businesses missing Facebook handles`);

  if (rows.length === 0) {
    console.log('Nothing to do.');
    await db.end();
    return;
  }

  if (dryRun) {
    rows.forEach(r => console.log(`  [DRY-RUN] Would search: "${r.name}" facebook`));
    await db.end();
    return;
  }

  // Build search queries
  const queries = rows.map(r => ({
    term: `"${r.name}" facebook ${r.city || ''}`.trim(),
    leadId: r.id,
    leadName: r.name,
  }));

  console.log(`\n🚀 Running Google Search via Apify for ${queries.length} businesses...`);

  const run = await apify.actor(GOOGLE_SEARCH_ACTOR).call({
    queries: queries.map(q => q.term).join('\n'),
    maxPagesPerQuery: 1,
    resultsPerPage: 5,
  }, { waitSecs: 300 });

  const { items } = await apify.dataset(run.defaultDatasetId).listItems({ limit: 5000 });
  console.log(`Got ${items.length} search results`);

  const skipHandles = new Set(['pages', 'groups', 'watch', 'events', 'marketplace', 'profile.php', 'help', 'legal', 'policies', 'login', 'sharer']);

  let updated = 0;
  for (const item of items) {
    const url = item.url || item.link || '';
    if (!url.includes('facebook.com/')) continue;

    const match = url.match(/facebook\.com\/([^/?#\s]+)/);
    if (!match) continue;
    const handle = match[1];
    if (skipHandles.has(handle.toLowerCase())) continue;

    const searchTerm = (item.searchQuery || item.query || '').toLowerCase();
    const matchedLead = queries.find(q =>
      searchTerm.includes(q.leadName.toLowerCase().split(' ')[0])
    );

    if (matchedLead) {
      try {
        const r = await db.query(`
          UPDATE business_leads SET facebook = $1, updated_at = NOW()
          WHERE id = $2 AND facebook IS NULL
          RETURNING id
        `, [handle, matchedLead.leadId]);
        if (r.rowCount > 0) {
          console.log(`  ✅ ${matchedLead.leadName} → facebook.com/${handle}`);
          updated++;
        }
      } catch (e) { /* skip */ }
    }
  }

  await db.end();
  console.log(`\n✅ Done: ${updated} leads updated with Facebook handles`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
