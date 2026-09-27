#!/usr/bin/env node
/**
 * Find company domains for LinkedIn leads using Apify Google Search
 * Then enrich with Contact Details Scraper
 */

require('dotenv').config();
const { Pool } = require('pg');
const { ApifyClient } = require('apify-client');

const pool = new Pool({ connectionString: process.env.INSFORGE_CONNECTION_STRING });
const apify = new ApifyClient({ token: process.env.APIFY_API_KEY });

const args = process.argv.slice(2);
const campaign = args.find(a => a.startsWith('--campaign='))?.split('=')[1] || 'vc';
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '10');
const dryRun = args.includes('--dry-run');

async function findDomainForCompany(companyName) {
  if (!companyName || companyName.length < 3) return null;
  
  // Use Google Search Scraper to find company website
  const run = await apify.actor('apify/google-search-scraper').call({
    queries: `${companyName} official website`,
    maxPagesPerQuery: 1,
    resultsPerPage: 3,
    mobileResults: false,
    languageCode: 'en',
    countryCode: 'us'
  }, { waitSecs: 60 });
  
  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  
  // Find first result that looks like a company website (not LinkedIn, Facebook, etc)
  const skipDomains = ['linkedin.com', 'facebook.com', 'twitter.com', 'instagram.com', 'youtube.com', 'crunchbase.com', 'glassdoor.com', 'yelp.com', 'wikipedia.org', 'zoominfo.com', 'apollo.io'];
  
  for (const result of items) {
    if (result.organicResults) {
      for (const r of result.organicResults) {
        const url = r.url || r.link;
        if (url && !skipDomains.some(d => url.includes(d))) {
          try {
            const domain = new URL(url).hostname.replace('www.', '');
            return { domain, url };
          } catch (e) {}
        }
      }
    }
  }
  return null;
}

async function scrapeEmailsFromWebsites(websites) {
  if (websites.length === 0) return [];
  
  console.log(`\n📧 Scraping ${websites.length} websites for contact emails...`);
  
  const startUrls = websites.map(w => ({ url: w.url }));
  
  const run = await apify.actor('QAKrfXwAcbmcWYnSo').call({
    startUrls,
    maxRequestsPerStartUrl: 3,
    maxCrawlDepth: 2,
    considerChildFrames: false
  }, { waitSecs: 120 });
  
  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  
  // Map results back to leads
  const emailResults = [];
  for (const item of items) {
    const website = websites.find(w => item.url?.includes(w.domain) || w.url?.includes(new URL(item.url || '').hostname));
    if (website && item.emails?.length > 0) {
      // Pick best email (prefer info@, contact@, hello@, or first available)
      const preferredPrefixes = ['info', 'contact', 'hello', 'team', 'support'];
      let bestEmail = item.emails[0];
      for (const prefix of preferredPrefixes) {
        const found = item.emails.find(e => e.toLowerCase().startsWith(prefix + '@'));
        if (found) { bestEmail = found; break; }
      }
      emailResults.push({ leadId: website.leadId, email: bestEmail, allEmails: item.emails });
    }
  }
  
  return emailResults;
}

async function main() {
  console.log(`🔍 LinkedIn Lead Email Enrichment`);
  console.log(`   Campaign: ${campaign}`);
  console.log(`   Limit: ${limit}`);
  if (dryRun) console.log('   🧪 DRY RUN\n');
  
  const client = await pool.connect();
  
  try {
    // Get leads with company names but no email
    const leads = await client.query(`
      SELECT id, first_name, last_name, current_company, linkedin_url
      FROM linkedin_leads 
      WHERE campaign_name = $1
        AND current_company IS NOT NULL
        AND current_company != ''
        AND (email IS NULL OR email = '')
      LIMIT $2
    `, [campaign, limit]);
    
    console.log(`📋 Found ${leads.rows.length} leads to process\n`);
    
    if (leads.rows.length === 0) {
      console.log('No leads to process!');
      return;
    }
    
    // Step 1: Find company websites
    const websites = [];
    for (const lead of leads.rows) {
      console.log(`🔎 ${lead.first_name} ${lead.last_name} @ ${lead.current_company}`);
      
      try {
        const result = await findDomainForCompany(lead.current_company);
        
        if (result) {
          console.log(`   ✅ ${result.domain}`);
          websites.push({ leadId: lead.id, ...result, lead });
        } else {
          console.log(`   ❌ No website found`);
        }
        
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        console.log(`   ⚠️ Error: ${err.message}`);
      }
    }
    
    console.log(`\n📊 Found ${websites.length}/${leads.rows.length} company websites`);
    
    if (websites.length === 0) {
      console.log('No websites found to scrape!');
      return;
    }
    
    // Step 2: Scrape those websites for emails
    const emailResults = await scrapeEmailsFromWebsites(websites);
    
    console.log(`\n📧 Found emails for ${emailResults.length} leads:`);
    
    // Step 3: Update database
    for (const result of emailResults) {
      const lead = websites.find(w => w.leadId === result.leadId)?.lead;
      console.log(`   ${lead?.first_name} ${lead?.last_name}: ${result.email}`);
      
      if (!dryRun) {
        await client.query(`
          UPDATE linkedin_leads 
          SET email = $1
          WHERE id = $2 AND (email IS NULL OR email = '')
        `, [result.email, result.leadId]);
      }
    }
    
    console.log(`\n✅ Done! Updated ${emailResults.length} leads with emails.`);
    
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
