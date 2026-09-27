// Single source of truth for scheduled content jobs. BOTH consumers derive
// from this module, so the dashboard can never drift from the scheduler:
//
//   src/lib/content/cron.ts        → arms one timer per job×hour
//   src/lib/automations/railway.ts → renders one timeline entry per job×hour
//
// Hours come from `<PREFIX>_CRON_HOURS_ET` env at runtime (the dashboard runs
// on the same service as the crons, so both read identical values); the
// defaults here are the production schedule and double as the local fallback.

export type ContentJob = {
  name: string;
  /** Platforms one run posts to — drives the calendar's projected-uploads
   *  count. Empty for jobs that don't publish (snapshots, drafters). */
  platforms: string[];
  envPrefix: string; // DANNY → DANNY_CRON_ENABLED / DANNY_CRON_HOURS_ET
  defaultHours: string; // comma-separated ET hours
  script: string; // repo-relative node script
  args: (slot: number) => string[];
  /** How the timeline verifies runs: persona-scoped content_posts rows, the
   *  analytics_snapshots table, or the follower_snapshots table. */
  verify: "carousels" | "snapshots" | "followers" | "rc_subs" | "rc_customers" | "web_analytics" | "ai_news";
  /** Persona whose content_posts rows verify this job's runs (carousels only). */
  persona?: string;
  /** SQL LIKE pattern on carousel_id so verification matches THIS job's output
   *  (persona-level checks can't tell a proof post from a day-in-the-life). */
  verifyMatch?: string;
  displayName: string;
  description: string;
};

