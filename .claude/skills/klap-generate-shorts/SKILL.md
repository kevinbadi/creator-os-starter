---
name: klap-generate-shorts
description: Generates short-form video clips from YouTube videos using Klap API. Submits video, polls for processing, exports all shorts with virality scores, downloads locally, and stores in database. Trigger when asked to create shorts from YouTube, generate clips from long videos, or use Klap for video editing.
---

# Klap Generate Shorts

End-to-end workflow for generating short-form video clips from YouTube videos using the Klap API. Handles the complete pipeline: submit → process → export → download → store.

## What It Does

1. Submits a YouTube URL to Klap for AI-powered editing
2. Polls for processing completion (~5-30 minutes)
3. Lists all generated shorts with virality scores
4. Exports each short (creates download URLs)
5. Downloads videos locally
6. Stores everything in `video_to_shorts_agent` database table
7. Sends desktop/webhook notifications when complete

## How to Run

```bash
# Generate shorts from YouTube video
python3 skills/klap-generate-shorts/scripts/klap_generate_shorts.py "https://youtube.com/watch?v=VIDEO_ID"

# With custom user ID
python3 skills/klap-generate-shorts/scripts/klap_generate_shorts.py "https://youtube.com/watch?v=VIDEO_ID" --user-id 2
```

## Configuration

### Environment Variables

```env
KLAP_API_KEY=xxx
DATABASE_URL=postgresql://...

# Optional
NOTIFICATION_WEBHOOK_URL=https://hooks.slack.com/services/...
```

### Dependencies

```bash
pip install requests psycopg2-binary python-dotenv
```

## Workflow Steps

1. **Submit** — `POST /tasks/video-to-shorts` with source URL, language, max duration, clip count
2. **Poll Task** — `GET /tasks/{task_id}` every 30 seconds until status = success
3. **List Shorts** — `GET /projects/{folder_id}` to get all generated clips
4. **Export** — `POST /projects/{folder_id}/{short_id}/exports` for each short
5. **Poll Export** — `GET .../exports/{export_id}` every 5 seconds until download URL ready
6. **Download** — Save MP4 files locally
7. **Store** — Update database with video URLs and metadata

## Klap API Settings

```python
max_duration = 30          # Max seconds per clip
max_clip_count = 5         # Max clips to generate
language = "en"
intro_title = False        # No intro title overlay
```

## Polling Configuration

```python
TASK_POLL_INTERVAL = 30    # Seconds between task checks
EXPORT_POLL_INTERVAL = 5   # Seconds between export checks
MAX_TASK_POLLS = 60        # ~30 min max wait for processing
MAX_EXPORT_POLLS = 40      # ~3 min max wait for export
```

## Database Table: `video_to_shorts_agent`

| Column | Description |
|--------|-------------|
| `id` | Klap clip ID |
| `name` | Generated clip title |
| `status` | pending → processing → complete → exported → downloaded |
| `src_url` | Original YouTube URL |
| `output_video_url` | Final exported video URL (Google Storage) |
| `virality_score` | AI-predicted virality (0-100) |
| `publication_captions` | Ready-to-use captions (JSONB) |

## Important Notes

- Processing takes 5-30 minutes depending on video length
- Each short must be exported individually before downloading
- Downloads go to `shorts/klap_{folder_id}_{date}/` directory
- macOS desktop notification sent when complete
- Klap dashboard: `https://klap.app/spaces/{folder_id}`
- Handles API rate limits, timeouts, and export failures gracefully

## Scripts

| File | Purpose |
|------|---------|
| `klap_generate_shorts.py` | Full end-to-end shorts workflow |
