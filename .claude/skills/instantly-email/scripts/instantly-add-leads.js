#!/usr/bin/env node
/**
 * Add leads from database to Instantly campaigns
 * Matches business category to appropriate campaign
 *
 * Usage:
 *   node instantly-add-leads.js                    # Add all leads with emails
 *   node instantly-add-leads.js --category tours   # Add specific category
 *   node instantly-add-leads.js --limit 50         # Limit number of leads
 *   node instantly-add-leads.js --dry-run          # Preview only
 */

require('dotenv').config();
const { Client } = require('pg');
const { InstantlyAPI } = require('./instantly-api');
const { CAMPAIGNS, matchCategoryToCampaign } = require('./campaign-templates');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CATEGORY_FILTER = args.includes('--category') ? args[args.indexOf('--category') + 1] : null;
const LIMIT = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 100;

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║  Instantly - Add Leads from Database       ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log();

  const apiKey = process.env.INSTANTLY_API_KEY;
  if (!apiKey) { console.error('❌ INSTANTLY_API_KEY not found in .env'); process.exit(1); }

  const dbUrl = process.env.INSFORGE_CONNECTION_STRING || process.env.DATABASE_URL;
  if (!dbUrl) { console.error('❌ INSFORGE_CONNECTION_STRING not found in .env'); process.exit(1); }

  const api = new InstantlyAPI(apiKey);
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();

  console.log('📋 Fetching campaigns from Instantly...');
  const campaigns = await api.listCampaigns();

  const campaignMap = {};
  for (const campaign of (campaigns || [])) {
    for (const [templateId, template] of Object.entries(CAMPAIGNS)) {
      if (campaign.name === template.name) {
        campaignMap[templateId] = campaign.id;
        console.log(`   ✅ ${templateId} → ${campaign.id}`);
        break;
      }
    }
  }

  if (Object.keys(campaignMap).length === 0) {
    console.error('❌ No matching campaigns found in Instantly');
    console.error('   Run `node instantly-setup.js` first to create campaigns');
    await db.end();
    process.exit(1);
  }

  console.log();
  console.log('📊 Fetching leads from database...');

  let query = `
    SELECT
      id, business_name, email, phone, website, category,
      COALESCE(NULLIF(contact_name, ''), SPLIT_PART(business_name, ' ', 1)) as first_name
    FROM business_leads
    WHERE email IS NOT NULL
      AND email != ''
      AND (instantly_campaign_id IS NULL OR instantly_campaign_id = '')
  `;

  const params = [];
  if (CATEGORY_FILTER) {
    query += ` AND LOWER(category) LIKE $1`;
    params.push(`%${CATEGORY_FILTER.toLowerCase()}%`);
  }
  query += ` ORDER BY created_at DESC LIMIT ${LIMIT}`;

  const result = await db.query(query, params);
  const leads = result.rows;
  console.log(`   Found ${leads.length} leads with emails (limit: ${LIMIT})`);

  if (leads.length === 0) {
    console.log('   No new leads to add');
    await db.end();
    return;
  }

  const leadsByCampaign = {};
  for (const lead of leads) {
    const campaignId = matchCategoryToCampaign(lead.category);
    if (!leadsByCampaign[campaignId]) leadsByCampaign[campaignId] = [];
    leadsByCampaign[campaignId].push(lead);
  }

  console.log();
  console.log('📦 Leads grouped by campaign:');
  for (const [campaignId, campaignLeads] of Object.entries(leadsByCampaign)) {
    const template = CAMPAIGNS[campaignId];
    console.log(`   ${campaignId}: ${campaignLeads.length} leads → "${template?.name || 'Unknown'}"`);
  }

  console.log();
  console.log('🚀 Adding leads to Instantly...');
  console.log();

  const stats = { added: 0, skipped: 0, failed: 0 };

  for (const [campaignId, campaignLeads] of Object.entries(leadsByCampaign)) {
    const instantlyId = campaignMap[campaignId];

    if (!instantlyId) {
      console.log(`⏭️  SKIP: No Instantly campaign for "${campaignId}"`);
      stats.skipped += campaignLeads.length;
      continue;
    }

    console.log(`📧 Adding ${campaignLeads.length} leads to "${CAMPAIGNS[campaignId].name}"...`);

    for (const lead of campaignLeads) {
      const leadPayload = {
        email: lead.email,
        first_name: lead.first_name || '',
        company_name: lead.business_name || '',
        phone: lead.phone || '',
        website: lead.website || '',
      };

      if (DRY_RUN) {
        console.log(`   [DRY RUN] Would add: ${lead.email} (${lead.business_name})`);
        stats.added++;
        continue;
      }

      try {
        await api.createLead(instantlyId, leadPayload);
        console.log(`   ✅ Added: ${lead.email}`);
        await db.query(
          `UPDATE business_leads SET instantly_campaign_id = $1, instantly_added_at = NOW() WHERE id = $2`,
          [instantlyId, lead.id]
        );
        stats.added++;
      } catch (err) {
        console.error(`   ❌ Failed: ${lead.email} - ${err.message}`);
        stats.failed++;
      }

      await new Promise(r => setTimeout(r, 100));
    }
    console.log();
  }

  await db.end();

  console.log('════════════════════════════════════════════');
  console.log('📊 SUMMARY');
  console.log('════════════════════════════════════════════');
  console.log(`   Added:   ${stats.added}`);
  console.log(`   Skipped: ${stats.skipped}`);
  console.log(`   Failed:  ${stats.failed}`);
  console.log();
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
