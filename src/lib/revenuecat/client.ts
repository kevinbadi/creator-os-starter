import "server-only";
import { dbConfigured, query } from "@/lib/insforge/db";

// RevenueCat v2 REST client (server-only). Uses a Secret API key.
// Docs surface: /v2/projects, /v2/projects/{id}/metrics/overview

const BASE = process.env.REVENUECAT_BASE_URL ?? "https://api.revenuecat.com";
const KEY = process.env.REVENUECAT_API_KEY ?? "";

export const revenueCatConfigured = Boolean(KEY);

export type RevenueCatMetric = {
  id: string; // e.g. "active_subscriptions", "mrr", "new_customers"
  name: string; // human label from the API
  description: string; // e.g. "Last 28 days"
  unit: string; // "$" | "#"
  value: number;
  period: string; // ISO-8601 duration, e.g. "P28D"
};

export type RevenueCatOverview = {
  currency: string;
  metrics: RevenueCatMetric[];
};

async function rcFetch<T>(path: string, apiKey?: string): Promise<T> {
  const key = apiKey || KEY;
  if (!key) throw new Error("REVENUECAT_API_KEY is not set");
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`RevenueCat ${res.status}: ${body.slice(0, 200) || res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function getOverviewMetrics(
  projectId: string,
  apiKey?: string,
): Promise<RevenueCatOverview> {
  return rcFetch<RevenueCatOverview>(
    `/v2/projects/${encodeURIComponent(projectId)}/metrics/overview`,
    apiKey,
  );
}

export type DailyCount = { date: string; count: number };

type CustomerPage = {
  items: { first_seen_at: number }[];
  next_page: string | null;
};

/** ET calendar day (YYYY-MM-DD) — Creator OS convention; aligns RC bars with
 *  PostHog visitors and the rest of the Overview (Kevin 2026-09-16: UTC
 *  bucketing made the New Customers chart drift a day vs traffic). */
export function etDayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

/** @deprecated use etDayKey — kept as alias so older call sites keep compiling. */
export function dayKey(d: Date): string {
  return etDayKey(d);
}

/** Last `n` ET calendar dates ascending (oldest → today ET). */
export function etDayKeys(n: number): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (let h = 0; ordered.length < n && h < n * 48; h++) {
    const k = fmt.format(new Date(Date.now() - h * 3600_000));
    if (!seen.has(k)) {
      seen.add(k);
      ordered.push(k);
    }
  }
  return ordered.reverse();
}

/** Contiguous ET-day series filled from a sparse date→count map. */
export function fillEtDailyCounts(
  byDay: Map<string, number>,
  days: number,
): DailyCount[] {
  return etDayKeys(days).map((date) => ({ date, count: byDay.get(date) ?? 0 }));
}

/** Total customers (≈ total downloads) for a project, all-time. */
export async function getTotalCustomers(
  projectId: string,
  apiKey?: string,
): Promise<number> {
  let url: string | null = `/v2/projects/${encodeURIComponent(
    projectId,
  )}/customers?limit=1000`;
  let count = 0;
  let guard = 0;
  while (url && guard++ < 25) {
    const page: CustomerPage = await rcFetch<CustomerPage>(url, apiKey);
    count += (page.items ?? []).length;
    url = page.next_page;
  }
  return count;
}

/** New customers added per day for the last `days` ET days, derived from each
 *  customer's first_seen_at (RevenueCat has no daily-series endpoint).
 *
 *  Table-first: `revenuecat_customers` is kept full by the revenuecat-customers
 *  / revenuecat-subs crons, so the series is complete in one query. A short
 *  live top-up then walks the newest customer pages and upserts anyone the
 *  table doesn't know yet. Buckets in America/New_York so bars line up with
 *  PostHog visitors on the same chart (Kevin 2026-09-16). */
export async function getNewCustomersDaily(
  projectId: string,
  days = 30,
  apiKey?: string,
): Promise<DailyCount[]> {
  const seen = new Map<string, number>();
  let tableKnown = false;
  if (dbConfigured) {
    try {
      const rows = await query<{ customer_id: string; first_seen_at: Date | null }>(
        `select customer_id, first_seen_at from revenuecat_customers where project_id = $1`,
        [projectId],
      );
      for (const r of rows) {
        if (r.first_seen_at) seen.set(r.customer_id, new Date(r.first_seen_at).getTime());
      }
      tableKnown = rows.length > 0;
    } catch {
      // table appears with the first sweep — fall through to the live walk
    }
  }

  // Live top-up: with a full table only the newest page(s) matter, so the
  // budget is short; with an empty table (first run) walk as far as 3.5s
  // allows, as before.
  const budgetMs = tableKnown ? 1500 : 3500;
  const fresh: { id: string; ts: number }[] = [];
  let url: string | null = `/v2/projects/${encodeURIComponent(
    projectId,
  )}/customers?limit=1000`;
  let guard = 0;
  const started = Date.now();
  try {
    while (url && guard++ < 25) {
      if (Date.now() - started > budgetMs) break;
      const page: { items: { id: string; first_seen_at: number }[]; next_page: string | null } =
        await rcFetch(url, apiKey);
      let unknown = 0;
      for (const c of page.items ?? []) {
        if (!seen.has(c.id)) {
          unknown++;
          seen.set(c.id, c.first_seen_at);
          fresh.push({ id: c.id, ts: c.first_seen_at });
        }
      }
      // A page the table already knows entirely means the rest is known too.
      if (tableKnown && unknown === 0) break;
      url = page.next_page;
    }
  } catch {
    // best-effort — the table series still renders
  }
  if (dbConfigured && fresh.length) {
    query(
      `insert into revenuecat_customers (project_id, customer_id, first_seen_at, synced_at)
       select $1, x.id, x.ts, now() from jsonb_to_recordset($2::jsonb) as x(id text, ts timestamptz)
       on conflict (project_id, customer_id) do nothing`,
      [projectId, JSON.stringify(fresh.map((f) => ({ id: f.id, ts: new Date(f.ts).toISOString() })))],
    ).catch(() => {});
  }

  const byDay = new Map<string, number>();
  for (const ts of seen.values()) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) continue;
    const k = etDayKey(d);
    byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }

  return fillEtDailyCounts(byDay, days);
}
