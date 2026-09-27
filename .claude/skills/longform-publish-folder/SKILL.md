---
name: longform-publish-folder
description: Publish long-form videos to YouTube from a local folder. Drop your edited videos into the watch folder and this skill uploads them with AI-generated titles, descriptions, and tags. Trigger when asked to publish YouTube videos, upload long-form content, or automate YouTube publishing.
---

# Longform Publish — Folder Method

**Publish your long-form videos to YouTube from a local folder.**

Drop your edited videos into `~/Long form videos/`. This skill picks them up, uploads to YouTube via Late API, and generates optimized titles, descriptions, and tags via Gemini.

For creators who edit their own YouTube content and want automated publishing.

---

## Watch Folder

Default: `~/Desktop/Long form videos/`

The skill scans this folder for video files (`.mp4`, `.mov`, `.webm`) that haven't been published yet. Published videos get a `.published.json` sidecar file so they're not re-posted.

### Folder Structure

```
~/Long form videos/
  ├── how-to-build-ai-agents.mp4       ← ready to publish
  ├── weekly-vlog-march.mov            ← ready to publish
  ├── old-video.mp4                    ← already published
  ├── old-video.published.json         ← sidecar (marks as published)
  └── thumbnails/                      ← optional: matching thumbnails
      └── how-to-build-ai-agents.jpg   ← auto-matched by filename
```

### Naming Convention

Name files descriptively — Gemini uses the filename for context:
- `how-to-build-ai-agents-2024.mp4` → title about building AI agents
- `day-in-my-life-austin-texas.mov` → vlog-style title about Austin

### Thumbnails

Put matching thumbnails in a `thumbnails/` subfolder with the same base name:
- Video: `my-video.mp4`
- Thumbnail: `thumbnails/my-video.jpg` (or `.png`)

---

## Usage

```bash
# Publish the next unpublished video
node skills/longform-publish-folder/scripts/longform-publish-folder.js

# Publish a specific file
node skills/longform-publish-folder/scripts/longform-publish-folder.js --file "~/Long form videos/my-video.mp4"

# Preview metadata without publishing
node skills/longform-publish-folder/scripts/longform-publish-folder.js --dry-run

# Custom watch folder
node skills/longform-publish-folder/scripts/longform-publish-folder.js --folder "~/Desktop/youtube"

# Publish ALL unpublished videos (batch mode)
node skills/longform-publish-folder/scripts/longform-publish-folder.js --all --limit 3

# Override video topic for better metadata
node skills/longform-publish-folder/scripts/longform-publish-folder.js --topic "Tutorial on building AI automation systems"

# Schedule for later
node skills/longform-publish-folder/scripts/longform-publish-folder.js --schedule "2026-03-20T14:00:00"

# Set visibility (public/private/unlisted)
node skills/longform-publish-folder/scripts/longform-publish-folder.js --visibility unlisted
```

## Flags

| Flag | Description |
|------|-------------|
| `--file PATH` | Publish a specific video file |
| `--folder PATH` | Override watch folder (default: `~/Long form videos/`) |
| `--schedule DATETIME` | ISO datetime to schedule publish |
| `--topic TEXT` | Override topic for metadata generation |
| `--visibility` | YouTube visibility: `public`, `private`, `unlisted` (default: public) |
| `--all` | Publish all unpublished videos in folder |
| `--limit N` | Max videos to publish in `--all` mode (default: 3) |
| `--dry-run` | Preview metadata, skip publishing |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LATE_API_KEY` | Yes | Late API key for publishing |
| `GEMINI_API_KEY` | Yes | Gemini API key for metadata generation |
| `INSFORGE_CONNECTION_STRING` | No | Database for post tracking |

## Generated Metadata

Gemini generates:
- **Title** — Clickable, YouTube-optimized (under 100 chars)
- **Description** — Full description with timestamps placeholder, links, hashtags
- **Tags** — 10-15 relevant tags for discoverability

## Output

After publishing, each video gets a `.published.json` sidecar:

```json
{
  "source_file": "how-to-build-ai-agents.mp4",
  "media_url": "https://cdn.getlate.dev/media/...",
  "late_post_id": "post_abc123",
  "youtube_video_id": "dQw4w9WgXcQ",
  "published_at": "2026-03-13T12:00:00Z",
  "title": "How I Built an AI Agent That Runs My Entire Business",
  "description": "...",
  "tags": ["ai", "automation", "business", ...]
}
```

## Cron Schedule (Recommended)

Check for new videos daily:
```
0 10 * * * node skills/longform-publish-folder/scripts/longform-publish-folder.js
```
