---
name: daily-carousel
description: Fully automated daily Megan day-in-the-life carousel — builds a fresh plan from a rotation template, renders via carousel-gen, gates on carousel-qa (auto-fix), burns on-screen text via carousel-overlay, and publishes to IG + TikTok via carousel-publish/Zernio. Trigger to run the daily pipeline manually, dry-run it, or adjust the daily schedule/template.
---

# daily-carousel

The whole content machine in one command:

```
template + daily rotation → plan
  → carousel-gen        (render 10 slides, FAL nano-banana-2 — NO faces, persona shown from behind/phone-covered)
  → carousel-qa --fix   (Claude vision gate; auto-regenerates defects)
  → carousel-overlay    (timestamps + text, no-background style)
  → carousel-publish-tiktok  (Zernio → Megan's TikTok; autoAddMusic = trending sound, live)
```

**Publish gate:** if any slide still fails QA after auto-fix attempts, the run
aborts before publishing — the draft stays in the carousels feed for review.

## Daily rotation

`templates/day-in-the-life.json` holds the proven V10/V11 structure with banks
that rotate deterministically by day (`dayIndex % bank.length`):

- **hooks** — 8 outlandish cover headlines (+ matching caption hook lines)
- **outfits** — OOTD color woven into the FAL prompts (cream, all-black, …)
- **client names** — fictional venues per stop (yoga / café / brunch / gym / bar)

9 slides regenerate fresh via FAL each day; the CreatorOS dashboard render is
the one constant. Constants: Megan's face-free identity anchor (hair/necklace/outfit — her face is NEVER shown; TikTok banned the faced version), pink Macan, the husky,
the 5:45am → 9:30pm timeline, the comment-"OS" CTA.

## Usage

```bash
cd creator-os

# what cron runs (template mode, live publish)
node --env-file=.env.local .claude/skills/daily-carousel/scripts/daily-carousel.js

# rehearsal — full pipeline, publish step prints payload only
node --env-file=.env.local .claude/skills/daily-carousel/scripts/daily-carousel.js --dry-run

# explicit plan (skip template rotation)
node --env-file=.env.local .claude/skills/daily-carousel/scripts/daily-carousel.js \
  --plan <plan.json> --overlays <overlays.json>
```

## Schedule

Installed in `crontab` — **6:00 PM Eastern daily** (`0 18`; the machine is America/Toronto, so this is 6 PM ET, DST-handled):

```
0 18 * * * cd "<repo>/creator-os" && PATH=/opt/homebrew/bin:/usr/bin:/bin /opt/homebrew/bin/node --env-file=.env.local .claude/skills/daily-carousel/scripts/daily-carousel.js >> .claude/logs/daily-carousel.log 2>&1
```

Manage with `crontab -e` / `crontab -l`. Logs: `.claude/logs/daily-carousel.log`.

## Prerequisites

`.env.local`: `FAL_KEY` (generation), `ANTHROPIC_API_KEY` (QA judge),
`ZERNIO_API_KEY` (publish), `INSFORGE_*` (slide storage), `DATABASE_URL`
(persona + content_posts). Plus `ffmpeg` and the extracted
`.claude/assets/fonts/SnellRoundhand-Black.ttf` (timestamp font).

## Outputs (per run)

`.claude/brand-content/megan/carousels/<date>-day-in-the-life-marketing-manager-<date>/`
- `slide-*.png` raw → `texted/` burned → `carousel.json` (points at texted; feed + publish)
- `carousel.raw.json` (clean paths for MegOS), `qa.json`, `overlays.json`
- Published post recorded in `content_posts`; sidecar gets `zernio_post_id`.
