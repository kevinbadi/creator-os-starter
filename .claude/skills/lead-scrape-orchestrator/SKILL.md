---
name: lead-scrape-orchestrator
description: Master lead generation pipeline that runs after onboarding. Orchestrates all lead scraping in sequence: Google Maps businesses → LinkedIn profiles → Instagram likers → Facebook page finder → email/phone enrichment. Trigger when onboarding is complete, when asked to run the full lead pipeline, or when asked to populate the lead database from scratch.
---

# Lead Scrape Orchestrator

Runs the full lead generation pipeline in sequence after onboarding. Reads targeting config from `onboarding-config.json` and triggers each scraper based on what the user configured.

## Pipeline Order

1. **Google Maps** (`apify-google-maps`) — Scrape businesses by keyword + location → `business_leads`
2. **LinkedIn Profiles** (`linkedin-profile-scraper`) — Scrape professionals by title/industry/location → `linkedin_leads`
3. **Instagram Likers** (`instagram-lead-scraper`) — Scrape post likers from competitor posts → `instagram_leads`
4. **Facebook Page Finder** (`facebook-page-finder`) — Match business names to FB pages → updates `business_leads.facebook`
5. **Lead Enrichment** (`lead-enrichment`) — Crawl websites for emails + phones → updates `business_leads`

Each step is skipped if the user didn't configure that source in onboarding.

## How to Run

```bash
# Run full pipeline from onboarding config
node skills/lead-scrape-orchestrator/scripts/lead-scrape-orchestrator.js

# Run specific steps only
node skills/lead-scrape-orchestrator/scripts/lead-scrape-orchestrator.js --steps google_maps,enrichment

# Dry run (show what would run, no Apify calls)
node skills/lead-scrape-orchestrator/scripts/lead-scrape-orchestrator.js --dry-run
```

## Config Source

Reads from `onboarding-config.json` (phase 4):
- `lead_sources` — which scrapers to run (`google_maps`, `instagram_leads`, `linkedin_leads`, `facebook_leads`)
- `lead_config.ig_competitor_posts` — Instagram post URLs for liker scraping
- `lead_config.li_lead_titles` — LinkedIn job titles to target
- `lead_config.li_lead_location` — LinkedIn location filter
- `lead_config.li_lead_industries` — LinkedIn industry filter
- `location_city` + `location_business_type` — Google Maps search params

## Environment Variables

```env
APIFY_API_KEY=xxx
INSFORGE_CONNECTION_STRING=xxx
```

## Output

Saves results to `initial-scrape-results.json`:
```json
{
  "google_maps": 150,
  "linkedin": 167,
  "instagram": 759,
  "facebook_pages": 80,
  "enriched": 95,
  "total_leads": 1076
}
```

## Notes

- This is automatically triggered after the onboarding wizard completes
- Can be re-run any time to refresh leads
- Each scraper skips leads already in the DB (deduplicates by username/url)
