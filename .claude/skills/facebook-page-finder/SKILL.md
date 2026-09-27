---
name: facebook-page-finder
description: Find Facebook page URLs for businesses already in the business_leads table. Uses Google Search via Apify to match business names to Facebook pages and updates the facebook column. Trigger when asked to find Facebook pages for leads, enrich leads with Facebook handles, or populate facebook_outreach queue.
---

# Facebook Page Finder

Finds Facebook page URLs for businesses in the `business_leads` table that don't yet have a Facebook handle. Uses Apify Google Search actor to search `"Business Name" facebook city` and extracts matching facebook.com URLs.

## What It Does

1. Reads businesses from `business_leads` where `facebook IS NULL`
2. For each business, runs a Google search: `"Business Name" facebook <location>`
3. Extracts facebook.com handles from search results
4. Updates `business_leads.facebook` with the found handle
5. Feeds the `facebook_outreach` table for the facebook-outreach skill

## How to Run

```bash
# Find Facebook pages for all leads missing them
node skills/facebook-page-finder/scripts/facebook-page-finder.js

# Limit to 50 leads
node skills/facebook-page-finder/scripts/facebook-page-finder.js --limit 50

# Dry run (preview without DB writes)
node skills/facebook-page-finder/scripts/facebook-page-finder.js --dry-run
```

## Environment Variables

```env
APIFY_API_KEY=xxx
INSFORGE_CONNECTION_STRING=xxx
```

## Apify Actor

- **Actor ID:** `nFJndFXA5zjCTuudP` (Google Search Results)

## Database

- Reads from: `business_leads` (where `facebook IS NULL`)
- Updates: `business_leads.facebook`
- After running, use `facebook-url-normalize.js` in `facebook-outreach` to populate `facebook_outreach` queue
