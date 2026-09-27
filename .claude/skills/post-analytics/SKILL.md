# post-analytics

Sync post-level analytics from Late API into the database. Pulls performance metrics for each published post (impressions, reach, likes, comments, shares, saves, views, engagement rate) and stores per-platform breakdowns into the platform-specific stats tables.

## Usage

```bash
node skills/post-analytics/scripts/post-analytics.js [options]
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--post-id` | Specific Late post ID to sync | All recent posts |
| `--limit` | Max posts to sync | 20 |
| `--dry-run` | Show analytics without DB writes | false |

## What It Does

1. Fetches all published posts from Late API (or a specific post)
2. For each post, calls `GET /v1/analytics?postId=` to get per-platform metrics
3. Updates `platform_posts` with post URLs and sync status
4. Upserts per-platform stats into `instagram_posts_stats`, `tiktok_posts_stats`, `youtube_posts_stats`, `facebook_posts_stats`, `twitter_posts_stats`
5. Updates `user_posts` with aggregate analytics in metadata

## Prerequisites

- `LATE_API_KEY` in `.env`
- `INSFORGE_CONNECTION_STRING` in `.env`

## DB Tables Written

- `platform_posts` — post_url, raw_response updated
- `instagram_posts_stats` — impressions, reach, likes, comments, saves, shares, video_views
- `tiktok_posts_stats` — views, likes, comments, shares, saves
- `youtube_posts_stats` — views, likes, comments, shares, impressions
- `facebook_posts_stats` — impressions, reach, likes, shares, comments
- `twitter_posts_stats` — impressions, likes, retweets (shares), replies (comments)
- `user_posts` — metadata.analytics updated with aggregate totals
