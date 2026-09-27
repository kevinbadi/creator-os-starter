#!/usr/bin/env node
// WhatsApp Phone Normalizer — normalizes Samoan phone numbers to E.164 format
// Usage: node whatsapp-phone-normalize.js [--dry-run] [--limit N]

const { Client } = require('pg');

const CONNECTION_STRING = process.env.INSFORGE_CONNECTION_STRING || process.env.DATABASE_URL;
if (!CONNECTION_STRING) { console.error('Error: INSFORGE_CONNECTION_STRING or DATABASE_URL not set'); process.exit(1); }

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 0;

/**
 * Normalize a Samoan phone number to E.164 format (+685XXXXX).
 * Returns null if not a valid Samoan mobile number (WhatsApp = mobile only).
 *
 * Samoa mobile numbers start with 7:
 *   - 5-digit: 7XXXX (older format)
 *   - 7-digit: 7XXXXXX (newer format)
 *
 * Handles: +685XXXXX, 685XXXXX, 0XXXXX, XXXXX, (685) XX XXX, spaces/dashes/parens
 */
function normalizePhone(raw) {
  if (!raw) return null;

  // Strip everything except digits and leading +
  let cleaned = raw.replace(/[^+\d]/g, '');

  // Remove leading +
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);

  // Remove country code if present
  if (cleaned.startsWith('685')) cleaned = cleaned.slice(3);

  // Remove leading 0 (local dialing prefix)
  if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);

  // Must start with 7 for mobile (WhatsApp only works on mobile)
  if (!cleaned.startsWith('7')) return null;

  // Valid lengths: 5 digits (old) or 7 digits (new)
  if (cleaned.length !== 5 && cleaned.length !== 7) return null;

  return `+685${cleaned}`;
}

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    // Get leads with phone numbers that don't already have a whatsapp_outreach row
    let sql = `
      SELECT bl.id, bl.business_name, bl.phone, bl.island, bl.category
      FROM business_leads bl
      WHERE bl.phone IS NOT NULL AND bl.phone != ''
        AND NOT EXISTS (
          SELECT 1 FROM whatsapp_outreach wo WHERE wo.business_lead_id = bl.id
        )
      ORDER BY bl.business_name
    `;
    if (limit > 0) sql += ` LIMIT ${limit}`;

    const { rows } = await client.query(sql);
    console.log(`Found ${rows.length} leads with phone numbers (no existing outreach row)\n`);

    let normalized = 0;
    let skipped = 0;
    const results = [];

    for (const row of rows) {
      const e164 = normalizePhone(row.phone);
      if (!e164) {
        skipped++;
        if (dryRun) {
          console.log(`  SKIP  ${row.business_name} | ${row.phone} (not a valid Samoan mobile)`);
        }
        continue;
      }

      normalized++;
      results.push({
        business_lead_id: row.id,
        business_name: row.business_name,
        phone_raw: row.phone,
        phone_e164: e164,
        island: row.island,
        category: row.category,
      });

      if (dryRun) {
        console.log(`  OK    ${row.business_name} | ${row.phone} → ${e164}`);
      }
    }

    console.log(`\nResults: ${normalized} valid mobile numbers, ${skipped} skipped (landline/invalid)`);

    if (!dryRun && results.length > 0) {
      console.log(`\nInserting ${results.length} rows into whatsapp_outreach...`);
      for (const r of results) {
        await client.query(
          `INSERT INTO whatsapp_outreach (business_lead_id, phone_raw, phone_e164, campaign_name, status)
           VALUES ($1, $2, $3, 'pending_normalize', 'pending')
           ON CONFLICT DO NOTHING`,
          [r.business_lead_id, r.phone_raw, r.phone_e164]
        );
      }
      console.log(`Done. ${results.length} rows inserted.`);
    } else if (!dryRun) {
      console.log('No valid mobile numbers to insert.');
    } else {
      console.log('\n(dry-run mode — no DB writes)');
    }
  } finally {
    await client.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
