#!/usr/bin/env node
/**
 * revenuecat-subs-snapshot — sync every RevenueCat subscription into Postgres.
 *
 * RevenueCat v2 has NO project-wide subscription listing (the /subscriptions
 * and /purchases project endpoints are identifier lookups only), so this
 * walks /customers and fans out one GET per customer to
 * /customers/{id}/subscriptions, throttled under the 60 req/min v2 limit.
 * Too slow for a page render (~4 min at 244 customers) — exactly right for a
 * cron sweep. The dashboard's New-Customers chart reads the resulting
 * `revenuecat_subscriptions` table for its new-subscribers-per-day series.
 *
 * Runs for every channel with a revenuecat_project_id; the channel's own
 * revenuecat_api_key wins over the global REVENUECAT_API_KEY.
 *
 * Scheduled by the content-cron registry (RC_SUBS_CRON_ENABLED=1), riding the
 * same 9 AM + 9 PM ET slots as follower-growth. Upserts by subscription id —
 * safe to re-run any time.
 *
 * Env: DATABASE_URL, REVENUECAT_API_KEY. Run: node scripts/revenuecat-subs-snapshot.mjs
 */
import { Pool } from "pg";

const BASE = process.env.REVENUECAT_BASE_URL || "https://api.revenuecat.com";
if (!process.env.DATABASE_URL) {
  console.error("✗ DATABASE_URL required");
  process.exit(1);
}

const SCHEMA = `create table if not exists revenuecat_subscriptions (
  id text primary key,
  channel_id text not null,
  project_id text not null,
  customer_id text not null,
  product_id text,
  status text,
  environment text,
  starts_at timestamptz,
  current_period_ends_at timestamptz,
  raw jsonb,
  synced_at timestamptz not null default now()
)`;

// Every customer's first_seen_at — the Overview's New Customers chart and the
// Downloads m/m trend read THIS table (2026-09-11: the live customer walk
// never finished inside the page's 2.5s budget on Railway, so prod showed
// "0 last 30 days" while local dev, with a warm fetch cache, showed 316).
const CUSTOMERS_SCHEMA = `create table if not exists revenuecat_customers (
  project_id text not null,
  customer_id text not null,
  first_seen_at timestamptz,
  synced_at timestamptz not null default now(),
  primary key (project_id, customer_id)
)`;

// Point-in-time /metrics/overview (mrr, active_subscriptions, …) per ET day —
// the header's ARR / Valuation m/m compares today's MRR against the row from
// ~30 days back (mirrors src/lib/revenuecat/mrr-history.ts).
const METRICS_SCHEMA = `create table if not exists revenuecat_metric_snapshots (
  project_id text not null,
  day text not null,
  metric_id text not null,
  value double precision not null,
  currency text,
  captured_at timestamptz not null default now(),
  primary key (project_id, day, metric_id)
)`;
const etDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

// `--customers-only` skips the slow per-customer subscription fan-out.
const CUSTOMERS_ONLY = process.argv.includes("--customers-only");

