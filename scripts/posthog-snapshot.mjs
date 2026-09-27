#!/usr/bin/env node
/**
 * posthog-snapshot — daily website-visitor capture from PostHog into Postgres.
 *
 * For every channel with a posthog_project_id, runs one HogQL query over the
 * PostHog Query API for a per-ET-day series of unique visitors, pageviews, and
 * sessions (last ~35 days), and upserts one row per (day, channel) into
 * `web_analytics_snapshots`. The Overview header reads THIS table for the
 * Visitors KPI + its month-over-month trend (with a live top-up for today).
 *
 * Auth: POSTHOG_API_KEY is a project-scoped PERSONAL key (phx_…) with Query
 * Read. Host + project id come from the channel row (posthog_host defaults to
 * US cloud). Region-agnostic — set posthog_host to eu.posthog.com for EU.
 *
 * Scheduled by the content-cron registry (POSTHOG_CRON_ENABLED=1), riding the
 * 9 AM + 9 PM ET slots. Safe to re-run any time — upserts by (day, channel).
 *
 * Env: DATABASE_URL, POSTHOG_API_KEY. Run: npm run posthog-snapshot
 */
import { Pool } from "pg";

const KEY = process.env.POSTHOG_API_KEY;
if (!KEY || !process.env.DATABASE_URL) {
  console.error("✗ POSTHOG_API_KEY / DATABASE_URL required");
  process.exit(1);
}

const SCHEMA = `create table if not exists web_analytics_snapshots (
  snapshot_date date not null,
  channel_id text not null,
  project_id text not null,
  visitors int not null default 0,
  pageviews int not null default 0,
  sessions int not null default 0,
  captured_at timestamptz not null default now(),
  primary key (snapshot_date, channel_id)
)`;

// Per-ET-day pageviews, unique visitors, unique sessions over the window.
// toTimeZone keeps the day buckets aligned to ET (matches the rest of the
// dashboard); $session_id groups pageviews into sessions.
const HOGQL = `
  SELECT
    toDate(toTimeZone(timestamp, 'America/New_York')) AS day,
    count() AS pageviews,
    count(DISTINCT person_id) AS visitors,
    count(DISTINCT properties.$session_id) AS sessions
  FROM events
  WHERE event = '$pageview'
    AND timestamp >= now() - INTERVAL 35 DAY
  GROUP BY day
  ORDER BY day`;

async function phQuery(host, projectId, key) {
  const res = await fetch(`${host}/api/projects/${projectId}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: HOGQL } }),
  });
  if (!res.ok) {
    throw new Error(`PostHog ${projectId} → ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  const json = await res.json();
  // results: [[day, pageviews, visitors, sessions], …]
  return json.results ?? [];
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
  await pool.query(SCHEMA);

  const { rows: channels } = await pool.query(
    `select id, name, posthog_project_id as pid,
            coalesce(posthog_host, 'https://us.posthog.com') as host
       from channels where posthog_project_id is not null`,
  );
  if (channels.length === 0) {
    console.log("no channels with a posthog_project_id — nothing to do");
    await pool.end();
    return;
  }

  let total = 0;
  for (const ch of channels) {
    console.log(`\n=== ${ch.name} (project ${ch.pid}) ===`);
    let rows;
    try {
      rows = await phQuery(ch.host, ch.pid, KEY);
    } catch (e) {
      console.warn(`  ! ${e.message}`);
      continue;
    }
    for (const [day, pageviews, visitors, sessions] of rows) {
      const d = String(day).slice(0, 10);
      await pool.query(
        `insert into web_analytics_snapshots
           (snapshot_date, channel_id, project_id, visitors, pageviews, sessions, captured_at)
         values ($1,$2,$3,$4,$5,$6, now())
         on conflict (snapshot_date, channel_id) do update set
           visitors = excluded.visitors,
           pageviews = excluded.pageviews,
           sessions = excluded.sessions,
           captured_at = now()`,
        [d, String(ch.id), String(ch.pid), Number(visitors) || 0, Number(pageviews) || 0, Number(sessions) || 0],
      );
      total++;
    }
    // Always heartbeat TODAY's row (ET) even at zero traffic — gives the
    // watchdog a captured_at to verify and the header a "today" number
    // instead of a stale last-nonzero day.
    const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    const has = rows.some((r) => String(r[0]).slice(0, 10) === todayEt);
    if (!has) {
      await pool.query(
        `insert into web_analytics_snapshots
           (snapshot_date, channel_id, project_id, visitors, pageviews, sessions, captured_at)
         values ($1,$2,$3,0,0,0, now())
         on conflict (snapshot_date, channel_id) do update set captured_at = now()`,
        [todayEt, String(ch.id), String(ch.pid)],
      );
      total++;
    }
    const today = rows.at(-1);
    console.log(`  ✓ ${rows.length} day-rows upserted${today ? ` (latest ${String(today[0]).slice(0, 10)}: ${today[2]} visitors, ${today[1]} views)` : " — no pageview events yet, today heartbeat written"}`);
  }

  await pool.end();
  console.log(`\n✓ done — ${total} day-rows across ${channels.length} channel(s)`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
