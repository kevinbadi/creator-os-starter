# Instagram DM Super Agent

Automated Instagram DM outreach system - "Instantly for Instagram"

## Overview

This system sends personalized cold DMs at scale using:
1. **Lead Processor** - Generates personalized messages from raw lead data
2. **DM Agent** - Automates sending via Playwright browser automation
3. **Neon Database** - Stores all leads with `contacted` status tracking

## Database Schema

Table: `instagram_leads`

| Column | Type | Description |
|--------|------|-------------|
| `username` | TEXT | Instagram handle (unique) |
| `full_name` | TEXT | Display name |
| `profile_url` | TEXT | Profile URL |
| `instagram_id` | TEXT | Numeric IG ID |
| `is_verified` | BOOLEAN | Verified account |
| `contacted` | BOOLEAN | **DM sent?** |
| `contacted_at` | TIMESTAMP | When DM was sent |
| `message_sent` | TEXT | Actual message sent |
| `dm_success` | BOOLEAN | DM delivered? |
| `dm_error` | TEXT | Error if failed |
| `status` | TEXT | new/contacted/replied/qualified/converted |
| `campaign_name` | TEXT | Campaign tracking |
| `template_used` | TEXT | Which template |

## Workflow

### Step 1: Process Raw Leads

Take raw Instagram scrape data, generate personalized messages, and store in database:

```bash
./venv/bin/python3 implementation/instagram_lead_processor.py \
    --input "/path/to/raw_leads.csv" \
    --campaign "Campaign Name" \
    --output implementation/instagram_leads.csv
```

**Options:**
- `--preview 5` - Preview 5 messages without writing file
- `--template short` - Use shorter template variant
- `--template bold` - Use bold claim variant
- `--template problem` - Use problem/solution variant
- `--campaign "Name"` - Campaign name for tracking
- `--no-db` - Skip database storage

### Step 2: Configure Environment

Set credentials in `.env`:

```env
INSTAGRAM_USERNAME=your_username
INSTAGRAM_PASSWORD=your_password

# Rate limiting (keep high to avoid bans)
DELAY_BETWEEN_DMS=60
DELAY_BETWEEN_BATCHES=300
BATCH_SIZE=10
MAX_DMS_PER_DAY=50
```

### Step 3: Run DM Agent

```bash
./venv/bin/python3 implementation/instagram_dm_sales_agent.py
```

**Options:**
- `--headless` - Run without visible browser
- `--test` - Validate config only

## Message Templates

### Default (Alex Hormozi Style)
```
{{fullName}} –

We built Instantly for Instagram.

→ Automated DMs at scale
→ Personalized using AI
→ Books calls while you sleep

Works for @{{username}} out of the box.

Reply "demo" if you want to see it.
```

### Short Variant
```
{{fullName}} –

Built Instantly for Instagram.

Automated DMs. Personalized. Scales infinitely.

Want to see it?
```

### Bold Claim Variant
```
{{fullName}} –

We send 1,000+ personalized Instagram DMs per day.

Zero manual work.

Built the infrastructure ourselves – calling it "Instantly for IG."

If you want in, reply "show me".
```

## Input CSV Format

The lead processor expects these columns from Instagram scrapes:

| Column | Required | Description |
|--------|----------|-------------|
| `username` | ✅ | Instagram handle |
| `fullName` | ⚠️ | Display name (fallback: "Hey there") |
| `profileUrl` | ❌ | Not used in DM |
| `isVerified` | ❌ | Future: VIP treatment |

## Output CSV Format

The processed file for the DM agent:

```csv
username,message
capilano_community_services,"Capilano Community Services – ..."
john124846,"Hey there – ..."
```

## Rate Limiting

**Conservative defaults to avoid bans:**
- 60 second delay between DMs
- 5 minute delay between batches of 10
- Max 50 DMs per day

## Session Persistence

- Login session saved to `instagram_session.json`
- Sent log saved to `instagram_sent_log.csv`
- Skips already-contacted leads automatically

## Files

| File | Purpose |
|------|---------|
| `instagram_lead_processor.py` | Process raw leads → personalized messages |
| `instagram_dm_sales_agent.py` | Send DMs via Playwright |
| `instagram_dm_config.py` | Configuration settings |
| `instagram_leads.csv` | Processed leads (input to agent) |
| `instagram_sent_log.csv` | Log of sent DMs |
| `instagram_session.json` | Browser session persistence |

## Example Full Workflow

```bash
# 1. Process new leads (preview first)
./venv/bin/python3 implementation/instagram_lead_processor.py \
    --input ~/Downloads/instagram_scrape.csv \
    --preview 3

# 2. Confirm and store in database
./venv/bin/python3 implementation/instagram_lead_processor.py \
    --input ~/Downloads/instagram_scrape.csv \
    --campaign "Q1 Outreach"

# 3. Run the DM agent (auto-updates contacted status)
./venv/bin/python3 implementation/instagram_dm_sales_agent.py
```

## Database Queries

Check lead status:

```sql
-- Total leads by status
SELECT status, COUNT(*) FROM instagram_leads GROUP BY status;

-- Leads not yet contacted
SELECT username, full_name FROM instagram_leads WHERE contacted = FALSE;

-- Today's DM results
SELECT username, dm_success, dm_error 
FROM instagram_leads 
WHERE contacted_at::date = CURRENT_DATE;

-- Campaign performance
SELECT campaign_name, COUNT(*), 
       SUM(CASE WHEN dm_success THEN 1 ELSE 0 END) as sent,
       SUM(CASE WHEN replied THEN 1 ELSE 0 END) as replies
FROM instagram_leads 
GROUP BY campaign_name;
```

