---
name: whatsapp-outreach
description: Send WhatsApp messages to Samoan businesses via Playwright + WhatsApp Web and track delivery
---

## What It Does

- Normalizes Samoan phone numbers from `business_leads` to E.164 format (+685XXXXX)
- Sends WhatsApp messages via Playwright browser automation on `web.whatsapp.com`
- Uses `https://web.whatsapp.com/send?phone=...&text=...` URL scheme (works for numbers not in contacts)
- Rate-limited with configurable daily limits, batch sizes, and human-like jittered delays
- Filters by category, island, priority
- Detects "not on WhatsApp" errors and marks as failed

## Setup

### 1. First-Run QR Login
On first run (no `cookies/whatsapp-web.json`), the script opens a visible browser to WhatsApp Web. Scan the QR code with your phone's WhatsApp app. Cookies are saved automatically.

```bash
# First run — will open browser for QR scan
node skills/whatsapp-outreach/scripts/whatsapp-outreach.js --limit 1
```

To re-authenticate, delete the cookie file and run again:
```bash
rm cookies/whatsapp-web.json
node skills/whatsapp-outreach/scripts/whatsapp-outreach.js --limit 1
```

### 2. Environment Variables
Add to `.env`:
```
WA_DELAY_BETWEEN_MESSAGES=12000
WA_BATCH_SIZE=25
WA_DAILY_LIMIT=50
```

### 3. Prerequisites
- Clawdbot CDP browser running (`clawdbot browser start --profile clawd --headless`) — script auto-starts it if needed
- WhatsApp account linked on your phone
- Playwright installed (`npm install`)

## How to Run

### Step 1: Normalize phone numbers
```bash
# Preview which leads have valid Samoan mobile numbers
node skills/whatsapp-outreach/scripts/whatsapp-phone-normalize.js --dry-run

# Populate whatsapp_outreach table with normalized numbers
node skills/whatsapp-outreach/scripts/whatsapp-phone-normalize.js
```

### Step 2: Send messages
```bash
# Preview targets without sending (no browser opened)
node skills/whatsapp-outreach/scripts/whatsapp-outreach.js --dry-run --limit 5

# Send to 10 high-priority leads on Upolu
node skills/whatsapp-outreach/scripts/whatsapp-outreach.js --limit 10 --priority high --island Upolu

# Send with a specific campaign name
node skills/whatsapp-outreach/scripts/whatsapp-outreach.js --campaign samoa_tourism_q1 --limit 25
```

## CLI Options

### whatsapp-phone-normalize.js
| Flag       | Default | Description                        |
|------------|---------|------------------------------------|
| --dry-run  | false   | Preview without DB writes          |
| --limit N  | all     | Max leads to process               |

### whatsapp-outreach.js
| Flag            | Default                | Description                          |
|-----------------|------------------------|--------------------------------------|
| --dry-run       | false                  | Preview without sending (no browser) |
| --limit N       | batch size (25)        | Max messages to send                 |
| --campaign NAME | discover_samoa_intro   | Campaign name for tracking           |
| --category CAT  | all                    | Filter by business category          |
| --island ISLAND | all                    | Filter by island (Upolu, Savai'i)    |
| --priority P    | all                    | Filter by priority (high/medium/low) |

## Database

Table: `whatsapp_outreach` (see `migrations/003_whatsapp_outreach.sql`)

## Scripts

- `scripts/whatsapp-phone-normalize.js` — Phone number normalizer
- `scripts/whatsapp-outreach.js` — Main message sender (Playwright + WhatsApp Web)
