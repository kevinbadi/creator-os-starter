#!/usr/bin/env node
/**
 * Instantly Analytics
 * Fetches campaign analytics and syncs to database
 *
 * Usage: node instantly-analytics.js
 */

const { Pool } = require('pg');
require('dotenv').config();

const API_KEY = process.env.INSTANTLY_API_KEY;
const BASE_URL = 'https://api.instantly.ai/api/v2';

async function fetchCampaigns() {
  const response = await fetch(`${BASE_URL}/campaigns?limit=20`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  return response.json();
}

async function fetchAllCampaignAnalytics(campaignIds = []) {
  const queryParams = campaignIds.length > 0 ? `?campaign_ids=${campaignIds.join(',')}` : '';
  const response = await fetch(`${BASE_URL}/campaigns/analytics${queryParams}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  return response.json();
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.INSFORGE_CONNECTION_STRING || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  console.log('═══════════════════════════════════════════════════════════');
  console.log('           📊 INSTANTLY CAMPAIGN ANALYTICS');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_campaign_stats (
        id SERIAL PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        campaign_name TEXT,
        date DATE DEFAULT CURRENT_DATE,
        leads_total INT DEFAULT 0,
        emails_sent INT DEFAULT 0,
        emails_opened INT DEFAULT 0,
        emails_replied INT DEFAULT 0,
        emails_bounced INT DEFAULT 0,
        open_rate DECIMAL(5,2),
        reply_rate DECIMAL(5,2),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(campaign_id, date)
      )
    `);

    const { items: campaigns } = await fetchCampaigns();
    if (!campaigns || campaigns.length === 0) { console.log('No campaigns found.'); await pool.end(); return; }

    console.log(`Found ${campaigns.length} campaigns\n`);

    const campaignIds = campaigns.map(c => c.id);
    let allAnalytics = [];
    try { allAnalytics = await fetchAllCampaignAnalytics(campaignIds); } catch (e) { console.log('Warning: Could not fetch analytics:', e.message); }

    const analyticsMap = {};
    for (const a of (allAnalytics || [])) { analyticsMap[a.campaign_id] = a; }

    let totalSent = 0, totalOpened = 0, totalReplied = 0, totalBounced = 0, totalLeads = 0;

    for (const campaign of campaigns) {
      const analytics = analyticsMap[campaign.id] || {};
      const sent = analytics.emails_sent_count || 0;
      const opened = analytics.open_count_unique || 0;
      const replied = analytics.reply_count_unique || 0;
      const bounced = analytics.bounced_count || 0;
      const leads = analytics.leads_count || 0;
      const contacted = analytics.contacted_count || 0;
      const openRate = sent > 0 ? ((opened / sent) * 100).toFixed(1) : 0;
      const replyRate = sent > 0 ? ((replied / sent) * 100).toFixed(1) : 0;

      const status = campaign.status === 1 ? '🟢 Active' : '⏸️ Paused';
      console.log(`${status} ${campaign.name}`);
      console.log(`   Leads: ${leads} | Contacted: ${contacted} | Sent: ${sent} | Bounced: ${bounced}`);
      if (sent > 0) console.log(`   Opened: ${opened} (${openRate}%) | Replied: ${replied} (${replyRate}%)`);

      totalSent += sent; totalOpened += opened; totalReplied += replied; totalBounced += bounced; totalLeads += leads;

      await pool.query(`
        INSERT INTO email_campaign_stats
          (campaign_id, campaign_name, leads_total, emails_sent, emails_opened, emails_replied, emails_bounced, open_rate, reply_rate)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (campaign_id, date) DO UPDATE SET
          leads_total = EXCLUDED.leads_total, emails_sent = EXCLUDED.emails_sent,
          emails_opened = EXCLUDED.emails_opened, emails_replied = EXCLUDED.emails_replied,
          emails_bounced = EXCLUDED.emails_bounced, open_rate = EXCLUDED.open_rate, reply_rate = EXCLUDED.reply_rate
      `, [campaign.id, campaign.name, leads, sent, opened, replied, bounced, openRate, replyRate]);
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('                      TOTALS');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   📋 Total Leads:    ${totalLeads}`);
    console.log(`   📤 Emails Sent:    ${totalSent}`);
    console.log(`   👁️  Emails Opened:  ${totalOpened} (${totalSent > 0 ? ((totalOpened/totalSent)*100).toFixed(1) : 0}%)`);
    console.log(`   💬 Replies:        ${totalReplied} (${totalSent > 0 ? ((totalReplied/totalSent)*100).toFixed(1) : 0}%)`);
    console.log(`   ❌ Bounced:        ${totalBounced}`);
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
