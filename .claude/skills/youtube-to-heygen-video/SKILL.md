---
name: youtube-to-heygen-video
description: Converts YouTube videos into short-form (60-second) avatar videos using HeyGen AI clone. Analyzes video with Gemini, generates Alex Hormozi-style script, creates vertical 1080x1920 avatar video with social media caption. Trigger when asked to create clone shorts, convert YouTube to avatar video, or make HeyGen short-form content.
---

# YouTube to HeyGen Avatar Video

Converts YouTube videos into 60-second vertical avatar videos using your HeyGen AI clone. Analyzes the video with Gemini AI, rewrites as an Alex Hormozi-style script, generates a social media caption, and creates the avatar video.

## What It Does

1. Sends YouTube URL to Gemini 2.0 Flash for direct video analysis
2. Generates a ~180-word Alex Hormozi-style script (≈60 seconds of speaking)
3. Creates a social media caption with SEO keywords and hashtags
4. Sends script to HeyGen API for avatar video generation (1080x1920 vertical)
5. Polls for completion and stores video URL in `gemini_video_agent` database table

## How to Run

```bash
# Generate avatar video from YouTube
python3 skills/youtube-to-heygen-video/scripts/youtube_to_heygen_video.py "https://www.youtube.com/watch?v=VIDEO_ID"

# Start generation without waiting for completion
python3 skills/youtube-to-heygen-video/scripts/youtube_to_heygen_video.py "https://www.youtube.com/watch?v=VIDEO_ID" --no-wait
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

## Script Format (Alex Hormozi Style)

- **Hook** (3-5 sec): Bold/contrarian statement, pattern interrupt
- **Body** (60-70%): ONE core concept, 2-3 supporting points, short punchy sentences
- **Close** (15-20 sec): Restate transformation, create urgency, comment CTA

### Constraints
- ~180 words (≈60 seconds)
- Max 4000 characters (HeyGen limit)
- No `\n` literals (causes unnatural pauses)
- No markdown formatting

## HeyGen Settings

| Setting | Value |
|---------|-------|
| Dimension | 1080x1920 (vertical/shorts) |
| Background | #000000 (black) |
| Avatar Style | normal |
| Voice Emotion | Excited |
| Generation Time | 2-5 minutes |

## Important Notes

- **Gemini**: Can analyze YouTube URLs directly — no need to download videos
- **Script Length**: Keep under 4000 characters or HeyGen truncates
- **Generation Time**: 2-5 minutes; script polls every 10 seconds with 10-minute timeout
- **Newlines**: Strip all `\n` literals — they cause unnatural pauses in avatar speech
- **Database**: Stores video_id immediately, updates with URL after completion

## Scripts

| File | Purpose |
|------|---------|
| `youtube_to_heygen_video.py` | Main short-form avatar video generator |
