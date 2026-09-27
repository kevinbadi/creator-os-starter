---
name: apify-google-maps
description: Scrape business leads from Google Maps using Apify actor nwua9Gu5YrADL7ZDj. Search by keyword + location, stores results in business_leads table. Trigger when asked to scrape Google Maps, find local businesses, or build a business lead list.
---

# Apify Google Maps Scraper

Scrapes business listings from Google Maps using Apify actor `nwua9Gu5YrADL7ZDj`. Returns business name, address, phone, website, category, and rating. Stores results in the `business_leads` DB table.

## How to Run

```bash
# Scrape businesses by keyword + location
python3 skills/apify-google-maps/scripts/apify_leads_sheet.py \
    --terms "Marketing Agency" \
    --location "Austin, USA" \
    --max 100

# Multiple terms
python3 skills/apify-google-maps/scripts/apify_leads_sheet.py \
    --terms "Dentist,Law Firm,Accountant" \
    --location "New York, USA" \
    --max 200
```

## Arguments

| Option | Description | Default |
|---|---|---|
| `--terms` | Search keywords (comma-separated) | Required |
| `--location` | Location in "City, Country" format | Required |
| `--max` | Max businesses to scrape | 1000 |

## Environment Variables

```env
APIFY_API_KEY=xxx
INSFORGE_CONNECTION_STRING=xxx
```

## Apify Actor

- **Actor ID:** `nwua9Gu5YrADL7ZDj` (compass/google-maps-scraper)

## Database

Stores into `business_leads`: name, address, phone, website, category, rating.
After scraping, run `lead-enrichment` to add emails, Facebook handles, and social profiles.

## Scripts

- `apify_leads_sheet.py` — Main Google Maps scraper
- `enrich_leads.py` — Standalone contact enrichment (use `lead-enrichment` skill instead)
