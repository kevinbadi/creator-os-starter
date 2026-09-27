#!/usr/bin/env node
/**
 * follower-snapshot — daily capture of every connected account's follower count.
 *
 * Walks Zernio /profiles → /accounts and upserts one row per (ET day, account)
 * into `follower_snapshots`. The Overview reads THIS table for growth badges
 * (day-over-day / 7-day deltas fall out of consecutive snapshots) while the
 * live count on each chip stays fresh Zernio.
 *
 * Scheduled by the content-cron registry (FOLLOWERS_CRON_ENABLED=1); rides the
 * same 9 AM + 9 PM ET slots as analytics-snapshot. Safe to re-run within a day
 * — the upsert refreshes that day's row.
 *
 * Env: ZERNIO_API_KEY, DATABASE_URL. Run: npm run follower-snapshot
 */
import { Pool } from "pg";

const BASE = process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1";
const KEY = process.env.ZERNIO_API_KEY;
if (!KEY || !process.env.DATABASE_URL) {
  console.error("✗ ZERNIO_API_KEY / DATABASE_URL required");
  process.exit(1);
}

const SCHEMA = `create table if not exists follower_snapshots (
  id bigserial primary key,
  snapshot_date date not null,
  profile_id text not null,
  profile_name text,
  account_id text not null,
  platform text,
  username text,
  followers int not null default 0,
  captured_at timestamptz not null default now(),
  unique (snapshot_date, account_id)
)`;

// Zernio throws the odd 5xx at the top of the hour (2026-09-10 21:00 ET: the
// whole evening capture was lost to one 503, so Thursday's growth showed 0).
// Retry transient failures with backoff before giving up on a call.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const zfetch = async (p, attempts = 4) => {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BASE}${p}`, {
        headers: { Authorization: `Bearer ${KEY}` },
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return res.json();
      lastErr = new Error(`Zernio ${p} → ${res.status}`);
      if (res.status < 500 && res.status !== 429) throw lastErr;
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) await sleep(3000 * (i + 1));
  }
  throw lastErr;
};

