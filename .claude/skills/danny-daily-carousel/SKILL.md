---
name: danny-daily-carousel
description: End-to-end daily "day in the life" carousel for Danny — rotated hook/scenes/caption → carousel-gen → QA gate with alternate-swap retry → Manrope text overlay → TikTok publish with native trending sound (autoAddMusic). Trigger to run/test the daily Danny post or adjust its rotation pools.
---

# danny-daily-carousel

One command produces and posts Danny's daily day-in-the-life TikTok carousel,
using the structure approved in V4:

```
plan (rotations) → carousel-gen → carousel-qa (retry loop) → carousel-overlay → carousel-publish-tiktok
```

## What rotates daily (by ET day index)

- **Hook** — cycles through `brand-content/danny/hook-headers.json` (10 variants).
- **Scene slots** — morning (dog walk / coffee / couch), work (edit cave / ring
  light / café), calls (rooftop / office / boardroom), money (911 ×2 / hotel).
  Cover, gym, fuel, dinner, receipts, and the inset closer stay fixed (QA-tuned).
- **Caption** — 3 full-length caption templates, all ending in the comment-"OS" CTA.

## QA gate

`carousel-qa` (vision judge with the composition/text-clearance rubric) must pass
all 10 slides. A failing pooled slide is swapped for the slot's next image and
re-rendered (≤3 attempts). If QA still fails — or a fixed slide fails — the run
**aborts without publishing** (exit 2) and leaves `qa.json` for review.

## Sound + platforms

Each daily run publishes to **both platforms** from the same texted slides:

- **TikTok** — photo post with `autoAddMusic: true`; TikTok attaches its
  recommended/trending sound natively. No audio files on our side.
- **Instagram** — IG's API can't attach audio, so `carousel-publish-instagram`
  bakes a trending sound (rotated from `sounds` favorites, `--sound-gender male`
  → male+any tagged, least-recently-used first, marked used after) into a
  15–60s video of slide 1, posted as the first carousel item followed by the
  9 images. A single-video run (`--reel`) posts as a true Reel
  (`contentType:'reels'`) — IG cannot publish a multi-item carousel as a Reel.

TikTok publishes first; an Instagram failure is logged loudly but never
retracts the already-live TikTok post.

## Usage

```bash
# full dry run (renders everything, publishes nothing)
npm run daily-danny

# real post
npm run daily-danny -- --publish

# re-run a specific day's rotation
node --env-file=.env.local .claude/skills/danny-daily-carousel/scripts/danny-daily-carousel.mjs --date 2026-07-04 --publish
```

## Schedule (6 PM ET daily)

`src/lib/content/cron.ts` runs this with `--publish` every day at **18:00
America/New_York** (DST-aware) inside the always-on web service. Arm it by
setting `DANNY_CRON_ENABLED=1` on the deployed service (leave unset locally).

## Prerequisites

`.env.local` / service env: `DATABASE_URL`, `FAL_KEY` (only if a retry needs
regeneration), `ANTHROPIC_API_KEY` (QA judge), `ZERNIO_API_KEY`,
`INSFORGE_API_BASE_URL`, `INSFORGE_API_KEY`. Plus ffmpeg. Danny seeded in
`personas` (`scripts/setup-personas.mjs`).

## Output

`.claude/brand-content/danny/carousels/<date>-day-in-the-life-<date>/` —
raw slides, `qa.json`, `overlays.json`, `texted/` (published set), and the plan
at `plans/daily-<date>.json`.
