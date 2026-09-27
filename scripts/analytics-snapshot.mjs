#!/usr/bin/env node
/**
 * analytics-snapshot — nightly capture of per-platform post metrics.
 *
 * Pages through Zernio /analytics and upserts one row per (ET day, platform
 * post) into `analytics_snapshots`, then rolls those up into
 * `daily_view_snapshots` (one total_views + post_count per account×platform
 * per ET day). Overview header Views / avg views / m/m read ONLY that daily
 * series so a refresh never mixes live Zernio into the number.
 *
 * Scheduled once daily at 9 PM ET (ANALYTICS_CRON_ENABLED=1,
 * ANALYTICS_CRON_HOURS_ET=21). Safe to re-run within a day — both upserts
 * refresh that day's row.
 *
 * Env: ZERNIO_API_KEY, DATABASE_URL. Run: npm run analytics-snapshot
 */
import { Pool } from "pg";

const BASE = process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1";
const KEY = process.env.ZERNIO_API_KEY;
if (!KEY || !process.env.DATABASE_URL) {
  console.error("✗ ZERNIO_API_KEY / DATABASE_URL required");
  process.exit(1);
}

const SCHEMA = `create table if not exists analytics_snapshots (
  id bigserial primary key,
  snapshot_date date not null,
  platform_post_id text not null,
  platform text,
  account_username text,
  content text,
  views int not null default 0,
  likes int not null default 0,
  comments int not null default 0,
  saves int not null default 0,
  shares int not null default 0,
  impressions int not null default 0,
  reach int not null default 0,
  engagement_rate real,
  published_at timestamptz,
  captured_at timestamptz not null default now(),
  carried boolean not null default false,
  unique (snapshot_date, platform_post_id)
);
alter table analytics_snapshots add column if not exists carried boolean not null default false;
create index if not exists analytics_snapshots_acct_post_date
  on analytics_snapshots (account_username, platform_post_id, snapshot_date);
create index if not exists analytics_snapshots_post_date
  on analytics_snapshots (platform_post_id, snapshot_date);
create table if not exists daily_view_snapshots (
  snapshot_date date not null,
  account_username text not null default '',
  platform text not null default 'other',
  total_views bigint not null default 0,
  post_count int not null default 0,
  captured_at timestamptz not null default now(),
  unique (snapshot_date, account_username, platform)
);
create index if not exists daily_view_snapshots_date_idx
  on daily_view_snapshots (snapshot_date desc)`;

/** Normalize platform ids (TikTok publish handles → numeric tail). */
const platformKey = (id) => {
  if (!id) return null;
  const m = String(id).match(/(\d{12,})\s*$/);
  return m ? m[1] : String(id);
};

/** Zernio GET with retries: a single 5xx/429/network blip used to end the whole
 *  nightly run (2026-09-18 captured 250 of ~5000 rows and left the heatmap blank). */
