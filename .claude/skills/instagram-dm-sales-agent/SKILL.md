---
name: instagram-dm-sales-agent
description: Automated Instagram DM outreach agent using Playwright browser automation. Sends personalized cold DMs to leads at scale using the Inbox Compose Method. Trigger when asked to send Instagram DMs, run DM campaigns, or do Instagram outreach.
---

# Instagram DM Sales Agent

Playwright-based Instagram DM automation that sends personalized direct messages to leads at scale. Uses the **Inbox Compose Method** (navigates to inbox → compose → search username → chat → send) which works for both public AND private accounts.

## What It Does

1. Loads leads from the `instagram_leads` database table
2. Launches a Chromium browser (uses saved session or logs in fresh)
3. For each lead: navigates to DM inbox → composes new message → searches for username → sends personalized DM
4. Tracks success/failure in the database
5. Supports AI-personalized messages via Anthropic Claude

## How to Run

```bash
# Basic run (10 leads, default template)
python3 skills/instagram-dm-sales-agent/scripts/instagram_dm_sales_agent.py --limit 10

# AI-personalized messages
python3 skills/instagram-dm-sales-agent/scripts/instagram_dm_sales_agent.py --template ai --limit 10

# Headless mode (for cron jobs)
python3 skills/instagram-dm-sales-agent/scripts/instagram_dm_sales_agent.py --headless --template ai --limit 10

# Test config only
python3 skills/instagram-dm-sales-agent/scripts/instagram_dm_sales_agent.py --test
```

### Multi-Account Support

```bash
# Run with specific account
python3 skills/instagram-dm-sales-agent/scripts/instagram_dm_multi_account.py --account 1
python3 skills/instagram-dm-sales-agent/scripts/instagram_dm_multi_account.py --account 2
```

### Command Line Options

| Option | Description |
|--------|-------------|
| `--limit N` | Process only N leads |
| `--template default` | Use standard template |
| `--template ai` | Use AI-generated personalized messages |
| `--headless` | Run without visible browser |
| `--test` | Validate config only |

## Configuration

### Environment Variables (Required)

```env
INSTAGRAM_USERNAME=your_username
INSTAGRAM_PASSWORD=your_password
DATABASE_URL=postgresql://...
```

### Optional Environment Variables

```env
ANTHROPIC_API_KEY=sk-ant-...          # For AI personalization
DELAY_BETWEEN_DMS=60                   # Seconds between messages (default 60)
DELAY_BETWEEN_BATCHES=300              # Seconds between batches (default 300)
BATCH_SIZE=10                          # Messages per batch
MAX_DMS_PER_DAY=50                     # Daily limit
HEADLESS=false                         # Browser visibility

# Multi-account
IG_ACCOUNT_1_USERNAME=account1
IG_ACCOUNT_1_PASSWORD=password1
IG_ACCOUNT_2_USERNAME=account2
IG_ACCOUNT_2_PASSWORD=password2
```

### Dependencies

```bash
pip install playwright anthropic psycopg2-binary python-dotenv colorama
playwright install chromium
```

## Important Notes

- **Error Recovery**: On any error, the agent returns to inbox and continues to next lead — never gets stuck
- **Anti-Detection**: Uses random delays, session persistence, real user agent, stealth flags
- **Rate Limiting**: Start conservative (120s delay, 20-30 DMs/day) and gradually increase
- **2FA**: First run may require manual 2FA input — run with `--headless false`
- **Session**: Login session saved to `instagram_session.json` for reuse
- **Legal**: Instagram ToS prohibits automation — use responsibly

## Database Table

Uses `instagram_leads` table. Leads must be pre-loaded (see `instagram-lead-scraper` or `instagram-post-likers` skills).

## Scripts

| File | Purpose |
|------|---------|
| `instagram_dm_sales_agent.py` | Main DM automation script |
| `instagram_dm_config.py` | Configuration settings |
| `instagram_dm_multi_account.py` | Multi-account runner |
| `instagram_dm_modal.py` | Modal.com serverless deployment |
