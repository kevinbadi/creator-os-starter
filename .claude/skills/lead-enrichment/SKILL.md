---
name: lead-enrichment
description: Enrich business leads with emails and phone numbers by crawling their websites using Apify Contact Details Scraper (QAKrfXwAcbmcWYnSo). Updates business_leads table with email, phone, and social handles. Trigger when asked to find emails for leads, enrich contact info, scrape emails from websites, or get phone numbers for businesses.
---

# Lead Enrichment

Crawls business websites to extract emails, phone numbers, and social media handles using Apify actor `QAKrfXwAcbmcWYnSo` (Contact Details Scraper). Updates the `business_leads` table.

## What It Does

1. Reads businesses from `business_leads` where `website IS NOT NULL` and `email IS NULL`
2. Submits all websites to Apify Contact Details Scraper (crawls up to 3 pages deep)
3. Extracts emails, phone numbers, LinkedIn, Twitter, Facebook, Instagram handles
4. Updates `business_leads` with found contact info (only fills empty fields)

## How to Run

```bash
# Enrich all leads with websites but no email
node skills/lead-enrichment/scripts/lead-enrichment.js

# Limit batch size
node skills/lead-enrichment/scripts/lead-enrichment.js --limit 100

# Dry run
node skills/lead-enrichment/scripts/lead-enrichment.js --dry-run
```

## Environment Variables

```env
APIFY_API_KEY=xxx
INSFORGE_CONNECTION_STRING=xxx
```

## Apify Actor

- **Actor ID:** `QAKrfXwAcbmcWYnSo` (Contact Details Scraper)
- Crawls up to 3 pages deep on each website
- Extracts: emails, phone numbers, LinkedIn, Twitter, Facebook, Instagram

## Database

- Reads from: `business_leads` where `website IS NOT NULL AND email IS NULL`
- Updates: `business_leads.email`, `business_leads.phone`, `business_leads.facebook`, `business_leads.instagram`
- Never overwrites existing data — uses `COALESCE` to only fill empty fields

## Notes

- Run after `apify-google-maps` to enrich the scraped businesses
- Works best when businesses have a website in their Google Maps listing
- Typical enrichment rate: 30-60% of leads will have a findable email
