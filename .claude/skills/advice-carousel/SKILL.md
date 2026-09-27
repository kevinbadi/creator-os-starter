---
name: advice-carousel
description: Daily "marketing manager advice" carousel for Megan/Danny — proof-first hook, 10 creator-growth tips (one native CreatorOS integration slide), recap + link-in-bio CTA. Publishes the full deck to TikTok (autoAddMusic), a ≤10-item cut to Instagram (trending sound video slide 1), and a one-tip-per-tweet thread to Twitter + Threads. Trigger to run/dry-run the daily advice post or tune its templates.
---

# advice-carousel

The passive-advertising sibling of `daily-carousel`: instead of showing the
persona's day, it hands out their playbook. Positions Megan/Danny as marketing
managers who "figured it out"; CreatorOS appears once, as a native tip, plus a
link-in-bio CTA. Editorial direction lives in the outer project's
`marketing-advice-carousel` living skill; this skill is the executable pipeline.

## Deck structure (from the locked skeleton)

| role | slide | notes |
|------|-------|-------|
| hook | rich-lifestyle thumbnail (Porsche/Pilates/gym/loft) + proof-first headline + **proof inset** | fal-generated fresh daily, frame-dominant, face hidden. The inset is a small fal-generated fake IG profile of the venue the hook claims (e.g. PULSE45 gym @ 1M followers), composited top-right via carousel-overlay's `inset` support — each hook entry's `inset.prompt` must match its claim's venue + number. Prompts demand full-bleed UI (no phone mockup) so the stats stay legible; `widthFrac`/`pos`/`margin` tunable per hook. Non-fatal if generation fails. NOTE: insets composite AFTER the QA gate, so keep "no visible faces" in every inset prompt. |
| stakes | "posting daily and still stuck under 1k views?" | optional per series |
| reframe | the core insight in one line | optional per series |
| tip × N | `TIP n/N` eyebrow + headline + ≤2 support lines, text centered | backgrounds rotate from the template pool |
| integration | real app screenshot (contain-fit over blur) + testimonial copy | ONE per deck, reads as tip n |
| proof | receipts screenshot or text slide | optional per series |
| recap | all tips as a checklist — the save trigger | `bullets` overlay |
| cta | ONE action: link in bio | `caption` overlay |

## Per-platform distribution

- **TikTok** — full deck (≤35 photos), `autoAddMusic` trending sound.
- **Instagram** — ≤10-item cut (`ig/carousel.json`): hook, integration, recap,
  CTA always survive; remaining slots fill with tips in order; stakes/reframe/
  proof are the first drops. Sound video (existing rotation) takes one slot.
- **Twitter + Threads** — `advice-publish-thread.js` posts one thread per
  platform via Zernio `threadItems`: extended intro (+ hook image) → one tip
  per item (integration item carries the app screenshot) → CTA with the App
  Store link. Twitter capped at 280 chars/item, Threads 500. Missing accounts
  are skipped — Threads goes live automatically once the account is added to
  `personas.accounts.threads`.

## Run it

```bash
cd creator-os
node --env-file=.env.local .claude/skills/advice-carousel/scripts/advice-carousel.js --dry-run              # Megan rehearsal
node --env-file=.env.local .claude/skills/advice-carousel/scripts/advice-carousel.js --persona danny        # Danny, LIVE
node --env-file=.env.local .claude/skills/advice-carousel/scripts/advice-carousel.js --series ugc-starter   # pin a tip series
```

Cron: registered in `src/lib/content/registry.ts` as `megan-advice` /
`danny-advice` — armed on Railway with `MEGAN_ADVICE_CRON_ENABLED=1` /
`DANNY_ADVICE_CRON_ENABLED=1` (hours via `*_CRON_HOURS_ET`, defaults 13/14 ET
so the advice post lands between the two day-in-the-life slots).

## GIF thread variation (format test, 2026-07-09)

