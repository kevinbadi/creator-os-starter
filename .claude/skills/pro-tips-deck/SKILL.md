---
name: pro-tips-deck
description: Professional Creator OS brand content — weekly 15-slide tips deck (TikTok/IG/LinkedIn) + daily tip-of-the-day X post, all in the locked black/teal editorial style. Curates 10 fresh tips from the Jun Yuh bank + 2 notable-creator quote slides into the locked black-and-teal wireframe editorial style, then publishes to the brand's TikTok (full photo carousel + sound), Instagram (10-cut + trending sound cover), LinkedIn (multi-image) and X (image thread). Trigger to run/dry-run a deck, tune the style, or manage the every-other-day schedule.
---

# pro-tips-deck

The brand's flagship "professional-level" content series (Kevin 2026-07-08,
after v1 was approved on all four platforms): a 14-slide editorial deck —
cover + 10 tips + 2 influencer-quote slides + CTA — positioned as
*"we post the best marketing tips for creators, daily."*

## Locked visual system — DO NOT restyle per-run

- 1080×1350 (4:5). Matte-black canvas lifted with `eq` brightness/saturation.
- One glowing teal (#2dd4bf) wireframe metaphor per slide via fal
  nano-banana-2 (style block bans text/people/logos inside the image).
- Manrope-ExtraBold headlines, Arimo support, teal `TIP NN / 10` eyebrow,
  app icon + CREATOR OS wordmark top-left, @creator_oss footer.
- The app icon comes from the App Store lookup API and lives at
  `.claude/assets/brand/creatoros/app-icon.png`.

## Content rotation

- Tips: `.claude/skills/advice-carousel/data/jun-yuh-tips.json` (109 tips),
  ordered category-round-robin (deterministic), sliced 10 per run by
  `runIndex = floor(dayIndex / 2)` — every deck is fresh until the bank wraps
  (~3 weeks), then it recycles with different pairings. `EXCLUDE` drops tips
  that contradict the product (e.g. "master one platform first").
- Quotes: 2 per deck from the verified `QUOTES` bank (MrBeast, Gary Vee,
  Hormozi, Neistat, …) — rotate with the same runIndex. Only add REAL,
  widely-documented quotes to the bank.

## Schedule (Kevin 2026-07-08 pm)

- **Weekly deck** — registry job `pro-tips-deck`, daily 13:00 ET timer,
  script self-gates to dayIndex%7 anchored Jul 8 → TikTok + Instagram +
  LinkedIn. Off-days write a `pro-tips-deck-skip-<date>` row so the
  watchdog/manager see the slot as handled.
- **Daily X tip** — registry job `daily-tip-x`, 11:00 ET daily, runs this
  same script with `--daily-tip`: ONE branded tip-of-the-day slide + tweet,
  walking the bank sequentially (~109 days/cycle).
- fal outages don't miss slots: backgrounds fall back to the on-brand stock
  at `.claude/assets/brand/creatoros/bg-stock/`.

## Usage

```bash
node --env-file=.env.local .claude/skills/pro-tips-deck/scripts/pro-tips-deck.mjs --dry-run   # build only, review in feed
node --env-file=.env.local .claude/skills/pro-tips-deck/scripts/pro-tips-deck.mjs --publish   # full 4-platform publish
#   --force   bypass the every-other-day gate + already-posted guard
```

Publish legs are failure-isolated (one platform failing never blocks the
rest): TikTok + IG via the existing carousel publishers, LinkedIn + X direct
через Zernio. Every deck lands in the Carousels feed for review.
