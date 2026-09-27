---
name: carousel-publish-tiktok
description: Publish a photo carousel to TikTok via Zernio with a native trending sound (autoAddMusic). Images only — no video. Trigger when asked to post/publish a TikTok carousel or photo-mode post for a persona.
---

# carousel-publish-tiktok

Publishes a persona's photo carousel to **TikTok** via the Zernio API (`POST /posts`).

TikTok photo carousels are **images only** (video is rejected). The trending sound is **native**: we set `autoAddMusic: true` and TikTok automatically adds recommended (trending) music. There is **no ffmpeg and no sound file** on our side — that only happens in the Instagram sibling skill, because Instagram's API cannot attach audio.

## How it works

1. Loads the persona brand pack from the `personas` table (`profileId`, `accounts.tiktok`) via `.claude/lib/persona.js`.
2. Finds the latest unpublished carousel sidecar in `.claude/brand-content/{slug}/carousels/` (produced by `carousel-gen`), or the one you pass with `--carousel`.
3. Uploads each `slide-NN.png` to Insforge storage → public URLs.
4. Posts to Zernio mirroring the official photo-carousel example — root-level `tiktokSettings` (snake_case): `media_type:'photo'`, `auto_add_music:true`, `photo_cover_index:0`, `privacy_level:'PUBLIC_TO_EVERYONE'`, `allow_comment:true`, `content_preview_confirmed:true`, `express_consent_given:true`, plus `publishNow:true` when not scheduling.
5. Stamps the sidecar with `published_at` + `zernio_post_id`.

Caption mapping (per Zernio docs): `content` becomes the photo **title** (90 chars max, hashtags/URLs auto-stripped) — we send the topic. The full caption + hashtags go in `tiktokSettings.description` (≤4000 chars). Captions come from `carousel.json` (`caption.tiktok` + `hashtags`) — no caption model at publish time. Photos are auto-resized by TikTok to 1080×1920.

## Usage

```bash
node .claude/skills/carousel-publish-tiktok/scripts/carousel-publish-tiktok.js [options]

Options:
  --persona <slug>       Persona slug (default: $PERSONA_SLUG or "megan")
  --carousel <path>      Specific carousel dir or carousel.json (default: latest unpublished)
  --schedule <ISO8601>   Schedule instead of posting now
  --publish              Actually post. WITHOUT this flag it is a DRY RUN.
```

**Safety:** dry-run by default — it prints the plan and caption but uploads nothing and posts nothing. Add `--publish` to go live. Publishing to TikTok is outward-facing and not easily reversible.

## Prerequisites

- `.env.local` with `ZERNIO_API_KEY`, `INSFORGE_API_BASE_URL`, `INSFORGE_API_KEY`, `DATABASE_URL`.
- A generated carousel (slides + `carousel.json`) from `carousel-gen`.
- Persona row in `personas` with `zernio_profile_id` and `accounts.tiktok`.

## Notes

- Authoritative Zernio field names are camelCase inside `platformSpecificData` (the human docs show snake_case, but the OpenAPI uses camelCase; both are accepted per the TikTok schema).
- Photo titles auto-truncate at ~90 chars, so the full caption is also sent as `description` (max 4000).
