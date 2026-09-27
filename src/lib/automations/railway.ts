import "server-only";
import { dbConfigured, query } from "@/lib/insforge/db";
import { ttlRemember } from "@/lib/cache/ttl";
import { CONTENT_JOBS, hourLabelET, jobEnabled, jobHoursET, utcHourForET } from "@/lib/content/registry";

/**
 * Automations running on Railway, surfaced as a timeline on the Overview.
 *
 * Most entries are hand-maintained config (roadmap). Entries with a `source`
 * are LIVE — their last run, recent-run count, and health are read from real
 * data (e.g. the sounds cron is verified against the `sounds` table).
 */

export type AutomationStatus = "active" | "paused" | "error";

/** Live health, only computed for tracked (`source`) automations. */
export type HealthStatus = "healthy" | "overdue" | "pending" | "paused";

export type RailwayAutomation = {
  id: string;
  name: string;
  description: string;
  /** Railway service name this automation runs as. */
  service: string;
  /** 5-field cron (server local time = UTC on Railway). Drives next/prev run. */
  cron: string;
  /** Human-readable cadence, shown as-is (e.g. "Every day · 9:00am"). */
  cadence: string;
  status: AutomationStatus;
  /** ISO timestamp of the last successful run, if known. */
  lastRunAt?: string;
  /** Marks an automation whose runs are verified against real data. */
  source?: "sounds" | "carousels" | "snapshots" | "followers" | "rc_subs" | "rc_customers" | "web_analytics" | "ai_news";
  /** For source "carousels": scope run-verification to one persona's posts. */
  persona?: string;
  /** Platforms one run posts to (empty = doesn't publish). */
  platforms: string[];
  /** The .claude skill (or script) this run executes. */
  skill: string;
};

export type ScheduledAutomation = RailwayAutomation & {
  /** ISO timestamp of the next run, computed from `cron`. */
  nextRunAt: string | null;
  /** Verified health — only set for tracked automations. */
  health?: HealthStatus;
  /** How many runs landed in the last 7 days (tracked automations only). */
  recentRuns?: number;
};

// Hand-maintained entries — only jobs OUTSIDE the content-cron registry.
// The sounds cron runs in-app (src/lib/sounds/cron.ts), verified live against
// the `sounds` table via `source: "sounds"`.
const STATIC_AUTOMATIONS: RailwayAutomation[] = [
  {
    id: "trending-sounds",
    name: "Trending sounds sync",
    description: "Refreshes both charts daily — English-market trending music + general trending sounds.",
    service: "kevbuildsapps-Marketing-OS",
    cron: "0 6 * * *",
    cadence: "Daily · 6:00am UTC",
    status: "active",
    source: "sounds",
    platforms: [],
    skill: "trending-sounds",
  },
];

/** Skill folder name from a registry script path, e.g.
 *  ".claude/skills/reaction-ugc/scripts/…" → "reaction-ugc". */
