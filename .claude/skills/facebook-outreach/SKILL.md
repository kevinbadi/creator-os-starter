---
name: facebook-outreach
description: Send Facebook Messenger DMs as a personal account to business pages via Playwright + facebook.com and track delivery. Personal accounts can message pages — pages cannot message other pages.
---

# Facebook Outreach

Playwright-based Facebook Messenger cold outreach. Sends DMs **as your personal Facebook account** to business pages. Personal accounts can initiate Messenger conversations with any page that has messaging enabled.

## What It Does

- Sends Messenger DMs **as your personal Facebook account** to business pages
- Navigates to each page → clicks "Message" button → types in Messenger overlay → sends
- Also scrapes contact info (email, phone, website) from each page's About section while it's there
- Rate-limited with configurable daily limits, batch sizes, and human-like jittered delays (±30%)
- 3-layer dedup: SQL `DISTINCT ON`, session Set, post-send duplicate marking
- Detects missing Message button, 404 pages, and navigation errors
- Tracks all sends in `facebook_outreach` table

## Setup

### 1. Save Your Personal Account Session
Run `--headed` on first use — log in as your personal Facebook account. Session saves to `cookies/facebook-profile/`.

```bash
node skills/facebook-outreach/scripts/facebook-outreach.js --headed --dry-run
```

### 2. Environment Variables
Add to `.env`:
```
FB_DELAY_BETWEEN_MESSAGES=30000
FB_BATCH_SIZE=15
FB_DAILY_LIMIT=20
```

### 3. Prerequisites
- Playwright installed (`npm install`)
- Leads in `business_leads` table with Facebook handles
- Facebook handles normalized: run `facebook-url-normalize.js` first

## How to Run

### Step 1: Normalize Facebook handles
```bash
# Preview
node skills/facebook-outreach/scripts/facebook-url-normalize.js --dry-run

# Populate facebook_outreach table
node skills/facebook-outreach/scripts/facebook-url-normalize.js
```

### Step 2: Send messages
```bash
# Preview targets without sending
node skills/facebook-outreach/scripts/facebook-outreach.js --dry-run --limit 5

# Send to 10 leads (headed browser)
node skills/facebook-outreach/scripts/facebook-outreach.js --headed --limit 10

# Headless (after session is saved)
node skills/facebook-outreach/scripts/facebook-outreach.js --limit 15

# With campaign name
node skills/facebook-outreach/scripts/facebook-outreach.js --campaign outreach_q1 --limit 15
```

## CLI Options

| Flag | Default | Description |
|---|---|---|
| --headed | false | Show browser (required on first run) |
| --dry-run | false | Preview targets, no browser opened |
| --limit N | batch size (15) | Max messages to send |
| --campaign NAME | default_outreach | Campaign name for tracking |
| --category CAT | all | Filter by business category |
| --island ISLAND | all | Filter by island |
| --priority P | all | Filter by priority (high/medium/low) |

## Session Storage

- Personal account session: `cookies/facebook-profile/`
- If session expires, the script auto-relaunches headed for re-login

## Status Values

| Status | Description |
|---|---|
| pending | Queued, not yet attempted |
| sent | Message delivered via Messenger |
| failed | Navigation error or page gone |
| skipped_duplicate | Same page already messaged |
| no_message_btn | Page has messaging disabled |

## Database

- Reads from: `facebook_outreach` (populated by `facebook-url-normalize.js`)
- Also reads: `business_leads` for targeting filters
- Updates: `facebook_outreach.status`, `business_leads.contacted_facebook`
