# YouTube to HeyGen Avatar Video Agent

## Overview

Converts YouTube videos into short-form avatar videos using your HeyGen clone. The agent analyzes the video with Gemini, rewrites content as an Alex Hormozi-style 60-second script, generates a social media caption, and creates an avatar video.

## Workflow

```
YouTube URL → Gemini Analysis → Alex Hormozi Script → Generate Caption → HeyGen Avatar Video → Store in Database
```

## Database Table

**Table:** `gemini_video_agent`

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Auto-increment primary key |
| `original_youtube_url` | TEXT | Source YouTube URL (required) |
| `raw_heygen_video_url` | TEXT | HeyGen generated video URL |
| `final_edited_video_url` | TEXT | Post-edited video URL (optional) |
| `post_caption` | TEXT | Generated social media caption |
| `created_at` | TIMESTAMP | When the video was generated |

## Script Format (Alex Hormozi Style)

### Core Principles

1. **Hook (First 3-5 seconds)**
   - Pattern interrupt with bold/contrarian statement
   - Value declaration
   - Problem agitation with urgency

2. **Body (60-70%)**
   - ONE core concept explained thoroughly
   - 2-3 supporting points max
   - Short, punchy sentences
   - Specific numbers and metrics

3. **Close (Final 15-20 seconds)**
   - Restate transformation
   - Create urgency
   - Comment CTA (e.g., "COMMENT GEMINI, and I'll send you the blueprint")

### Tonal Characteristics
- Confident without arrogance
- Educational intensity
- No fluff - every sentence serves the argument
- Conversational authority
- Outcome-obsessed

### Word Count
- Target: ~180 words (equals ~60 seconds of talking)
- Max: 4000 characters (HeyGen limit)

## Caption Format

- SEO and keyword rich
- Include relevant hashtags
- End with same comment CTA as video script
- Clean text only (no markdown)

## HeyGen Configuration

| Setting | Value |
|---------|-------|
| Dimension | 1080x1920 (vertical/shorts) |
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
# Generate avatar video from YouTube
python3 implementation/youtube_to_heygen_video.py "https://www.youtube.com/watch?v=VIDEO_ID"

# Start generation without waiting for completion
python3 implementation/youtube_to_heygen_video.py "https://www.youtube.com/watch?v=VIDEO_ID" --no-wait
```

## Claude Code Skill

Invoke with:
```
/youtube-to-clone-shorts https://youtube.com/watch?v=VIDEO_ID
```

## API Details

### Gemini
- **Model:** `gemini-2.0-flash`
- **Capability:** Direct YouTube URL analysis (no download needed)

### HeyGen
- **Endpoint:** `POST https://api.heygen.com/v2/video/generate`
- **Status Check:** `GET https://api.heygen.com/v1/video_status.get?video_id=XXX`
- **Typical Generation Time:** 2-5 minutes for 60-second video

## Warnings & Learned Constraints

### WARNING: Script Length
Keep script under 4000 characters. Longer scripts will be truncated.

### WARNING: Video Generation Time
HeyGen video generation takes 2-5 minutes. The script polls every 10 seconds with a 10-minute timeout.

### WARNING: Newline Characters
Remove all `\n` literals from script output. They cause unnatural pauses in avatar speech.

### WARNING: Gemini YouTube Analysis
Gemini can analyze YouTube URLs directly - no need to download videos. This is faster and avoids 403 errors.

## Best Practices

1. **Script Cleanup:** Strip markdown and newlines before sending to HeyGen
2. **Polling:** Use 10-second intervals to check video status
3. **Error Handling:** HeyGen may fail on very long scripts - enforce character limits
4. **Database:** Store video_id immediately, update with URL after completion
