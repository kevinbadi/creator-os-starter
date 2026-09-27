import { PlatformBadge } from "./PlatformBadge";
import { formatNumber } from "@/lib/format";
import type { AvgViewsSummary, DayPoint } from "@/lib/analytics/post-averages";

/** Growth chip: signed % with window label, green up / red down. */
function Delta({ pct, label }: { pct: number | null; label: string }) {
  if (pct == null)
    return (
      <span className="rounded-full bg-neutral-500/10 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400">
        {label} —
      </span>
    );
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
        up
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
      }`}
    >
      {up ? "↑" : "↓"} {Math.abs(Math.round(pct))}% <span className="font-normal opacity-70">{label}</span>
    </span>
  );
}

/** 30-day growth chart: daily avg-views cohorts, area + line, min/max labeled.
 *  Y is sqrt-scaled: one viral day (e.g. a 115K-view thread cohort) used to
 *  flatten every other day onto the baseline; sqrt keeps ordering honest
 *  while the normal days stay readable. Labels show real values. */
function TrendChart({ series }: { series: DayPoint[] }) {
  const w = 560;
  const h = 72;
  const pad = 4;
  const active = series.map((p, i) => ({ ...p, i })).filter((p) => p.posts > 0);
  if (active.length < 2) return null;
  const max = Math.max(...active.map((p) => p.avg), 1);
  const step = (w - pad * 2) / (series.length - 1);
  const x = (i: number) => pad + i * step;
  const y = (v: number) => h - pad - Math.sqrt(v / max) * (h - pad * 2);
  const pts = active.map((p) => [x(p.i), y(p.avg)] as const);
  const line = pts.map(([px, py]) => `${px},${py}`).join(" ");
  const area = `${pts[0][0]},${h - pad} ${line} ${pts[pts.length - 1][0]},${h - pad}`;
  const last = active[active.length - 1];
  const [lx, ly] = pts[pts.length - 1];
  return (
    <div className="mt-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[72px] w-full" preserveAspectRatio="none" aria-hidden>
        <polygon className="fade-in" points={area} fill="#2dd4bf" opacity="0.12" />
        <polyline className="draw" pathLength={1} points={line} fill="none" stroke="#2dd4bf" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
        {/* Only the latest point gets a marker — 30 dots stretched by
            preserveAspectRatio="none" rendered as smeared ellipses. */}
        <circle className="fade-in" cx={lx} cy={ly} r="2.5" fill="#2dd4bf" />
      </svg>
      <div className="flex justify-between text-[9px] text-neutral-400 tabular-nums">
        <span>{series[0]?.date.slice(5)}</span>
        <span>
          peak {formatNumber(Math.round(max))} · latest {formatNumber(Math.round(last.avg))} avg/post
        </span>
        <span>{series[series.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

/** Daily avg-views line; days with no posts are skipped, not drawn as 0. */
function Sparkline({ series }: { series: DayPoint[] }) {
  const w = 112;
  const h = 30;
  const pad = 3;
  const active = series
    .map((p, i) => ({ ...p, i }))
    .filter((p) => p.posts > 0);
  if (active.length < 2) {
    return <span className="text-[10px] text-neutral-400">not enough days</span>;
  }
  const max = Math.max(...active.map((p) => p.avg), 1);
  const step = (w - pad * 2) / (series.length - 1);
  // sqrt scale — same outlier treatment as the big TrendChart.
  const pts = active.map(
    (p) => [pad + p.i * step, h - pad - Math.sqrt(p.avg / max) * (h - pad * 2)] as const,
  );
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} aria-hidden className="shrink-0">
      <polyline className="draw" pathLength={1}
        points={pts.map(([x, y]) => `${x},${y}`).join(" ")}
        fill="none"
        stroke="#2dd4bf"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill="#2dd4bf" />
    </svg>
  );
}

/**
 * Per-platform "avg views per post" trend — is our content getting better
 * where it counts? Rows sorted by total views; sparkline = nightly snapshot
 * avg (14 days), delta = today's snapshot vs 7 / 30 days ago.
 */
export function AvgViewsPerPost({ data, wide = false }: { data: AvgViewsSummary; wide?: boolean }) {
  if (!data.posts) return null;
  return (
    <div className="card">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="card-title">Avg views per post</h2>
          <p className="num mt-2 font-serif text-[30px] leading-none tracking-tight">
            {formatNumber(Math.round(data.avg))}
            <span className="ml-2 font-sans text-xs not-italic text-neutral-400">
              this month · {data.posts} posts
            </span>
          </p>
        </div>
        {/* Growth: tonight's snapshot vs 7 days ago and 30 days ago. */}
        <div className="flex shrink-0 items-center gap-1">
          <Delta pct={data.delta7Pct} label="7d" />
          <Delta pct={data.deltaPct} label="m/m" />
        </div>
      </div>

      <TrendChart series={data.trendSeries} />

      <div
        className={
          wide
            ? "mt-3 grid gap-x-10 lg:grid-cols-2 [&>div]:border-t [&>div]:border-black/[.05] dark:[&>div]:border-white/[.06]"
            : "mt-3 divide-y divide-black/[.05] dark:divide-white/[.06]"
        }
      >
        {data.platforms.map((p) => (
          <div key={p.platform} className="py-2">
            <div className="flex items-center gap-3">
              <div className="w-32 shrink-0">
                <PlatformBadge platform={p.platform} />
                <p className="mt-0.5 text-[10px] text-neutral-400 tabular-nums">
                  {p.posts} post{p.posts === 1 ? "" : "s"}
                </p>
              </div>
              <div className="min-w-0 flex-1">
                {/* With an account split below, per-account lines carry the
                    trend — a header sparkline would read as a phantom fourth
                    account. Single-account platforms keep it (only chart). */}
                {p.accounts.length > 1 ? null : <Sparkline series={p.series} />}
              </div>
              <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums">
                {formatNumber(Math.round(p.avg))}
              </span>
            </div>
            {/* Account split — only worth showing once a platform has 2+ accounts. */}
            {p.accounts.length > 1
              ? p.accounts.map((a) => (
                  <div
                    key={a.username ?? "(unattributed)"}
                    className="mt-1 flex items-center gap-3 pl-4"
                  >
                    <div className="w-28 shrink-0">
                      <p className="truncate text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
                        {a.username ? `@${a.username}` : "(unattributed)"}
                      </p>
                      <p className="text-[10px] text-neutral-400 tabular-nums">
                        {a.posts} post{a.posts === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1 opacity-70">
                      <Sparkline series={a.series} />
                    </div>
                    <span className="shrink-0">
                      <Delta pct={a.delta7Pct} label="7d" />
                    </span>
                    <span className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-neutral-600 dark:text-neutral-300">
                      {formatNumber(Math.round(a.avg))}
                    </span>
                  </div>
                ))
              : null}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-neutral-400">
        Headline: this month&apos;s views ÷ this month&apos;s posts ·
        m/m: same dates last month (not a partial vs a full month) ·
        chart: nightly all-time avg/post, last 30 days, sqrt-scaled
      </p>
    </div>
  );
}
