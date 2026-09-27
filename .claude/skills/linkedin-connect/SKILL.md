---
name: linkedin-connect
description: Send LinkedIn connection requests with personalized messages via browser automation. Uses pre-scraped leads from linkedin_leads table (populated by Apify during onboarding). Trigger when asked to send LinkedIn connections or run LinkedIn outreach.
---

# LinkedIn Connect

Send personalized LinkedIn connection requests to **pre-scraped leads** from your database.

## How It Works

1. **Onboarding** → Apify scrapes LinkedIn profiles based on your targeting → `linkedin_leads` table
2. **This skill** → Reads from `linkedin_leads` → Sends connection requests via browser automation
3. **Tracking** → Marks leads as `connection_sent = TRUE` → Won't contact twice

## Prerequisites

- Chrome with CDP running (auto-starts via Clawdbot)
- Logged into LinkedIn (cookies at `cookies/linkedin-*.json`)
- `DATABASE_URL` env var pointing to your Insforge DB
- Leads in `linkedin_leads` table (populated by initial scrape or linkedin-profile-scraper skill)

## Quick Usage (Recommended)

### Send connections to pre-scraped leads
```bash
# Send to 20 uncontacted leads from DB
node skills/linkedin-connect/scripts/batch-connect.js --limit 20

# Filter by campaign (e.g. leads from a specific scrape)
node skills/linkedin-connect/scripts/batch-connect.js --campaign "onboarding_initial" --limit 20

# Custom message template
node skills/linkedin-connect/scripts/batch-connect.js --limit 20 \
  --message "Hey {{firstName}}, saw your work at {{company}} — would love to connect!"

# Dry run (preview which leads would be contacted)
node skills/linkedin-connect/scripts/batch-connect.js --limit 20 --dry-run
```

## Message Templates

| Variable | Source |
|----------|--------|
| `{{firstName}}` | First name from DB |
| `{{lastName}}` | Last name from DB |
| `{{fullName}}` | Full name |
| `{{company}}` | current_company from DB |
| `{{headline}}` | headline from DB |
| `{{title}}` | current_title from DB |

## CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--limit` | 20 | Max connection requests per run |
| `--campaign` | — | Filter leads by campaign_name |
| `--message` | Default template | Message with {{variables}} |
| `--delay-min` | 8 | Min seconds between requests |
| `--delay-max` | 15 | Max seconds between requests |
| `--dry-run` | false | Preview leads, don't send |
| `--cdp-port` | 18800 | Chrome CDP port |

## Safety

- **Cap at 20-25/day** — LinkedIn flags aggressive behavior
- Random delays between requests (8-15s default)
- Real browser automation, not API calls
- Automatically detects weekly invitation limit and stops
- Leads marked `connection_sent = TRUE` won't be contacted again

## Database Schema

Reads from `linkedin_leads` table:
```sql
SELECT * FROM linkedin_leads 
WHERE connection_sent = FALSE 
ORDER BY created_at DESC 
LIMIT 20;
```

Updates after each request:
```sql
UPDATE linkedin_leads 
SET connection_sent = TRUE, connection_sent_at = NOW() 
WHERE id = $1;
```

## Output

```json
{"sent": 15, "skipped": 2, "errors": 0, "hitWeeklyLimit": false}
```

- `sent` — Connection requests successfully sent
- `skipped` — Leads skipped (already connected, no connect button, etc.)
- `errors` — Failed attempts
- `hitWeeklyLimit` — LinkedIn's weekly limit reached, stop processing

## Cron Schedule (Recommended)

Run daily with 20 leads max:
```
0 10 * * * node skills/linkedin-connect/scripts/batch-connect.js --limit 20
```

---

## Alternative: Single Profile

For one-off connections (not recommended for scale):

```bash
node skills/linkedin-connect/scripts/linkedin-connect.js \
  --url "https://www.linkedin.com/in/someone/" \
  --message "Hey, would love to connect!"
```

---

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  ONBOARDING                                                      │
│  User fills out LinkedIn targeting (titles, keywords, location)  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  INITIAL SCRAPE (Apify)                                          │
│  harvestapi~linkedin-profile-search → linkedin_leads table       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  LINKEDIN CONNECT (This Skill)                                   │
│  batch-connect.js reads from DB → sends connection requests      │
│  Marks connection_sent = TRUE after each                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  LINKEDIN MESSAGE AGENT (Optional)                               │
│  Monitors accepted connections → sends follow-up DMs             │
└─────────────────────────────────────────────────────────────────┘
```
