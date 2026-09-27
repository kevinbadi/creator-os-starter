# YouTube to HeyGen Long-Form Avatar Video Agent

## Overview

Converts YouTube videos into long-form avatar videos using your HeyGen clone. The agent analyzes the video with Gemini, rewrites content as a full Alex Hormozi-style script matching the original length, condenses to max 2000 words, and creates a landscape avatar video.

## Workflow

```
YouTube URL → Gemini Full Script → Condense to 2000 words → HeyGen Long-Form Video → Store in Database
```

## Database Table

**Table:** `youtube_long_form_heygen`

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Auto-increment primary key |
| `original_youtube_url` | TEXT | Source YouTube URL (required) |
| `raw_heygen_video_url` | TEXT | HeyGen generated video URL |
| `final_edited_video_url` | TEXT | Post-edited video URL (optional) |
| `created_at` | TIMESTAMP | When the video was generated |

## Script Format (Alex Hormozi Long-Form Style)

### Core Principles

1. **Hook**
   - Pattern interrupt with bold/contrarian statement
   - What the tool/concept is + promise of what they'll learn
   - Value declaration + problem agitation with urgency

2. **Body (60-70%)**
   - ONE core concept explained thoroughly
   - 2-3 supporting points maximum
   - Each point: explanation → example → application
   - Use metaphors from business, physics, everyday life

3. **Close**
   - Restate transformation in different words
   - Create urgency or consequence for inaction
   - Comment CTA (e.g., "COMMENT GEMINI, and I'll send you the blueprint")

### Tonal Characteristics
- Confident without arrogance
- Educational intensity
- No fluff - every sentence serves the argument
- Conversational authority
- Outcome-obsessed

### Word Count
- Default max: 2000 words
- ~150 words = 1 minute speaking time
- 2000 words ≈ 13-14 minute video

## HeyGen Configuration

| Setting | Value |
|---------|-------|
| Dimension | 1920x1080 (landscape) |
| Background | #000000 (black) |
| Avatar Style | normal |
| Voice Emotion | Excited |
| Avatar ID | From `HEYGEN_AVATAR_ID` env |
| Voice ID | From `HEYGEN_VOICE_ID` env |

## Environment Variables

```bash
GEMINI_API_KEY=your_gemini_api_key
HEYGEN_API_KEY=your_heygen_api_key
HEYGEN_AVATAR_ID=your_avatar_id
HEYGEN_VOICE_ID=your_voice_clone_id
DATABASE_URL=postgresql://...
```

## Usage

```bash
# Generate long-form avatar video from YouTube (default 2000 words max)
python3 implementation/youtube_to_heygen_longform.py "https://www.youtube.com/watch?v=VIDEO_ID"

# With custom word limit
python3 implementation/youtube_to_heygen_longform.py "https://www.youtube.com/watch?v=VIDEO_ID" --max-words 2000

# Start generation without waiting for completion
python3 implementation/youtube_to_heygen_longform.py "https://www.youtube.com/watch?v=VIDEO_ID" --no-wait
```

## Claude Code Skill

Invoke with:
```
/youtube-to-clone-longform https://youtube.com/watch?v=VIDEO_ID
```

## API Details

### Gemini
- **Model:** `gemini-2.0-flash`
- **Capability:** Direct YouTube URL analysis (no download needed)
- **Two-step process:** Full extraction → Condensation

### HeyGen
- **Endpoint:** `POST https://api.heygen.com/v2/video/generate`
- **Status Check:** `GET https://api.heygen.com/v1/video_status.get?video_id=XXX`
- **Typical Generation Time:** 15-30 minutes for long-form video

## Warnings & Learned Constraints

### WARNING: Video Generation Time
Long-form videos (10+ minutes) can take 15-30 minutes to generate. The script polls every 30 seconds with a 30-minute timeout.

### WARNING: Word Count
Keep script under max words to avoid truncation. The condense step ensures this.

### WARNING: Newline Characters
Remove all `\n` literals from script output. They cause unnatural pauses in avatar speech.

### WARNING: Gemini YouTube Analysis
Gemini can analyze YouTube URLs directly - no need to download videos. This is faster and avoids 403 errors.

## Best Practices

1. **Word Limit:** Use --max-words to control video length (150 words ≈ 1 minute)
2. **Script Cleanup:** Strip markdown and newlines before sending to HeyGen
3. **Polling:** Use 30-second intervals for long-form (less frequent than short-form)
4. **Database:** Store video_id immediately, update with URL after completion
5. **Timeout:** Allow 30 minutes for long-form video generation

## Comparison: Short-Form vs Long-Form

| Feature | Short-Form | Long-Form |
|---------|------------|-----------|
| Max Words | ~180 | 2000 |
| Video Length | ~60 seconds | ~13-14 minutes |
| Dimension | 1080x1920 (vertical) | 1920x1080 (landscape) |
| Caption Generation | Yes | No |
| Database Table | `gemini_video_agent` | `youtube_long_form_heygen` |
| Generation Time | 2-5 minutes | 15-30 minutes |