function skillFromScript(script: string): string {
  const m = script.match(/\.claude\/skills\/([^/]+)\//);
  return m ? m[1] : script.split("/").pop()?.replace(/\.(mjs|js|ts)$/, "") ?? script;
}

/**
 * One timeline entry per content-cron job×hour, derived from the SAME registry
 * the scheduler arms (src/lib/content/registry.ts) — set up an automation there
 * and the dashboard reflects it with zero extra wiring. The UTC cron mirror is
 * computed per-request so it tracks DST.
 */
function contentAutomations(): RailwayAutomation[] {
  return CONTENT_JOBS.flatMap((job) =>
    jobHoursET(job).map((hour) => ({
      id: `${job.name}-${hour}h`,
      name: `${job.displayName} · ${hourLabelET(hour)}`,
      description: job.description,
      service: "kevbuildsapps-Marketing-OS",
      // Fractional ET hours (0:30 slots) put the minutes in the cron minute
      // field; utcHourForET only shifts whole hours so pass it the floor.
      cron: `${Math.round((hour % 1) * 60)} ${utcHourForET(Math.floor(hour))} * * *`,
      cadence: `Daily · ${hourLabelET(hour)}`,
      status: (jobEnabled(job) ? "active" : "paused") as AutomationStatus,
      source: job.verify,
      persona: job.persona,
      platforms: job.platforms,
      skill: skillFromScript(job.script),
    })),
  );
}

/** Match a single cron field against a value. Supports `*`, `a`, `a-b`, `a,b`, `* /n`. */
function fieldMatch(field: string, value: number): boolean {
  return field.split(",").some((part) => {
    let range = part;
    let step = 1;
    const slash = part.indexOf("/");
    if (slash !== -1) {
      step = parseInt(part.slice(slash + 1), 10) || 1;
      range = part.slice(0, slash);
    }
    let lo: number;
    let hi: number;
    if (range === "*") {
      // Any value passes the bounds; step still applies relative to 0.
      return value % step === 0;
    }
    if (range.includes("-")) {
      const [a, b] = range.split("-");
      lo = parseInt(a, 10);
      hi = parseInt(b, 10);
    } else {
      lo = hi = parseInt(range, 10);
    }
    if (Number.isNaN(lo) || Number.isNaN(hi) || value < lo || value > hi) return false;
    return (value - lo) % step === 0;
  });
}

/**
 * Next fire time for a 5-field cron (minute hour day-of-month month day-of-week).
 * Steps forward minute-by-minute; day-of-month and day-of-week are AND-ed
 * (use one or the other for predictable behavior). Returns null if unparseable.
 *
 * Cron fields are interpreted in UTC (the Railway contract), independent of the
 * host timezone — so health/next-run stay correct when the dashboard is viewed
 * on a non-UTC machine locally.
 */
export function nextRun(cron: string, from: Date = new Date()): Date | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hr, dom, mon, dow] = parts;

  const d = new Date(from.getTime());
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);

  // Cap the search at ~366 days; the loop breaks far earlier for real schedules.
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (
      fieldMatch(min, d.getUTCMinutes()) &&
      fieldMatch(hr, d.getUTCHours()) &&
      fieldMatch(dom, d.getUTCDate()) &&
      fieldMatch(mon, d.getUTCMonth() + 1) &&
      fieldMatch(dow, d.getUTCDay())
    ) {
      return new Date(d.getTime());
    }
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return null;
}

/**
 * Most recent fire time at or before `from` for a 5-field cron — the mirror of
 * nextRun, stepping backward. Used to tell whether the last run was on schedule.
 */
export function prevRun(cron: string, from: Date = new Date()): Date | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hr, dom, mon, dow] = parts;

  const d = new Date(from.getTime());
  d.setUTCSeconds(0, 0);

  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (
      fieldMatch(min, d.getUTCMinutes()) &&
      fieldMatch(hr, d.getUTCHours()) &&
      fieldMatch(dom, d.getUTCDate()) &&
      fieldMatch(mon, d.getUTCMonth() + 1) &&
      fieldMatch(dow, d.getUTCDay())
    ) {
      return new Date(d.getTime());
    }
    d.setUTCMinutes(d.getUTCMinutes() - 1);
  }
  return null;
}

export type ManagerReport = {
  healthy: boolean;
  createdAt: string;
  blockers: string[];
  jobs: { job: string; slot: string; status: string }[];
};

/** Latest manager health report (written by the cron manager tick). */
export async function latestManagerReport(): Promise<ManagerReport | null> {
  if (!dbConfigured) return null;
  try {
    const rows = await query<{ healthy: boolean; report: { blockers?: string[]; jobs?: ManagerReport["jobs"] }; created_at: Date }>(
      `select healthy, report, created_at from manager_reports order by created_at desc limit 1`,
    );
    if (!rows.length) return null;
    return {
      healthy: rows[0].healthy,
      createdAt: new Date(rows[0].created_at).toISOString(),
      blockers: rows[0].report?.blockers ?? [],
      jobs: rows[0].report?.jobs ?? [],
    };
  } catch {
    return null;
  }
}

type RunInfo = { lastRunAt: string | null; recentRuns: number };

/** Real run history for the analytics snapshot, from `analytics_snapshots`. */
async function snapshotsRunInfo(): Promise<RunInfo> {
  if (!dbConfigured) return { lastRunAt: null, recentRuns: 0 };
  try {
    const rows = await query<{ last: Date | null; recent: string | number }>(
      `select max(captured_at) as last,
              count(distinct snapshot_date) filter (where captured_at > now() - interval '7 days') as recent
         from analytics_snapshots`,
    );
    const r = rows[0];
    return {
      lastRunAt: r?.last ? new Date(r.last).toISOString() : null,
      recentRuns: Number(r?.recent ?? 0),
    };
  } catch {
    return { lastRunAt: null, recentRuns: 0 };
  }
}

