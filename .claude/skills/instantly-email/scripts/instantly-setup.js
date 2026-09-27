#!/usr/bin/env node
/**
 * Instantly Campaign Setup
 * Creates email campaign templates in Instantly
 *
 * Usage: node instantly-setup.js [--dry-run]
 */

require('dotenv').config();
const { InstantlyAPI } = require('./instantly-api');
const { CAMPAIGNS } = require('./campaign-templates');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║       Instantly Campaign Setup             ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log();

  const apiKey = process.env.INSTANTLY_API_KEY;
  if (!apiKey) {
    console.error('❌ INSTANTLY_API_KEY not found in .env');
    console.error('   Get your API v2 key from: app.instantly.ai → Settings → API');
    process.exit(1);
  }

  const api = new InstantlyAPI(apiKey);

  // Check existing campaigns
  console.log('📋 Checking existing campaigns...');
  let existingCampaigns;
  try {
    existingCampaigns = await api.listCampaigns();
    console.log(`   Found ${existingCampaigns.length || 0} existing campaigns`);
  } catch (err) {
    console.error('❌ Failed to list campaigns:', err.message);
    process.exit(1);
  }

  const existingNames = new Set((existingCampaigns || []).map(c => c.name));

  // Check email accounts
  console.log('📧 Checking email accounts...');
  let emailAccounts;
  try {
    emailAccounts = await api.listEmailAccounts();
    if (!emailAccounts || emailAccounts.length === 0) {
      console.error('❌ No email accounts connected in Instantly');
      console.error('   Connect an email account first at: app.instantly.ai');
      process.exit(1);
    }
    console.log(`   Found ${emailAccounts.length} email account(s)`);
    emailAccounts.forEach(acc => console.log(`   - ${acc.email}`));
  } catch (err) {
    console.error('❌ Failed to list email accounts:', err.message);
    process.exit(1);
  }

  console.log();
  console.log('🚀 Creating campaigns...');
  console.log();

  const results = { created: [], skipped: [], failed: [] };

  for (const [campaignId, template] of Object.entries(CAMPAIGNS)) {
    const campaignName = template.name;

    if (existingNames.has(campaignName)) {
      console.log(`⏭️  SKIP: "${campaignName}" already exists`);
      results.skipped.push(campaignId);
      continue;
    }

    console.log(`📝 Creating: "${campaignName}"`);
    console.log(`   Target: ${template.description}`);
    console.log(`   Emails: ${template.sequences[0].steps.length} in sequence`);

    if (DRY_RUN) {
      console.log('   [DRY RUN - not creating]');
      results.created.push(campaignId);
      continue;
    }

    try {
      const campaign = {
        name: campaignName,
        sequences: template.sequences,
        email_list: emailAccounts.map(a => a.email),
        daily_limit: 50,
        email_gap: 60,
        random_wait_max: 30,
        stop_on_reply: true,
        stop_on_auto_reply: true,
        link_tracking: true,
        open_tracking: true,
        text_only: false,
        campaign_schedule: {
          schedules: [
            {
              name: 'Business Hours',
              timing: { from: '09:00', to: '17:00' },
              days: { 0: false, 1: true, 2: true, 3: true, 4: true, 5: true, 6: false },
              timezone: 'America/Chicago',
            },
          ],
        },
      };

      const created = await api.createCampaign(campaign);
      console.log(`   ✅ Created with ID: ${created.id}`);
      results.created.push(campaignId);
    } catch (err) {
      console.error(`   ❌ Failed: ${err.message}`);
      results.failed.push(campaignId);
    }

    console.log();
  }

  console.log('════════════════════════════════════════════');
  console.log('📊 SUMMARY');
  console.log('════════════════════════════════════════════');
  console.log(`   Created: ${results.created.length}`);
  console.log(`   Skipped: ${results.skipped.length}`);
  console.log(`   Failed:  ${results.failed.length}`);
  console.log();

  if (results.created.length > 0 && !DRY_RUN) {
    console.log('💡 Next steps:');
    console.log('   1. Review campaigns at app.instantly.ai');
    console.log('   2. Add leads: node instantly-add-leads.js');
    console.log('   3. Activate: node instantly-activate.js --all');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
