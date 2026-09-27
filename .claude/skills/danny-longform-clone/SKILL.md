---
name: danny-longform-clone
description: Clone one of Kevin's kevbuildsapps YouTube longform videos as DANNY — persona-swapped transcript to HeyGen, v2 single-pass composite (fullscreen + webcam-bubble PIP), every-frame QA, and a Danny-swapped thumbnail. Trigger when Kevin drops a YouTube URL and says to clone it as Danny (longform/horizontal).
---

# Danny Longform Clone

Clone a kevbuildsapps YouTube video with Danny fronting it. This is the
persona-bound wrapper around `ai-os-skills/longform-video-clone-edit` — it
carries Danny's identity constants and the LOCKED v2 pipeline learnings
(Kevin-approved "perfecto" 2026-07-12). Reference implementation:
`clone-projects/H15Bw_L141Y-danny/` (all scripts live there — copy the
workspace pattern per video: `clone-projects/<VIDEO_ID>-danny/`).

## Danny constants

| key | value |
|---|---|
| HeyGen look (horizontal/YouTube) | `HEYGEN_ID_1` |
| HeyGen look (vertical) | `HEYGEN_ID_2` |
| HeyGen voice | `HEYGEN_ID_3` |
| character payload | `{"type": "talking_photo", "talking_photo_id": <look>}` |
| reference image | `.claude/assets/brand/danny/reference-hero.png` |
| transcript swap | `Kevin/Kev Builds Apps` → `Danny Creator OS`; `Kevin`/`Kev` (+possessives) → `Danny` |

Env: HeyGen MCP (OAuth / plan credits — not `HEYGEN_API_KEY`). `INSFORGE_*` in creator-os/.env.local for publish only.
Cost: plan credits via MCP (not the API-credit pool).

## Pipeline (v2, locked)

1. **Download + probe**: `yt-dlp -f "bv*[height<=1080]+ba/b[height<=1080]"`.
   Also grab the DESCRIPTION one-for-one (Kevin 07-12: every link he refers
   to in his videos must carry over): `yt-dlp --skip-download --print
   description <url> > source/description.txt`, then
   `transcript_swap.swap_description()` → `source/description_danny.txt`.
   URLs are placeholder-protected and NEVER touched (his identity lives
   inside link slugs — github.com/kevinbadi, skool.com/kevs-no-code-academy
   — a swap there breaks the link); the persona swap applies to prose only.
   This file is the upload description at publish time.
2. **Transcript — GRAB YOUTUBE'S OWN CAPTIONS, don't run Whisper** (2026-07-30:
   Whisper `small.en --word_timestamps` burned 22 min on a 9-min video for
   nothing — the compositor retimes on the global duration ratio and never
   reads word timings):
   `yt-dlp --skip-download --write-auto-subs --write-subs --sub-langs "en.*"
   --sub-format json3 -o source/subs <url>` → seconds, and product names come
   through already spelled right (HeyGen, Claude, Codex). Join the json3 segs
   turning `\n` into a SPACE (dropping it glues words: "your boyKyle").
   Whisper only as a fallback when a video has no captions — then `base.en`,
   no word timestamps.
   **Caption artifacts MUST be scrubbed before chunking (TTS speaks them
   verbatim):** `>>` speaker markers and duplicated audio from clips played
   on screen, `[clears throat]`-style bracket events, stutter dupes
   ("puts the puts the"), dropped words, and **name mishears — YouTube heard
   "Kev" as "Kyle", which the Kev/Kevin identity guard cannot catch and would
   have shipped "it's your boy Kyle" in Danny's voice.** Grep the mishear list
   too, not just Kev/Kevin.
3. **PERSONA SWAP (never skip)**: `transcript_swap.py danny` — swaps the
   identity rules above, prints every replacement with context, flags
   gendered tells (`my girlfriend`, `I'm a guy`, `my name is`). Everything
   else (product names, "this channel", "like and subscribe") stays.
   Chunks the SWAPPED text ≤3800 chars → what actually goes to HeyGen.
