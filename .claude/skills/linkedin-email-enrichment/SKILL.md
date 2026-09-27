# LinkedIn Email Enrichment

## Purpose
Finds email addresses and contact details for LinkedIn leads using the Apify Leads Finder actor (`code_crafter/leads-finder`). Runs automatically after LinkedIn profile scraping in the onboarding pipeline, and can also be triggered standalone.

## How It Works
1. Analyzes existing LinkedIn leads' headlines to derive the most common job titles (CEO, Founder, VP, etc.)
2. Searches for matching professionals using the Leads Finder actor, which returns:
   - Work email addresses
   - Personal email addresses
   - Phone numbers
   - Company details (name, website, industry, size, revenue)
   - LinkedIn profile URLs
3. Matches results to existing leads by LinkedIn identifier or name
4. Inserts new leads with emails into `linkedin_leads` table
5. Cross-populates `business_leads` table with company information

## Actor Details
- **Apify Actor:** `code_crafter/leads-finder` (ID: `IoSHqwTR9YGhzccez`)
- **Input:** `query` (job title), `location`, `maxResults`
- **Output:** Full contact + company profiles with emails

## Pipeline Position
Runs as **Step 3.5** in the initial lead scrape pipeline:
1. Google Maps scrape
2. Instagram lead scrape
3. LinkedIn profile scrape
4. **LinkedIn Email Enrichment** (this skill)
5. Facebook page discovery
6. Website contact enrichment

## Usage
```bash
# Runs automatically during onboarding lead scrape pipeline
node scripts/initial-lead-scrape.js

# The enrichment function is called after LinkedIn scraping completes
```

## Database Tables
- **Reads from:** `linkedin_leads` (to derive keyword queries from headlines)
- **Writes to:** `linkedin_leads` (email column), `business_leads` (company + contact data)

## Dependencies
- Apify API key (`APIFY_API_KEY` in `.env`)
- PostgreSQL database (`INSFORGE_CONNECTION_STRING` in `.env`)

## Cost
~$0.03-0.10 per 100 leads found (Apify usage-based pricing)
