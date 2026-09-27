---
name: short-form-video-clone-edit
description: Clone a finished 9:16 reel by replacing the talking head with a HeyGen persona (Megan/Danny/Kevin), keeping the original animation/captions, then fitting duration. Locked 2026-09-14 after the Megan 55/45 iOS-farms run.
metadata:
  openclaw:
    emoji: 🎭
    requires:
      anyBins: ["ffmpeg", "ffprobe", "yt-dlp", "python3"]
      pip: ["openai-whisper"]
---

# Short-form video clone (locked)

Replace the original speaker with a HeyGen look. Preserve the original edit (graphics, captions, B-roll). Persona IDs come from the Agent Video Cloning job prompt — ignore any Nick Saraev IDs below.

Do not stop until `WORKDIR/renders/final_clone.mp4` exists.

## Hard locks

- **HeyGen MCP only.** Tools: `create_video_from_avatar`, `get_video`. Do not curl `api.heygen.com`. Do not use `HEYGEN_API_KEY`. If MCP is unauthenticated, stop.
- **Never atempo/setpts the HeyGen take** to match the source. Per-window voice stretch pops (static). Keep `avatar/avatar_full.mp4` at 1x for picture and audio.
- **fal.ai HARD STOP.** No fal.ai calls. Skip optional face-swap.
- **Dates are ET.** No em/en dashes in on-screen UGC text.
- **Do not publish.** Stop at the local master.
- **Browser-safe encode:** `-pix_fmt yuv420p -color_range tv -movflags +faststart`. `yuvj420p` will not load in the dashboard player.
- Download signed HeyGen URLs with **Python urllib** (zsh expands `~` in CloudFront signatures and 403s).

## Layouts

### 55/45 split (graphics on top, talking-head band bottom)

This is the locked Megan/Danny shortform path when the source is 1080×1920 with a bottom talking-head card.

- Band: `1056×960` at `(12, 960)` on a `1080×1920` canvas.
- Use the **horizontal** look (`horizontalLookId` from the job prompt), `aspect_ratio` **16:9**, dimension `1920×1080`. Do **not** use the vertical 9:16 talking-photo — it warps in the band.
- Crop lock (do not retune): `HEAD_ZOOM=0.539` `HEAD_TOP=0.159` → on a 1920×1080 take that is `crop=640:582:640:172`, then `scale=1056:960`. Hair/cap flush with the band cutoff so IG captions/buttons do not cover the face.
- **Always overlay** the band for the full duration: `overlay=12:960:eof_action=repeat`. Never `enable=` from Haar face ranges — every gap flashes the original speaker.

### Full-frame 9:16 talking-head

- Vertical look, `aspect_ratio` 9:16.
- ~4x crop (`270×480` from `1080×1920`, face-centered, slight upward offset) then scale to `1080×1920`.

## Pipeline

Scripts live next to this skill. Run them from the job workdir:

```bash
SKILL="…/creator-os/.claude/skills/short-form-video-clone-edit"
python3 "$SKILL/scripts/pipeline_composite_ffmpeg.py" "$WORKDIR"
python3 "$SKILL/scripts/pipeline_fit_original_duration.py" "$WORKDIR"
```

### 1. Source

Copy/download the finished vertical to `source/video.mp4`.

### 2. Whisper both tracks (word timestamps)

```bash
whisper source/video.mp4 --model base --language en --word_timestamps True --output_format json --output_dir source
# rename to source/source.json if whisper named it video.json
whisper avatar/avatar_full.mp4 --model base --language en --word_timestamps True --output_format json --output_dir audio
# rename to audio/avatar_full.json
```

Persona-swap the transcript (job prompt identity rules) **before** HeyGen. Never submit Kevin/Kyle on a Megan/Danny job.

### 3. HeyGen (plan credits, one take)

MCP `create_video_from_avatar`:

- `avatar_id` = look id from the job prompt (horizontal for 55/45)
- `voice_id` from the job prompt
- `script` = persona-swapped transcript
- 55/45 → 16:9 / 1920×1080; full-frame shortform → 9:16 / 1080×1920

Poll `get_video` until completed. Save to `avatar/avatar_full.mp4`. Do not rebuy API credits; do not re-render if this file already exists.

### 4. Composite (native clone, retimed edit)

`pipeline_composite_ffmpeg.py`:

1. Align source vs avatar Whisper words (`difflib.SequenceMatcher`, knot on every aligned word start).
2. Warp **source video only** so each source word lands on the clone's time (`setpts=(PTS-STARTPTS)*out/in`, reset STARTPTS or `-t` drops every frame).
3. Crop/scale the **unwarped** HeyGen take into the band.
4. Mux **native** HeyGen audio (no atempo).
5. Always-on overlay with rounded top corners. Pad avatar/source so the band never goes empty.

Master at this point is clone duration (often longer than the source). Save happens inside the next script.

### 5. Global fit to original duration (locked)

If the composite is longer than `source/video.mp4`, speed **the entire mux** — animation, captions, talking head, and voice — with **one** `atempo` / `setpts` so duration equals the original. This keeps word-sync (everything moves together) and shortens the hold-frames that appear when the clone speaks slower than the edit.

`pipeline_fit_original_duration.py` copies the native-pace master to `renders/final_clone.pre-fit.mp4` first. Revert with:

```bash
cp renders/final_clone.pre-fit.mp4 renders/final_clone.mp4
```

Do **not** skip this step. Kevin 2026-09-14: the 55/45 Megan cut is “perfect” after this fit.

### 6. Deliver

```
DONE $WORKDIR/renders/final_clone.mp4
```

Then stop. Refresh the dashboard player (it caches the mp4).

## Do not

- Gate the 55/45 overlay on `face_ranges.json`.
- Stretch 9:16 into the 1056×960 band.
- Per-window atempo on HeyGen audio.
- Mux with `-shortest` unless both streams are already the target length.
- Call fal.ai.
- Retune `HEAD_ZOOM` / `HEAD_TOP` unless Kevin asks.

## Full-frame 9:16 only (not 55/45)

Scan every frame for the original face if you must cut between talking-head and B-roll. Pad ranges 2 frames. Filter Haar hits to faces >8% of frame height. Still mux avatar audio only. Then run the same global fit if the clone is longer than the source.
