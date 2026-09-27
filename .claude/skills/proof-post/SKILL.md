---
name: proof-post
description: Jack Friks-style founder-aura X post for Creator OS — day-rotated bank of proof-flex / transformation / punchline / anti-sell / build-in-public posts in the persona's voice, App Store link only in the reply, published to the persona's Twitter via Zernio. Trigger to post or dry-run a Friks-style proof post, or to tune the post bank.
---

# proof-post

Single-post sibling of `advice-carousel`'s thread publisher: instead of a
10-tip thread, it fires ONE Friks-style founder post. The writing rules come
from the outer project's `marketing-advice-carousel` skill
(`references/jack-friks-breakdown.md`); this skill is the executable pipeline.

## Friks doctrine (enforced by the bank shape)

- **Effort-vs-result hook with numbers** — small input, big output, $0 cost.
- **Full value free in the main post** — never gated, never teased.
- **Link ONLY in the reply** (`reply` field → threadItems[1]); pure-value and
  punchline posts have NO reply at all. Most posts don't plug.
- **Disclosed plugs** — "yes, the app is ours. that's the whole ad :)".
- **Voice** — lowercase, casual, ":)", reads like a DM from a friend who's
  winning. No corporate polish, no hashtags.
- **Claims match the persona canon** (same numbers as the advice-carousel
  hooks: gym 1M/6mo, UGC creator 0→100k/12mo, Pilates 900→500k/8mo, 3
  businesses, 3h/day saved) — see the outer skill's `persona-claims` ledger.
  Never invent a new number here without adding it to the ledger.

## Run it

```bash
cd creator-os
node --env-file=.env.local .claude/skills/proof-post/scripts/proof-post.js                 # dry-run (Megan)
node --env-file=.env.local .claude/skills/proof-post/scripts/proof-post.js --publish       # LIVE
node --env-file=.env.local .claude/skills/proof-post/scripts/proof-post.js --index 3       # pin a bank entry
```

Rotation is day-indexed across `templates/proof-posts-<persona>.json` (8
entries → 8-day cycle; `--slot` from the registry advances it for multi-hour
schedules). Registered as `megan-proof` in `src/lib/content/registry.ts` —
arm with `MEGAN_PROOF_CRON_ENABLED=1` (hour via `MEGAN_PROOF_CRON_HOURS_ET`,
default 11 ET). Recorded in `content_posts` (metadata.proofPost=true) so the
dashboard timeline verifies runs like every other content cron.

## Adding a persona

Create `templates/proof-posts-<slug>.json` (same shape: `posts[]` with id /
archetype / content / optional media + reply) and run with `--persona <slug>`.
Danny's bank should reuse HIS canon claims (gym 1M, barber 250k) in operator
voice.
