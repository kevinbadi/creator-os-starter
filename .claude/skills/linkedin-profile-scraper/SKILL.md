---
name: linkedin-profile-scraper
description: Search and scrape LinkedIn profiles using Apify HarvestAPI actor (no cookies needed). Search by keyword, title, company, location. Stores leads in database with full profile details. Trigger when asked to find LinkedIn leads, search LinkedIn profiles, or scrape LinkedIn for prospects.
---

# LinkedIn Profile Search Scraper (Apify)

Search LinkedIn profiles and extract detailed information using the Apify `harvestapi/linkedin-profile-search` actor (ID: `M2FMdjRVeF1HPGFcc`). No cookies or LinkedIn account required.

## How to Run

```bash
# Keyword search (e.g., find agency founders)
node skills/linkedin-profile-scraper/scripts/apify-linkedin-search.js \
    --query "agency founder" --max 100

# Keyword + location filter
node skills/linkedin-profile-scraper/scripts/apify-linkedin-search.js \
    --query "marketing manager" --location "Austin" --max 50

# Full profile mode (more details, $4/1k)
node skills/linkedin-profile-scraper/scripts/apify-linkedin-search.js \
    --query "CEO" --mode full --max 50

# Full profile + email search ($10/1k)
node skills/linkedin-profile-scraper/scripts/apify-linkedin-search.js \
    --query "founder" --mode email --max 25 --campaign "founder_outreach"

# Dry run (no DB writes)
node skills/linkedin-profile-scraper/scripts/apify-linkedin-search.js \
    --query "developer" --dry-run
```

### Arguments

| Option | Description | Default |
|--------|-------------|---------|
| `--query` | Search keywords (e.g., "agency founder") | - |
| `--location` | Filter by location (city/country) | - |
| `--max` | Max profiles to return | 100 |
| `--mode` | Scraping depth (search/full/email) | search |
| `--campaign` | Campaign name for DB tracking | linkedin_search |
| `--dry-run` | Preview leads without storing | false |

### Modes & Pricing

| Mode | Description | Cost |
|------|-------------|------|
| `search` | Search page results (basic info) | $0.10 per page (25 profiles) |
| `full` | Full profile details | $4 per 1,000 profiles |
| `email` | Full profile + email search | $10 per 1,000 profiles |

### Environment Variables

```env
APIFY_API_KEY=xxx        # Required - Apify API token
DATABASE_URL=xxx         # Required - PostgreSQL connection string
```

## Apify Actor

| Actor | ID | Features |
|-------|-----|---------|
| LinkedIn Profile Search Scraper | `M2FMdjRVeF1HPGFcc` | No cookies, keyword search, email lookup |
| Developer | HarvestAPI | |

## Output Per Profile

```json
{
  "publicIdentifier": "john-doe-123",
  "linkedinUrl": "https://www.linkedin.com/in/john-doe-123",
  "firstName": "John",
  "lastName": "Doe",
  "headline": "Founder & CEO at Acme Agency",
  "location": {
    "linkedinText": "San Francisco, CA",
    "parsed": { "city": "San Francisco", "country": "United States" }
  },
  "connectionsCount": 500,
  "premium": false,
  "openToWork": true,
  "currentPosition": [{ "companyName": "Acme Agency", "title": "Founder" }],
  "email": "john@example.com"  // Only in email mode
}
```

## Database

Stores in `linkedin_leads` table (deduped by public_identifier):

| Column | Description |
|--------|-------------|
| public_identifier | LinkedIn username (unique) |
| linkedin_url | Full profile URL |
| first_name, last_name | Name |
| headline | Job headline |
| location, location_city, location_country | Location info |
| current_company, current_title | Current job |
| connections_count, follower_count | Network size |
| is_open_to_work, is_hiring | Status flags |
| email | Found email (email mode only) |
| campaign_name | Campaign identifier |
| contacted, connection_sent, dm_success | Outreach tracking |

## Notes

- LinkedIn limits search results to ~2,500 per query
- For larger datasets, split by location or use more specific keywords
- Email search performs SMTP validation; not guaranteed for every profile
- Auto-skips own accounts (loaded from onboarding-config.json)
