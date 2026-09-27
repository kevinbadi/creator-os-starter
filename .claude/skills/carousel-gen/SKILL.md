# carousel-gen

Plan-driven carousel renderer for a persona brand pack. Turns an authored plan
into finished 1080×1350 slides (real library photos and/or FAL nano-banana-2
generations) with burned-in overlay text, plus a `carousel.json` sidecar for
`carousel-publish`.

## How It Works

1. **Plan** — a JSON plan (authored in the persona's voice) lists slides. Each
   slide is either `source: "library"` (a curated real photo from the persona's
   brand pack) or `source: "fal"` (generated with FAL nano-banana-2 using the
   persona's reference face for character consistency).
2. **Render** — each image is normalized to 1080×1350 (4:5 cover-crop) and the
   overlay text is burned on with ffmpeg (per-line drawtext + scrim box).
3. **Sidecar** — writes `carousel.json` with slide paths, captions, hashtags.

Persona brand pack (niche, voice, pillars, accounts, reference image, library) is
loaded from the `personas` Insforge table via `.claude/lib/persona.js`.

## Usage

```bash
node .claude/skills/carousel-gen/scripts/carousel-gen.js \
  --plan .claude/brand-content/<slug>/plans/<plan>.json [--slug megan] [--dry-run]
```

## Plan shape

```json
{
  "topic": "How I run my whole agency from one app",
  "content_pillar": "creatoros",
  "visual_pillar": "business",
  "slides": [
    { "source": "library", "image": "megan-fancy-work-laptop", "overlay": "How I run my agency from ONE app", "position": "top", "focus": "center" },
    { "source": "fal", "prompt": "...", "persona": true, "overlay": "..." }
  ],
  "caption": { "instagram": "...", "tiktok": "..." },
  "hashtags": ["#agencyowner", "..."]
}
```

- `position`: `top` (default) | `center` | `bottom`
- `focus` (cover-crop bias): `center` (default) | `top` | `bottom` — use `top` for
  full-body shots so heads aren't cropped.

## Prerequisites

- Persona seeded in `personas` table (`node --env-file=.env.local scripts/setup-personas.mjs`)
- ffmpeg with drawtext
- `FAL_KEY` in `.env.local` — only if any slide uses `source: "fal"`

## Output

`.claude/brand-content/<slug>/carousels/<date>-<topic-slug>/slide-01.png…` + `carousel.json`