async function getJson(url, attempts = 4) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(60_000) });
      if (res.ok) return await res.json();
      last = new Error(`HTTP ${res.status}`);
      if (res.status < 500 && res.status !== 429) throw last;
    } catch (e) {
      last = e;
      if (e?.message?.startsWith("HTTP 4")) throw e;
    }
    if (i < attempts) {
      const wait = 3000 * 2 ** (i - 1);
      console.warn(`! ${url.replace(BASE, "")} attempt ${i} failed (${last.message}), retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

/** Copy each post's most recent row (previous 3 days) into `day` when the crawl
 *  didn't return it. Real captures overwrite these (carried=false) on re-run. */
export async function carryForward(pool, day) {
  const { rowCount } = await pool.query(
    `insert into analytics_snapshots
       (snapshot_date, platform_post_id, platform, account_username, content,
        views, likes, comments, saves, shares, impressions, reach, engagement_rate,
        published_at, carried)
     select distinct on (s.platform_post_id)
            $1::date, s.platform_post_id, s.platform, s.account_username, s.content,
            s.views, s.likes, s.comments, s.saves, s.shares, s.impressions, s.reach,
            s.engagement_rate, s.published_at, true
       from analytics_snapshots s
      where s.snapshot_date < $1::date
        and s.snapshot_date = $1::date - 1
        and not s.carried
        and not exists (select 1 from analytics_snapshots t
                         where t.snapshot_date = $1::date and t.platform_post_id = s.platform_post_id)
      order by s.platform_post_id, s.snapshot_date desc
     on conflict (snapshot_date, platform_post_id) do nothing`,
    [day],
  );
  return rowCount;
}

async function main() {
  // --date YYYY-MM-DD re-captures a specific ET day (backfill after a failed run).
  const dateArg = process.argv.find((a) => a.startsWith("--date="))?.slice(7) ?? process.argv[process.argv.indexOf("--date") + 1];
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dateArg ?? "")
    ? dateArg
    : new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
  await pool.query(SCHEMA);

  // Our threads inflate platform comment counts with their OWN child items
  // (Threads counts the whole chain, X the root's direct reply). Build
  // platform-post-id → self-replies from the feed posts' threadItems so the
  // stored "comments" mean real audience comments.
  const selfReplies = new Map();
  try {
    const feed = await getJson(`${BASE}/posts?limit=200`);
    for (const p of feed.posts ?? []) {
      for (const pl of p.platforms ?? []) {
        const k = platformKey(pl.platformPostId);
        const items = pl.platformSpecificData?.threadItems?.length ?? 0;
        if (k && items > 1) selfReplies.set(k, pl.platform === "twitter" ? 1 : items - 1);
      }
    }
  } catch (e) {
    console.warn(`! thread self-reply map failed (comments stay raw): ${e.message}`);
  }

  // --carry-only repairs a past day without re-crawling (Zernio only has today's numbers).
  const carryOnly = process.argv.includes("--carry-only");
  let page = 1;
  let pages = carryOnly ? 0 : 1;
  let rows = 0;
  if (!carryOnly) do {
    const data = await getJson(`${BASE}/analytics?page=${page}`);
    pages = data.pagination?.pages ?? 1;
    for (const post of data.posts ?? []) {
      for (const pl of post.platforms ?? []) {
        const key = platformKey(pl.platformPostId);
        const a = pl.analytics;
        if (!key || !a) continue;
        await pool.query(
          `insert into analytics_snapshots
             (snapshot_date, platform_post_id, platform, account_username, content,
              views, likes, comments, saves, shares, impressions, reach, engagement_rate, published_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           on conflict (snapshot_date, platform_post_id) do update set
             views=excluded.views, likes=excluded.likes, comments=excluded.comments,
             saves=excluded.saves, shares=excluded.shares, impressions=excluded.impressions,
             reach=excluded.reach, engagement_rate=excluded.engagement_rate,
             published_at=coalesce(excluded.published_at, analytics_snapshots.published_at),
             captured_at=now(), carried=false`,
          [
            day, key, pl.platform, pl.accountUsername ?? null,
            (post.content ?? "").slice(0, 300),
            a.views ?? 0, a.likes ?? 0,
            Math.max(0, (a.comments ?? 0) - (selfReplies.get(key) ?? 0)), a.saves ?? 0,
            a.shares ?? 0, a.impressions ?? 0, a.reach ?? 0, a.engagementRate ?? null,
            post.publishedAt ?? post.scheduledFor ?? null,
          ],
        );
        rows++;
      }
    }
    page++;
  } while (page <= pages);

  // Carry forward posts the crawl missed. Zernio /analytics pages shift while new
  // posts land mid-crawl (~9 min), so a run can skip posts it saw yesterday
  // (2026-09-24: kevbuildsapps TikTok 100 -> 24 posts). A live post can't vanish,
  // so reuse yesterday's real capture (missing two nights running = really gone); otherwise the day's total
  // dips, its heatmap cell reads 0 and the next day double-counts.
  const carried = await carryForward(pool, day);
  if (carried) console.warn(`! ${carried} posts missing from this crawl, carried forward from their last capture`);

  // One daily total per account×platform. Rebuild every history day so a
  // recapture never leaves the header on a stale mix.
  const rolled = await pool.query(
    `insert into daily_view_snapshots
       (snapshot_date, account_username, platform, total_views, post_count)
     select snapshot_date,
            coalesce(account_username, ''),
            coalesce(platform, 'other'),
            sum(coalesce(nullif(views, 0), impressions, 0))::bigint,
            count(*)::int
       from analytics_snapshots
      where published_at is null
         or published_at >= timestamptz '2026-06-01 00:00:00+00'
      group by 1, 2, 3
     on conflict (snapshot_date, account_username, platform) do update set
       total_views = excluded.total_views,
       post_count = excluded.post_count,
       captured_at = now()
     returning snapshot_date`,
  );

  const { rows: r } = await pool.query(
    `select count(*) n, sum(total_views) v, sum(post_count) p
       from daily_view_snapshots where snapshot_date = $1`,
    [day],
  );
  console.log(
    `✓ snapshot ${day}: ${rows} post rows, ${rolled.rowCount} daily totals (${r[0].n} accounts, ${r[0].v} views, ${r[0].p} posts)`,
  );
  await pool.end();
}

main().catch((e) => { console.error("✗", e.message); process.exit(1); });