/** Real run history for the follower growth check, from `follower_snapshots`. */
async function followersRunInfo(): Promise<RunInfo> {
  if (!dbConfigured) return { lastRunAt: null, recentRuns: 0 };
  try {
    const rows = await query<{ last: Date | null; recent: string | number }>(
      `select max(captured_at) as last,
              count(distinct snapshot_date) filter (where captured_at > now() - interval '7 days') as recent
         from follower_snapshots`,
    );
    const r = rows[0];
    return {
      lastRunAt: r?.last ? new Date(r.last).toISOString() : null,
      recentRuns: Number(r?.recent ?? 0),
    };
  } catch {
    return { lastRunAt: null, recentRuns: 0 };
  }
}

/** Real run history for the RevenueCat customers sync. */
async function rcCustomersRunInfo(): Promise<RunInfo> {
  if (!dbConfigured) return { lastRunAt: null, recentRuns: 0 };
  try {
    const rows = await query<{ last: Date | null; recent: string | number }>(
      `select max(synced_at) as last,
              count(distinct (synced_at at time zone 'America/New_York')::date)
                filter (where synced_at > now() - interval '7 days') as recent
         from revenuecat_customers`,
    );
    const r = rows[0];
    return {
      lastRunAt: r?.last ? new Date(r.last).toISOString() : null,
      recentRuns: Number(r?.recent ?? 0),
    };
  } catch {
    return { lastRunAt: null, recentRuns: 0 };
  }
}

/** Real run history for the RevenueCat subs sweep, from `revenuecat_subscriptions`. */
async function rcSubsRunInfo(): Promise<RunInfo> {
  if (!dbConfigured) return { lastRunAt: null, recentRuns: 0 };
  try {
    const rows = await query<{ last: Date | null; recent: string | number }>(
      `select max(synced_at) as last,
              count(distinct (synced_at at time zone 'America/New_York')::date)
                filter (where synced_at > now() - interval '7 days') as recent
         from revenuecat_subscriptions`,
    );
    const r = rows[0];
    return {
      lastRunAt: r?.last ? new Date(r.last).toISOString() : null,
      recentRuns: Number(r?.recent ?? 0),
    };
  } catch {
    return { lastRunAt: null, recentRuns: 0 };
  }
}

async function webAnalyticsRunInfo(): Promise<RunInfo> {
  if (!dbConfigured) return { lastRunAt: null, recentRuns: 0 };
  try {
    const rows = await query<{ last: Date | null; recent: string | number }>(
      `select max(captured_at) as last,
              count(distinct (captured_at at time zone 'America/New_York')::date)
                filter (where captured_at > now() - interval '7 days') as recent
         from web_analytics_snapshots`,
    );
    const r = rows[0];
    return {
      lastRunAt: r?.last ? new Date(r.last).toISOString() : null,
      recentRuns: Number(r?.recent ?? 0),
    };
  } catch {
    return { lastRunAt: null, recentRuns: 0 };
  }
}

/** Real run history for the AI news desk, from `ai_news_briefs` (one row per ET day). */
async function aiNewsRunInfo(): Promise<RunInfo> {
  if (!dbConfigured) return { lastRunAt: null, recentRuns: 0 };
  try {
    const rows = await query<{ last: Date | null; recent: string | number }>(
      `select max(created_at) as last,
              count(*) filter (where created_at > now() - interval '7 days') as recent
         from ai_news_briefs`,
    );
    const r = rows[0];
    return {
      lastRunAt: r?.last ? new Date(r.last).toISOString() : null,
      recentRuns: Number(r?.recent ?? 0),
    };
  } catch {
    return { lastRunAt: null, recentRuns: 0 };
  }
}

/** Real run history for the sounds cron, derived from the `sounds` table. */
async function soundsRunInfo(): Promise<RunInfo> {
  if (!dbConfigured) return { lastRunAt: null, recentRuns: 0 };
  try {
    const rows = await query<{ last: Date | null; recent: string | number }>(
      `select max(created_at) as last,
              count(distinct batch) filter (where created_at > now() - interval '7 days') as recent
         from sounds`,
    );
    const r = rows[0];
    return {
      lastRunAt: r?.last ? new Date(r.last).toISOString() : null,
      recentRuns: Number(r?.recent ?? 0),
    };
  } catch {
    return { lastRunAt: null, recentRuns: 0 };
  }
}

/**
 * Real run history for a daily carousel, derived from the `content_posts`
 * table — scoped to one persona when given, so Megan's and Danny's automations
 * are verified independently.
 */
