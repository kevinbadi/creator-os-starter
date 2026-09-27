#!/usr/bin/env node
/**
 * apify-linkedin-search.js — Search LinkedIn profiles via Apify HarvestAPI.
 *
 * Uses: harvestapi/linkedin-profile-search (actor M2FMdjRVeF1HPGFcc)
 *   - No cookies/session needed
 *   - Keyword search via searchQuery field
 *   - Filter by location, combine with keywords
 *
 * Pricing:
 *   - $0.10 per search page (up to 25 short profiles)
 *   - $4 per 1k full profiles
 *   - $10 per 1k full profiles with email search
 *
 * Usage:
 *   node apify-linkedin-search.js --query "agency founder"
 *   node apify-linkedin-search.js --query "marketing manager" --location "Austin"
 *   node apify-linkedin-search.js --query "CEO" --mode email --max 50
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ApifyClient } = require("apify-client");

// --- Onboarding Config ---
const onboardingConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'onboarding-config.json'), 'utf8'));
const phase2 = onboardingConfig.phase2 || {};

// --- Args ---
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}
function hasFlag(name) { return args.includes(name); }

const searchQuery = getArg("--query");
const location = getArg("--location");
const maxItems = parseInt(getArg("--max") || "100", 10);
const campaignName = getArg("--campaign") || "linkedin_search";
const mode = getArg("--mode") || "search"; // search | full | email
const dryRun = hasFlag("--dry-run");

if (!searchQuery && !location) {
  console.error("Error: --query or --location is required");
  console.error("");
  console.error("Usage: node apify-linkedin-search.js --query \"agency founder\"");
  console.error("       node apify-linkedin-search.js --query \"CEO\" --location \"New York\"");
  console.error("       --max 100 --campaign my_campaign --mode full --dry-run");
  console.error("");
  console.error("Modes:");
  console.error("  search - Search page results only ($0.10/page, up to 25 profiles)");
  console.error("  full   - Full profile details ($4/1k profiles)");
  console.error("  email  - Full profile + email search ($10/1k profiles)");
  process.exit(1);
}

const APIFY_API_KEY = process.env.APIFY_API_KEY;
if (!APIFY_API_KEY) {
  console.error("Error: APIFY_API_KEY not set in environment");
  process.exit(1);
}

const DATABASE_URL = process.env.INSFORGE_CONNECTION_STRING || process.env.DATABASE_URL;
const ACTOR_ID = "harvestapi~linkedin-profile-search";

// --- DB ---
async function getDbClient() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  return client;
}

async function ensureTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS linkedin_leads (
      id SERIAL PRIMARY KEY,
      public_identifier TEXT UNIQUE NOT NULL,
      linkedin_url TEXT,
      first_name TEXT,
      last_name TEXT,
      full_name TEXT,
      headline TEXT,
      location TEXT,
      location_country TEXT,
      location_city TEXT,
      profile_picture_url TEXT,
      connections_count INTEGER,
      follower_count INTEGER,
      is_premium BOOLEAN DEFAULT FALSE,
      is_influencer BOOLEAN DEFAULT FALSE,
      is_hiring BOOLEAN DEFAULT FALSE,
      is_open_to_work BOOLEAN DEFAULT FALSE,
      current_company TEXT,
      current_title TEXT,
      about TEXT,
      email TEXT,
      top_skills TEXT,
      source_query TEXT,
      scraped_at TIMESTAMP,
      campaign_name TEXT,
      template_used TEXT,
      message_sent TEXT,
      contacted BOOLEAN DEFAULT FALSE,
      contacted_at TIMESTAMP,
      connection_sent BOOLEAN DEFAULT FALSE,
      connection_sent_at TIMESTAMP,
      connection_accepted BOOLEAN DEFAULT FALSE,
      dm_success BOOLEAN DEFAULT FALSE,
      dm_error TEXT,
      status TEXT DEFAULT 'new',
      response_received BOOLEAN DEFAULT FALSE,
      response_text TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_linkedin_leads_identifier ON linkedin_leads(public_identifier);
    CREATE INDEX IF NOT EXISTS idx_linkedin_leads_contacted ON linkedin_leads(contacted);
    CREATE INDEX IF NOT EXISTS idx_linkedin_leads_campaign ON linkedin_leads(campaign_name);
  `);
}

async function storeLeads(db, leads, campaign, query) {
  let newCount = 0;
  let existingCount = 0;
  let errorCount = 0;

  for (const lead of leads) {
    try {
      // Extract current position info
      let currentCompany = null;
      let currentTitle = null;
      if (lead.currentPosition && lead.currentPosition.length > 0) {
        currentCompany = lead.currentPosition[0].companyName || null;
        currentTitle = lead.currentPosition[0].title || null;
      }

      const result = await db.query(`
        INSERT INTO linkedin_leads (
          public_identifier, linkedin_url, first_name, last_name, full_name,
          headline, location, location_country, location_city, profile_picture_url,
          connections_count, follower_count, is_premium, is_influencer, is_hiring,
          is_open_to_work, current_company, current_title, about, email, top_skills,
          source_query, scraped_at, campaign_name
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW(), $23)
        ON CONFLICT (public_identifier) DO UPDATE SET
          headline = COALESCE(EXCLUDED.headline, linkedin_leads.headline),
          current_company = COALESCE(EXCLUDED.current_company, linkedin_leads.current_company),
          current_title = COALESCE(EXCLUDED.current_title, linkedin_leads.current_title),
          email = COALESCE(EXCLUDED.email, linkedin_leads.email),
          updated_at = NOW()
        RETURNING id, (xmax = 0) AS is_new
      `, [
        lead.publicIdentifier,
        lead.linkedinUrl || `https://www.linkedin.com/in/${lead.publicIdentifier}/`,
        lead.firstName || null,
        lead.lastName || null,
        lead.firstName && lead.lastName ? `${lead.firstName} ${lead.lastName}` : lead.firstName || lead.lastName || null,
        lead.headline || null,
        lead.location?.linkedinText || lead.location?.parsed?.text || null,
        lead.location?.parsed?.country || lead.location?.countryCode || null,
        lead.location?.parsed?.city || null,
        lead.profilePicture?.url || lead.photo || null,
        lead.connectionsCount || null,
        lead.followerCount || null,
        lead.premium || false,
        lead.influencer || false,
        lead.hiring || false,
        lead.openToWork || false,
        currentCompany,
        currentTitle,
        lead.about || null,
        lead.email || null,
        lead.topSkills || null,
        query,
        campaign
      ]);

      if (result.rows.length > 0) {
        if (result.rows[0].is_new) {
          newCount++;
        } else {
          existingCount++;
        }
      }
    } catch (e) {
      errorCount++;
      if (errorCount <= 3) console.error(`   DB error for @${lead.publicIdentifier}: ${e.message}`);
    }
  }

  return { new: newCount, existing: existingCount, errors: errorCount };
}

// --- Main ---
async function run() {
  console.error("🔍 Apify LinkedIn Profile Search");
  console.error("=" .repeat(50));
  console.error(`📅 ${new Date().toISOString()}`);
  if (searchQuery) console.error(`🔎 Query: "${searchQuery}"`);
  if (location) console.error(`📍 Location: ${location}`);
  console.error(`🎯 Campaign: ${campaignName}`);
  console.error(`📊 Max items: ${maxItems}`);
  console.error(`⚙️  Mode: ${mode} (${mode === 'search' ? '$0.10/page' : mode === 'full' ? '$4/1k' : '$10/1k'})`);
  if (dryRun) console.error("🏃 DRY RUN MODE");

  const client = new ApifyClient({ token: APIFY_API_KEY });

  // Build input for the actor
  const input = {
    maxItems: maxItems,
    autoQuerySegmentation: false,
  };

  // Add search query (keyword search)
  if (searchQuery) {
    input.searchQuery = searchQuery;
  }

  // Add location filter
  if (location) {
    input.locations = [location];
  }

  // Set scraping depth mode
  if (mode === 'full') {
    input.fullProfileMode = true;
  } else if (mode === 'email') {
    input.fullProfileMode = true;
    input.emailSearch = true;
  }

  console.error(`\n👥 Searching LinkedIn profiles...`);
  console.error(`   Input: ${JSON.stringify(input, null, 2)}`);

  const actorRun = await client.actor(ACTOR_ID).call(input, { waitSecs: 600 });

  const { items } = await client.dataset(actorRun.defaultDatasetId).listItems();
  console.error(`   ✅ Got ${items.length} profiles`);

  if (!items || items.length === 0) {
    console.error("📭 No profiles found");
    console.log(JSON.stringify({ total: 0, new: 0, leads: [] }));
    process.exit(0);
  }

  // Log pagination info if available
  if (items[0]?._meta?.pagination) {
    const pagination = items[0]._meta.pagination;
    console.error(`   📊 Total available on LinkedIn: ${pagination.totalElements || 'unknown'}`);
  }

  // Dedupe and clean
  const seen = new Set();
  const leads = [];

  const linkedinUrl = phase2.platforms?.linkedin?.url || "";
  const linkedinSlug = linkedinUrl.match(/\/in\/([^/]+)/)?.[1] || "your-profile";
  const skipIdentifiers = new Set([
    linkedinSlug,
    "zeus-by-creatoros-6898863a1"
  ]);

  for (const item of items) {
    const identifier = (item.publicIdentifier || "").toLowerCase().trim();
    if (!identifier || seen.has(identifier) || skipIdentifiers.has(identifier)) continue;

    seen.add(identifier);
    leads.push(item);
  }

  console.error(`\n👥 ${leads.length} unique profiles (after dedup)`);
  for (const lead of leads.slice(0, 10)) {
    const flags = [
      lead.premium ? "💎" : "",
      lead.openToWork ? "🟢" : "",
      lead.hiring ? "📢" : "",
    ].filter(Boolean).join(" ");
    const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.publicIdentifier;
    console.error(`   👤 ${name} - ${lead.headline?.slice(0, 50) || 'No headline'}... ${flags}`);
  }
  if (leads.length > 10) console.error(`   ... and ${leads.length - 10} more`);

  if (dryRun) {
    console.error("\n🏃 DRY RUN — skipping DB storage");
    console.log(JSON.stringify({
      total: leads.length,
      new: leads.length,
      dryRun: true,
      leads: leads.slice(0, 20).map(l => ({
        publicIdentifier: l.publicIdentifier,
        name: [l.firstName, l.lastName].filter(Boolean).join(" "),
        headline: l.headline,
        location: l.location?.parsed?.text || l.location?.linkedinText,
        email: l.email || null,
      }))
    }));
    process.exit(0);
  }

  // Store in database
  if (!DATABASE_URL) {
    console.error("⚠️ No DATABASE_URL — outputting leads as JSON");
    console.log(JSON.stringify({ total: leads.length, leads }));
    process.exit(0);
  }

  const db = await getDbClient();
  await ensureTable(db);

  const queryStr = [searchQuery, location].filter(Boolean).join(" | ");
  const stats = await storeLeads(db, leads, campaignName, queryStr);

  console.error(`\n✅ Results:`);
  console.error(`   🆕 New leads: ${stats.new}`);
  console.error(`   ⏭️  Already existed: ${stats.existing}`);
  if (stats.errors) console.error(`   ❌ Errors: ${stats.errors}`);

  console.log(JSON.stringify({
    total: leads.length,
    new: stats.new,
    existing: stats.existing,
    errors: stats.errors,
    query: searchQuery,
    location: location,
    mode: mode,
  }));

  await db.end();
  process.exit(0);
}

run().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
