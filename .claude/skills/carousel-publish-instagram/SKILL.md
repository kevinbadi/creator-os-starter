---
name: carousel-publish-instagram
description: Publish a carousel to Instagram via Zernio with a trending sound baked into the first slide — ffmpeg turns slide 1 + a favorited sound from the sounds table into a video that leads the carousel, so the whole post plays that sound. Trigger when asked to post an IG carousel with a trending sound for a persona.
---

# carousel-publish-instagram

Instagram's API can't attach audio to a carousel — but an IG carousel CAN mix video + images, and when slide 1 is a video its sound plays across the whole carousel. This skill exploits that:

1. **Pick the sound** — next favorited trending sound from the `sounds` table (Insforge), rotation-ordered `checked asc, last_used_at asc` and excluding `gender='male'`, same bookkeeping the Sounds tab shows.
2. **Build the video** — download the audio from Insforge storage, ffmpeg-mux with slide 1's image: H.264/AAC, 1080×1350, duration = the song's length clamped to **15–60s** (audio loops up to the 15s floor).
3. **Upload** video + remaining slides to Insforge → public URLs.
4. **Publish** via Zernio `POST /posts` — `mediaItems` video-first, persona's Instagram account, `publishNow` (or `scheduledFor`), with instagram `platformSpecificData`: single-video posts get `{ contentType: 'reels', shareToFeed: true }` (posted as a Reel that also shows on the profile feed); multi-item posts are feed carousels (IG can't publish a carousel as a Reel) and send `{ shareToFeed: true }`. Polls until the platform reports `published` and prints the live URL.
5. **Record** — marks the sound used (`checked`, `used_count`, `last_used_at`), stamps the sidecar with `instagram: { zernio_post_id, sound, published_at }`.

First live run (2026-07-01): v13 carousel + "CUFF IT — Beyoncé" → https://www.instagram.com/p/DaRDlrZDLdc/

## Usage

```bash
cd creator-os
node --env-file=.env.local .claude/skills/carousel-publish-instagram/scripts/carousel-publish-instagram.js \
  [--persona megan] [--carousel <dir-or-json>] [--sound <id>] [--schedule <ISO>] [--reel] [--publish]
```

Dry-run by default — builds `slide-01-sound.mp4` next to the slides for local review, uploads/posts nothing. `--sound <id>` overrides the rotation pick. `--reel` posts ONLY the sound video as an Instagram Reel (`contentType: 'reels'`, `shareToFeed: true`) instead of the full carousel.

## Prerequisites

- `.env.local`: `ZERNIO_API_KEY`, `INSFORGE_*`, `DATABASE_URL`
- `ffmpeg`/`ffprobe` on PATH
- Favorited sounds in the Sounds tab (the rotation pool)
- A rendered carousel sidecar (texted slides) from the carousel pipeline

## Notes

- TikTok sibling: `carousel-publish-tiktok` (images-only + native `auto_add_music` — no ffmpeg there).
- The sidecar's slide 1 stays a PNG; the generated `slide-01-sound.mp4` lives alongside and is only used for the IG upload.
