# Instagram DM Sales Agent

## Overview

Playwright-based Instagram DM automation that sends personalized direct messages to leads at scale. Uses the **Inbox Compose Method** which works for both public AND private accounts.

## Key Innovation: Inbox Compose Method

Instead of navigating to individual profiles (unreliable), this system:
1. Goes to `instagram.com/direct/inbox/`
2. Clicks the "New message" compose icon
3. Searches for target username
4. Selects the **first result** (top of list) via coordinate click
5. Clicks "Chat" to open conversation
6. Types message and sends with Enter key
7. **On any error: returns to inbox and continues to next lead**

**Why it works:** The DM compose UI is consistent, unlike profile pages which vary for public/private accounts.

## Error Handling & Fallback

The agent includes robust error handling:

| Step | Potential Error | Fallback Action |
|------|----------------|-----------------|
| Compose button | Not found | Return to inbox, skip lead |
| Search user | No results | Return to inbox, mark as failed |
| Select user | Click fails | Return to inbox, skip lead |
| Chat button | Disabled/not found | Return to inbox, mark as failed |
| Wrong conversation | Redirect detected | Return to inbox, retry once |
| Message input | Not found | Return to inbox, skip lead |
| Send message | Fails | Return to inbox, mark as failed |

**Key principle:** Never get stuck - always return to inbox and continue.

## Requirements

- Python 3.11+
- Playwright (`pip install playwright`)
- Chromium browser (`playwright install chromium`)
- Anthropic API key (for AI personalization)
- Instagram account credentials
- Neon PostgreSQL database with `instagram_leads` table

## Environment Variables

```env
# Instagram Credentials (REQUIRED)
INSTAGRAM_USERNAME=your_username
INSTAGRAM_PASSWORD=your_password

# Database (REQUIRED)
DATABASE_URL=postgresql://...

# AI Personalization (OPTIONAL)
ANTHROPIC_API_KEY=sk-ant-...

# Rate Limiting (seconds) - Keep HIGH to avoid bans
DELAY_BETWEEN_DMS=60          # 1 min between messages
DELAY_BETWEEN_BATCHES=300     # 5 min between batches

# Batch Settings
BATCH_SIZE=10                 # Messages per batch
MAX_DMS_PER_DAY=50           # Daily limit

# Browser
HEADLESS=false               # false = see browser, true = hidden
```

## Usage

### Basic Run (Default Template)
```bash
python3 implementation/instagram_dm_sales_agent.py --limit 10
```

### AI-Personalized Messages
```bash
python3 implementation/instagram_dm_sales_agent.py --template ai --limit 10
```

### Headless Mode (for cron jobs)
```bash
python3 implementation/instagram_dm_sales_agent.py --headless --template ai --limit 10
```

### Command Line Options

| Option | Description |
|--------|-------------|
| `--limit N` | Process only N leads |
| `--template default` | Use standard template |
| `--template ai` | Use AI-generated personalized messages |
| `--headless` | Run without visible browser |
| `--test` | Validate config only |

## Cron Job Setup

The agent runs 15 times per day, sending 10 messages per session (150 DMs/day max):

```bash
# Edit crontab
crontab -e

# Add these entries (runs every ~1.5 hours from 8am to 10pm)
0 8 * * * /path/to/scripts/run_instagram_dm.sh
30 9 * * * /path/to/scripts/run_instagram_dm.sh
0 11 * * * /path/to/scripts/run_instagram_dm.sh
# ... etc
```

## Database Schema

Table: `instagram_leads`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `username` | TEXT | Instagram handle (unique) |
| `full_name` | TEXT | Display name |
| `profile_url` | TEXT | Profile URL |
| `is_verified` | BOOLEAN | Verified account |
| `contacted` | BOOLEAN | DM sent? |
| `contacted_at` | TIMESTAMP | When DM was sent |
| `message_sent` | TEXT | Actual message sent |
| `dm_success` | BOOLEAN | DM delivered? |
| `dm_error` | TEXT | Error if failed |
| `status` | TEXT | new/contacted/failed |
| `campaign_name` | TEXT | Campaign tracking |
| `template_used` | TEXT | Which template |

