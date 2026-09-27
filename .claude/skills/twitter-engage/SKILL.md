# Twitter Engage Skill

Like, retweet, and comment on Twitter/X posts from a specified account using browser automation.

## Purpose
Automatically engage with tweets from your Twitter account as your assistant to boost engagement metrics.

## Usage

```bash
# Basic usage - engage with your tweets
cd ~/creator-os && \
  export $(grep -v '^#' .env | xargs) && \
  node skills/twitter-engage/scripts/twitter-engage.js --account your-handle

# With options
node skills/twitter-engage/scripts/twitter-engage.js \
  --account your-handle \
  --limit 5 \
  --dry-run
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--account` | Twitter handle (without @) | Read from onboarding-config.json |
| `--limit` | Max tweets to engage with per run | `5` |
| `--dry-run` | Preview without actually engaging | `false` |
| `--cdp-port` | CDP port for browser connection | `18800` |
| `--commenter` | Name for personalized comments | `Kev's Assistant` |

## Requirements

1. **Browser running:** `clawdbot browser start --profile clawd --headless`
2. **Logged into Twitter/X** as your assistant account in the clawd browser profile
3. **DATABASE_URL** env var set for PostgreSQL tracking

## Database

Tracks engagements in `twitter_engagements` table:
- `tweet_id` - Twitter post ID (unique)
- `account_handle` - Account that was engaged with
- `tweet_text` - Text content of the tweet
- `liked` - Whether tweet was liked
- `retweeted` - Whether tweet was retweeted
- `commented` - Whether comment was left
- `comment_text` - The comment that was posted
- `engaged_at` - Timestamp

## Comment Style

Uses hype/supportive comments appropriate for Twitter:
- "This is fire 🔥"
- "W tweet 🏆"
- "Facts 💯"
- etc.

## Output

Returns JSON with engagement results:
```json
{
  "account": "your-handle",
  "tweetsFound": 10,
  "alreadyEngaged": 7,
  "newlyEngaged": 3,
  "engagements": [
    {
      "tweetId": "1234567890",
      "text": "Building AI agents...",
      "liked": true,
      "retweeted": true,
      "commented": true,
      "comment": "This is fire 🔥"
    }
  ]
}
```