// Removed 2026-07-08 (Kevin: paused automations are being phased out of
// Marketing OS): danny-daily + megan-daily day-in-the-life carousels (paused
// 07-07, reactions took their slots) and the reddit-responder (Reddit channel
// shut down 07-07). The skills remain on disk until formally retired.
export const CONTENT_JOBS: ContentJob[] = [
  {
    name: "megan-advice",
    // TikTok leg dropped 2026-07-08 (Kevin: carousels underperform reaction
    // UGC there — reactions keep the TikTok upload slots).
    platforms: ["instagram", "twitter", "threads"],
    envPrefix: "MEGAN_ADVICE",
    defaultHours: "13",
    script: ".claude/skills/advice-carousel/scripts/advice-carousel.js",
    args: () => ["--no-tiktok"],
    verify: "carousels",
    persona: "megan",
    verifyMatch: "%megan%advice%",
    displayName: "Megan marketing advice",
    description:
      "Builds the daily marketing-advice carousel (proof-first hook, 10 tips, native CreatorOS slide) — slideshow Reel to Instagram, one-tip-per-tweet thread to Twitter/Threads. TikTok leg retired 07-08 in favor of reaction UGC.",
  },
  {
    name: "danny-advice",
    platforms: ["instagram", "twitter", "threads"],
    envPrefix: "DANNY_ADVICE",
    defaultHours: "14",
    script: ".claude/skills/advice-carousel/scripts/advice-carousel.js",
    args: () => ["--persona", "danny", "--no-tiktok"],
    verify: "carousels",
    persona: "danny",
    verifyMatch: "%danny%advice%",
    displayName: "Danny marketing advice",
    description:
      "Builds Danny's daily marketing-advice carousel — slideshow Reel to Instagram, one-tip-per-tweet thread to Twitter/Threads. TikTok leg retired 07-08 in favor of reaction UGC.",
  },
  {
    name: "danny-thread",
    platforms: ["twitter", "threads"],
    envPrefix: "DANNY_THREAD",
    // Every 4 hours, around the clock (Kevin 2026-07-15: dialed 8→6/day).
    // Staggered vs megan/kev by 1h. 6 same-day slots collision-free: hook
    // bank 20 + cta/integration banks 8 (stride math verified).
    defaultHours: "1,5,9,13,17,21",
    script: ".claude/skills/advice-carousel/scripts/advice-thread.js",
    // slot+1 → rotation offsets 3/6/9/12 days ahead, so no drop duplicates
    // another or the 2 PM full advice pipeline (offset 0).
    args: (slot) => ["--persona", "danny", "--slot", String(slot + 1), "--platforms", "twitter,threads", "--publish"],
    verify: "carousels",
    persona: "danny",
    verifyMatch: "advice-thread-%",
    displayName: "Danny thread drop",
    description:
      "Written advice thread in Danny's voice to Twitter + Threads — no deck render, just the tip thread. Added 2026-07-07 because Danny over-performs on Threads; doubled to 4 daily drops 07-09. Each slot rotates to a different series/hook combo.",
  },
  {
    name: "megan-thread",
    platforms: ["twitter", "threads"],
    envPrefix: "MEGAN_THREAD",
    // Every 4 hours around the clock (Kevin 2026-07-15: dialed 8→6/day).
    // 0,4,…20 dodges her advice (13 ET) and proof (11 ET) hours.
    defaultHours: "0,4,8,12,16,20",
    script: ".claude/skills/advice-carousel/scripts/advice-thread.js",
    // slot+1 → offsets 3/6 days ahead of the 1 PM full pipeline (offset 0).
    args: (slot) => ["--persona", "megan", "--slot", String(slot + 1), "--platforms", "twitter,threads", "--publish"],
    verify: "carousels",
    persona: "megan",
    verifyMatch: "advice-thread-%",
    displayName: "Megan thread drop",
    description:
      "Written advice thread in Megan's voice to Twitter + Threads — same workflow as Danny's (added 2026-07-08 after his threads over-performed), doubled to 2 daily drops 07-09.",
  },
  {
    name: "kev-thread",
    platforms: ["twitter", "threads"],
    envPrefix: "KEV_THREAD",
    // Founder-angle threads on kev.creatoros — winning megan/danny formats in
    // founder voice. Every 4 hours around the clock (Kevin 2026-07-15: dialed
    // 8→6/day), staggered to 2,6,…22. AI-agency hooks removed 07-15; refreshed
    // with fresh client-transform hooks (mirrored to advice-kevbuildsapps.json).
    defaultHours: "2,6,10,14,18,22",
    script: ".claude/skills/advice-carousel/scripts/advice-thread.js",
    args: (slot) => ["--persona", "kev", "--slot", String(slot + 1), "--platforms", "twitter,threads", "--publish"],
    verify: "carousels",
    persona: "kev",
    verifyMatch: "advice-thread-%",
    displayName: "Kev founder thread",
    description:
      "Founder-of-Creator-OS advice thread to the kev.creatoros Twitter + Threads — winning megan/danny thread formats (stakes transformation + insider reveal) in Kev's voice, tips cycled from the Jun Yuh bank.",
  },
  {
    name: "kevbuildsapps-thread",
    // Kevin's REAL personal brand — 4/day minimum (Kevin 2026-07-13: "run
    // the same winning megan + danny threads + the kev creator os
    // automation threads onto the kevbuildsapps threads account"). Template
    // mirrors advice-kev.json (winning formats + AI-automation hooks in
    // founder voice). Supersedes the profile's "Dont Touch" marker for
    // Threads specifically. X leg REMOVED 2026-07-16 (Kevin: "no more
    // tweeting on kevbuildsapps twitter") — Threads only now.
    platforms: ["threads"],
    envPrefix: "KEVBUILDSAPPS_THREAD",
    defaultHours: "9,13,17,21",
    script: ".claude/skills/advice-carousel/scripts/advice-thread.js",
    args: (slot) => ["--persona", "kevbuildsapps", "--slot", String(slot + 1), "--platforms", "threads", "--publish"],
    verify: "carousels",
    persona: "kevbuildsapps",
    verifyMatch: "advice-thread-%",
    displayName: "KevBuildsApps thread",
    description:
      "Founder advice thread on Kevin's real @kevbuildsapps Threads — winning stakes/insider formats + AI-automation angles, tips cycled from the Jun Yuh bank. 4 daily drops, Threads only.",
  },
  {
    name: "kevbuildsagencies-thread",
    // Creator OS WEB-app persona (B2B, agencies/businesses). Sounds exactly
    // like Megan but retargeted to gyms, personal trainers, coaches,
    // consultants, financial advisors and content creators (Kevin 2026-07-15:
    // "make kevbuildsagencies sound exactly like megan but for [verticals]…
    // blasting on threads every 4 hours around the clock"). Threads only —
    // the profile has no X connected. 6 drops/day, slots 1-6 rotate hooks.
    platforms: ["threads"],
    envPrefix: "KEVBUILDSAGENCIES_THREAD",
    defaultHours: "0,4,8,12,16,20",
    script: ".claude/skills/advice-carousel/scripts/advice-thread.js",
    args: (slot) => ["--persona", "kevbuildsagencies", "--slot", String(slot + 1), "--platforms", "threads", "--publish"],
    verify: "carousels",
    persona: "kevbuildsagencies",
    verifyMatch: "advice-thread-%",
    displayName: "Agencies thread",
    description:
      "Megan-voiced agency-growth thread on @kevbuildsagencies Threads — client-transformation hooks for gyms, PTs, coaches, consultants, financial advisors and creators, Creator-OS-for-agencies CTA. Blasts every 4 hours around the clock (6 drops/day), Threads only.",
  },
  {
    name: "megan-proof",
    platforms: ["twitter"],
    envPrefix: "MEGAN_PROOF",
    defaultHours: "11",
    script: ".claude/skills/proof-post/scripts/proof-post.js",
    args: (slot) => ["--publish", "--slot", String(slot)],
    verify: "carousels",
    persona: "megan",
    verifyMatch: "proof-post-%",
    displayName: "Megan proof post",
    description:
      "Fires one Friks-style founder-aura X post from the day-rotated bank (proof-flex / transformation / punchline / anti-sell / build-in-public) — App Store link rides in the reply.",
  },
  {
    name: "creatoros-reaction",
    platforms: ["tiktok", "instagram", "youtube", "facebook"],
    envPrefix: "REACTION",
    defaultHours: "12,20",
    script: ".claude/skills/reaction-ugc/scripts/reaction-ugc.js",
    args: (slot) => ["--publish", "--slot", String(slot)],
    verify: "carousels",
    persona: "creatoros",
    verifyMatch: "reaction-%",
    displayName: "Creator OS reaction reel",
    description:
      "Beat-synced reaction meme (clip → hook card → before/after → receipts) on a trending sound — posts to the Creator OS branded TikTok, Instagram Reel, YouTube Short and Facebook video. Angle + clip + copy rotate per slot from a 100-pair bank.",
  },
  {
    name: "megan-reaction",
    platforms: ["tiktok", "instagram", "youtube"],
    envPrefix: "MEGAN_REACTION",
    defaultHours: "15",
    script: ".claude/skills/reaction-ugc/scripts/reaction-ugc.js",
    args: (slot) => ["--persona", "megan", "--publish", "--slot", String(slot)],
    verify: "carousels",
    persona: "megan",
    verifyMatch: "reaction-%",
    displayName: "Megan reaction reel",
    description:
      "Beat-synced reaction meme in Megan's identity — draws from her own 5-clip reaction bank (assets/reaction-clips/megan), posts to her TikTok + Instagram Reel.",
  },
  {
    name: "danny-reaction",
    platforms: ["tiktok", "instagram", "youtube"],
    envPrefix: "DANNY_REACTION",
    defaultHours: "16",
    script: ".claude/skills/reaction-ugc/scripts/reaction-ugc.js",
    args: (slot) => ["--persona", "danny", "--publish", "--slot", String(slot)],
    verify: "carousels",
    persona: "danny",
    verifyMatch: "reaction-%",
    displayName: "Danny reaction reel",
    description:
      "Beat-synced reaction meme in Danny's identity — draws from his own 5-clip reaction bank (assets/reaction-clips/danny), posts to his TikTok + Instagram Reel.",
  },
  {
    name: "pro-tips-deck",
    platforms: ["instagram", "linkedin", "facebook"],
    envPrefix: "PRO_TIPS",
    defaultHours: "13",
    script: ".claude/skills/pro-tips-deck/scripts/pro-tips-deck.mjs",
    args: () => ["--publish", "--no-tiktok"],
    verify: "carousels",
    persona: "creatoros",
    verifyMatch: "pro-tips-deck-%",
    displayName: "Pro tips deck (weekly)",
    description:
      "The brand's professional editorial deck — 10 fresh creator-marketing tips + notable-creator quotes + a native Creator OS slide in the locked black/teal style. WEEKLY (script gates on dayIndex%7, anchored Jul 8; off-days write a skip row) to Instagram, LinkedIn and Facebook. TikTok leg retired 07-08 in favor of reaction UGC.",
  },
  {
    name: "daily-tip-x",
    platforms: ["twitter", "facebook"],
    envPrefix: "DAILY_TIP",
    defaultHours: "11",
    script: ".claude/skills/pro-tips-deck/scripts/pro-tips-deck.mjs",
    args: () => ["--daily-tip", "--publish"],
    verify: "carousels",
    persona: "creatoros",
    verifyMatch: "daily-tip-%",
    displayName: "Daily tip on X",
    description:
      "One branded tip-of-the-day slide + tweet on the brand X account, walking the Jun Yuh bank sequentially (~109 days per cycle). Same locked black/teal style as the weekly deck; falls back to stock backgrounds during fal outages.",
  },
  {
    name: "analytics-snapshot",
    platforms: [],
    envPrefix: "ANALYTICS",
    // Once a day after the viewing day is done (Kevin 2026-09-16): header
    // Views / avg views / m/m are one daily total, not a live mix.
    defaultHours: "21",
    script: "scripts/analytics-snapshot.mjs",
    args: () => [],
    verify: "snapshots",
    displayName: "Analytics snapshot",
    description:
      "Nightly capture of every post's platform metrics into analytics_snapshots, then one daily_view_snapshots row per account×platform — powers the Overview header Views / avg views / m/m, the daily-views heatmap, and the posts feed numbers.",
  },
  {
    name: "revenuecat-customers",
    platforms: [],
    envPrefix: "RC_CUSTOMERS",
    // Customers-only walk (~minutes, no per-customer fan-out) — keeps the
    // New Customers chart fresh between the slow full subscription sweeps.
    defaultHours: "9,13,17,21",
    script: "scripts/revenuecat-subs-snapshot.mjs",
    args: () => ["--customers-only"],
    verify: "rc_customers",
    displayName: "RevenueCat customers sync",
    description:
      "Four-times-daily sync of every RevenueCat customer first_seen_at into revenuecat_customers — powers the New Customers chart and Downloads m/m without waiting on the full subscription fan-out.",
  },
  {
    name: "revenuecat-subs",
    platforms: [],
    envPrefix: "RC_SUBS",
    // Rides the follower-growth slots — the throttled per-customer fan-out
    // (~55 req/min under RevenueCat's v2 limit) takes minutes, fine for cron.
    defaultHours: "9,21",
    script: "scripts/revenuecat-subs-snapshot.mjs",
    args: () => [],
    verify: "rc_subs",
    displayName: "RevenueCat subscriptions sync",
    description:
      "Twice-daily sweep of every RevenueCat customer's subscriptions into revenuecat_subscriptions — powers the new-subscribers bars in the Overview's New Customers chart.",
  },
  {
    name: "posthog-web",
    platforms: [],
    envPrefix: "POSTHOG",
    // Rides the analytics slots; one HogQL query per channel, seconds long.
    defaultHours: "9,21",
    script: "scripts/posthog-snapshot.mjs",
    args: () => [],
    verify: "web_analytics",
    displayName: "PostHog web visitors sync",
    description:
      "Twice-daily capture of website unique visitors / pageviews / sessions from PostHog into web_analytics_snapshots — powers the Visitors KPI in the Overview header.",
  },
  {
    name: "ai-news",
    platforms: [],
    envPrefix: "AI_NEWS",
    // Once a day, early, so the desk is fresh before Kevin picks the day's
    // video (Kevin 2026-09-08: "run once a day, check everything").
    defaultHours: "7",
    script: "scripts/ai-news-ingest.mjs",
    args: () => [],
    verify: "ai_news",
    displayName: "AI news desk",
    description:
      "Daily AI news agent: pulls Product Hunt launches, GitHub trending + new repos + watched releases, Hacker News, Hugging Face trending models + daily papers, and OpenAI / DeepMind / TechCrunch / Verge feeds; DeepSeek classifies, summarizes and scores each for video-worthiness; writes the day's top-100 into ai_news_items plus a daily brief with video ideas (ai_news_briefs) for /dashboard/news.",
  },
  {
    name: "follower-growth",
    platforms: [],
    envPrefix: "FOLLOWERS",
    // Rides the analytics-snapshot slots: morning baseline + evening refresh
    // (same-day rows upsert, so the 9 PM run just makes today's row current).
    defaultHours: "9,21",
    script: "scripts/follower-snapshot.mjs",
    args: () => [],
    verify: "followers",
    displayName: "Follower growth check",
    description:
      "Twice-daily capture of every connected account's follower count into follower_snapshots — powers the Overview's per-account growth badges and day-over-day audience deltas.",
  },
];