## Workflow

```
┌─────────────────────────────────────────────────────────────┐
│                    INSTAGRAM DM AGENT                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. STARTUP                                                  │
│     • Load saved session (if exists)                        │
│     • Launch Chromium browser                               │
│     • Check if already logged in                            │
│                                                              │
│  2. LOGIN (if needed)                                        │
│     • Navigate to login page                                │
│     • Enter credentials                                      │
│     • Handle 2FA (waits for manual input)                   │
│     • Save session for reuse                                │
│                                                              │
│  3. LOAD LEADS FROM DATABASE                                 │
│     • Query uncontacted leads                               │
│     • Generate AI messages if template=ai                   │
│     • Limit to specified count                              │
│                                                              │
│  4. SEND DMs (with error recovery)                          │
│     For each lead:                                           │
│     ├─ Go to /direct/inbox/                                 │
│     ├─ Click compose icon                                    │
│     ├─ Search username                                       │
│     ├─ Click FIRST result (coordinate click)                │
│     ├─ Click "Chat" button                                  │
│     ├─ Verify correct conversation (check URL)              │
│     ├─ Find message input (RIGHT side of screen only)       │
│     ├─ Fill message text                                    │
│     ├─ Press Enter to send                                  │
│     ├─ Update database                                       │
│     ├─ Wait DELAY_BETWEEN_DMS seconds                       │
│     │                                                        │
│     └─ ON ANY ERROR:                                         │
│        ├─ Log error                                          │
│        ├─ Navigate back to /direct/inbox/                   │
│        ├─ Mark lead as failed in database                   │
│        └─ Continue to next lead                              │
│                                                              │
│  5. COMPLETE                                                 │
│     • Save session                                           │
│     • Close browser                                          │
│     • Report stats                                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Anti-Detection Features

| Feature | Description |
|---------|-------------|
| **Random delays** | Variable wait times between actions |
| **Session persistence** | Reuses login cookies |
| **Real user agent** | Chrome 120 on macOS |
| **Stealth flags** | Disables automation detection |
| **Right-side clicking** | Only clicks in main chat area, not sidebar |
| **Enter to send** | Uses keyboard, not button clicks |

## Rate Limiting Guidelines

| Risk Level | DELAY_BETWEEN_DMS | MAX_DMS_PER_DAY |
|------------|-------------------|-----------------|
| 🟢 Safe | 120+ seconds | 20-30 |
| 🟡 Moderate | 60 seconds | 50 |
| 🔴 Risky | <30 seconds | 100+ |

**Recommendation:** Start conservative and gradually increase.

## Files

```
implementation/
├── instagram_dm_sales_agent.py   # Main automation script
├── instagram_dm_config.py        # Configuration
├── instagram_lead_processor.py   # Process raw leads
└── instagram_session.json        # Saved browser session

scripts/
└── run_instagram_dm.sh           # Cron job runner

logs/
└── instagram_dm.log              # Execution logs
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Redirect to wrong conversation" | Fixed: now uses right-side clicking only |
| "Could not find compose button" | Wait longer, check if logged in |
| "Rate limited / Account restricted" | Increase delays, lower daily limit |
| "Session not persisting" | Check file write permissions |
| "Message split into multiple" | Fixed: uses fill() not type() |

## AI Personalization

When using `--template ai`, the agent:
1. Fetches lead data (name, profile URL, verified status)
2. Calls Anthropic Claude API to generate personalized message
3. Includes natural hooks based on lead context
4. Keeps messages under 200 characters for readability

## Legal Disclaimer

⚠️ **Educational purposes only.** Instagram ToS prohibits automation.

- Only message people who expect to hear from you
- Keep daily limits low
- Don't spam
- Be prepared for account restrictions
