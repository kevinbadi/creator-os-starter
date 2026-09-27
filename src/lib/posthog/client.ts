import "server-only";
import { dbConfigured, query } from "@/lib/insforge/db";

export type DailyVisitors = {
  date: string; // YYYY-MM-DD (ET)
  visitors: number;
  pageviews: number;
  sessions: number;
};

const liveCheckedAt = new Map<string, number>();
const LIVE_COOLDOWN_MS = 90_000;

/** Live top-up for today's row (Kevin 2026-07-15: header must be current
 *  between the 9/21 cron sweeps). One HogQL query for today's ET pageviews /
 *  visitors / sessions, upserted into web_analytics_snapshots. Best-effort +
 *  time-boxed by the caller; falls back to the cron-fed rows. */
async function liveTopUp(
  projectId: string,
  host: string,
  channelId: string,
  apiKey?: string | null,
): Promise<void> {
  const key = apiKey || process.env.POSTHOG_API_KEY;
  if (!key) return;
  const last = liveCheckedAt.get(projectId) ?? 0;
  if (Date.now() - last < LIVE_COOLDOWN_MS) return;

  // "Today" must be the ET day — both sides of the comparison in ET.
  // today() evaluates in UTC, so after ~8pm ET (past midnight UTC) it rolls
  // to tomorrow while visits are still bucketed under the ET date → the query
  // returned 0 every evening (Kevin 2026-07-15: "visitor tracking at 0 again").
  const hogql = `
    SELECT
      count() AS pageviews,
      count(DISTINCT person_id) AS visitors,
      count(DISTINCT properties.$session_id) AS sessions
    FROM events
    WHERE event = '$pageview'
      AND toDate(toTimeZone(timestamp, 'America/New_York')) = toDate(toTimeZone(now(), 'America/New_York'))`;
  const res = await fetch(`${host}/api/projects/${projectId}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: hogql } }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PostHog query → ${res.status}`);
  const json = (await res.json()) as { results?: [number, number, number][] };
  const row = json.results?.[0] ?? [0, 0, 0];
  const [pageviews, visitors, sessions] = row.map((n) => Number(n) || 0);
  const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  await query(
    `insert into web_analytics_snapshots
       (snapshot_date, channel_id, project_id, visitors, pageviews, sessions, captured_at)
     values ($1,$2,$3,$4,$5,$6, now())
     on conflict (snapshot_date, channel_id) do update set
       visitors = excluded.visitors,
       pageviews = excluded.pageviews,
       sessions = excluded.sessions,
       captured_at = now()`,
    [todayEt, channelId, projectId, visitors, pageviews, sessions],
  );
  liveCheckedAt.set(projectId, Date.now());
}

/** Daily website-visitor series for the last `days` ET days, read from the
 *  cron-fed `web_analytics_snapshots` table plus a live top-up for today.
 *  Empty until the PostHog snippet is live and traffic arrives. */
export async function getWebVisitorsDaily(
  channelId: string,
  projectId: string,
  host: string,
  days = 30,
  apiKey?: string | null,
): Promise<DailyVisitors[]> {
  if (!dbConfigured) return [];
  try {
    await Promise.race([
      liveTopUp(projectId, host, channelId, apiKey),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch {
    // best-effort — table still renders
  }

  const rows = await query<{
    snapshot_date: Date | string;
    visitors: number;
    pageviews: number;
    sessions: number;
  }>(
    `select snapshot_date, visitors, pageviews, sessions
       from web_analytics_snapshots
      where channel_id = $1
        and snapshot_date >= (current_date - ($2::int - 1))
      order by snapshot_date`,
    [channelId, days],
  ).catch(() => []);

  const key = (d: Date | string) =>
    typeof d === "string" ? d.slice(0, 10) : new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(d);
  return rows.map((r) => ({
    date: key(r.snapshot_date),
    visitors: r.visitors ?? 0,
    pageviews: r.pageviews ?? 0,
    sessions: r.sessions ?? 0,
  }));
}
