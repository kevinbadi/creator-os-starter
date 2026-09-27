#!/usr/bin/env node
/**
 * Instantly Campaign Activation
 * Activate, pause, or list campaign status
 *
 * Usage:
 *   node instantly-activate.js              # List all campaigns
 *   node instantly-activate.js --all        # Activate all campaigns
 *   node instantly-activate.js --all --pause # Pause all campaigns
 *   node instantly-activate.js <campaign-id> # Activate specific campaign
 */

require('dotenv').config();

const API_KEY = process.env.INSTANTLY_API_KEY;
const BASE_URL = 'https://api.instantly.ai/api/v2';

const args = process.argv.slice(2);
const CAMPAIGN_ID = args.find(a => !a.startsWith('--'));
const ACTIVATE_ALL = args.includes('--all');
const PAUSE = args.includes('--pause');

async function fetchCampaigns() {
  const response = await fetch(`${BASE_URL}/campaigns?limit=20`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  return response.json();
}

async function updateCampaignStatus(campaignId, status) {
  const response = await fetch(`${BASE_URL}/campaigns/${campaignId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status })
  });
  return response.json();
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('           ⚡ INSTANTLY CAMPAIGN CONTROL');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    const { items: campaigns } = await fetchCampaigns();

    if (!campaigns || campaigns.length === 0) {
      console.log('No campaigns found.');
      return;
    }

    const action = PAUSE ? 'Pausing' : 'Activating';
    const newStatus = PAUSE ? 0 : 1;
    const statusIcon = PAUSE ? '⏸️' : '🟢';

    if (CAMPAIGN_ID) {
      const campaign = campaigns.find(c => c.id === CAMPAIGN_ID);
      if (!campaign) { console.log(`Campaign ${CAMPAIGN_ID} not found.`); return; }
      await updateCampaignStatus(CAMPAIGN_ID, newStatus);
      console.log(`${statusIcon} ${action}: ${campaign.name}`);

    } else if (ACTIVATE_ALL) {
      let count = 0;
      for (const campaign of campaigns) {
        if (campaign.name.includes('Test')) continue;
        if (campaign.status !== (PAUSE ? 0 : 1)) {
          await updateCampaignStatus(campaign.id, newStatus);
          console.log(`${statusIcon} ${action}: ${campaign.name}`);
          count++;
          await new Promise(r => setTimeout(r, 500));
        }
      }
      console.log(`\n✅ ${count} campaigns ${PAUSE ? 'paused' : 'activated'}`);

    } else {
      console.log('Current campaign status:\n');
      for (const campaign of campaigns) {
        const status = campaign.status === 1 ? '🟢 Active' : '⏸️ Paused';
        console.log(`${status} ${campaign.name}`);
        console.log(`   ID: ${campaign.id}`);
      }
      console.log('\nUsage:');
      console.log('  node instantly-activate.js --all          # Activate all');
      console.log('  node instantly-activate.js --all --pause  # Pause all');
      console.log('  node instantly-activate.js <campaign-id>  # Activate one');
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
