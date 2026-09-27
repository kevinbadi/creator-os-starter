#!/usr/bin/env node
/**
 * Instantly Template Update
 * Updates campaign email templates to match approved copy
 *
 * Usage: node instantly-update-templates.js [--dry-run]
 */

require('dotenv').config();

const API_KEY = process.env.INSTANTLY_API_KEY;
const BASE_URL = 'https://api.instantly.ai/api/v2';

// TODO: Define your email templates per campaign category
const TEMPLATES = {
  general: {
    subject: 'Free promotion for your business on {{YOUR_BRAND}}',
    body: `<p>Hello {{firstName|there}},</p>

<p>We are currently inviting local businesses to be featured on <strong>{{YOUR_BRAND}}</strong>.</p>

<p>We would love to include <strong>{{companyName}}</strong> on the platform.</p>

<p>Your listing includes:</p>
<ul>
<li>Business profile</li>
<li>Contact information</li>
<li>Location map</li>
<li>Photos</li>
<li>Direct exposure to your target audience</li>
</ul>

<p>The listing is completely free.</p>

<p>If you would like us to add your business, simply reply to this email.</p>

<p>Kind regards,</p>
<p><strong>{{YOUR_NAME}}</strong><br/>
{{YOUR_TITLE}}<br/>
{{YOUR_BRAND}}</p>`
  },

  // TODO: Add more templates for different categories
};

// TODO: Map your Instantly campaign IDs to template keys
const CAMPAIGN_TEMPLATES = {
  // 'instantly-campaign-uuid': 'general',
};

async function fetchCampaigns() {
  const response = await fetch(`${BASE_URL}/campaigns?limit=20`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  return response.json();
}

async function updateCampaignSequence(campaignId, template) {
  const response = await fetch(`${BASE_URL}/campaigns/${campaignId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sequences: [{
        steps: [{
          type: 'email',
          delay: 0,
          delay_unit: 'days',
          variants: [{ subject: template.subject, body: template.body }]
        }]
      }]
    })
  });
  return response.json();
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('           📝 INSTANTLY TEMPLATE UPDATE');
  console.log('═══════════════════════════════════════════════════════════\n');

  const DRY_RUN = process.argv.includes('--dry-run');
  if (DRY_RUN) console.log('🔸 DRY RUN MODE\n');

  try {
    const { items: campaigns } = await fetchCampaigns();
    let updated = 0;

    for (const campaign of campaigns) {
      const templateKey = CAMPAIGN_TEMPLATES[campaign.id];

      if (!templateKey) {
        console.log(`⏭️ Skipping: ${campaign.name} (no template mapped)`);
        continue;
      }

      const template = TEMPLATES[templateKey];

      if (!DRY_RUN) {
        const result = await updateCampaignSequence(campaign.id, template);
        if (result.error) {
          console.log(`❌ ${campaign.name}: ${result.message || result.error}`);
        } else {
          console.log(`✅ ${campaign.name} → ${templateKey} template`);
          updated++;
        }
      } else {
        console.log(`📝 Would update: ${campaign.name} → ${templateKey}`);
        updated++;
      }

      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`\n═══════════════════════════════════════════════════════════`);
    console.log(`   ✅ ${updated} campaigns ${DRY_RUN ? 'would be ' : ''}updated`);
    console.log(`═══════════════════════════════════════════════════════════\n`);

  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
