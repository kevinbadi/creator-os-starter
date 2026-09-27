---
name: youtube-to-heygen-longform
description: Converts YouTube videos into long-form (10-14 minute) landscape avatar videos using HeyGen AI clone. Analyzes video with Gemini, generates full Alex Hormozi-style script condensed to max 2000 words, creates 1920x1080 landscape avatar video. Trigger when asked to create long-form avatar videos, clone long YouTube videos, or make HeyGen long-form content.
---

# YouTube to HeyGen Long-Form Avatar Video

Converts YouTube videos into long-form landscape avatar videos using your HeyGen AI clone. Two-step Gemini process: full script extraction → condensation to max 2000 words.

## What It Does

1. Sends YouTube URL to Gemini 2.0 Flash for full content analysis
2. Generates a full Alex Hormozi-style script matching the original video's content
3. Condenses to max 2000 words (~13-14 minute video at 150 words/min)
4. Sends to HeyGen API for landscape video generation (1920x1080)
5. Polls for completion (15-30 minutes) and stores in `youtube_long_form_heygen` table

## How to Run

```bash
# Generate long-form avatar video (default 2000 words max)
python3 skills/youtube-to-heygen-longform/scripts/youtube_to_heygen_longform.py "https://www.youtube.com/watch?v=VIDEO_ID"

# With custom word limit
python3 skills/youtube-to-heygen-longform/scripts/youtube_to_heygen_longform.py "https://www.youtube.com/watch?v=VIDEO_ID" --max-words 1500

# Start generation without waiting for completion
python3 skills/youtube-to-heygen-longform/scripts/youtube_to_heygen_longform.py "https://www.youtube.com/watch?v=VIDEO_ID" --no-wait
```

## Configuration

### Environment Variables

```env
GEMINI_API_KEY=xxx
HEYGEN_API_KEY=xxx
HEYGEN_AVATAR_ID=xxx       # Your avatar clone ID
HEYGEN_VOICE_ID=xxx        # Your voice clone ID
DATABASE_URL=postgresql://...
```

### Dependencies

```bash
pip install google-generativeai requests psycopg2-binary python-dotenv
```

## Short-Form vs Long-Form Comparison

| Feature | Short-Form | Long-Form |
|---------|------------|-----------|
| Max Words | ~180 | 2000 |
| Video Length | ~60 seconds | ~13-14 minutes |
| Dimension | 1080x1920 (vertical) | 1920x1080 (landscape) |
| Caption | Yes | No |
| Database Table | `gemini_video_agent` | `youtube_long_form_heygen` |
| Generation Time | 2-5 minutes | 15-30 minutes |
| Polling Interval | 10 seconds | 30 seconds |
| Timeout | 10 minutes | 30 minutes |

## Important Notes

- **Generation Time**: 15-30 minutes for 10+ minute videos — be patient
- **Word Limit**: ~150 words = 1 minute speaking time
- **Two-Step Gemini**: First extracts full content, then condenses to target length
- **Newlines**: Strip all `\n` literals — they cause unnatural pauses
- **Timeout**: 30-minute timeout with 30-second polling intervals

## Scripts

| File | Purpose |
|------|---------|
| `youtube_to_heygen_longform.py` | Main long-form avatar video generator |