/** Platform uploads the armed automations will make on a full day. */
export function projectedDailyUploads(personas?: string[]): number {
  const allow = Array.isArray(personas) ? new Set(personas) : null;
  return CONTENT_JOBS.filter(jobEnabled)
    .filter((j) => !allow || (j.persona != null && allow.has(j.persona)))
    .reduce((sum, j) => sum + jobHoursET(j).length * j.platforms.length, 0);
}

/** ET times a job runs at — env override, else its default schedule.
 *  Accepts `H` or `H:MM` per entry (e.g. "0:30,4:30,12") and returns
 *  fractional hours (0:30 → 0.5) so half-hour slots schedule cleanly. */
export function jobHoursET(job: ContentJob): number[] {
  return (process.env[`${job.envPrefix}_CRON_HOURS_ET`] || job.defaultHours)
    .split(",")
    .map((s) => {
      const m = s.trim().match(/^(\d{1,2})(?::([0-5]\d))?$/);
      return m ? parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) / 60 : 0) : NaN;
    })
    .filter((h) => Number.isFinite(h) && h >= 0 && h < 24);
}

export function jobEnabled(job: ContentJob): boolean {
  // Local dashboards don't set the env — treat as enabled so the timeline
  // still previews the production schedule.
  const v = process.env[`${job.envPrefix}_CRON_ENABLED`];
  return v === undefined || v === "1";
}

const HOUR_LABELS: Record<number, string> = {};
export function hourLabelET(hour: number): string {
  if (!HOUR_LABELS[hour]) {
    const h = Math.floor(hour);
    const min = Math.round((hour - h) * 60);
    const h12 = h % 12 === 0 ? 12 : h % 12;
    HOUR_LABELS[hour] = `${h12}:${String(min).padStart(2, "0")}${h < 12 ? "am" : "pm"} ET`;
  }
  return HOUR_LABELS[hour];
}

/** "H:MMh" log label for a fractional ET hour (0.5 → "0:30h"). */
export function hourTagET(hour: number): string {
  return `${Math.floor(hour)}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")}h`;
}

/** Current UTC hour for an ET wall-clock hour (tracks DST at request time). */
export function utcHourForET(hour: number, at: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hour12: false,
  });
  // ET offset right now (UTC hour − ET hour, mod 24).
  const etHourNow = parseInt(fmt.format(at), 10) % 24;
  const utcHourNow = at.getUTCHours();
  const offset = (utcHourNow - etHourNow + 24) % 24;
  return (hour + offset) % 24;
}
