#!/usr/bin/env node
// Facebook URL Normalizer — normalizes Facebook handles from business_leads
// Usage: node facebook-url-normalize.js [--dry-run] [--limit N]

const { Client } = require('pg');

const CONNECTION_STRING = process.env.INSFORGE_CONNECTION_STRING || process.env.DATABASE_URL;
if (!CONNECTION_STRING) { console.error('Error: INSFORGE_CONNECTION_STRING or DATABASE_URL not set'); process.exit(1); }

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 0;

// Generic/invalid slugs to reject (from apify-facebook-search.js reject list + extras)
const REJECT_SLUGS = new Set([
  'sharer', 'share', 'pages', 'dialog', 'login', 'groups', 'events', 'watch',
  'marketplace', 'gaming', 'meta', 'people', 'profile.php', 'help', 'policies',
  'privacy', 'about', 'ads', 'business', 'developers', 'messenger', 'p',
  'wordpresscom', 'marriottbonvoy', 'settings', 'notifications', 'bookmarks', 'saved',
  'story.php', 'photo.php', 'video', 'videos', 'photos', 'hashtag', 'search',
]);

/**
 * Normalize a Facebook handle to a clean slug.
 * Input can be: URL, @handle, or raw handle.
 * Returns null if not a valid page handle.
 */
function normalizeHandle(raw) {
  if (!raw) return null;

  let handle = raw.trim();

  // Strip leading @
  if (handle.startsWith('@')) handle = handle.slice(1);

  // Extract handle from full URLs
  // Handles: https://www.facebook.com/SamoaBeachFales, facebook.com/SamoaBeachFales, etc.
  const urlMatch = handle.match(/(?:https?:\/\/)?(?:www\.)?(?:m\.)?facebook\.com\/([a-zA-Z0-9._-]+)/i);
  if (urlMatch) {
    handle = urlMatch[1];
  }

  // Clean up: strip trailing slashes, query params
  handle = handle.split('?')[0].split('/')[0].trim();

  // Reject empty, too short, or generic slugs
  if (!handle || handle.length < 2) return null;
  if (REJECT_SLUGS.has(handle.toLowerCase())) return null;

  // Reject numeric-only IDs (profile IDs, not page names)
  if (/^\d+$/.test(handle)) return null;

  return handle;
}

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    // Get leads with Facebook handles that don't already have a facebook_outreach row
    let sql = `
      SELECT bl.id, bl.business_name, bl.facebook, bl.island, bl.category
      FROM business_leads bl
      WHERE bl.facebook IS NOT NULL AND bl.facebook != ''
        AND NOT EXISTS (
          SELECT 1 FROM facebook_outreach fo WHERE fo.business_lead_id = bl.id
        )
      ORDER BY bl.business_name
    `;
    if (limit > 0) sql += ` LIMIT ${limit}`;

    const { rows } = await client.query(sql);
    console.log(`Found ${rows.length} leads with Facebook handles (no existing outreach row)\n`);

    let normalized = 0;
    let skipped = 0;
    const results = [];

    for (const row of rows) {
      const handle = normalizeHandle(row.facebook);
      if (!handle) {
        skipped++;
        if (dryRun) {
          console.log(`  SKIP  ${row.business_name} | ${row.facebook} (invalid/generic handle)`);
        }
        continue;
      }

      const fbUrl = `https://www.facebook.com/${handle}`;
      normalized++;
      results.push({
        business_lead_id: row.id,
        business_name: row.business_name,
        facebook_handle: row.facebook,
        facebook_url: fbUrl,
        island: row.island,
        category: row.category,
      });

      if (dryRun) {
        console.log(`  OK    ${row.business_name} | ${row.facebook} → ${fbUrl}`);
      }
    }

    console.log(`\nResults: ${normalized} valid handles, ${skipped} skipped (invalid/generic)`);

    if (!dryRun && results.length > 0) {
      console.log(`\nInserting ${results.length} rows into facebook_outreach...`);
      for (const r of results) {
        await client.query(
          `INSERT INTO facebook_outreach (business_lead_id, facebook_handle, facebook_url, campaign_name, status)
           VALUES ($1, $2, $3, 'pending_normalize', 'pending')
           ON CONFLICT DO NOTHING`,
          [r.business_lead_id, r.facebook_handle, r.facebook_url]
        );
      }
      console.log(`Done. ${results.length} rows inserted.`);
    } else if (!dryRun) {
      console.log('No valid handles to insert.');
    } else {
      console.log('\n(dry-run mode — no DB writes)');
    }
  } finally {
    await client.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
