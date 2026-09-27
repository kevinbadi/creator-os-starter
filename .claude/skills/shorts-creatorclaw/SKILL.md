---
name: shorts-creatorclaw
description: Watch the "SHORTS FOR CREATORCLAW" folder for new short videos, upload each to the publishing API, generate captions via Gemini, and blast to all socials (Instagram, TikTok, YouTube). Tracks sent files with a .published marker and dedupes via DB. Trigger when asked to publish CreatorClaw shorts, blast shorts to all platforms, or process the shorts watch folder.
---

# Shorts — CreatorClaw Blaster

Watches `~/Downloads/SHORTS FOR CREATORCLAW` for new short videos, uploads each via
the publishing API, auto-generates a caption with Gemini, and posts to every
connected social. Each file is marked `{filename}.published` and tracked in the DB
so it's only sent once.

## Prerequisites

- `LATE_API_KEY` — publishing API key (posts via `https://zernio.com/api/v1`).
- `GEMINI_API_KEY` — caption generation.
- `INSFORGE_CONNECTION_STRING` (or `DATABASE_URL`) — dedup tracking.
- Watch folder: `~/Downloads/SHORTS FOR CREATORCLAW` (video files: mp4/mov/webm/avi/mkv).

## Run

```bash
node scripts/shorts-creatorclaw.js
node scripts/shorts-creatorclaw.js --platforms instagram,tiktok,youtube
node scripts/shorts-creatorclaw.js --dry-run
```

**Flags:** `--platforms <csv>` (default all connected), `--dry-run`.

## Cron use

Folder-watcher pattern — schedule frequently (e.g. every 15–30 min) so dropped
clips publish promptly. Idempotent via the `.published` marker, so re-runs are safe.

> ⚠️ Stub recovered from the ai-os-skills repo — note the publishing base URL points
> at `zernio.com/api/v1` (same API the dashboard's `createPost()` uses). Confirm the
> watch-folder path and API keys before scheduling.
