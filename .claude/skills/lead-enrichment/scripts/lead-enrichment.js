#!/usr/bin/env node
/**
 * lead-enrichment.js
 * Crawls business websites to extract emails, phones, and social handles.
 * Uses Apify Contact Details Scraper (QAKrfXwAcbmcWYnSo).
 *
 * Usage:
 *   node lead-enrichment.js [--limit 100] [--dry-run]
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const { ApifyClient } = require('apify-client');
const { Client } = require('pg');

const CONTACT_SCRAPER_ACTOR = 'QAKrfXwAcbmcWYnSo';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 100;

const APIFY_KEY = process.env.APIFY_API_KEY;
const DB_URL = process.env.INSFORGE_CONNECTION_STRING;

if (!APIFY_KEY) { console.error('Missing APIFY_API_KEY'); process.exit(1); }
if (!DB_URL) { console.error('Missing INSFORGE_CONNECTION_STRING'); process.exit(1); }

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

async function main() {
  const apify = new ApifyClient({ token: APIFY_KEY });
  const db = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();

  // Get leads with websites but missing email
  const { rows } = await db.query(`
    SELECT id, name, website FROM business_leads
    WHERE website IS NOT NULL AND email IS NULL
    ORDER BY created_at DESC
    LIMIT $1
  `, [limitArg]);

  console.log(`\n📧 Lead Enrichment`);
  console.log(`Found ${rows.length} leads with websites but no email`);

  if (rows.length === 0) {
    console.log('Nothing to enrich.');
    await db.end();
    return;
  }

  if (dryRun) {
    rows.forEach(r => console.log(`  [DRY-RUN] Would crawl: ${r.website} (${r.name})`));
    await db.end();
    return;
  }

  const websites = rows.map(r => {
    let url = (r.website || '').trim();
    if (!url.startsWith('http')) url = 'https://' + url;
    return { url, leadId: r.id, name: r.name };
  });

  console.log(`\n🚀 Submitting ${websites.length} websites to Apify Contact Scraper...`);

  const run = await apify.actor(CONTACT_SCRAPER_ACTOR).call({
    startUrls: websites.map(w => ({ url: w.url })),
    maxRequestsPerStartUrl: 3,
  }, { waitSecs: 600 });

  const items = await fetchAllItems(apify, run.defaultDatasetId);
  console.log(`Got contact info from ${items.length} pages`);

  let enriched = 0;

  for (const item of items) {
    const pageUrl = (item.url || '').toLowerCase();
    const matchedLead = websites.find(w => pageUrl.startsWith(w.url.toLowerCase().replace(/\/$/, '')));
    if (!matchedLead) continue;

    const emails = (item.emails || []).filter(e => e && !e.includes('example.') && !e.includes('sentry.'));
    const phones = item.phones || [];
    const facebook = (item.linkedIns || item.facebooks || []).find(u => u && u.includes('facebook.com'));
    const instagram = (item.instagrams || []).find(u => u && u.includes('instagram.com'));

    if (!emails.length && !phones.length && !facebook && !instagram) continue;

    const updates = [];
    const params = [];
    let idx = 1;

    if (emails.length) { updates.push(`email = COALESCE(NULLIF(email,''), $${idx})`); params.push(emails[0]); idx++; }
    if (phones.length) { updates.push(`phone = COALESCE(NULLIF(phone,''), $${idx})`); params.push(phones[0]); idx++; }
    if (facebook) {
      const fbHandle = facebook.match(/facebook\.com\/([^/?#]+)/)?.[1];
      if (fbHandle) { updates.push(`facebook = COALESCE(NULLIF(facebook,''), $${idx})`); params.push(fbHandle); idx++; }
    }
    if (instagram) {
      const igHandle = instagram.match(/instagram\.com\/([^/?#]+)/)?.[1];
      if (igHandle) { updates.push(`instagram = COALESCE(NULLIF(instagram,''), $${idx})`); params.push(igHandle); idx++; }
    }

    if (updates.length === 0) continue;

    params.push(matchedLead.leadId);
    try {
      const r = await db.query(
        `UPDATE business_leads SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
        params
      );
      if (r.rowCount > 0) {
        const found = [];
        if (emails.length) found.push(`email: ${emails[0]}`);
        if (phones.length) found.push(`phone: ${phones[0]}`);
        if (facebook) found.push(`fb`);
        if (instagram) found.push(`ig`);
        console.log(`  ✅ ${matchedLead.name}: ${found.join(', ')}`);
        enriched++;
      }
    } catch (e) { console.log(`  ⚠️ ${matchedLead.name}: ${e.message}`); }
  }

  await db.end();
  console.log(`\n✅ Done: ${enriched} leads enriched with contact info`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