async function carouselsRunInfo(persona?: string): Promise<RunInfo> {
  if (!dbConfigured) return { lastRunAt: null, recentRuns: 0 };
  try {
    const where = persona ? `where persona = $1` : "";
    const rows = await query<{ last: Date | null; recent: string | number }>(
      `select max(coalesce(posted_at, created_at)) as last,
              count(*) filter (where coalesce(posted_at, created_at) > now() - interval '7 days') as recent
         from content_posts ${where}`,
      persona ? [persona] : [],
    );
    const r = rows[0];
    return {
      lastRunAt: r?.last ? new Date(r.last).toISOString() : null,
      recentRuns: Number(r?.recent ?? 0),
    };
  } catch {
    return { lastRunAt: null, recentRuns: 0 };
  }
}

/** Verified health for a tracked automation, from its cron + last run. */
function computeHealth(
  a: RailwayAutomation,
  lastRunAt: string | null,
  now: Date,
): HealthStatus | undefined {
  if (a.status === "paused") return "paused";
  if (!a.source) return undefined; // untracked → make no health claim
  if (!lastRunAt) return "pending"; // live but hasn't fired yet
  const expected = prevRun(a.cron, now);
  if (!expected) return "healthy";
  const last = new Date(lastRunAt).getTime();
  const graceMs = 90 * 60 * 1000; // allow for run duration / clock skew
  if (last >= expected.getTime()) return "healthy";
  if (now.getTime() - expected.getTime() < graceMs) return "healthy"; // just fired, may be running
  return "overdue";
}

/**
 * Automations enriched with next run + (for tracked ones) real last-run,
 * recent-run count, and health. Soonest next-run first.
 */
export async function listRailwayAutomations(opts?: {
  /** When set, only persona-owned jobs for these slugs (plus shared jobs if includeShared). */
  personas?: string[];
  /** Sounds / snapshots / RC / PostHog — Creator OS ops, not personal brand. */
  includeShared?: boolean;
}): Promise<ScheduledAutomation[]> {
  const key = `rail:auto:${[...(opts?.personas ?? [])].sort().join(",")}:${String(opts?.includeShared)}`;
  return ttlRemember(key, 30_000, () => listRailwayAutomationsFresh(opts));
}

async function listRailwayAutomationsFresh(opts?: {
  personas?: string[];
  includeShared?: boolean;
}): Promise<ScheduledAutomation[]> {
  const now = new Date();
  const personaSet = opts?.personas ? new Set(opts.personas) : null;
  const includeShared = opts?.includeShared ?? personaSet == null;

  const AUTOMATIONS = [...STATIC_AUTOMATIONS, ...contentAutomations()].filter((a) => {
    if (!personaSet) return true;
    if (a.persona) return personaSet.has(a.persona);
    return includeShared;
  });
  const [sounds, snapshots, followers, rcSubs, rcCustomers, webAnalytics, aiNews] = await Promise.all([
    soundsRunInfo(),
    snapshotsRunInfo(),
    followersRunInfo(),
    rcSubsRunInfo(),
    rcCustomersRunInfo(),
    webAnalyticsRunInfo(),
    aiNewsRunInfo(),
  ]);
  // Per-persona carousel run info, fetched once per distinct persona.
  const personas = [
    ...new Set(
      AUTOMATIONS.filter((a) => a.source === "carousels").map((a) => a.persona),
    ),
  ];
  const carouselInfos = new Map(
    await Promise.all(
      personas.map(async (p) => [p, await carouselsRunInfo(p)] as const),
    ),
  );

  const out = await Promise.all(
    AUTOMATIONS.map(async (a): Promise<ScheduledAutomation> => {
      const info: RunInfo | null =
        a.source === "sounds"
          ? sounds
          : a.source === "snapshots"
            ? snapshots
            : a.source === "followers"
              ? followers
              : a.source === "rc_subs"
                ? rcSubs
                : a.source === "rc_customers"
                  ? rcCustomers
                  : a.source === "web_analytics"
                    ? webAnalytics
                    : a.source === "ai_news"
                      ? aiNews
                      : a.source === "carousels"
                        ? (carouselInfos.get(a.persona) ?? null)
                        : null;
      const lastRunAt = info?.lastRunAt ?? a.lastRunAt;
      const next = a.status === "active" ? nextRun(a.cron, now) : null;
      return {
        ...a,
        lastRunAt,
        nextRunAt: next ? next.toISOString() : null,
        health: computeHealth(a, lastRunAt ?? null, now),
        recentRuns: info ? info.recentRuns : undefined,
      };
    }),
  );

  return out.sort((a, b) => {
    if (!a.nextRunAt) return 1;
    if (!b.nextRunAt) return -1;
    return a.nextRunAt.localeCompare(b.nextRunAt);
  });
}
