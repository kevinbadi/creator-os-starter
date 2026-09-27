---
name: youtube-upload
description: Upload videos to YouTube via Studio browser automation. Use when publishing video content to YouTube, setting title/description/visibility, or automating YouTube publishing as part of a content pipeline.
---

# YouTube Upload

Upload video files to YouTube via Studio browser automation against a logged-in Chrome session.

## Prerequisites

- Clawdbot installed (script auto-starts browser if needed)
- Logged into YouTube Studio in the browser session
- `ws` npm package available

## Quick Usage

### Public upload with title and description
```bash
node skills/youtube-upload/scripts/youtube-upload.js \
  --video /path/to/video.mp4 \
  --title "My Video Title" \
  --description "Video description here"
```

### Unlisted upload
```bash
node skills/youtube-upload/scripts/youtube-upload.js \
  --video /path/to/video.mp4 \
  --title "Draft Video" \
  --visibility unlisted
```

### Private upload
```bash
node skills/youtube-upload/scripts/youtube-upload.js \
  --video /path/to/video.mp4 \
  --title "Private Draft" \
  --visibility private
```

## Options

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--video` | Yes | — | Path to video file |
| `--title` | Yes | — | Video title (max 100 chars) |
| `--description` | No | empty | Video description (supports newlines) |
| `--visibility` | No | `public` | `public`, `unlisted`, or `private` |
| `--cdp-port` | No | `18800` | Chrome CDP port |

## Output

- **stdout**: YouTube URL (e.g. `https://youtu.be/abc123`) or `UPLOAD_SUCCESS_NO_URL`
- **stderr**: Progress messages
- **Exit 0**: Success
- **Exit 1**: Error

## How It Works

1. Connects to Chrome via CDP, navigates to YouTube Studio
2. Clicks "Upload videos" to open the upload dialog
3. Uploads video via `DOM.setFileInputFiles`
4. Sets title via focus + `Input.insertText`
5. Sets description via focus + `Input.insertText`
6. Selects "Not made for kids"
7. Clicks Next 3 times (Details → Video elements → Checks → Visibility)
8. Selects visibility (Public/Unlisted/Private)
9. Clicks Publish (or Save for Private)
10. Extracts and returns the YouTube URL

## Pipeline Example: Veo + YouTube

Generate a video and upload it in one pipeline:
```bash
VIDEO=$(node skills/veo-video/scripts/veo-generate.js \
  --prompt "Kev's Assistant coding at a desk" \
  --image-prompt "20yo guy, brown wavy hair, dark grey tee, at a modern desk with monitors" \
  --output kevs-clip.mp4)

node skills/youtube-upload/scripts/youtube-upload.js \
  --video "$VIDEO" \
  --title "Kev's Assistant Vibe Coding" \
  --description "AI-generated content by Kev's Assistant at CreatorOS"
```

## Troubleshooting

- **Upload dialog not opening**: YouTube Studio may have popups or banners blocking — dismiss them first
- **Title not set**: The title input selector may change — check for `[aria-label*="title"]`
- **Video URL not found**: The youtu.be link appears in the publish confirmation dialog — timing may vary
- **"Not made for kids" not clicking**: Radio button selectors differ across YouTube Studio versions
