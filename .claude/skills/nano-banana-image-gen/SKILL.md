# Skill: nano-banana-image-gen

## Purpose
Generate and edit images using FAL's Nano Banana 2 model (`fal-ai/nano-banana-2`). This is the **only** image generation model used in this workspace — all image generation and editing goes through Nano Banana 2 for character consistency.

## Why Nano Banana 2
- Character consistency for up to 5 people across generations
- Image-to-image editing with reference images (maintains {{PERSONA_NAME}}'s exact appearance)
- Native text rendering
- Supports 0.5K to 4K resolution
- $0.08/image (standard 1K)

## API Endpoints
- **Text-to-Image:** `POST https://fal.run/fal-ai/nano-banana-2`
- **Image-to-Image / Edit:** `POST https://fal.run/fal-ai/nano-banana-2/edit`

## Usage

### Image-to-Image (Primary — use for {{PERSONA_NAME}})
```bash
node scripts/nano-banana-gen.js --prompt "description of scene" --name "output-name" --ref brand-content/persona/reference.png
```

### Text-to-Image (No reference)
```bash
node scripts/nano-banana-gen.js --prompt "description" --name "output-name" --text-only
```

### Options
- `--prompt` — Image description (required)
- `--name` — Output filename (required)
- `--ref` — Reference image path for image-to-image (default: {{PERSONA_NAME}} reference)
- `--text-only` — Use text-to-image endpoint instead of edit
- `--resolution` — 0.5K, 1K (default), 2K, 4K
- `--aspect-ratio` — 1:1, 16:9, 9:16, 4:3, 3:4, etc. (default: 1:1)
- `--num` — Number of images 1-4 (default: 1)
- `--format` — png (default), jpeg, webp

## Key Rule
**Always use image-to-image (`/edit`) with {{PERSONA_NAME}}'s reference image when generating {{PERSONA_NAME}} content.** This maintains pure character consistency across all generated images.

## Reference Image
`brand-content/persona/reference.png` — {{PERSONA_NAME}} hero portrait (Samoan woman, 24, curly dark hair, warm smile, floral top)

## Output
- Images saved to `brand-content/persona/`
- Metadata stored in `persona_images` database table
- Returns image URL from FAL CDN

## Cost
- 1K: $0.08/image
- 2K: $0.12/image
- 4K: $0.16/image
