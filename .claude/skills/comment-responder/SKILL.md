# comment-responder

Auto-respond to comments across all platforms via Late API. Generates personalized replies with a CTA to the academy using Gemini, likes comments, and tracks state in a local JSON file.

## Usage

```bash
node skills/comment-responder/scripts/comment-response-agent.js [options]
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--platform` | Single platform to check | all |
| `--limit` | Max comments to respond to per run | 20 |
| `--dry-run` | Show what would happen, no replies sent | false |

## What It Does

1. Fetches all posts with comments from Late API (`GET /v1/inbox/comments`)
2. For each post, fetches individual comments (`GET /v1/inbox/comments/{postId}`)
3. Skips comments from own accounts and already-replied comments (tracked in `replied-comments.json`)
4. Generates a personalized reply via Gemini with academy CTA
5. Posts public reply via Late API (`POST /v1/inbox/comments/{postId}`)
6. Likes the comment via Late API
7. Saves comment ID to `replied-comments.json` to avoid duplicates

## Platforms

- Instagram, Facebook, Twitter/X, YouTube
- **Note:** Late API does NOT support TikTok comments
- YouTube returns `from.name` (not `from.username`)

## Prerequisites

- `LATE_API_KEY` in `.env`
- `GEMINI_API_KEY` in `.env`

## State

- `replied-comments.json` — local file tracking which comments have been replied to (no database needed)

## Cron

Runs via OpenClaw cron job (ID: `00000000-0000-0000-0000-000000000001`).
