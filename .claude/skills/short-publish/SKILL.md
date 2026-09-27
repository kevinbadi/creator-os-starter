# short-publish

Publishes {{PERSONA_NAME}} short-form videos to all 5 social platforms (Instagram Reels, TikTok, YouTube Shorts, Facebook, Twitter/X) via the Late API.

## How It Works

1. Reads the sidecar `.json` metadata from `~/{{PersonaDir}}/videos/` (produced by `short-video`)
2. Generates platform-optimized captions via Gemini (different length/style per platform)
3. Publishes to all platforms in a single Late API call
4. Marks the sidecar as published (`published_at`, `late_post_id`)

## Usage

```bash
node skills/short-publish/scripts/short-publish.js [options]

Options:
  --video "path/to/sidecar.json"           # Specific video (default: latest unpublished)
  --platforms "instagram,tiktok,youtube"    # Filter platforms (default: all 5)
  --schedule "2026-03-05T09:00:00"         # Schedule post (default: publish now)
  --dry-run                                # Show what would be posted, skip publish
```

## Prerequisites

- `LATE_API_KEY` in `.env`
- `GEMINI_API_KEY` in `.env`
- Video must have a `media_url` (cloud URL from Late upload in `short-video` pipeline)
- All 5 platform accounts connected in Late (see SOCIALS.md)

## Platform Caption Strategy

| Platform | Style | Limit |
|----------|-------|-------|
| Instagram | Storytelling caption + hashtags | 2200 chars |
| TikTok | Short punchy + trending hashtags | 2200 chars |
| YouTube Shorts | Title + description + tags | 100 char title |
| Facebook | Warm caption + {{SKIP_ACCOUNT}}.ws link | 63,206 chars |
| Twitter/X | Punchy one-liner | 280 chars |

## Output

- Updates sidecar JSON with `published_at` and `late_post_id`
- Logs post IDs for each platform
