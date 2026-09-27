# carousel-publish

Publishes a rendered carousel to a persona's socials via **Zernio** (Instagram +
TikTok — the platforms that support native carousels).

## How It Works

1. Reads a `carousel.json` sidecar from `carousel-gen`.
2. Uploads each slide to **Insforge storage** (same path as the app's uploader).
3. Builds the Zernio `POST /posts` payload using the persona's profile + account
   IDs and the captions authored in the plan (IG caption + TikTok `customContent`).
4. Records the post in `content_posts` and marks the sidecar published.

Persona (Zernio profile id, per-platform account ids, carousel platforms) is loaded
from the `personas` Insforge table via `.claude/lib/persona.js`.

## Safe by default

Without `--publish` or `--schedule`, it **dry-runs**: prints captions + the exact
payload, uploads nothing, posts nothing.

## Usage

```bash
# dry-run (default)
node .claude/skills/carousel-publish/scripts/carousel-publish.js --carousel <carousel.json>

# go live now
node ... --carousel <carousel.json> --publish

# schedule
node ... --carousel <carousel.json> --schedule 2026-07-02T09:00:00

# filter platforms
node ... --carousel <carousel.json> --platforms instagram --publish
```

Run with `node --env-file=.env.local` so `ZERNIO_API_KEY` / `INSFORGE_*` /
`DATABASE_URL` are loaded.

## Prerequisites

- `ZERNIO_API_KEY`, `INSFORGE_API_BASE_URL`, `INSFORGE_API_KEY`, `DATABASE_URL` in `.env.local`
- Persona's social accounts connected in Zernio (Megan: IG + TikTok + Twitter)

## Notes

- Twitter/X and YouTube have no native carousel and are excluded.
- Records to `content_posts` (created on first run).