const THROTTLE_MS = 1100; // ~55 req/min, under the 60/min v2 limit
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rcFetch(url, key, attempt = 0) {
  const res = await fetch(url.startsWith("http") ? url : `${BASE}${url}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (res.status === 429 && attempt < 4) {
    const wait = Number(res.headers.get("retry-after") || 15) * 1000;
    console.warn(`  … rate limited, waiting ${wait / 1000}s`);
    await sleep(wait);
    return rcFetch(url, key, attempt + 1);
  }
  if (!res.ok) throw new Error(`RevenueCat ${url} → ${res.status}: ${(await res.text()).slice(0, 150)}`);
  return res.json();
}

// starts_at arrives as an epoch-ms number; be defensive about ISO strings too.
const toTs = (v) =>
  v == null ? null : typeof v === "number" ? new Date(v) : new Date(String(v));

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
  await pool.query(SCHEMA);
  await pool.query(CUSTOMERS_SCHEMA);
  await pool.query(METRICS_SCHEMA);

  const { rows: channels } = await pool.query(
    `select id, name, revenuecat_project_id as pid, revenuecat_api_key as key
       from channels where revenuecat_project_id is not null`,
  );

  let totalSubs = 0;
  for (const ch of channels) {
    const key = ch.key || process.env.REVENUECAT_API_KEY;
    if (!key) { console.warn(`! ${ch.name}: no API key — skipped`); continue; }
    console.log(`\n=== ${ch.name} (${ch.pid}) ===`);

    // 0. Today's overview metrics → revenuecat_metric_snapshots (ARR m/m baseline).
    try {
      const ov = await rcFetch(`/v2/projects/${encodeURIComponent(ch.pid)}/metrics/overview`, key);
      const day = etDay();
      let n = 0;
      for (const m of ov.metrics ?? []) {
        if (typeof m.value !== "number" || !Number.isFinite(m.value)) continue;
        await pool.query(
          `insert into revenuecat_metric_snapshots (project_id, day, metric_id, value, currency, captured_at)
           values ($1,$2,$3,$4,$5, now())
           on conflict (project_id, day, metric_id) do update set
             value = excluded.value, currency = excluded.currency, captured_at = now()`,
          [ch.pid, day, m.id, m.value, ov.currency ?? null],
        );
        n++;
      }
      const mrr = (ov.metrics ?? []).find((m) => m.id === "mrr");
      console.log(`  ✓ ${n} overview metrics snapshotted for ${day}${mrr ? ` (mrr ${mrr.value})` : ""}`);
      await sleep(THROTTLE_MS);
    } catch (e) {
      console.warn(`  ! overview snapshot failed: ${e.message}`);
    }

    // 1. Every customer id.
    const customers = [];
    let url = `/v2/projects/${encodeURIComponent(ch.pid)}/customers?limit=1000`;
    let guard = 0;
    while (url && guard++ < 25) {
      const page = await rcFetch(url, key);
      for (const c of page.items ?? []) {
        customers.push(c.id);
        await pool.query(
          `insert into revenuecat_customers (project_id, customer_id, first_seen_at, synced_at)
           values ($1,$2,$3, now())
           on conflict (project_id, customer_id) do update set
             first_seen_at = coalesce(excluded.first_seen_at, revenuecat_customers.first_seen_at),
             synced_at = now()`,
          [ch.pid, c.id, toTs(c.first_seen_at)],
        );
      }
      url = page.next_page;
      await sleep(THROTTLE_MS);
    }
    console.log(`  ✓ ${customers.length} customers upserted into revenuecat_customers`);
    if (CUSTOMERS_ONLY) continue;
    console.log(`  sweeping subscriptions (~${Math.ceil((customers.length * THROTTLE_MS) / 60000)} min)`);

    // 2. Fan out subscriptions, throttled.
    let subs = 0;
    for (const cid of customers) {
      let sUrl = `/v2/projects/${encodeURIComponent(ch.pid)}/customers/${encodeURIComponent(cid)}/subscriptions?limit=100`;
      let g2 = 0;
      while (sUrl && g2++ < 5) {
        const page = await rcFetch(sUrl, key).catch((e) => {
          console.warn(`  ! ${cid}: ${e.message}`);
          return { items: [], next_page: null };
        });
        for (const s of page.items ?? []) {
          await pool.query(
            `insert into revenuecat_subscriptions
               (id, channel_id, project_id, customer_id, product_id, status, environment, starts_at, current_period_ends_at, raw, synced_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
             on conflict (id) do update set
               status = excluded.status,
               current_period_ends_at = excluded.current_period_ends_at,
               raw = excluded.raw,
               synced_at = now()`,
            [
              s.id, String(ch.id), ch.pid, cid,
              s.product_id ?? null, s.status ?? null, s.environment ?? null,
              toTs(s.starts_at), toTs(s.current_period_ends_at),
              JSON.stringify(s),
            ],
          );
          subs++;
        }
        sUrl = page.next_page;
        await sleep(THROTTLE_MS);
      }
    }
    console.log(`  ✓ ${subs} subscription rows upserted`);
    totalSubs += subs;
  }

  await pool.end();
  console.log(`\n✓ done — ${totalSubs} subscriptions across ${channels.length} channel(s)`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
