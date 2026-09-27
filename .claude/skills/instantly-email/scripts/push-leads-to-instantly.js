#!/usr/bin/env node
/**
 * Push leads from DB to Instantly campaigns
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.INSFORGE_CONNECTION_STRING });
const API_KEY = process.env.INSTANTLY_API_KEY;

const CAMPAIGN_IDS = {
  vc: '00000000-0000-0000-0000-000000000002',
  podcast: '00000000-0000-0000-0000-000000000003',
  creatorclaw: '00000000-0000-0000-0000-000000000004'
};

async function addLead(campaignId, lead) {
  const res = await fetch('https://api.instantly.ai/api/v2/leads', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      campaign_id: campaignId,
      email: lead.email,
      first_name: lead.first_name || '',
      company_name: lead.company_name || '',
      website: lead.website || ''
    })
  });
  return res.json();
}

async function pushLeads(category, limit = 50) {
  const campaignId = CAMPAIGN_IDS[category];
  if (!campaignId) {
    console.error(`Unknown category: ${category}`);
    return;
  }

  const client = await pool.connect();
  try {
    const leads = await client.query(`
      SELECT id, business_name, email, website
      FROM business_leads 
      WHERE email_campaign = $1
        AND email IS NOT NULL 
        AND email != ''
        AND (outreach_status IS NULL OR outreach_status = 'pending')
      LIMIT $2
    `, [category, limit]);

    console.log(`Pushing ${leads.rows.length} leads to ${category} campaign...`);

    let success = 0;
    let failed = 0;
    const successIds = [];

    for (const lead of leads.rows) {
      try {
        const result = await addLead(campaignId, {
          email: lead.email,
          first_name: lead.business_name ? lead.business_name.split(' ')[0] : '',
          company_name: lead.business_name,
          website: lead.website || ''
        });

        if (result.id) {
          success++;
          successIds.push(lead.id);
          process.stdout.write('.');
        } else if (result.error) {
          failed++;
          console.log(`\nFailed: ${lead.email} - ${result.message || result.error}`);
        }

        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        failed++;
        console.log(`\nError: ${lead.email} - ${err.message}`);
      }
    }

    // Update DB
    if (successIds.length > 0) {
      await client.query(`
        UPDATE business_leads 
        SET outreach_status = 'email_queued',
            instantly_campaign_id = $1
        WHERE id = ANY($2::uuid[])
      `, [campaignId, successIds]);
    }

    console.log('\n');
    console.log('=== RESULTS ===');
    console.log(`Campaign: ${category}`);
    console.log(`Success: ${success}`);
    console.log(`Failed: ${failed}`);
    console.log(`DB Updated: ${successIds.length}`);

  } finally {
    client.release();
    pool.end();
  }
}

// Run for all categories or specified one
const category = process.argv[2] || 'creatorclaw';
const limit = parseInt(process.argv[3]) || 50;

pushLeads(category, limit);
