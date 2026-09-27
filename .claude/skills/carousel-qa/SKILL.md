---
name: carousel-qa
description: Vision QA gate for a rendered carousel — flags AI generation defects (hands/fingers, faces, limbs, warped logos, stray text, identity drift) per slide and can auto-regenerate the failures. Trigger before publishing a carousel, or when asked to QA / check / verify generated slides for a persona.
---

# carousel-qa

Vision QA gate that inspects each slide of a rendered carousel for AI generation
defects **before** it goes live. Sits between `carousel-gen` and `carousel-publish`:

```
carousel-gen  →  carousel-qa (--fix)  →  carousel-publish
```

## How It Works

1. Reads a `carousel.json` sidecar (same input as `carousel-publish`).
2. Sends **each slide** to Claude (`claude-opus-4-8`, vision) with a strict defect
   rubric — hands/fingers & limb anatomy, face integrity, persona identity match,
   brand-object/logo distortion, stray on-screen text or watermarks, scene physics,
   duplicated/merged people.
3. Gets a **structured verdict** per slide (`pass`/`fail` + severity + issues +
   `regen_hint`) via structured outputs, and writes a `qa.json` sidecar into the
   carousel folder.
4. With `--fix`, each failing slide is **auto-regenerated** via FAL nano-banana-2
   (reusing the `carousel-gen` path + the persona's reference face) with a repair
   hint built from the defect, normalized to 1080×1350, then re-QA'd — up to
   `--max-attempts` times.

## Usage

```bash
# report only (writes qa.json; exit code 2 if any slide fails)
node .claude/skills/carousel-qa/scripts/carousel-qa.js --carousel <carousel.json>

# report + auto-regenerate failures (needs the plan for regen prompts)
node .claude/skills/carousel-qa/scripts/carousel-qa.js \
  --carousel <carousel.json> --plan <plan.json> --fix

# limit to specific slides / cap retries
node ... --carousel ... --plan ... --fix --only 3,7 --max-attempts 3
```

Run with `node --env-file=.env.local` so `ANTHROPIC_API_KEY` / `FAL_KEY` /
`DATABASE_URL` load.

## Prerequisites

- `ANTHROPIC_API_KEY` in `.env.local` — the QA judge (vision). **Required.**
- `FAL_KEY` in `.env.local` — only for `--fix` (regeneration).
- `DATABASE_URL` — only for `--fix` (loads the persona reference face).
- `ffmpeg` — only for `--fix` (normalizes regenerated slides to 1080×1350).
- The plan JSON — only for `--fix` (supplies the per-slide regen prompt).

## Output

`qa.json` in the carousel folder:

```json
{
  "carousel_id": "...",
  "model": "claude-opus-4-8",
  "reviewed_at": "...",
  "summary": { "pass": 9, "fail": 1, "fixed": 1 },
  "slides": [
    { "index": 3, "verdict": "pass", "severity": "none", "identity_ok": true,
      "issues": [], "regen_hint": "", "attempts": 1, "fixed": true }
  ]
}
```

## Notes

- Grades conservatively: only clear, visible defects fail; uncertain/cosmetic issues
  are logged at `low` but still pass. Tune the rubric in `SYSTEM` (scripts/carousel-qa.js).
- Report-only mode exits `2` when any slide fails — usable as a publish gate in a script.
- `QA_MODEL` env var overrides the judge model (default `claude-opus-4-8`).
