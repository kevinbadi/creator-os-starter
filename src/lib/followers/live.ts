import "server-only";
import type { ZernioAccount } from "@/lib/zernio/types";

// Live follower counts scraped from public profile pages. Zernio only
// re-syncs followersCount once a day (~midnight ET) and its Threads counts
// are permanently 0, so the Overview chips looked frozen all day. Meta and
// TikTok serve full OpenGraph meta (with follower counts) to link-preview
// crawler user-agents, which is what we fetch here — no login, no tokens.
//
// Precision: crawler pages round big counts ("12.4k"), Zernio is exact
// (12414). When Zernio's number rounds to the same compact string we keep
// Zernio's; a real divergence means Zernio is stale and the scrape wins.

const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type Scrape = { url: (u: string) => string; ua: string; pattern: (u: string) => RegExp };

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// X, LinkedIn and Facebook hard-wall even crawler UAs — Zernio stays the
// source for those.
const SCRAPERS: Record<string, Scrape> = {
  threads: {
    url: (u) => `https://www.threads.com/@${u}`,
    ua: CRAWLER_UA,
    pattern: () => /content="([\d.,KkMm]+)\s+Followers?/i,
  },
  instagram: {
    url: (u) => `https://www.instagram.com/${u}/`,
    ua: CRAWLER_UA,
    pattern: () => /content="([\d.,KkMm]+)\s+Followers?/i,
  },
  tiktok: {
    url: (u) => `https://www.tiktok.com/@${u}`,
    ua: CRAWLER_UA,
    pattern: () => /([\d.,KkMm]+)\s+Followers?/i,
  },
  youtube: {
    // The channel page embeds OTHER channels' subscriber counts (featured
    // shelf, video rows) before its own — anchor the match to the handle
    // with a word boundary so @kevbuildsapps does not eat @kevbuildsapps2.
    // YouTube wraps the count in bidi isolates: "@KevBuildsApps⁩ • ⁨29.9K subscribers".
    url: (u) => `https://www.youtube.com/@${u}`,
    ua: BROWSER_UA,
    pattern: (u) =>
      new RegExp(
        `@${reEscape(u)}(?![\\w.])[^\\d"]{0,40}?([\\d.,]+\\s*[KkMm]?)\\s+subscribers`,
        "i",
      ),
  },
};

/** "12.4k" → 12400; "1,234" → 1234; plain ints pass through. */
function parseCompact(raw: string): number | null {
  const m = raw.replace(/,/g, "").match(/^([\d.]+)([KkMm])?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.round(m[2] ? n * (m[2].toLowerCase() === "k" ? 1e3 : 1e6) : n);
}

/** Step size of a public compact label: "29.9K" → 100, "129K" → 1000, "1.2M" → 100000. */
export function compactGrainFromRaw(raw: string): number {
  const unit = /m/i.test(raw) ? 1e6 : /k/i.test(raw) ? 1e3 : 1;
  if (unit === 1) return 1;
  const decimals = (raw.replace(/,/g, "").split(".")[1] ?? "").replace(/\D/g, "").length;
  return unit / 10 ** decimals;
}

/** Grain YouTube/TikTok/IG use for a count this size when they only publish "29.9K". */
export function compactDisplayGrain(n: number): number {
  const a = Math.abs(n);
  if (a >= 1_000_000) return 100_000;
  if (a >= 100_000) return 1_000;
  if (a >= 10_000) return 100;
  if (a >= 1_000) return 100;
  return 1;
}

/** True when `to` is only one public-label step below `from` (29.9K → 29.8K). */
export function isCompactGrainDrop(from: number, to: number): boolean {
  if (!(from > to) || to <= 0) return false;
  const grain = compactDisplayGrain(from);
  if (grain <= 1) return false;
  if (from % grain !== 0 || to % grain !== 0) return false;
  return from - to <= grain;
}

/** Would `exact` render as the same compact string the crawler page showed? */
function compactMatches(exact: number, raw: string): boolean {
  const unit = /m/i.test(raw) ? 1e6 : /k/i.test(raw) ? 1e3 : 1;
  if (unit === 1) return exact === parseCompact(raw);
  const decimals = (raw.replace(/,/g, "").split(".")[1] ?? "").replace(/\D/g, "").length;
  const rendered = (exact / unit).toFixed(decimals);
  return parseFloat(rendered) === parseFloat(raw.replace(/,/g, "").replace(/[KkMm]/, ""));
}

/**
 * Scrape one account's live follower count. Cached 15 min via the Next fetch
 * cache; null on any failure (caller falls back to Zernio's count).
 */
async function scrapeFollowers(platform: string, username: string): Promise<{ count: number; raw: string } | null> {
  const s = SCRAPERS[platform];
  if (!s) return null;
  try {
    const res = await fetch(s.url(username), {
      headers: { "User-Agent": s.ua, "Accept-Language": "en-US,en;q=0.9" },
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(s.pattern(username));
    if (!m) return null;
    const count = parseCompact(m[1]);
    return count == null ? null : { count, raw: m[1] };
  } catch {
    return null;
  }
}

const ZERNIO_FRESH_MS = 26 * 60 * 60 * 1000;

/**
 * Pick the count to show given Zernio's nightly API figure and a public-page
 * scrape. Zernio re-syncs every account ~midnight ET from the platform API
 * (exact, authoritative); crawler pages are live but Meta caches their
 * preview meta for hours (2026-09-11: IG page said 2,048 while the API had
 * 2,156 since midnight) and round big counts.
 *   - rounded scrape that agrees with Zernio → keep Zernio's exact figure
 *   - Zernio synced within a day and both exact → the higher one (the lagging
 *     source is always the lower one on a growing account; a real drop lands
 *     at the next nightly sync)
 *   - Zernio older than a day → the scrape wins outright
 */
export function resolveFollowerCount(
  zernio: number,
  zernioUpdatedAt: string | undefined,
  scraped: { count: number; raw: string } | null,
  lastKnown = 0,
): number {
  const holdCompact = (n: number) =>
    lastKnown > 0 && isCompactGrainDrop(lastKnown, n) ? lastKnown : n;

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

/**
 * Freshest follower count per account id: live scrape where the platform
 * allows it, reconciled against Zernio's nightly sync by resolveFollowerCount.
 */
export async function freshFollowerCounts(
  accounts: ZernioAccount[],
  lastKnown?: Map<string, number>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  await Promise.allSettled(
    accounts.map(async (a) => {
      const pd = a.metadata?.profileData;
      const username = pd?.username ?? a.username;
      const zernio = a.followersCount ?? pd?.followersCount ?? 0;
      if (!username) return;
      const scraped = await scrapeFollowers(a.platform, username);
      const resolved = resolveFollowerCount(
        zernio,
        a.followersLastUpdated,
        scraped,
        lastKnown?.get(a._id) ?? 0,
      );
      if (resolved !== zernio) out.set(a._id, resolved);
    }),
  );
  return out;
}

/** Accounts with followersCount replaced by the freshest known value. */
export async function withFreshFollowers(
  accounts: ZernioAccount[],
  lastKnown?: Map<string, number>,
): Promise<ZernioAccount[]> {
  const fresh = await freshFollowerCounts(accounts, lastKnown);
  if (!fresh.size) return accounts;
  return accounts.map((a) =>
    fresh.has(a._id) ? { ...a, followersCount: fresh.get(a._id) } : a,
  );
}
