# short-video

Short-form vertical video pipeline for {{PERSONA_NAME}} — generates Reels/Shorts/TikToks promoting Samoa tourism via {{BRAND_NAME}}.

## Two-Stage Pipeline

1. **Content Creation** — Auto-generates a topic from INFORMATION.md, rotates content pillars, selects a matching HeyGen avatar look, writes a 30-60s script via Gemini, and generates a 9:16 avatar video via HeyGen.
2. **Post-Production** — Downloads the HeyGen video, runs Whisper for word-level timestamps, generates Hormozi-style word-by-word animated captions (ASS subtitles), and burns them onto the video with ffmpeg.

## Usage

```bash
node skills/short-video/scripts/short-video.js [options]

Options:
  --topic "To Sua Ocean Trench"   # Override auto-topic selection
  --pillar "hidden-samoa"         # Override pillar rotation
  --look "waterfall"              # Override avatar look (waterfall|jungle|studio)
  --dry-run                       # Print script + config, skip video generation
  --skip-captions                 # Output raw HeyGen video without caption burn-in
```

## Output

- Final video: `~/{{PersonaDir}}/videos/{date}-{slug}.mp4`
- Metadata sidecar: `~/{{PersonaDir}}/videos/{date}-{slug}.json`
- Database row in `heygen_videos` table

## Prerequisites

- `GEMINI_API_KEY` in `.env`
- `HEYGEN_API_KEY` in `.env`
- Whisper CLI (`pip install openai-whisper`)
- ffmpeg installed
- PostgreSQL (Insforge) connection via `INSFORGE_CONNECTION_STRING`

## Content Pillars (auto-rotated)

1. Hidden Samoa
2. Local Life
3. Adventure
4. Business Spotlight
5. Travel Tips
6. Culture Education

## Avatar Looks (from config/heygen-avatars.json)

| Look | Setting | Best For |
|------|---------|----------|
| waterfall | Waterfall backdrop | Hidden Samoa, Adventure, Culture |
| jungle | Jungle trail | Adventure, Hidden Samoa, Local Life |
| studio | Indoor studio | Travel Tips, Business Spotlight, Culture |
