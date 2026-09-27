# account-analytics

Sync account-level daily analytics from Late API into the database. Pulls daily metrics (impressions, reach, likes, comments, shares, views) per platform, follower counts from connected accounts, and stores everything for trend tracking.

## Usage

```bash
node skills/account-analytics/scripts/account-analytics.js [options]
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--dry-run` | Show analytics without DB writes | false |

## What It Does

1. Calls `GET /v1/analytics/daily-metrics?profileId=` for daily platform breakdown
2. Calls `GET /v1/accounts?profileId=` for follower counts per platform
3. Upserts daily metrics into `daily_social_analytics` (one row per platform per day)
4. Prints a summary table to the console

## Prerequisites

- `LATE_API_KEY` in `.env`
- `INSFORGE_CONNECTION_STRING` in `.env`

## DB Tables Written

- `daily_social_analytics` — daily per-platform metrics (followers, posts_count, likes, comments, shares, impressions, reach, engagement_rate)

## Output

Console summary showing:
- Per-platform daily metrics
- Follower counts across all platforms
- Total engagement summary
