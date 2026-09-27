---
name: veo-video
description: Generate AI videos using Google Veo 3 (text-to-video and image-to-video). Use when creating video content from prompts, animating reference images into video clips, or generating short-form video for social media or YouTube. Supports Veo 2, Veo 3, Veo 3 Fast, and Veo 3.1 models.
---

# Veo Video

Generate AI videos via the Gemini API using Google's Veo models. Supports text-only prompts and image-referenced generation (image-to-video).

## Prerequisites

- `GEMINI_API_KEY` environment variable set
- Billing enabled on the Google AI account (Veo requires it)

## Quick Usage

### Text-to-video
```bash
node skills/veo-video/scripts/veo-generate.js \
  --prompt "A young developer typing at a modern desk with code on monitors" \
  --output my-video.mp4
```

### Image-to-video (reference frame)
```bash
node skills/veo-video/scripts/veo-generate.js \
  --prompt "A young man typing at a desk, focused and coding" \
  --image /path/to/reference-photo.png \
  --output my-video.mp4
```

### Generate a new reference image on the fly (Imagen 4)
```bash
node skills/veo-video/scripts/veo-generate.js \
  --prompt "A young man typing on a laptop at a coffee shop" \
  --image-prompt "A 20-year-old guy with brown wavy hair in a dark grey t-shirt, sitting at a coffee shop with a laptop, natural lighting, portrait photo" \
  --output coffee-shop-video.mp4
```

This generates a reference image via Imagen 4 first, saves it as `coffee-shop-video-ref.png`, then uses it as the Veo reference frame. Use this when you need Kev's Assistant in a setting that doesn't exist in the avatar library.

### Use a different model
```bash
node skills/veo-video/scripts/veo-generate.js \
  --prompt "..." \
  --model veo-3.0-fast-generate-001 \
  --output fast-video.mp4
```

## Available Models

| Model | ID | Notes |
|-------|-----|-------|
| Veo 2 | `veo-2.0-generate-001` | Older, requires billing |
| Veo 3 | `veo-3.0-generate-001` | Default, best quality |
| Veo 3 Fast | `veo-3.0-fast-generate-001` | Faster, slightly lower quality |
| Veo 3.1 | `veo-3.1-generate-preview` | Latest preview |
| Veo 3.1 Fast | `veo-3.1-fast-generate-preview` | Latest fast preview |

## Output

- **stdout**: Absolute path to saved video file
- **stderr**: Progress messages (generation time, download status)
- **Exit 0**: Success
- **Exit 1**: Error
- Typical output: 8s video, 1280x720, h264+aac, ~1.7MB

## How It Works

1. Sends prompt (+ optional base64 image) to Veo via `predictLongRunning`
2. Polls the operation every 10s until `done: true` (typically 30-90 seconds)
3. Downloads the generated video from the response URI
4. Saves to the specified output path

## Image Reference Tips

- Use a clear, well-lit photo of the subject
- The generated video will start from/match the reference image
- Resize large images before sending (1280px wide is plenty)
- Supported formats: PNG, JPEG, WebP
- The prompt should describe the motion/action, the image provides the look

## On-the-fly Image Generation (--image-prompt)

When `--image-prompt` is provided:
1. Imagen 4 generates a reference photo from your description
2. The reference image is saved as `{output}-ref.png`
3. That image is passed to Veo as the reference frame
4. You get both the reference image and the video

For Kev's Assistant-consistent images, always include in the image prompt:
"A 20-year-old guy with brown wavy hair, blue-green eyes, light acne, wearing a dark grey t-shirt"

Then add the setting: "at a coffee shop", "on a rooftop", "in a conference room", etc.

## Prompt Tips

- Be specific about the scene, lighting, and camera movement
- Include "cinematic" or "shallow depth of field" for film-like quality
- Describe the action: "typing on keyboard", "walking through city"
- Veo 3 generates audio too — mention sounds if relevant