4. **HeyGen**: `run_heygen.py` (resume-safe submit/poll/download; watch for
   `MOVIO_PAYMENT_INSUFFICIENT_CREDIT` — API credits are separate from
   studio plans). The script prefers `chunks_swapped.json` and carries an
   IDENTITY GUARD that refuses to submit any chunk still containing
   Kevin/Kev (2026-07-12 incident: an older version re-chunked the raw
   transcript over the swap and burned 366 quota voicing "Kev here" in the
   persona's voice (caught on the Megan run) — the guard makes that impossible). If only some chunks change
   after a swap fix, resubmit ONLY those chunk indexes; identity-free
   chunks are reusable as-is.
5. **Segment map**: OpenCV per-second classify with pip-priority (bubble-zone
   face first — `cy>0.6H, w<0.3W` — then big face `w≥0.16W`, else noface;
   largest-face picks slide-thumbnail faces and poisons the map). Then snap
   EVERY boundary to the exact cut frame (max frame-diff scan ±2s; verify
   weak-diff boundaries visually — per-second classification has been 6-13s
   off). Measure webcam bubble rects off 100px-gridded frames, pad +14px
   per side; the bubble can MOVE mid-video (detect per section).
6. **Render SINGLE-PASS** (`build_singlepass.py`): one ffmpeg filter_complex
   over the source timeline — cropped-avatar overlays time-gated on pip
   windows (avatar face at 0.42 of crop height), full-frame avatar overlay
   on fullscreen windows, avatar audio muxed (lip-sync). Never per-segment
   cut+concat (frame rounding leaks).
7. **QA (never skip)**: `qa_everyframe.py` — every frame vs source:
   fullscreen must DIFFER everywhere, pip must MATCH outside the bubble and
   DIFFER inside. Ship only at 0 flags.
8. **Thumbnail**: grab `i.ytimg.com/vi/<ID>/maxresdefault.jpg`, recreate
   with Danny via fal `nano-banana-2/edit` (Kevin-approved; NOT Flux
   Schnell — t2i only, no reference input): `image_urls=[original,
   reference-hero]`, prompt = same outfit/pose/layout/text, swap the person
   for the reference man, `16:9`, `1K`. Eyeball: identity + exact text.
9. **Deliver**: 720p preview (`scale=1280:-2 crf 26`) + thumbnail →
   Insforge; review carousel in the Content feed
   (`brand-content/danny/carousels/<date>-heygen-clone-<slug>/`), 1080p
   master stays in the workspace. Publish to Danny's YouTube only on
   Kevin's go — PROVEN flow (first publish 2026-07-12,
   youtube.com/watch?v=nda01y7i1Ug): Zernio POST /posts with the 1080p
   master's Insforge URL as the video mediaItem, `content` +
   `platformSpecificData.description` = description_danny.txt,
   `title` = original title one-for-one, `visibility: "public"`,
   `madeForKids: false`, `containsSyntheticMedia: true`, and
   **`publishNow: true` IS REQUIRED** (2026-07-30): without it Zernio parks
   the post as a `draft` with the platform leg `pending` and it never reaches
   YouTube — it looks like a success (you get a post `_id`) but nothing goes
   live. Always read back `GET /posts/<id>` and confirm
   `platforms[0].platformPostId` before reporting a URL. Drafts CAN be
   DELETEd to retry (published posts cannot).
      `thumbnailUrl` = the recreated thumbnail's Insforge URL (WORKS —
   Zernio acquired Late, the Late youtubeOptions carry over; verify on
   i.ytimg.com/vi/<id>/hqdefault.jpg after publish). HQ RULE (Kevin 2026-07-26, supersedes the old 50MB gotcha):
   upload the FULL-QUALITY master (the crf18 final_clone as-is) via
   Zernio `POST /media` -> PUT to the returned R2 uploadUrl -> use
   `publicUrl` as the post's mediaItem + thumbnailUrl (helper:
   creator-os/.claude/lib/zernio-media.js, multi-GB fine). Insforge
   presigned uploads hard-cap at 50MiB (content-length-range in the
   policy) — Insforge is ONLY for dashboard feed previews now; never
   crush a publish master to fit it. Record a content_posts row
   (persona danny, platform youtube) after publish.

## Sibling

Megan variant = `megan-longform-clone` (look `HEYGEN_ID_4`
horizontal / `HEYGEN_ID_5` vertical, voice
`HEYGEN_ID_6`, swap target "Megan" / "Megan Creator OS").
First proven publish: youtube.com/watch?v=nda01y7i1Ug.
