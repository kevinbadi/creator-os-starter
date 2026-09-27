---
name: post-publish-folder
description: Publish text and image posts to social platforms from a local folder. Drop images with caption files or just text files, and this skill publishes to LinkedIn, Twitter, Facebook, and Instagram. Trigger when asked to publish posts, schedule content, or automate social posting.
---

# Post Publish — Folder Method

**Publish your text and image posts to social platforms from a local folder.**

Drop content into `~/Posts/`. This skill picks up images with caption files (or plain text files), and publishes to LinkedIn, Twitter/X, Facebook, and Instagram.

For creators who write their own posts and want automated cross-platform publishing.

---

## Watch Folder

Default: `~/Desktop/Posts/`

The skill scans this folder for:
- **Image posts:** `.jpg`, `.png`, `.webp` with matching `.txt` caption file
- **Text-only posts:** `.txt` files (for platforms that support text-only)

### Folder Structure

```
~/Posts/
  ├── monday-motivation.jpg           ← image to post
  ├── monday-motivation.txt           ← caption for the image
  ├── weekly-update.txt               ← text-only post
  ├── carousel/                       ← carousel folder
  │   ├── slide-1.jpg
  │   ├── slide-2.jpg
  │   └── caption.txt                 ← caption for carousel
  ├── old-post.jpg                    
  ├── old-post.txt
  └── old-post.published.json         ← sidecar (marks as published)
```

### Caption Files

Create a `.txt` file with the same name as your image:
- Image: `product-launch.jpg`
- Caption: `product-launch.txt`

The caption file contains your post text. Use `---` to separate platform-specific captions:

```
This is my LinkedIn post. More professional tone.
#business #startup

---twitter---
Short punchy version for Twitter/X 🚀

---instagram---
Full caption for Instagram with more hashtags
.
.
.
#instagram #content #creator
```

If no platform separators, the same caption is used everywhere.

---

## Usage

```bash
# Publish the next unpublished post
node skills/post-publish-folder/scripts/post-publish-folder.js

# Publish to specific platforms only
node skills/post-publish-folder/scripts/post-publish-folder.js --platforms "linkedin,twitter"

# Publish a specific file
node skills/post-publish-folder/scripts/post-publish-folder.js --file "~/Posts/my-post.jpg"

# Preview without publishing
node skills/post-publish-folder/scripts/post-publish-folder.js --dry-run

# Custom watch folder
node skills/post-publish-folder/scripts/post-publish-folder.js --folder "~/Desktop/social-posts"

# Publish ALL unpublished posts (batch mode)
node skills/post-publish-folder/scripts/post-publish-folder.js --all --limit 5

# Schedule for later
node skills/post-publish-folder/scripts/post-publish-folder.js --schedule "2026-03-20T09:00:00"
```

## Flags

| Flag | Description |
|------|-------------|
| `--file PATH` | Publish a specific image or text file |
| `--folder PATH` | Override watch folder (default: `~/Posts/`) |
| `--platforms LIST` | Comma-separated: `linkedin,twitter,facebook,instagram` |
| `--schedule DATETIME` | ISO datetime to schedule publish |
| `--all` | Publish all unpublished posts in folder |
| `--limit N` | Max posts in `--all` mode (default: 10) |
| `--dry-run` | Preview post, skip publishing |

## Supported Platforms

| Platform | Image Posts | Text-Only | Carousels |
|----------|------------|-----------|-----------|
| LinkedIn | ✅ | ✅ | ✅ |
| Twitter/X | ✅ | ✅ | ❌ |
| Facebook | ✅ | ✅ | ✅ |
| Instagram | ✅ | ❌ | ✅ |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LATE_API_KEY` | Yes | Late API key for publishing |
| `INSFORGE_CONNECTION_STRING` | No | Database for post tracking |

## Carousels

Create a subfolder with numbered images:

```
~/Posts/carousel-post/
  ├── 1.jpg (or slide-1.jpg, 01.jpg)
  ├── 2.jpg
  ├── 3.jpg
  └── caption.txt
```

The skill detects carousel folders and posts as multi-image posts.

## Output

After publishing, each post gets a `.published.json` sidecar:

```json
{
  "source_file": "monday-motivation.jpg",
  "caption_file": "monday-motivation.txt",
  "media_url": "https://cdn.getlate.dev/media/...",
  "late_post_id": "post_abc123",
  "published_at": "2026-03-13T12:00:00Z",
  "published_platforms": ["linkedin", "twitter", "facebook", "instagram"],
  "captions": { "linkedin": "...", "twitter": "...", ... }
}
```

## Cron Schedule (Recommended)

Check for new posts 3x/day:
```
0 9,13,17 * * * node skills/post-publish-folder/scripts/post-publish-folder.js
```
