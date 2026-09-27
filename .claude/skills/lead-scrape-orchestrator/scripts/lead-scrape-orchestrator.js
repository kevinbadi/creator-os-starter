#!/usr/bin/env node
/**
 * lead-scrape-orchestrator.js
 * Master lead generation pipeline. Runs after onboarding completes.
 * Reads onboarding-config.json and triggers each scraper in sequence.
 *
 * Pipeline:
 *   1. Google Maps      → business_leads
 *   2. LinkedIn         → linkedin_leads
 *   3. Instagram likers → instagram_leads
 *   4. Facebook pages   → business_leads.facebook
 *   5. Enrichment       → business_leads (email, phone, socials)
 *
 * Usage:
 *   node lead-scrape-orchestrator.js
 *   node lead-scrape-orchestrator.js --steps google_maps,enrichment
 *   node lead-scrape-orchestrator.js --dry-run
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const ROOT = path.resolve(__dirname, '../../..');
const CONFIG_PATH = path.join(ROOT, 'onboarding-config.json');
const RESULTS_PATH = path.join(ROOT, 'initial-scrape-results.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const stepsArg = args.includes('--steps') ? args[args.indexOf('--steps') + 1].split(',') : null;

// Read onboarding config
let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
} catch (e) {
  console.error('Cannot read onboarding-config.json:', e.message);
  process.exit(1);
}

const p4 = config.phase4 || {};
const lc = p4.lead_config || {};
const leadSources = p4.lead_sources || [];

function shouldRun(step) {
  if (stepsArg) return stepsArg.includes(step);
  return true;
}

function runScript(scriptPath, extraArgs = '') {
  const cmd = `node "${scriptPath}"${extraArgs ? ' ' + extraArgs : ''}${dryRun ? ' --dry-run' : ''}`;
  console.log(`\n▶ ${cmd}`);
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: process.env });
    return true;
  } catch (e) {
    console.error(`  ❌ Script failed: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║     LEAD SCRAPE ORCHESTRATOR         ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`Config: ${CONFIG_PATH}`);
  console.log(`Lead sources: ${leadSources.join(', ') || 'none configured'}`);
  if (dryRun) console.log('DRY RUN MODE\n');

  const results = { google_maps: 0, linkedin: 0, instagram: 0, facebook_pages: 0, enriched: 0 };

  // Step 1: Google Maps
  if (shouldRun('google_maps') && leadSources.includes('google_maps') && p4.location_city && p4.location_business_type) {
    console.log('\n── Step 1: Google Maps ──');
    runScript(
      path.join(ROOT, 'skills/apify-google-maps/scripts/apify_leads_sheet.py'),
      `--terms "${p4.location_business_type}" --location "${p4.location_city}"`
    );
  } else if (shouldRun('google_maps')) {
    console.log('\n── Step 1: Google Maps — SKIP (no location/business type configured)');
  }

  // Step 2: LinkedIn
  if (shouldRun('linkedin') && leadSources.includes('linkedin_leads') && (lc.li_lead_titles || lc.li_lead_keywords)) {
    console.log('\n── Step 2: LinkedIn Profiles ──');
    runScript(path.join(ROOT, 'scripts/initial-lead-scrape.js'), '--steps linkedin');
  } else if (shouldRun('linkedin')) {
    console.log('\n── Step 2: LinkedIn — SKIP (no titles/keywords configured)');
  }

  // Step 3: Instagram likers
  if (shouldRun('instagram') && leadSources.includes('instagram_leads') && lc.ig_competitor_posts) {
    console.log('\n── Step 3: Instagram Likers ──');
    const posts = lc.ig_competitor_posts.split(/[,\s]+/).filter(u => u.includes('instagram.com')).join(',');
    if (posts) {
      runScript(
        path.join(ROOT, 'skills/instagram-lead-scraper/scripts/instagram-lead-scraper.js'),
        `--posts "${posts}" --campaign competitor_likers`
      );
    }
  } else if (shouldRun('instagram')) {
    console.log('\n── Step 3: Instagram — SKIP (no competitor post URLs configured)');
  }

  // Step 4: Facebook page finder (runs if we have business leads)
  if (shouldRun('facebook_pages') && leadSources.includes('facebook_leads')) {
    console.log('\n── Step 4: Facebook Page Finder ──');
    runScript(path.join(ROOT, 'skills/facebook-page-finder/scripts/facebook-page-finder.js'));
  } else if (shouldRun('facebook_pages')) {
    console.log('\n── Step 4: Facebook Page Finder — SKIP (not in lead sources)');
  }

  // Step 5: Enrichment (emails + phones)
  if (shouldRun('enrichment')) {
    console.log('\n── Step 5: Lead Enrichment (emails + phones) ──');
    runScript(path.join(ROOT, 'skills/lead-enrichment/scripts/lead-enrichment.js'));
  }

  // Save results
  fs.writeFileSync(RESULTS_PATH, JSON.stringify({
    ...results,
    completed_at: new Date().toISOString(),
  }, null, 2));

  console.log('\n╔══════════════════════════════════════╗');
  console.log('║     LEAD PIPELINE COMPLETE           ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`Results saved to ${RESULTS_PATH}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
