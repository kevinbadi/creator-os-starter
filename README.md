# Creator OS Starter

The open-source wireframe of **Creator OS / Marketing OS**: a single-user marketing dashboard plus an
automation runner for creators and small agencies. It runs your social channels, AI personas, scheduled
content jobs, analytics snapshots and tracked links from one place.

Built with Next.js 16 (App Router), React 19, Tailwind 4 and TypeScript, backed by Postgres. It deploys
cleanly to Railway.

> This is a starter template. It ships **no keys, accounts, brand assets or data**. Bring your own.

## What's inside

- **Dashboard** (`src/app/dashboard`): overview KPIs and view heatmaps, analytics, posts, calendar,
  carousels review feed, channels, agent posts desk, copywriter, script writer, AI news, sounds, Giphy,
  Jev chat, and more.
- **Channels**: one workspace aggregates many social profiles (Zernio). Switch channels from the
  top-bar dropdown.
- **Content cron system**: `src/lib/content/registry.ts` is the single source of truth for scheduled jobs.
  `src/lib/content/cron.ts` arms DST-aware timers (America/New_York) plus a self-healing watchdog.
- **Snapshot analytics**: nightly scripts in `scripts/` write day-bucketed rows to `*_snapshots` tables.
  Charts never read live APIs for history.
- **Tracked links**: `/go/<slug>` logs a click and redirects (App Store, or your web app for `web-` slugs).
  Set `SHORT_LINK_HOST` to serve them from `go.yourdomain.com/<slug>`.
- **Claude Code skills** (`.claude/skills`): content pipelines (carousels, reaction UGC, pro-tips decks,
  proof posts, clone pipelines) and two video hyper-edit engines (vertical split talking head and
  landscape long-form).

## Quick start

```bash
npm install
cp .env.example .env.local      # fill in the Core block at minimum
npm run dev                      # http://localhost:3000
npm run build                    # production build (also the type check)
```

Only `DATABASE_URL`, `APP_PASSWORD` and `APP_AUTH_SECRET` are needed to boot. Every integration is
optional and switches on when its key is present.

## Wiring your accounts

Account and profile IDs are placeholders (`ZERNIO_PROFILE_*`, `ZERNIO_ACCOUNT_*`). Replace them with
your own Zernio IDs in:

- `src/lib/channels/store.ts` (default channels)
- `src/lib/channels/personas.ts` (profile to persona map)
- `src/lib/agent-posts/types.ts`
- `src/app/dashboard/page.tsx` (hidden accounts, brand profile list)
- `.claude/skills/pro-tips-deck/scripts/pro-tips-deck.mjs`, `.claude/skills/reddit-demand/scripts/reddit-publish.js`

Persona reference images, fonts and brand packs are not included. Skills that need them say where
to put them (see `.claude/assets/README.md`).

## Scheduled jobs

Each job in the registry is toggled per environment:

```
<PREFIX>_CRON_ENABLED=1
<PREFIX>_CRON_HOURS_ET=9,21
```

Queue drains and watchdogs only run on the worker host (`RAILWAY_ENVIRONMENT` set). Local `npm run dev`
is a viewer unless you set `LOCAL_WORKERS=1`.

## Deploy

`railway up` from the repo root (Nixpacks, Node >= 22). `nixpacks.toml` keeps ffmpeg in the image. The
content pipelines need it.

## Conventions

- Dates are Eastern Time. Stamp them with `Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })`,
  never `toISOString()`.
- Em/en dashes are scrubbed from on-screen UGC text.
- Every IG/TikTok publisher calls `writeSeoCaptions` (`.claude/lib/seo-caption.js`).

## License

MIT. See [LICENSE](LICENSE).
