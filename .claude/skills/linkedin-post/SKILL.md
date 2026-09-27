---
name: linkedin-post
description: Post text and optional image content to LinkedIn via browser automation. Use when creating LinkedIn posts, scheduling LinkedIn content, or automating LinkedIn publishing as part of a content pipeline.
---

# LinkedIn Post

Post text + optional image to LinkedIn using CDP browser automation against a logged-in Chrome session.

## Prerequisites

- Clawdbot installed (script auto-starts the browser if not running)
- Logged into LinkedIn (cookies at `cookies/linkedin-zeusbycreatoros.json`)
- `ws` npm package available

## Quick Usage

### Text-only post
```bash
node skills/linkedin-post/scripts/linkedin-post.js --text "Your post text here"
```

### Text + image post
```bash
node skills/linkedin-post/scripts/linkedin-post.js \
  --text "Your post text here" \
  --image /path/to/image.png
```

### Custom CDP port
```bash
node skills/linkedin-post/scripts/linkedin-post.js \
  --text "Post text" \
  --cdp-port 18800
```

## Output

- **stdout**: Post URL (e.g. `https://www.linkedin.com/feed/update/urn:li:share:...`) or `POST_SUCCESS_NO_URL`
- **stderr**: Progress/error messages
- **Exit 0**: Success
- **Exit 1**: Error

## How It Works

1. Connects to Chrome via CDP WebSocket
2. Finds or opens a LinkedIn tab, navigates to feed
3. Clicks "Start a post" to open the editor dialog
4. Injects text via innerHTML on LinkedIn's Quill editor (`.ql-editor`)
5. If image provided: clicks "Add media", uploads via `DOM.setFileInputFiles`
6. Clicks "Post" and waits for success dialog
7. Extracts and returns the post URL

## Formatting Notes

- Double newlines (`\n\n`) become separate paragraphs
- HTML entities are auto-escaped
- LinkedIn supports emojis natively in post text
- `@mentions` in text appear as plain text (not linked mentions) unless LinkedIn auto-resolves them

## Cron Automation

To schedule LinkedIn posts via cron, ensure the browser is running and LinkedIn session is active. Example cron job text:

```
Post to LinkedIn: "Your scheduled content here" with image /path/to/image.png
```

The agent reads this skill, runs the script, and confirms the post URL.

## Troubleshooting

- **Browser won't start**: Script auto-starts via `clawdbot browser start` or the control server at :18791. If both fail, start manually.
- **Not logged in**: Re-import cookies or log in manually via browser automation
- **Post button disabled**: Text may be empty or image upload failed — check stderr
- **Timeout on selector**: LinkedIn UI may have changed — update selectors in script
