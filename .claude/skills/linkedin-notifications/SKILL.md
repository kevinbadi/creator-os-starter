---
name: linkedin-notifications
description: Check LinkedIn notifications and report new ones via iMessage. Deduplicates against database so only new notifications are reported. Covers connection acceptances, reactions, comments, profile views, mentions, and more.
---

# LinkedIn Notifications Checker

Scrapes LinkedIn notifications page, deduplicates against DB, and outputs new notifications for reporting.

## Prerequisites

- Chrome with CDP running
- Logged into LinkedIn
- `ws` and `pg` npm packages
- `DATABASE_URL` env var

## Quick Usage

```bash
node skills/linkedin-notifications/scripts/linkedin-notifications.js
```

## Workflow

1. Navigate to linkedin.com/notifications/
2. Scroll to load notifications
3. Scrape all visible notifications (text, link, time)
4. Hash each notification, check against `linkedin_notifications` DB table
5. Store new ones, skip already-seen
6. Output JSON summary of new notifications
7. Navigate away from notifications page

## Notification Types Detected

| Type | Example |
|------|---------|
| `connection_accepted` | "John Doe accepted your invitation" |
| `connection_request` | "Jane wants to connect" |
| `reaction` | "5 people liked your post" |
| `comment` | "John commented on your post" |
| `share` | "Jane shared your post" |
| `mention` | "You were mentioned in a post" |
| `profile_view` | "3 people viewed your profile" |
| `endorsement` | "John endorsed you for Python" |
| `milestone` | "Jane started a new position" |
| `job` | "New jobs matching your alerts" |
| `other` | Anything else |

## Database

Uses `linkedin_notifications` table:
- `notification_hash`: MD5 of content (dedup key)
- `notification_type`: classified type
- `actor_name`: extracted person name
- `content`: full notification text
- `link`: URL if available
- `reported`: whether it was included in a report

## CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--limit` | 30 | Max notifications to process |
| `--cdp-port` | 18800 | Chrome CDP port |