Threads supports GIFs on posts — `scripts/advice-thread-gifs.js` builds the
same thread as `advice-thread.js` and rides a reaction GIF on the intro hook
plus AT MOST one body item where it really matters (Kevin's format, 07-09 —
no CTA GIF, never the integration item, never the same GIF twice). Claude
(`claude-opus-4-8`) picks the body item (or none) and writes the Giphy
queries, then picks the best candidate per search by title. Chosen
mp4s are mirrored to Insforge and posted as `mediaItems: [{type:"video"}]`
(Threads renders looping GIFs); picks are checked into the `gifs` table and a
review entry lands in the Carousels feed. Publisher support is the additive
`--gifs` flag on `advice-publish-thread.js`.

```bash
node --env-file=.env.local .claude/skills/advice-carousel/scripts/advice-thread-gifs.js --persona danny --slot 5 --publish
```

NOT in the cron registry — manual test runs only until Kevin approves the
format (first pair live 07-09: danny s5 + megan s3, `advice-thread-gifs-%`
carousel ids, `metadata.gifs` on the content_posts rows for eval). Zernio
gotcha: multi-video threads make the POST slow — the publisher retries network
failures and treats the 24h-dedup 409 as success; a Zernio "failed/timed out"
status can still be live on Threads (verify via external-post sync).

## Templates (`templates/advice-{megan,danny}.json`)

- `banks.hooks` — proof-first formulas ({headline, thread_intro, caption_line},
  picked together so cover, thread and caption always tell the same story).
- `banks.hook_scenes` / `backgrounds` — fal prompts (face-hidden, solo-subject
  only: group scenes are what fail QA). Background entries may instead be
  `{"library": "name"}` or `{"file": "path"}` to reuse renders at zero fal cost.
- `series[]` — the advice content. Each series: optional stakes/reframe/proof +
  `tips[]` ({headline, short, support, thread}); the `{"integration": true}`
  entry becomes the CreatorOS slide, with copy rotating from
  `integration.variants`. **The seed `ugc-starter` series is placeholder copy —
  Kevin supplies the real advice; add each set as a new series and rotation
  cycles them by day.**
- `integration.screenshot` / `series[].proof.screenshot` — must live under
  `.claude/assets/` (brand-content does not deploy to Railway).

## Tip research harvest (Jun Yuh et al.)

Two pipelines fill `data/jun-yuh-tips.json` — the ranked tip bank that the
`series[]` sets are assembled from (each tip carries category + source url +
like/view counts for ranking):

1. **Captions**: Apify `apify~instagram-post-scraper` (username → dataset) →
   `scripts/jun-tips-harvest.js --dataset <id>` — Claude extracts only tips the
   caption actually TEACHES (teasers/motivation/promos skipped), semantically
   deduped against the bank, output already in template shape
   (headline/short/support/thread). Resumable; prints a MILESTONE block every
   50 tips (Kevin wants those relayed).
2. **Reel transcripts**: `scripts/jun-reels-transcribe.js --dataset <id> --top 100`
   — top reels by views → download mp4 (CDN urls expire, run right after the
   scrape) → ffmpeg mono mp3 → Insforge upload → fal-ai/whisper →
   `data/jun-yuh-transcripts.json`; then
   `jun-tips-harvest.js --transcripts data/jun-yuh-transcripts.json` funnels
   spoken tips into the SAME bank (same dedup — run after the caption pass,
   never concurrently: single bank file).

To harvest another creator from the swipe file, start a new Apify run for
their handle and reuse both scripts with the new dataset id.

## Gates & safety

- carousel-qa `--fix` is the publish gate (exit 2 = QA blocked, draft stays in
  the feed). Same no-visible-face hard rule as the daily pipeline.
- All three publishers are dry-run by default; the orchestrator passes
  `--publish` unless invoked with `--dry-run`.
- Every publish records to `content_posts` for the dashboard timeline.
