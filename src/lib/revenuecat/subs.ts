import "server-only";
import { dbConfigured, query } from "@/lib/insforge/db";
import { etDayKey, fillEtDailyCounts, type DailyCount } from "@/lib/revenuecat/client";

const RC_BASE = process.env.REVENUECAT_BASE_URL || "https://api.revenuecat.com";

// Same fetch shape as the proven client.ts rcFetch — passing an
// AbortSignal.timeout here made Next 16's patched fetch fail instantly
// ("fetch failed") while plain options work. cache:"no-store" because a
// cached customers list would hide the very sub we're looking for.
async function rcGet(path: string, key: string): Promise<Record<string, unknown>> {
  // next_page arrives as an ABSOLUTE url — prepending RC_BASE to it produced
  // "api.revenuecat.comhttps" (the 07-14 "fetch failed" bug).
  const res = await fetch(path.startsWith("http") ? path : `${RC_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`RevenueCat ${path} → ${res.status}`);
  return res.json();
}

const toTs = (v: unknown): Date | null =>
  v == null ? null : typeof v === "number" ? new Date(v) : new Date(String(v));

// Live top-up between cron sweeps (Kevin 2026-07-14: a new sub didn't show
// until the next 9/21 ET sweep). One customers-list call finds customers the
// table doesn't know yet (plus anyone first seen in the last 3 days, who may
// have subscribed after their sweep), then fetches subscriptions for just
// that handful and upserts — so the chart is live without the 4-minute
// full fan-out. Cooldown keeps refreshes from hammering the API.
const liveCheckedAt = new Map<string, number>();
const LIVE_COOLDOWN_MS = 90_000;

async function liveTopUp(projectId: string, apiKey?: string | null): Promise<void> {
  const key = apiKey || process.env.REVENUECAT_API_KEY;
  if (!key) {
    console.warn("[rc-live] no RevenueCat API key — top-up skipped");
    return;
  }
  const last = liveCheckedAt.get(projectId) ?? 0;
  if (Date.now() - last < LIVE_COOLDOWN_MS) return;

  const known = new Set(
    (
      await query<{ customer_id: string }>(
        `select distinct customer_id from revenuecat_subscriptions where project_id = $1`,
        [projectId],
      )
    ).map((r) => r.customer_id),
  );
  const chan = await query<{ id: string }>(
    `select id from channels where revenuecat_project_id = $1 limit 1`,
    [projectId],
  );
  const channelId = chan[0]?.id ?? "unknown";

  const customers: { id: string; first_seen_at?: number }[] = [];
  let url: string | null = `/v2/projects/${encodeURIComponent(projectId)}/customers?limit=1000`;
  let guard = 0;
  while (url && guard++ < 3) {
    const page = (await rcGet(url, key)) as {
      items?: { id: string; first_seen_at?: number }[];
      next_page?: string | null;
    };
    customers.push(...(page.items ?? []));
    url = page.next_page ?? null;
  }

  const recentCutoff = Date.now() - 3 * 86_400_000;
  // Most customers never subscribe, so "not in the table" alone matches
  // nearly everyone — newest-first ordering guarantees the render budget is
  // spent on the customers who can actually be the missing new sub.
  const candidates = customers
    .filter((c) => !known.has(c.id) || (c.first_seen_at ?? 0) >= recentCutoff)
    .sort((a, b) => (b.first_seen_at ?? 0) - (a.first_seen_at ?? 0))
    .slice(0, 12); // page-render budget; the cron sweep covers the long tail

  // All candidates concurrently — 12 burst GETs sit well under the 60/min
  // limit and cut the whole pass to ~1s so the page render barely notices.
  await Promise.all(
    candidates.map(async (c) => {
      try {
        const page = (await rcGet(
          `/v2/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(c.id)}/subscriptions?limit=100`,
          key,
        )) as { items?: Record<string, unknown>[] };
        for (const s of page.items ?? []) {
          await query(
            `insert into revenuecat_subscriptions
               (id, channel_id, project_id, customer_id, product_id, status, environment, starts_at, current_period_ends_at, raw, synced_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
             on conflict (id) do update set
               status = excluded.status,
               current_period_ends_at = excluded.current_period_ends_at,
               raw = excluded.raw,
               synced_at = now()`,
            [
              s.id, channelId, projectId, c.id,
              s.product_id ?? null, s.status ?? null, s.environment ?? null,
              toTs(s.starts_at), toTs(s.current_period_ends_at),
              JSON.stringify(s),
            ],
          );
        }
      } catch (e) {
        console.warn(`[rc-live] customer ${c.id.slice(0, 12)}: ${e instanceof Error ? e.message : e}`);
      }
    }),
  );
  // Cooldown only sticks after a full pass — a transient RC error must not
  // open a dead window right when a sub lands.
  liveCheckedAt.set(projectId, Date.now());
  console.log(`[rc-live] ${projectId}: checked ${candidates.length} candidates`);
}

const IOS_STORES = new Set(["app_store", "play_store", "mac_app_store", "amazon"]);
const WEB_STORES = new Set(["rc_billing", "stripe", "paddle", "promotional"]);

/** iOS + web subscriber series in one pass (first sub per customer, by store). */
export async function getNewSubscribersDailySplit(
  projectId: string,
  days = 30,
  apiKey?: string | null,
): Promise<{ ios: DailyCount[]; web: DailyCount[] }> {
  const empty = {
    ios: fillEtDailyCounts(new Map(), days),
    web: fillEtDailyCounts(new Map(), days),
  };
  if (!dbConfigured) return empty;
  try {
    await Promise.race([
      liveTopUp(projectId, apiKey).catch((e: unknown) => {
        console.warn(`[rc-live] top-up failed: ${e instanceof Error ? e.message : e}`);
      }),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch {
    /* best-effort */
  }

  let rows: { starts_at: Date; store: string | null }[] = [];
  try {
    // DISTINCT ON picks the store of the earliest subscription — not
    // lexicographic min(store), which mis-bucketed multi-store customers.
    rows = await query<{ starts_at: Date; store: string | null }>(
      `select distinct on (customer_id)
              starts_at,
              coalesce(raw->>'store', '') as store
         from revenuecat_subscriptions
        where project_id = $1
          and starts_at is not null
          and coalesce(environment, 'production') <> 'sandbox'
        order by customer_id, starts_at asc`,
      [projectId],
    );
  } catch {
    return empty;
  }

  const iosByDay = new Map<string, number>();
  const webByDay = new Map<string, number>();
  for (const r of rows) {
    const d = new Date(r.starts_at);
    if (Number.isNaN(d.getTime())) continue;
    const k = etDayKey(d);
    const store = (r.store ?? "").toLowerCase();
    if (IOS_STORES.has(store)) {
      iosByDay.set(k, (iosByDay.get(k) ?? 0) + 1);
    } else if (WEB_STORES.has(store)) {
      webByDay.set(k, (webByDay.get(k) ?? 0) + 1);
    }
  }

  return {
    ios: fillEtDailyCounts(iosByDay, days),
    web: fillEtDailyCounts(webByDay, days),
  };
}

/** Combined new-subscriber series (all stores). */
export async function getNewSubscribersDaily(
  projectId: string,
  days = 30,
  apiKey?: string | null,
): Promise<DailyCount[]> {
  const { ios, web } = await getNewSubscribersDailySplit(projectId, days, apiKey);
  const byDay = new Map<string, number>();
  for (const d of ios) byDay.set(d.date, (byDay.get(d.date) ?? 0) + d.count);
  for (const d of web) byDay.set(d.date, (byDay.get(d.date) ?? 0) + d.count);
  return fillEtDailyCounts(byDay, days);
}
