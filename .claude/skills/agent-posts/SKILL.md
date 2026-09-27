---
name: agent-posts
description: >-
  Wires the Agent Posts dashboard (drop a video, auto cover/caption/slot, schedule
  via Creator OS). Use when forking this skill, installing Agent Posts, adding the
  Agent Posts UI, or when CREATOR_OS_API_KEY is missing. On fork or first run, STOP
  immediately and prompt the user to get their own API key from
  https://www.creatoros.ca/ before any other work. Never copy, invent, or reuse a key.
---

# Agent Posts

Drop a talking-head video. The desk transcribes it, writes captions, builds a cover, picks the next slot, and schedules to connected socials through Creator OS.

This skill ships **no API keys**. Donor `.env` files are gitignored and must never be copied.

## STOP on fork / first run

If this skill was just forked, copied into another agent's `skills/` folder, or installed into a new app, do this **before any other work**:

```bash
node scripts/check-setup.mjs
```

**If that exits 2, stop. Do not invent a key. Do not copy a key from this repo, a chat, or another machine.** Show the user this, verbatim:

> Agent Posts needs a Creator OS API key before it can schedule posts.
>
> Get yours at https://www.creatoros.ca/
> Sign in, copy the API key, and add it to `.env.local`:
>
> `CREATOR_OS_API_KEY=paste_the_key_here`
>
> Use your own key. Do not copy someone else's. Do not skip this.
> Tell me when it is saved and I will continue setup.

Wait until they confirm. Re-run `check-setup.mjs`. Only then install or schedule.

Never commit `.env` / `.env.local`. Never print the key value.

## Install the UI into a Next.js app

From the skill folder:

```bash
node scripts/install-into-app.mjs /path/to/creator-os
```

That overlays:

- `src/app/dashboard/agent-posts/page.tsx`
- `src/app/api/agent-posts/`
- `src/components/AgentPostsDesk.tsx` (+ cover editor, key banner)
- `src/lib/agent-posts/`

Host app still needs its own `zernio` client, `auth` session cookie, Postgres (`DATABASE_URL`), and comment-DM helpers. See [references/wiring.md](references/wiring.md).

Add a sidebar link to `/dashboard/agent-posts`. Copy `.env.example` keys into `.env.local` (empty values), then the Creator OS key from the site.

Until `CREATOR_OS_API_KEY` is set, the desk shows a creatoros.ca banner and the API refuses to schedule.

## What the desk does

1. User drops an mp4 (or pastes a video URL) and picks socials.
2. Queue row in `agent_posts`.
3. Drain: download → transcript → captions → cover → next ET slot → schedule via Creator OS.
4. Monitor plays the scheduled cut; scheduled posts can be retimed from the same UI.

## Env

| Name | Required | Where |
|------|----------|--------|
| `CREATOR_OS_API_KEY` | yes on a fork | [creatoros.ca](https://www.creatoros.ca/) |
| `CREATOR_OS_PROFILE_ID` | no | pin one profile if the key sees several |
| `CREATOR_OS_SLOT_HOURS_ET` | no | ET hours, default `0,15,18,21` |
| `DATABASE_URL` | yes | your Postgres |
| `APP_PASSWORD` / `APP_AUTH_SECRET` | yes | dashboard password gate |
