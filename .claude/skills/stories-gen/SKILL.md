# stories-gen

Vertical story frame pipeline for {{PERSONA_NAME}} — generates 3-5 story frames (9:16) with text overlays, then stitches them into a 15-second video with crossfade transitions.

## How It Works

1. **Content Ideation** — Gemini generates a story concept: topic, 3-5 frames, per-frame text (2-5 words), image prompts, and {{PERSONA_NAME}} YES/NO per frame.
2. **Image Generation** — FAL nano-banana-2 generates each frame at 9:16 aspect ratio using {{PERSONA_NAME}}'s reference face for character consistency.
3. **Text Overlay** — ffmpeg `drawtext` burns short, bold text centered on each frame.
4. **Video Stitch** — ffmpeg stitches all frames into a single 15-second MP4 with crossfade transitions.
5. **Output** — Frame PNGs + stitched video + sidecar JSON saved to `~/{{PersonaDir}}/stories/{date}-{slug}/`

## Usage

```bash
node skills/stories-gen/scripts/stories-gen.js [options]

Options:
  --topic "Sunday in Samoa"   # Override auto-topic selection
  --frames 4                  # Override frame count (default: Gemini decides, 3-5)
  --dry-run                   # Print story plan, skip image generation
```

## Output

- Frame images: `~/{{PersonaDir}}/stories/{date}-{slug}/frame-01.png` through `frame-N.png`
- Stitched video: `~/{{PersonaDir}}/stories/{date}-{slug}/story.mp4`
- Metadata sidecar: `~/{{PersonaDir}}/stories/{date}-{slug}/story.json`

## Prerequisites

- `GEMINI_API_KEY` in `.env`
- `FAL_KEY` in `.env`
- ffmpeg installed
- Reference image: `brand-content/persona/reference.png`

## Content Pillars (auto-rotated)

1. Hidden Samoa
2. Local Life
3. Adventure
4. Business Spotlight
5. Travel Tips
6. Culture Education
