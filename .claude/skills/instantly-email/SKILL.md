---
name: instantly-email
description: Cold email outreach via Instantly.ai API. Upload leads from business_leads table to campaigns, manage templates, track opens/replies/bounces, sync replies back to DB. Trigger when asked to send cold emails, manage email campaigns, check email analytics, upload leads to Instantly, or sync email replies.
---

# Instantly Email Outreach

Automated cold email outreach via Instantly.ai API. Manages the full email pipeline: lead upload → campaign activation → analytics tracking → reply sync.

## What It Does

- **Upload leads** from `business_leads` table to Instantly campaigns
- **Manage campaigns** — activate, pause, check status
- **Update templates** with approved email copy
- **Track analytics** — opens, replies, bounces → stored in DB
- **Sync replies** back to `business_leads` for follow-up
- **Daily reports** on campaign performance

## Scripts

### `instantly-setup.js`
Create all campaign templates in Instantly.
```bash
node skills/instantly-email/scripts/instantly-setup.js [--dry-run]
```

### `instantly-upload.js`
Upload pending leads from DB to Instantly campaigns.
```bash
node skills/instantly-email/scripts/instantly-upload.js [--dry-run] [--limit 50]
```

### `instantly-add-leads.js`
Add leads by category to campaigns.
```bash
node skills/instantly-email/scripts/instantly-add-leads.js [--category general] [--limit 50] [--dry-run]
```

### `instantly-activate.js`
Activate, pause, or list campaign status.
```bash
node skills/instantly-email/scripts/instantly-activate.js              # List all
node skills/instantly-email/scripts/instantly-activate.js --all        # Activate all
node skills/instantly-email/scripts/instantly-activate.js --all --pause # Pause all
node skills/instantly-email/scripts/instantly-activate.js <id>         # Activate one
```

### `instantly-analytics.js`
Fetch campaign analytics and sync to database.
```bash
node skills/instantly-email/scripts/instantly-analytics.js
```

### `instantly-sync-replies.js`
Check for new replies and update lead status in DB.
```bash
node skills/instantly-email/scripts/instantly-sync-replies.js
```

### `instantly-status.js`
Quick overview of all campaigns and stats.
```bash
node skills/instantly-email/scripts/instantly-status.js [--verbose]
```

### `instantly-update-templates.js`
Update email templates in all campaigns.
```bash
node skills/instantly-email/scripts/instantly-update-templates.js [--dry-run]
```

### `instantly-reset-and-push.js`
Nuclear reset: delete all leads, reset DB, re-push everything.
```bash
node skills/instantly-email/scripts/instantly-reset-and-push.js
```

## Environment Variables

```env
INSTANTLY_API_KEY=xxx
INSFORGE_CONNECTION_STRING=xxx
```

## Database

- `business_leads.outreach_status` — tracks email state:
  - `pending` → `email_queued` → `email_sent` → `email_opened` → `email_replied` / `email_bounced`
- `instantly_campaign_analytics_overview` — daily campaign stats
- `instantly_email_daily_analytics` — per-email analytics

## Cron Schedule

| Time | Task |
|---|---|
| 06:00 daily | Upload new leads to campaigns |
| 18:00 daily | Sync analytics + replies |

## Template Variables

- `{{firstName}}` — Lead's first name
- `{{companyName}}` — Business name
