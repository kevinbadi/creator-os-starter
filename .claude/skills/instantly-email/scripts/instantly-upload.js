#!/usr/bin/env node
/**
 * Instantly Lead Upload
 * Uploads pending business leads to appropriate Instantly campaigns
 *
 * Usage:
 *   node instantly-upload.js                # Upload all pending leads
 *   node instantly-upload.js --limit 50     # Limit to 50 leads
 *   node instantly-upload.js --dry-run      # Preview only
 */

const { Pool } = require('pg');
require('dotenv').config();

const API_KEY = process.env.INSTANTLY_API_KEY;
const BASE_URL = 'https://api.instantly.ai/api/v2';

// TODO: Map your business categories to Instantly campaign IDs
// Get campaign IDs from: node instantly-status.js
const CAMPAIGN_MAP = {
  // 'Category Name': 'instantly-campaign-uuid',
};

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx > -1 ? parseInt(args[limitIdx + 1]) : 100;

async function uploadLead(campaignId, lead) {
  if (DRY_RUN) return { id: 'dry-run', email: lead.email };

  const response = await fetch(`${BASE_URL}/leads`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      campaign: campaignId,
      email: lead.email,
      firstName: lead.firstName || '',
      companyName: lead.companyName || '',
      customVariables: {
        businessName: lead.companyName,
        category: lead.category,
        phone: lead.phone || '',
      }
    })
  });
  return response.json();
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.INSFORGE_CONNECTION_STRING || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  console.log('═══════════════════════════════════════════════════════════');
  console.log('           📧 INSTANTLY LEAD UPLOAD');
  console.log('═══════════════════════════════════════════════════════════');
  if (DRY_RUN) console.log('   🔸 DRY RUN MODE - No actual uploads');
  console.log(`   🔸 Limit: ${LIMIT} leads\n`);

  try {
    const { rows: leads } = await pool.query(`
      SELECT id, business_name, category, email, phone
      FROM business_leads
      WHERE email IS NOT NULL
        AND email != ''
        AND email LIKE '%@%.%'
        AND LENGTH(email) > 10
        AND outreach_status = 'pending'
      LIMIT $1
    `, [LIMIT]);

    console.log(`📦 Found ${leads.length} valid leads to upload\n`);

    if (leads.length === 0) {
      console.log('✅ No pending leads to upload.');
      await pool.end();
      return;
    }

    let uploaded = 0;
    let errors = 0;
    const byCategory = {};

    for (const lead of leads) {
      const campaignId = CAMPAIGN_MAP[lead.category];
      if (!campaignId) { continue; }

      const firstName = lead.business_name.split(/[\s&,\-]/)[0];

      try {
        const result = await uploadLead(campaignId, {
          email: lead.email,
          firstName,
          companyName: lead.business_name,
          phone: lead.phone,
          category: lead.category,
        });

        if (result.id) {
          uploaded++;
          byCategory[lead.category] = (byCategory[lead.category] || 0) + 1;
          if (!DRY_RUN) {
            await pool.query(
              `UPDATE business_leads SET outreach_status = 'email_queued', updated_at = NOW() WHERE id = $1`,
              [lead.id]
            );
          }
        } else { errors++; }
      } catch (err) { errors++; }

      const total = uploaded + errors;
      if (total % 10 === 0) process.stdout.write(`\r   Processing: ${total}/${leads.length}`);
    }

    console.log('\n\n📊 Uploaded by category:');
    for (const [cat, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${cat}: ${count}`);
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`   ✅ Uploaded: ${uploaded}`);
    console.log(`   ❌ Errors:   ${errors}`);
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