// ── Live scrape (mirror of src/lib/followers/live.ts) ───────────────────────
// Zernio only re-syncs follower counts once a day and reports Threads as 0;
// crawler UAs get the real numbers from public profile meta. Scraped counts
// win unless Zernio's exact figure rounds to the same compact string.
const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SCRAPERS = {
  threads: { url: (u) => `https://www.threads.com/@${u}`, ua: CRAWLER_UA, pattern: () => /content="([\d.,KkMm]+)\s+Followers?/i },
  instagram: { url: (u) => `https://www.instagram.com/${u}/`, ua: CRAWLER_UA, pattern: () => /content="([\d.,KkMm]+)\s+Followers?/i },
  tiktok: { url: (u) => `https://www.tiktok.com/@${u}`, ua: CRAWLER_UA, pattern: () => /([\d.,KkMm]+)\s+Followers?/i },
  // Anchor to the handle with a word boundary — YT lists OTHER channels first,
  // and @kevbuildsapps must not eat @kevbuildsapps2.
  youtube: { url: (u) => `https://www.youtube.com/@${u}`, ua: BROWSER_UA, pattern: (u) => new RegExp(`@${reEscape(u)}(?![\\w.])[^\\d"]{0,40}?([\\d.,]+\\s*[KkMm]?)\\s+subscribers`, "i") },
};

const parseCompact = (raw) => {
  const m = raw.replace(/,/g, "").match(/^([\d.]+)([KkMm])?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? Math.round(m[2] ? n * (m[2].toLowerCase() === "k" ? 1e3 : 1e6) : n) : null;
};

const compactMatches = (exact, raw) => {
  const unit = /m/i.test(raw) ? 1e6 : /k/i.test(raw) ? 1e3 : 1;
  if (unit === 1) return exact === parseCompact(raw);
  const decimals = (raw.replace(/,/g, "").split(".")[1] ?? "").replace(/\D/g, "").length;
  return parseFloat((exact / unit).toFixed(decimals)) === parseFloat(raw.replace(/,/g, "").replace(/[KkMm]/, ""));
};

async function scrapeFollowers(platform, username) {
  const s = SCRAPERS[platform];
  if (!s || !username) return null;
  try {
    const res = await fetch(s.url(username), {
      headers: { "User-Agent": s.ua, "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const m = (await res.text()).match(s.pattern(username));
    if (!m) return null;
    const count = parseCompact(m[1]);
    return count == null ? null : { count, raw: m[1] };
  } catch {
    return null;
  }
}

// Same rule as resolveFollowerCount in src/lib/followers/live.ts: Zernio's
// nightly API sync is exact and authoritative; Meta caches crawler preview
// meta for hours (IG page lagged the API by 108 on 2026-09-11) and rounds
// big counts. Rounded-and-agrees → Zernio; Zernio synced within a day and
// both exact → the higher; Zernio stale → the scrape.
const ZERNIO_FRESH_MS = 26 * 60 * 60 * 1000;
function compactDisplayGrain(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return 1e5;
  if (a >= 1e5) return 1e3;
  if (a >= 1e3) return 100;
  return 1;
}
function isCompactGrainDrop(from, to) {
  if (!(from > to) || to <= 0) return false;
  const grain = compactDisplayGrain(from);
  if (grain <= 1 || from % grain !== 0 || to % grain !== 0) return false;
  return from - to <= grain;
}
function compactGrainFromRaw(raw) {
  const unit = /m/i.test(raw) ? 1e6 : /k/i.test(raw) ? 1e3 : 1;
  if (unit === 1) return 1;
  const decimals = (raw.replace(/,/g, "").split(".")[1] ?? "").replace(/\D/g, "").length;
  return unit / 10 ** decimals;
}
function resolveFollowerCount(zernio, zernioUpdatedAt, scraped, lastKnown = 0) {
  const holdCompact = (n) => (lastKnown > 0 && isCompactGrainDrop(lastKnown, n) ? lastKnown : n);
  if (!scraped) return holdCompact(zernio);
  if (compactMatches(zernio, scraped.raw)) return holdCompact(zernio);
  const rounded = /[KkMm]/.test(scraped.raw);
  const grain = rounded ? compactGrainFromRaw(scraped.raw) : 1;
  const syncedAt = zernioUpdatedAt ? Date.parse(zernioUpdatedAt) : NaN;
  const zernioFresh = Number.isFinite(syncedAt) && Date.now() - syncedAt < ZERNIO_FRESH_MS && zernio > 0;
  const floor = Math.max(zernio, lastKnown);
  if (rounded && scraped.count < floor && floor - scraped.count <= grain) return floor;
  if (zernioFresh && !rounded) return Math.max(zernio, scraped.count);
  if (zernioFresh && rounded && scraped.count < zernio) return zernio;
  return holdCompact(scraped.count);
}

async function main() {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
  await pool.query(SCHEMA);

  const { profiles = [] } = await zfetch("/profiles");
  let rows = 0;
  let total = 0;
  let failedProfiles = 0;
  for (const prof of profiles) {
    // One profile's fetch failing must not lose every other profile's row.
    let accounts = [];
    try {
      ({ accounts = [] } = await zfetch(`/accounts?profileId=${prof._id}`));
    } catch (e) {
      failedProfiles++;
      console.error(`  ✗ ${prof.name ?? prof._id}: ${e.message}`);
      continue;
    }
    const lastKnown = new Map();
    if (accounts.length) {
      const { rows: prevs } = await pool.query(
        `select distinct on (account_id) account_id, followers
           from follower_snapshots where account_id = any($1)
           order by account_id, snapshot_date desc`,
        [accounts.map((a) => a._id)],
      );
      for (const r of prevs) lastKnown.set(r.account_id, Number(r.followers) || 0);
    }
    for (const a of accounts) {
      const pd = a.metadata?.profileData ?? {};
      const zernio = a.followersCount ?? pd.followersCount ?? 0;
      const scraped = await scrapeFollowers(a.platform, pd.username ?? a.username);
      const followers = resolveFollowerCount(zernio, a.followersLastUpdated, scraped, lastKnown.get(a._id) ?? 0);
      if (followers !== zernio) console.log(`  ~ ${pd.username ?? a.username} (${a.platform}): zernio ${zernio} → live ${followers}`);
      else if (scraped && scraped.count !== zernio) console.log(`  = ${pd.username ?? a.username} (${a.platform}): kept zernio ${zernio} over scrape ${scraped.raw}`);
      await pool.query(
        `insert into follower_snapshots
           (snapshot_date, profile_id, profile_name, account_id, platform, username, followers, captured_at)
         values ($1,$2,$3,$4,$5,$6,$7,now())
         on conflict (snapshot_date, account_id) do update
           set followers = excluded.followers, captured_at = now(),
               profile_name = excluded.profile_name, username = excluded.username`,
        [day, prof._id, prof.name ?? null, a._id, a.platform ?? null, pd.username ?? a.username ?? null, followers],
      );
      rows++;
      total += followers;
    }
  }

  // Day-over-day movement summary for the cron log.
  const { rows: deltas } = await pool.query(
    `select t.platform, t.username, t.followers, t.followers - p.followers as delta
       from follower_snapshots t
       join lateral (
         select followers from follower_snapshots p
          where p.account_id = t.account_id and p.snapshot_date < t.snapshot_date
          order by p.snapshot_date desc limit 1
       ) p on true
      where t.snapshot_date = $1 and t.followers <> p.followers
      order by abs(t.followers - p.followers) desc limit 10`,
    [day],
  );
  for (const d of deltas) {
    console.log(`  ${d.delta > 0 ? "+" : ""}${d.delta}  ${d.username ?? "?"} (${d.platform})`);
  }

  console.log(`✓ follower snapshot ${day}: ${rows} accounts, ${total} total followers`);
  await pool.end();
  if (rows === 0) throw new Error("no accounts captured");
  if (failedProfiles) console.warn(`⚠ ${failedProfiles} profile(s) skipped — partial capture`);
}

main().catch((e) => {
  console.error(`✗ follower snapshot failed: ${e.message}`);
  process.exit(1);
});
