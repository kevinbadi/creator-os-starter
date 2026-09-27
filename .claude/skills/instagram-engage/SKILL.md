---
name: instagram-engage
description: Like and comment on Instagram posts via browser automation (Playwright CDP). Visits a profile, finds recent posts, likes them, and drops a comment on ones not yet engaged. Deduplicates via the instagram_engagements DB table so each post gets one engagement. Trigger when asked to engage with Instagram posts, like/comment on a profile, or run Instagram engagement automation.
---

# Instagram Engage (Like & Comment)

Automated Instagram engagement: connects to a Chrome instance over CDP, visits a
profile, finds recent posts, likes them, and leaves a comment on any not already
engaged. Each post is deduplicated through the `instagram_engagements` table so it
only ever gets one like + comment.

## Prerequisites

- Chrome running with CDP exposed (default port `18800`).
- `onboarding-config.json` at the repo root (reads `phase2.platforms.instagram.username`).
- DB reachable for dedup (`instagram_engagements` table).

## Run

```bash
node scripts/instagram-engage.js --profile your-profile
node scripts/instagram-engage.js --profile your-profile --limit 5
node scripts/instagram-engage.js --profile your-profile --dry-run   # no actions, just log
```

**Flags:** `--profile <slug>`, `--limit <n>` (default 10), `--cdp-port <port>`
(default 18800), `--commenter <name>`, `--dry-run`.

## Cron use

Run on a gentle loop (e.g. a few times a day, not minute-by-minute) to keep
engagement human-paced and avoid rate-limit/anti-bot flags.

> ⚠️ Stub recovered from the ai-os-skills repo — verify the CDP port, profile slug,
> and DB connection against your current setup before scheduling.
