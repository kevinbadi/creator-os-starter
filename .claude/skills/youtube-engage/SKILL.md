# YouTube Engage Skill

Like and comment on YouTube videos from a specified channel using browser automation.

## Purpose
Automatically engage with videos from your YouTube channel as your assistant to boost engagement metrics.

## Usage

```bash
# Basic usage - engage with your channel's videos
cd ~/creator-os && \
  export $(grep -v '^#' .env | xargs) && \
  node skills/youtube-engage/scripts/youtube-engage.js --channel your-handle

# With options
node skills/youtube-engage/scripts/youtube-engage.js \
  --channel your-handle \
  --limit 5 \
  --dry-run
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--channel` | YouTube channel handle (without @) | Read from onboarding-config.json |
| `--limit` | Max videos to engage with per run | `5` |
| `--dry-run` | Preview without actually engaging | `false` |
| `--cdp-port` | CDP port for browser connection | `18800` |
| `--commenter` | Name for personalized comments | `Kev's Assistant` |

## Requirements

1. **Browser running:** `clawdbot browser start --profile clawd --headless`
2. **Logged into YouTube** as your assistant account in the clawd browser profile
3. **DATABASE_URL** env var set for PostgreSQL tracking

## Database

Tracks engagements in `youtube_engagements` table:
- `video_id` - YouTube video ID (unique)
- `channel_handle` - Channel that was engaged with
- `video_title` - Title of the video
- `liked` - Whether video was liked
- `commented` - Whether comment was left
- `comment_text` - The comment that was posted
- `engaged_at` - Timestamp

## Comment Style

Uses hype/supportive comments appropriate for YouTube:
- "This is incredible content 🔥"
- "Let's goooo 🚀"
- "Banger video as always 💯"
- etc.

## Output

Returns JSON with engagement results:
```json
{
  "channel": "your-handle",
  "videosFound": 10,
  "alreadyEngaged": 7,
  "newlyEngaged": 3,
  "engagements": [
    {
      "videoId": "abc123",
      "title": "How to Build AI Apps",
      "liked": true,
      "commented": true,
      "comment": "This is fire 🔥"
    }
  ]
}
```
