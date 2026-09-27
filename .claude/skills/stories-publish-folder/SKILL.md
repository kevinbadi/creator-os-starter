---
name: stories-publish-folder
description: Publish Instagram and Facebook Stories from a local folder. Drop images or short videos, and this skill publishes them as stories. Trigger when asked to publish stories, post to IG stories, or automate story publishing.
---

# Stories Publish — Folder Method

**Publish Instagram and Facebook Stories from a local folder.**

Drop images or short videos into `~/Stories/`. This skill publishes them as Stories to Instagram and Facebook.

For creators who make their own story content and want automated publishing.

---

## Watch Folder

Default: `~/Desktop/Stories/`

The skill scans this folder for:
- **Images:** `.jpg`, `.png`, `.webp`
- **Videos:** `.mp4`, `.mov` (under 15 seconds recommended)

### Folder Structure

```
~/Stories/
  ├── monday-bts.jpg                  ← ready to publish
  ├── product-tease.mp4               ← short video story
  ├── old-story.jpg                   
  └── old-story.published.json        ← sidecar (marks as published)
```

### Story Sequences

Create a numbered sequence to post multiple stories in order:

```
~/Stories/monday-sequence/
  ├── 1.jpg (or 01-intro.jpg)
  ├── 2.jpg
  ├── 3.mp4
  └── 4.jpg
```

All items in the folder get posted as sequential stories.

---

## Usage

```bash
# Publish the next unpublished story
node skills/stories-publish-folder/scripts/stories-publish-folder.js

# Publish to Instagram only
node skills/stories-publish-folder/scripts/stories-publish-folder.js --platforms "instagram"

# Publish a specific file
node skills/stories-publish-folder/scripts/stories-publish-folder.js --file "~/Stories/my-story.jpg"

# Preview without publishing
node skills/stories-publish-folder/scripts/stories-publish-folder.js --dry-run

# Custom watch folder
node skills/stories-publish-folder/scripts/stories-publish-folder.js --folder "~/Desktop/ig-stories"

# Publish ALL unpublished stories (batch mode)
node skills/stories-publish-folder/scripts/stories-publish-folder.js --all --limit 10
```

## Flags

| Flag | Description |
|------|-------------|
| `--file PATH` | Publish a specific image or video |
| `--folder PATH` | Override watch folder (default: `~/Stories/`) |
| `--platforms LIST` | Comma-separated: `instagram,facebook` (default: both) |
| `--all` | Publish all unpublished stories |
| `--limit N` | Max stories in `--all` mode (default: 10) |
| `--dry-run` | Preview, skip publishing |

## Supported Platforms

| Platform | Image Stories | Video Stories |
|----------|--------------|---------------|
| Instagram | ✅ | ✅ |
| Facebook | ✅ | ✅ |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LATE_API_KEY` | Yes | Late API key for publishing |
| `INSFORGE_CONNECTION_STRING` | No | Database for tracking |

## Story Specs

### Instagram Stories
- **Images:** 1080x1920 recommended (9:16 aspect ratio)
- **Videos:** Up to 60 seconds, but 15 seconds recommended per story

### Facebook Stories
- **Images:** 1080x1920 recommended
- **Videos:** Up to 20 seconds

## Output

After publishing, each story gets a `.published.json` sidecar:

```json
{
  "source_file": "monday-bts.jpg",
  "media_url": "https://cdn.getlate.dev/media/...",
  "late_post_id": "post_abc123",
  "published_at": "2026-03-13T12:00:00Z",
  "published_platforms": ["instagram", "facebook"]
}
```

## Cron Schedule (Recommended)

Check for new stories 3x/day:
```
0 9,13,17 * * * node skills/stories-publish-folder/scripts/stories-publish-folder.js --all --limit 5
```
