---
name: wan-video-clone
description: Clone Kevin's videos as Kev's Assistant using AI face swap + voice clone + WAN 2.2 animate. Handles long videos by splitting into 5s chunks, processing each through the pipeline, and stitching back together. Trigger when asked to clone a video, create a Kev's Assistant version, or convert Kevin's content into Kev's Assistant content.
---

# WAN 2.2 AI Video Clone Pipeline (Chunked)

Takes Kevin's video in, splits it into ~30s chunks, runs each through the AI pipeline, stitches them back together. Out the other side: Kev's Assistant talking in Kevin's chair with Kev's Assistant's voice.

## Pipeline

```
Kevin's Video
    │
    ▼
┌─────────────────────┐
│  ffmpeg split (~5s)  │
└────────┬────────────┘
         │
    ┌────▼────┐
    │ chunk_0 │  chunk_1  chunk_2  ...
    └────┬────┘
         │  For each chunk:
         ├─ Extract audio (ffmpeg local)
         ├─ Voice clone → Kev's Assistant (ChatterboxHD / fal.ai)
         ├─ Merge cloned audio back (ffmpeg local)
         ├─ Upload merged chunk to fal.ai
         ├─ WAN 2.2 animate/replace (Kev's Assistant face + chunk)
         └─ Download output chunk
         │
    ┌────▼────────────────┐
    │  ffmpeg stitch all   │
    └────────┬─────────────┘
             │
             ▼
      Kev's Assistant's Video
```

## Prerequisites

- `FAL_KEY` env var (fal.ai API key)
- `ffmpeg` installed
- `assets/kevs-reference.png` — Kev's Assistant face reference image
- `assets/kevs-voice-sample.mp3` — Kev's Assistant voice sample for cloning
- Optional: `REPLICATE_API_TOKEN` (not needed if using local ffmpeg for audio)

## Usage

```bash
# Basic — clone a video
node skills/wan-video-clone/scripts/wan-video-clone.js \
  --video "https://example.com/kevin-video.mp4"

# Local file
node skills/wan-video-clone/scripts/wan-video-clone.js \
  --video /path/to/kevin.mp4

# Custom chunk size (default 5s)
node skills/wan-video-clone/scripts/wan-video-clone.js \
  --video "URL" --chunk-duration 5

# Process 2 chunks at a time (parallel)
node skills/wan-video-clone/scripts/wan-video-clone.js \
  --video "URL" --parallel 2

# Skip voice clone (face only)
node skills/wan-video-clone/scripts/wan-video-clone.js \
  --video "URL" --skip-voice

# Skip face swap (use Kev's Assistant ref image directly with WAN)
node skills/wan-video-clone/scripts/wan-video-clone.js \
  --video "URL" --skip-face-swap

# Dry run (show plan without executing)
node skills/wan-video-clone/scripts/wan-video-clone.js \
  --video "URL" --dry-run
```

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--video` | required | Source video URL or local path |
| `--chunk-duration` | `30` | Seconds per chunk |
| `--parallel` | `1` | Max concurrent chunk processing |
| `--resolution` | `720p` | WAN output resolution |
| `--kevs-image` | auto | Kev's Assistant face image URL (uses asset if not set) |
| `--kevs-voice` | auto | Kev's Assistant voice sample URL (uses asset if not set) |
| `--prompt` | auto | Face swap prompt for Nano Banana |
| `--skip-voice` | false | Skip voice cloning step |
| `--skip-face-swap` | false | Use Kev's Assistant ref image directly |
| `--output` | `output/wan-clones/` | Output directory |
| `--dry-run` | false | Show plan without executing |

## Timing

- Face swap: ~1 min (one-time)
- Per chunk: ~15-20 min (WAN animate is the bottleneck)
- A 5 min video = 10 chunks × ~20 min = ~3.5 hours sequential, ~2 hours with parallel=2
- A 30s video = 1 chunk = ~20-25 min total
- Stitching: seconds
- IMPORTANT: Source video must be H.264 codec. AV1/VP9 causes WAN to hang. Script auto-re-encodes if needed.

## Output

Final video saved to `output/wan-clones/<timestamp>/kevs-assistant-clone-<timestamp>.mp4`

## Key APIs

- **fal.ai Nano Banana Pro** — face swap (`fal-ai/nano-banana-pro/edit`)
- **fal.ai ChatterboxHD** — voice clone (`resemble-ai/chatterboxhd/speech-to-speech`)
- **fal.ai WAN 2.2** — animate/replace (`fal-ai/wan/v2.2-14b/animate/replace`)
- **ffmpeg** — split, extract audio, merge audio, stitch (all local, no API)
