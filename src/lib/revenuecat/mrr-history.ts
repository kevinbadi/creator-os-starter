import "server-only";
import { dbConfigured, query } from "@/lib/insforge/db";
import { etDayKey, etDayKeys, type RevenueCatOverview } from "@/lib/revenuecat/client";

// RevenueCat's /metrics/overview is a point-in-time read with no history, so
// the header's ARR / Valuation m/m needs a stored baseline. Every Overview
// load (and the revenuecat-customers / revenuecat-subs crons) upserts today's
// overview metrics here, one row per ET day × metric. Once 30 days have
// accrued the m/m compares against the snapshot ~30 ET days back; before
// that it falls back to an estimate from `revenuecat_subscriptions` (active
// subs 30 days ago vs now, ARPU held constant) so the chip is never blank.

export const METRIC_SNAPSHOTS_SCHEMA = `create table if not exists revenuecat_metric_snapshots (
  project_id text not null,
  day text not null,
  metric_id text not null,
  value double precision not null,
  currency text,
  captured_at timestamptz not null default now(),
  primary key (project_id, day, metric_id)
)`;

let ensured: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!ensured) {
    ensured = query(METRIC_SNAPSHOTS_SCHEMA)
      .then(() => undefined)
      .catch((e) => {
        ensured = null;
        throw e;
      });
  }
  return ensured;
}

/** Upsert today's (ET) overview metrics. Fire-and-forget safe; never throws. */
export async function recordOverviewSnapshot(
  projectId: string,
  overview: RevenueCatOverview | null,
): Promise<void> {
  if (!dbConfigured || !overview?.metrics?.length) return;
  try {
    await ensureTable();
    const day = etDayKey(new Date());
    const rows = overview.metrics
      .filter((m) => typeof m.value === "number" && Number.isFinite(m.value))
      .map((m) => ({ id: m.id, value: m.value }));
    if (!rows.length) return;
    await query(
      `insert into revenuecat_metric_snapshots (project_id, day, metric_id, value, currency, captured_at)
       select $1, $2, x.id, x.value, $3, now()
         from jsonb_to_recordset($4::jsonb) as x(id text, value double precision)
       on conflict (project_id, day, metric_id) do update set
         value = excluded.value,
         currency = excluded.currency,
         captured_at = now()`,
      [projectId, day, overview.currency ?? null, JSON.stringify(rows)],
    );
  } catch (e) {
    process.stderr.write(
      `[rc-history] snapshot skipped: ${e instanceof Error ? e.message : String(e)}\n`,
    );
  }
}

export type MrrTrend = {
  /** Signed % change of live MRR vs the baseline day's stored MRR. */
  pct: number;
  /**
   * snapshot = stored MRR ≥28 ET days back (true m/m).
   * recent = stored MRR, but the history is still shorter than a month
   *   (this table only started 2026-09-22).
   * estimate = last-resort, paying-sub reconstruction — never preferred
   *   over a real snapshot; headcount lied (Kevin 2026-09-25: Creator OS
   *   showed ↓4% while live MRR went $349 → $387).
   */
  basis: "snapshot" | "recent" | "estimate";
  /** ET day the baseline came from. */
  baselineDay: string;
  /** Whole ET days from baseline → today. */
  days: number;
};

function pctChange(current: number, baseline: number): number {
  return ((current - baseline) / baseline) * 100;
}

function etDaysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00-04:00`);
  const b = Date.parse(`${to}T12:00:00-04:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

/** Newest snapshot on or before `day`, with a floor so a missed cron still hits. */
async function mrrOnOrBefore(
  projectId: string,
  day: string,
  floor: string,
): Promise<{ day: string; value: number } | null> {
  const rows = await query<{ day: string; value: number }>(
    `select day, value from revenuecat_metric_snapshots
      where project_id = $1 and metric_id = 'mrr'
        and day <= $2 and day >= $3 and value > 0
      order by day desc limit 1`,
    [projectId, day, floor],
  );
  return rows[0] ? { day: rows[0].day, value: Number(rows[0].value) } : null;
}

/** MRR change for a project. Always vs live RevenueCat MRR — never vs a
 *  stale subscription headcount. Snapshot-first; estimate only if we have
 *  no stored MRR at all. */
export async function getMrrMonthOverMonth(
  projectId: string,
  currentMrr: number,
): Promise<MrrTrend | null> {
  if (!dbConfigured || !(currentMrr > 0)) return null;
  const today = etDayKey(new Date());
  const keys = etDayKeys(41);
  const ago = (n: number) => keys[Math.max(0, keys.length - 1 - n)] ?? today;

  try {
    await ensureTable();

    // 1. True m/m: newest stored MRR from 28–40 ET days ago.
    const month = await mrrOnOrBefore(projectId, ago(28), ago(40));
    if (month) {
      return {
        pct: pctChange(currentMrr, month.value),
        basis: "snapshot",
        baselineDay: month.day,
        days: etDaysBetween(month.day, today),
      };
    }

    // 2. Accruing history (table is younger than a month): oldest stored
    //    MRR from a prior ET day vs live MRR. This is what new sales move.
    const earliest = await query<{ day: string; value: number }>(
      `select day, value from revenuecat_metric_snapshots
        where project_id = $1 and metric_id = 'mrr' and day < $2 and value > 0
        order by day asc limit 1`,
      [projectId, today],
    );
    const early = earliest[0];
    if (early && Number(early.value) > 0) {
      const days = etDaysBetween(early.day, today);
      return {
        pct: pctChange(currentMrr, Number(early.value)),
        basis: days >= 28 ? "snapshot" : "recent",
        baselineDay: early.day,
        days,
      };
    }
  } catch {
    // fall through to the estimate
  }

  // 3. Last resort: reconstruct a 30-day baseline from paying rows, then
  //    compare against LIVE currentMrr (not table "now" count — that missed
  //    new sales whose starts_at is still in the future / cron-lagged).
  try {
    const then = new Date(`${ago(30)}T12:00:00-04:00`);
    const rows = await query<{ then_n: string }>(
      `select count(*) filter (
         where coalesce(status, '') in ('active', 'trialing')
           and coalesce((raw->>'gives_access')::boolean, false)
           and starts_at is not null and starts_at <= $2
           and (current_period_ends_at is null or current_period_ends_at > $2)
       ) as then_n
       from revenuecat_subscriptions
       where project_id = $1
         and coalesce(environment, 'production') <> 'sandbox'`,
      [projectId, then],
    );
    const thenN = Number(rows[0]?.then_n ?? 0);
    const liveSubs = await query<{ value: number }>(
      `select value from revenuecat_metric_snapshots
        where project_id = $1 and metric_id = 'active_subscriptions' and day = $2
        order by captured_at desc limit 1`,
      [projectId, today],
    );
    const nowN = Number(liveSubs[0]?.value ?? 0);
    if (thenN > 0 && nowN > 0) {
      const baselineMrr = currentMrr * (thenN / nowN);
      if (baselineMrr > 0) {
        return {
          pct: pctChange(currentMrr, baselineMrr),
          basis: "estimate",
          baselineDay: ago(30),
          days: 30,
        };
      }
    }
  } catch {
    // no subscriptions table yet
  }
  return null;
}
