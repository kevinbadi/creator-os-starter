#!/usr/bin/env node
/**
 * Instantly Sync Replies
 * Checks for email replies and updates lead status in database
 *
 * Usage: node instantly-sync-replies.js
 */

const { Pool } = require('pg');
require('dotenv').config();

const API_KEY = process.env.INSTANTLY_API_KEY;
const BASE_URL = 'https://api.instantly.ai/api/v2';

async function fetchLeadsWithReplies(campaignId) {
  const response = await fetch(
    `${BASE_URL}/leads/search?campaign=${campaignId}&reply_status=1&limit=100`,
    { headers: { 'Authorization': `Bearer ${API_KEY}` } }
  );
  return response.json();
}

async function fetchAllCampaigns() {
  const response = await fetch(`${BASE_URL}/campaigns?limit=20`, {
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
  console.log('           📬 INSTANTLY REPLY SYNC');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_replies (
        id SERIAL PRIMARY KEY,
        lead_email TEXT NOT NULL,
        campaign_id TEXT,
        replied_at TIMESTAMP,
        reply_content TEXT,
        lead_id INT REFERENCES business_leads(id),
        processed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(lead_email, campaign_id)
      )
    `);

    const { items: campaigns } = await fetchAllCampaigns();

    let totalReplies = 0;
    let newReplies = 0;

    for (const campaign of campaigns) {
      try {
        const result = await fetchLeadsWithReplies(campaign.id);

        if (result.items && result.items.length > 0) {
          for (const lead of result.items) {
            totalReplies++;

            const existing = await pool.query(
              'SELECT id FROM email_replies WHERE lead_email = $1 AND campaign_id = $2',
              [lead.email, campaign.id]
            );

            if (existing.rows.length === 0) {
              newReplies++;

              await pool.query(`
                INSERT INTO email_replies (lead_email, campaign_id, replied_at)
                VALUES ($1, $2, $3)
                ON CONFLICT DO NOTHING
              `, [lead.email, campaign.id, lead.timestamp_replied || new Date()]);

              await pool.query(`
                UPDATE business_leads
                SET outreach_status = 'email_replied', updated_at = NOW()
                WHERE email = $1
              `, [lead.email]);

              console.log(`   🔥 New reply: ${lead.email} (${lead.company_name || 'Unknown'})`);
            }
          }
        }
      } catch (e) {
        // Campaign might not have reply data
      }
    }

    // Also check for opened emails
    for (const campaign of campaigns) {
      try {
        const response = await fetch(
          `${BASE_URL}/leads/search?campaign=${campaign.id}&open_status=1&limit=100`,
          { headers: { 'Authorization': `Bearer ${API_KEY}` } }
        );
        const result = await response.json();

        if (result.items) {
          for (const lead of result.items) {
            await pool.query(`
              UPDATE business_leads
              SET outreach_status = CASE
                WHEN outreach_status = 'email_replied' THEN 'email_replied'
                ELSE 'email_opened'
              END,
              updated_at = NOW()
              WHERE email = $1 AND outreach_status IN ('email_queued', 'email_sent')
            `, [lead.email]);
          }
        }
      } catch (e) {
        // Continue
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`   📬 Total replies tracked: ${totalReplies}`);
    console.log(`   🆕 New replies found:     ${newReplies}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    const hotLeads = await pool.query(`
      SELECT business_name, email, category
      FROM business_leads
      WHERE outreach_status = 'email_replied'
      ORDER BY updated_at DESC
      LIMIT 10
    `);

    if (hotLeads.rows.length > 0) {
      console.log('🔥 Hot Leads (Replied):');
      for (const lead of hotLeads.rows) {
        console.log(`   • ${lead.business_name} - ${lead.email}`);
      }
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
