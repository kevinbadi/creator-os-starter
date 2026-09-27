---
name: linkedin-lead-enrichment
description: Find company domains for LinkedIn leads via Apify Google Search, then enrich them with contact details. Looks up each lead's company website (skipping LinkedIn/Facebook/Crunchbase/etc), then scrapes emails and phones. Updates the leads table per campaign. Trigger when asked to find company domains for LinkedIn leads, enrich LinkedIn leads with websites/emails, or run LinkedIn lead enrichment.
---

# LinkedIn Lead Enrichment

Resolves a real company **domain** for each LinkedIn lead using the Apify
`apify/google-search-scraper`, filters out non-company hosts (LinkedIn, Facebook,
Twitter, Instagram, YouTube, Crunchbase, Glassdoor, Yelp, Wikipedia, ZoomInfo,
Apollo), then enriches with contact details. Writes results back to the leads table.

## Prerequisites

- `INSFORGE_CONNECTION_STRING` — Postgres connection (the leads DB).
- `APIFY_API_KEY` — Apify token.
- `.env` loaded via `dotenv`.

## Run

```bash
node scripts/find-company-domains.js --campaign=vc --limit=10
node scripts/find-company-domains.js --campaign=vc --limit=10 --dry-run
```

**Flags:** `--campaign=<name>` (default `vc`), `--limit=<n>` (default 10),
`--dry-run`.

## Pipeline fit

Runs after a LinkedIn scrape (`linkedin-lead-scraper` / `linkedin-profile-scraper`)
and feeds downstream outreach (`linkedin-message-agent`, `instantly-email`).

## Cron use

Batch enrichment job — schedule a small `--limit` every few hours to stay under
Apify quota and spread cost.

> ⚠️ Stub recovered from the ai-os-skills repo — confirm the campaign name, table
> schema, and Apify actor IDs against your current setup before scheduling.
