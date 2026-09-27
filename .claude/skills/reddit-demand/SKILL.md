---
name: reddit-demand
description: Reddit demand-gen for the Creator OS brand (u/creator_os via Zernio) — target subreddit map, per-sub insight notes, and a bank of value-first post drafts. Trigger to draft, review, or publish Reddit posts for Creator OS.
---

# reddit-demand

Demand generation on Reddit for Creator OS. Reddit punishes ads and rewards
value + authenticity — every draft is a real contribution first, with the
product appearing only where each sub's culture allows (builder subs: openly;
advice subs: only if asked / in comments; some subs: never in the post).

## Target subreddits (fit × promo tolerance)

| Sub | ~Size | Why | Promo tolerance |
|---|---|---|---|
| r/NewTubers | 1M+ | beginner creators, growth pain | LOW — value posts only, no links |
| r/SocialMediaMarketing | 200k+ | SMMs + freelancers, tool-stack talk | MED — tools discussed openly |
| r/socialmedia | 1.5M+ | general, strategy threads | LOW-MED |
| r/socialmediamanagers | ~60k | HIGH intent: manage many accounts | MED — tool threads common |
| r/smallbusiness | 3M+ | owners drowning in posting admin | LOW — no self-promo, advice only |
| r/Entrepreneur | 3M+ | builders + marketing threads | LOW-MED |
| r/EntrepreneurRideAlong | 500k+ | build-in-public friendly | HIGH — journey posts welcome |
| r/SideProject | 300k+ | product launches WELCOME | HIGH — show what you built |
| r/indiehackers | 100k+ | builder audience | HIGH |
| r/UGCcreators | ~100k | UGC creators juggling clients | MED |
| r/InstagramMarketing | ~100k | IG growth tactics | MED |
| r/Tiktokhelp | 300k+ | TikTok growth questions | LOW |

## What wins (per the yearly-top pattern in these subs)

1. **Milestone retros** — "I hit 10k followers/subs. Here's everything that
   actually worked" with numbered, specific lessons. The #1 format in
   r/NewTubers and creator subs.
2. **Contrarian takes** — "Stop doing X, everyone's wrong about Y" (posting
   times, hashtags, niching). High comment velocity.
3. **Pain confessionals** — "I spent 3 hours a day posting until I fixed my
   workflow" → r/smallbusiness, r/socialmediamanagers. Commenters volunteer
   their stacks; the product enters via comments naturally.
4. **Stack/workflow asks** — "SMMs: what's your posting stack in 2026?"
   Threads where tools get named are where demand forms.
5. **Build-in-public numbers** — r/SideProject/r/EntrepreneurRideAlong:
   "I built an app that posts to 6 platforms at once — here's month-1 data."
   Direct product posts are ON-culture there.
6. **Data posts** — original mini-analyses ("I tracked 90 days of posting
   daily to every platform, here's what happened") outperform opinions.

## Rules of engagement

- No em dashes anywhere (AI tell — house rule). Write like a tired human.
- Never drop the App Store link in LOW-tolerance subs; answer questions in
  comments and let profile/bio carry the link (u/creator_os bio must have it).
- 90/10: nine value contributions per one product mention. Account needs
  karma before promo subs take it seriously — comment genuinely first.
- One sub per day max for posts; stagger drafts across 2+ weeks.
- Publishing rail: Zernio platform "reddit", account ZERNIO_ACCOUNT_4
  (u/creator_os) on the Creator Os Socials profile — supports subreddit +
  title + text posts.

## Drafts

`data/drafts.json` — bank of ready post drafts keyed by subreddit, each with
title, body, promo_level, and when to deploy. Review in chat before posting
(manual for now; automation only after the account has organic karma).

## Blocked: live top-post mining

Reddit blocks ALL unauthenticated scraping (curl, jina, redlib mirrors, even
headless Chrome — fingerprint-level). To run the precise top-25/rising sweep:
either (a) Kevin starts his logged-in Chrome with
`--remote-debugging-port=9222` once and we drive it via CDP, or (b) create a
free Reddit OAuth script app (reddit.com/prefs/apps) and drop
REDDIT_CLIENT_ID/SECRET into .env.local — then `scripts/` can pull real
top/rising data and sharpen the drafts.
