---
name: instagram-lead-scraper
description: Scrape users who liked specific Instagram posts using Apify actor WxPRaG9gfg5KZ4gY1 (datadoping/instagram-likes-scraper). No cookies needed. Stores leads in instagram_leads table. Trigger when asked to scrape Instagram leads, find post likers, or build lead lists from Instagram.
---

# Instagram Lead Scraper

Scrapes users who liked specific Instagram posts using the Apify `datadoping/instagram-likes-scraper` actor (`WxPRaG9gfg5KZ4gY1`). No Instagram login or cookies required.

## What It Does

1. Accepts one or more Instagram post URLs
2. Calls Apify actor `WxPRaG9gfg5KZ4gY1` with `{ posts: [...urls], max_count: 1000 }`
3. Fetches all results with pagination
4. Inserts leads into `instagram_leads` DB table (deduplicates by username)

## Actor

- **Apify Actor ID:** `WxPRaG9gfg5KZ4gY1`
- **No cookies needed**
- **Input:** `{ "posts": ["https://www.instagram.com/p/SHORTCODE/"], "max_count": 1000 }`
- **Output fields:** `username`, `full_name`, `id`, `profile_pic_url`, `is_verified`, `is_private`, `liked_post`, `post_url`, `total_likes`

## How to Run

```bash
# Scrape likers from one or more posts
node skills/instagram-lead-scraper/scripts/instagram-lead-scraper.js --posts "https://www.instagram.com/p/ABC123/,https://www.instagram.com/p/DEF456/"

# With a campaign name
node skills/instagram-lead-scraper/scripts/instagram-lead-scraper.js --posts "https://www.instagram.com/p/ABC123/" --campaign "competitor_likers"

# Dry run (no DB insert)
node skills/instagram-lead-scraper/scripts/instagram-lead-scraper.js --posts "https://www.instagram.com/p/ABC123/" --dry-run
```

## Environment Variables

- `APIFY_API_KEY` — required
- `INSFORGE_CONNECTION_STRING` — required for DB insert

## Database

Inserts into `instagram_leads`:
- `username`, `full_name`, `profile_url`, `profile_picture_url`
- `instagram_id`, `is_verified`, `source_photo_url`
- `scraped_at`, `campaign_name`
- Unique constraint on `username` — duplicates silently skipped
