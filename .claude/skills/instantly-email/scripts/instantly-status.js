#!/usr/bin/env node
/**
 * Check Instantly campaign status and analytics
 *
 * Usage: node instantly-status.js [--verbose]
 */

require('dotenv').config();
const { InstantlyAPI } = require('./instantly-api');

const VERBOSE = process.argv.includes('--verbose');

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║       Instantly Campaign Status            ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log();

  const apiKey = process.env.INSTANTLY_API_KEY;
  if (!apiKey) { console.error('❌ INSTANTLY_API_KEY not found in .env'); process.exit(1); }

  const api = new InstantlyAPI(apiKey);

  console.log('📋 Fetching campaigns...');
  const campaigns = await api.listCampaigns();

  if (!campaigns || campaigns.length === 0) { console.log('   No campaigns found'); return; }

  console.log('📊 Fetching analytics...');
  const campaignIds = campaigns.map(c => c.id);
  let analytics;
  try { analytics = await api.getCampaignAnalytics(campaignIds); } catch (err) { console.log('   Analytics not available'); analytics = []; }

  const analyticsMap = {};
  for (const a of (analytics || [])) { analyticsMap[a.campaign_id] = a; }

  console.log();
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('CAMPAIGN STATUS');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log();

  const statusLabels = { 0: '⏸️  Paused', 1: '✅ Active', 2: '🏁 Completed', 3: '❌ Error' };

  for (const campaign of campaigns) {
    console.log(`${campaign.name}`);
    console.log(`   ID: ${campaign.id}`);
    console.log(`   Status: ${statusLabels[campaign.status] || campaign.status}`);

    const stats = analyticsMap[campaign.id];
    if (stats) {
      console.log(`   Leads: ${stats.leads_count || 0}`);
      console.log(`   Contacted: ${stats.contacted_count || 0}`);
      console.log(`   Emails Sent: ${stats.emails_sent_count || 0}`);
      console.log(`   Opens: ${stats.open_count_unique || 0} (${stats.open_count || 0} total)`);
      console.log(`   Replies: ${stats.reply_count_unique || 0} (${stats.reply_count || 0} total)`);
      console.log(`   Bounced: ${stats.bounced_count || 0}`);

      if (stats.emails_sent_count > 0) {
        const openRate = ((stats.open_count_unique || 0) / stats.emails_sent_count * 100).toFixed(1);
        const replyRate = ((stats.reply_count_unique || 0) / stats.emails_sent_count * 100).toFixed(1);
        console.log(`   Open Rate: ${openRate}%`);
        console.log(`   Reply Rate: ${replyRate}%`);
      }
    }

    if (VERBOSE && campaign.sequences) console.log(`   Sequences: ${campaign.sequences.length}`);
    console.log();
  }

  const activeCampaigns = campaigns.filter(c => c.status === 1);
  console.log('════════════════════════════════════════════════════════════════════');
  console.log(`Total: ${campaigns.length} | Active: ${activeCampaigns.length}`);
  console.log();
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
