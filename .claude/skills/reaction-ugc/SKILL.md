---
name: reaction-ugc
description: Beat-synced reaction meme video for Megan/Danny — reaction clip (vague hook) → real app B-ROLL with reveal text → payoff text, cut to the beat grid of a trending sound. Publishes to TikTok as a video and Instagram as a Reel (or feed carousel via --ig-carousel). Trigger to build/post a reaction UGC video or tune its rotation banks.
---

# reaction-ugc

Reaction meme: someone reacts in disbelief, then real app footage shows what
they found. Passive ad format — the "discovery" IS the story, CreatorOS is
the punchline.

## The 3 pieces (beat-aligned) — DEFAULT since 2026-07-08

| # | piece | beats | source |
|---|-------|-------|--------|
| 1 | reaction clip + vague hook text | trimmed to whole beats | rotates through `.claude/assets/reaction-clips/` (1080x1920) |
| 2 | app B-ROLL + reveal text ("an app that manages all your socials at once") | 2 | `.claude/assets/broll/` screen recordings, `angle.broll` picks which |
| 3 | same B-roll continuing + payoff text ("this saves me hours every day") | 2 | text swaps at the beat boundary, footage uncut |

Kevin's 3-beat text path (2026-07-08): credibility hook ("ive been making
content for 4 years and ive just found this...") → plain-language reveal →
personal-benefit payoff. Hook stays vague on the clip; the b-roll answers it.

**B-roll bank** (`.claude/assets/broll/`, mirrored to Insforge — Railway
auto-downloads): home-screen-scroll, post-all-platforms, post-types,
post-analytics, content-calendar. Each angle maps to the footage that proves
its claim (`angles[].broll` in `templates/reaction.json`). New b-roll: drop a
1080x1920 screen recording in the folder, upload to Insforge, add to
`TEMPLATE.broll`, point angles at it.

Legacy formats: `--cards` = old 5-still deck (card → before → after →
receipts); an angle without `broll` falls back to the single reveal still.

Assembly: BPM detected from the chosen sound (same dependency-free detector as
the IG slideshow Reel); the clip end and every cut land on the beat grid;
sound plays across the whole video with a 0.5s fade-out. Typical output ~9s.

## Performance learnings (data-backed)

- **Reaction + reveal >> pure reaction** (2026-07-07, TikTok): asain-girl
  reveal-style clip 419+432 TikTok views vs ginger 1 and blonde 0 (IG punished
  it less — ginger got 347 there). TikTok buries pure reactions. Applied TWO
  ways:
  1. **Reveal mode is now the DEFAULT**: every video cuts from the reaction to
     a wordless app-receipts glimpse that shows WHAT the reaction was about
     (the caption still carries the full answer). `--teaser` forces the old
     pure-reaction format for A/B tests only.
  2. **Weighted clip rotation**: `clips_preferred` + `clips_preferred_weight`
     (0.7) — clips that contain their own screen-share beat get ~70% of the
     rotation. When adding new clips, favor reveal-beat footage and promote
     winners into `clips_preferred` once snapshots confirm.
  DONE 2026-07-08: the reveal still is replaced by real screen-recording
  b-roll with the reveal → payoff text sequence (see pieces table above).

## Run it

```bash
cd creator-os
node --env-file=.env.local .claude/skills/reaction-ugc/scripts/reaction-ugc.js                    # Megan, dry-run (builds video for review)
node --env-file=.env.local .claude/skills/reaction-ugc/scripts/reaction-ugc.js --publish          # go live: TikTok video + IG Reel
node --env-file=.env.local .claude/skills/reaction-ugc/scripts/reaction-ugc.js --persona danny --publish
# options: --clip <name-substring>  --sound <id>  --angle <id> (force a feature angle)
#          --hook "<text>"  --ig-carousel (IG feed carousel: video + 4 stills)
```

Output lands in `brand-content/<persona>/carousels/<date>-reaction-<clip>/`
(`reaction-reel.mp4` + the 4 stills + a feed-compatible `carousel.json`) — so
every build shows up in the dashboard Carousels feed for review (Kevin's
standing rule), with the video as slide 1 (the feed plays mp4 slides inline).

## Distribution

Default persona is **creatoros** — the Creator OS BRANDED socials (profile
"Creator Os Socials"): captions speak as the brand; on-screen meme text stays
creator-voice. `--persona megan|danny` posts to the influencer accounts.

- **TikTok** (@creator.os): video post (sound baked in — no autoAddMusic).
- **Instagram** (@creator_oss): single-video Reel (`contentType:'reels'`,
  shareToFeed) by default; `--ig-carousel` posts a video-first feed carousel.
- **YouTube Short** (creator_oss): <3 min 9:16 auto-detects as a Short;
  `containsSyntheticMedia:true` disclosed (AI reaction person); App Store link
  posted as the firstComment.
- Sound comes from the `sounds` favorites rotation (persona gender + any),
  marked used only on publish. content_posts rows recorded per platform.
- First live run (2026-07-06): TikTok 6a4c06db…, IG Reel 6a4c06e0…, YouTube
  https://www.youtube.com/watch?v=Iw_Tey4gDnE

## Rotation banks (`templates/reaction.json`)

The OMG reaction stays constant; the **feature angle** varies. `angles[]` =
10 angles (post-everywhere, time-saved, consistency, schedule-week,
client-experience, make-it, no-team, analytics, trending-sounds, burnout) ×
10 paired {hook, card} lines = **100 combos**, each angle with matched
brand-voice captions so the caption always talks about what the video shows.
Rotation seed = `dayIndex × 2 + slot` (2 slots/day): angle cycles fastest,
line advances once per full angle cycle — all 100 pairs run before a repeat
(~50 days), multiplied by 8 clips and the sound rotation. Persona entries with
their own `captions` (megan/danny) override the angle captions.

NOTE: hook/card/label banks are rasterized by ffmpeg drawtext — **no emoji in
those banks** (tofu); emoji belong in captions.

## Cron (2× daily)

Registered as `creatoros-reaction` in `src/lib/content/registry.ts` — 12pm +
8pm ET (`REACTION_CRON_HOURS_ET` to change), armed on Railway with
`REACTION_CRON_ENABLED=1`. Each slot gets a fresh angle/clip/copy combo, and a
content_posts idempotency guard prevents double-posting a slot (--force
overrides).

## Notes

- Reaction clips are AI-generated people (via `reaction-clip-prompts`), not
  the personas — the persona no-face policy doesn't apply to them, but watch
  platform response. New clips: drop 1080x1920 .mov/.mp4 into
  `.claude/assets/reaction-clips/` (deploys to Railway).
- Not yet on the cron registry — run manually while the format proves out;
  add a `ContentJob` in `src/lib/content/registry.ts` when ready.
