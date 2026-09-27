# Short Publish — Folder Method

**Publish your own short-form videos to all platforms from a local folder.**

Drop `.mp4` or `.mov` files into your watch folder. This skill picks them up, uploads to Late cloud storage, generates platform-optimized captions via Gemini, and publishes to Instagram Reels, TikTok, YouTube Shorts, Facebook, and Twitter/X — all in one shot.

This is the **core publishing pipeline** for creators who make their own videos. No AI video generation — just your content, distributed everywhere.

---

## Watch Folder

Default: `~/Short form videos/`

The skill scans this folder for video files (`.mp4`, `.mov`, `.webm`) that haven't been published yet. Published videos get a `.published.json` sidecar file so they're not re-posted.

You can override the folder with `--folder "/path/to/videos"`.

### Folder Structure

```
~/Short form videos/
  ├── my-first-reel.mp4              ← ready to publish
  ├── behind-the-scenes.mov          ← ready to publish
  ├── old-video.mp4                  ← already published
  ├── old-video.published.json       ← sidecar (marks as published)
  └── published/                     ← optional: move published files here
```

### Naming Convention (Optional)

If you name files descriptively, Gemini uses the filename as context for better captions:
- `day-in-the-life-austin.mp4` → captions about day-in-the-life content in Austin
- `product-launch-announcement.mov` → captions about a product launch

---

## Usage

```bash
# Publish the next unpublished video in the folder
node skills/short-publish-folder/scripts/short-publish-folder.js

# Publish a specific file
node skills/short-publish-folder/scripts/short-publish-folder.js --file "~/Short form videos/my-video.mp4"

# Publish to specific platforms only
node skills/short-publish-folder/scripts/short-publish-folder.js --platforms "instagram,tiktok"

# Schedule instead of publish now
node skills/short-publish-folder/scripts/short-publish-folder.js --schedule "2026-03-14T09:00:00"

# Preview captions without publishing
node skills/short-publish-folder/scripts/short-publish-folder.js --dry-run

# Custom watch folder
node skills/short-publish-folder/scripts/short-publish-folder.js --folder "~/Desktop/reels"

# Publish ALL unpublished videos in the folder (batch mode)
node skills/short-publish-folder/scripts/short-publish-folder.js --all

# Limit batch to N videos
node skills/short-publish-folder/scripts/short-publish-folder.js --all --limit 5

# Override caption context (if filename isn't descriptive enough)
node skills/short-publish-folder/scripts/short-publish-folder.js --topic "Behind the scenes at the studio"
```

## Flags

| Flag | Description |
|------|-------------|
| `--file PATH` | Publish a specific video file |
| `--folder PATH` | Override watch folder (default: `~/Short form videos/`) |
| `--platforms LIST` | Comma-separated platforms (default: all) |
| `--schedule DATETIME` | ISO datetime to schedule (e.g. `2026-03-14T09:00:00`) |
| `--topic TEXT` | Override topic for caption generation |
| `--all` | Publish all unpublished videos in folder |
| `--limit N` | Max videos to publish in `--all` mode (default: 10) |
| `--dry-run` | Preview captions, skip publishing |
| `--headed` | (unused, kept for convention) |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LATE_API_KEY` | Yes | Late API key for publishing |
| `GEMINI_API_KEY` | Yes | Gemini API key for caption generation |
| `INSFORGE_CONNECTION_STRING` | No | Database connection for post tracking |

## Platform Account IDs

Read from `SOCIALS.md` in the workspace root. The skill parses Late Account IDs for each platform. If SOCIALS.md is not configured, pass `--profile` and `--accounts` flags.

## Output

After publishing, each video gets a `.published.json` sidecar:

```json
{
  "source_file": "my-first-reel.mp4",
  "media_url": "https://cdn.getlate.dev/media/...",
  "late_post_id": "post_abc123",
  "published_at": "2026-03-13T12:00:00Z",
  "published_platforms": ["instagram", "tiktok", "youtube", "facebook", "twitter"],
  "captions": { "instagram": "...", "tiktok": "...", ... }
}
```
