#!/usr/bin/env node
/**
 * Instantly Reset & Push
 * 1. Delete all leads from all campaigns
 * 2. Reset database outreach_status to pending
 * 3. Push all valid email leads to appropriate campaigns
 *
 * WARNING: This is destructive. Use with caution.
 *
 * Usage: node instantly-reset-and-push.js
 */

const { Pool } = require('pg');
require('dotenv').config();

const API_KEY = process.env.INSTANTLY_API_KEY;
const BASE_URL = 'https://api.instantly.ai/api/v2';

// TODO: Map your categories to Instantly campaign IDs
const CAMPAIGNS = {
  // 'Category Name': 'instantly-campaign-uuid',
};

async function deleteLeadsFromCampaign(campaignId) {
  const response = await fetch(`${BASE_URL}/leads`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ campaign_id: campaignId })
  });
  return response.json();
}

async function uploadLead(campaignId, lead) {
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
  console.log('           🔄 INSTANTLY RESET & PUSH');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    console.log('📛 STEP 1: Deleting existing leads from all campaigns...\n');

    let totalDeleted = 0;
    for (const [category, campaignId] of Object.entries(CAMPAIGNS)) {
      try {
        const result = await deleteLeadsFromCampaign(campaignId);
        const count = result.count || 0;
        totalDeleted += count;
        if (count > 0) console.log(`   Deleted ${count} leads from ${category}`);
      } catch (e) { /* continue */ }
      await new Promise(r => setTimeout(r, 200));
    }
    console.log(`\n   ✅ Total deleted: ${totalDeleted}\n`);

    console.log('🔄 STEP 2: Resetting database outreach status...\n');
    const resetResult = await pool.query(`
      UPDATE business_leads
      SET outreach_status = 'pending', updated_at = NOW()
      WHERE outreach_status IN ('email_queued', 'email_sent')
    `);
    console.log(`   ✅ Reset ${resetResult.rowCount} leads to pending\n`);

    console.log('📧 STEP 3: Fetching valid email leads...\n');
    const { rows: leads } = await pool.query(`
      SELECT id, business_name, category, email, phone
      FROM business_leads
      WHERE email IS NOT NULL
        AND email != ''
        AND email LIKE '%@%.%'
        AND LENGTH(email) > 10
        AND outreach_status = 'pending'
      ORDER BY category
    `);
    console.log(`   Found ${leads.length} leads with valid emails\n`);

    console.log('📤 STEP 4: Uploading leads to campaigns...\n');

    let uploaded = 0;
    let errors = 0;
    const byCategory = {};

    for (const lead of leads) {
      const campaignId = CAMPAIGNS[lead.category];
      if (!campaignId) { errors++; continue; }

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
          await pool.query(
            `UPDATE business_leads SET outreach_status = 'email_queued', updated_at = NOW() WHERE id = $1`,
            [lead.id]
          );
        } else { errors++; }
      } catch (err) { errors++; }

      const total = uploaded + errors;
      if (total % 20 === 0) process.stdout.write(`\r   Progress: ${total}/${leads.length} (${uploaded} uploaded)`);
      await new Promise(r => setTimeout(r, 100));
    }

    console.log('\n\n   📊 Uploaded by category:');
    for (const [cat, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
      console.log(`      ${cat}: ${count}`);
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`   ✅ Uploaded: ${uploaded} leads`);
    console.log(`   ❌ Errors:   ${errors}`);
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
