import { formatNumber } from "@/lib/format";
import { HeatmapGrid, type HeatmapColumn } from "@/components/HeatmapGrid";
import { PALETTES, type HeatmapPalette } from "@/components/heatmap-colors";

// GitHub-style calendar heatmap. Buckets `entries` by day (summing `value`)
// over the last N weeks. The grid is computed here (server) so dates are
// stable; hover interactivity lives in <HeatmapGrid>.

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export type HeatmapEntry = {
  date?: string | null;
  value: number;
  /** Who/where this entry came from (e.g. "Megan · TikTok") — shown as a per-day breakdown in the tooltip. */
  label?: string;
};

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function CalendarHeatmap({
  entries,
  title,
  unit,
  weeks = 27,
  range = "trailing",
  cell = 11,
  className = "",
  palette = "green",
  headline,
}: {
  entries: HeatmapEntry[];
  title: string;
  unit: string;
  weeks?: number;
  /** "trailing" = last N weeks ending today; "year" = full calendar year (incl. future). */
  range?: "trailing" | "year";
  cell?: number;
  className?: string;
  /** Color ramp — "green" for activity, "teal" for views/analytics. */
  palette?: HeatmapPalette;
  /** Optional rich header content (big totals, platform chips) above the grid. */
  headline?: React.ReactNode;
}) {
  const byDay = new Map<string, number>();
  const byDayLabels = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (!e.date || !e.value) continue;
    const d = new Date(e.date);
    if (Number.isNaN(d.getTime())) continue;
    const k = dayKey(d);
    byDay.set(k, (byDay.get(k) ?? 0) + e.value);
    if (e.label) {
      const labels = byDayLabels.get(k) ?? new Map<string, number>();
      labels.set(e.label, (labels.get(e.label) ?? 0) + e.value);
      byDayLabels.set(k, labels);
    }
  }

  // Tooltip breakdown lines for a day, biggest contributor first.
  const detailFor = (k: string): string[] | undefined => {
    const labels = byDayLabels.get(k);
    if (!labels) return undefined;
    return Array.from(labels.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, n]) => (n > 1 ? `${label} ×${n}` : label));
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let start: Date;
  let end: Date;
  if (range === "year") {
    const y = today.getFullYear();
    start = new Date(y, 0, 1);
    end = new Date(y, 11, 31);
  } else {
    end = new Date(today);
    start = new Date(today);
    start.setDate(start.getDate() - (weeks * 7 - 1));
  }
  start.setDate(start.getDate() - start.getDay()); // align to Sunday
  end.setDate(end.getDate() + (6 - end.getDay())); // extend to Saturday

  const days: { key: string; date: Date; value: number }[] = [];
  for (
    const cursor = new Date(start);
    cursor <= end;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const k = dayKey(cursor);
    days.push({ key: k, date: new Date(cursor), value: byDay.get(k) ?? 0 });
  }

  const max = Math.max(0, ...days.map((d) => d.value));
  const level = (v: number): number => {
    if (v <= 0 || max <= 0) return 0;
    const r = v / max;
    if (r > 0.66) return 4;
    if (r > 0.33) return 3;
    if (r > 0.1) return 2;
    return 1;
  };

  const columns: HeatmapColumn[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const slice = days.slice(i, i + 7);
    const m = slice[0].date.getMonth();
    const prevM = i > 0 ? days[i - 7].date.getMonth() : -1;
    columns.push({
      month: m !== prevM ? MONTHS[m] : "",
      cells: slice.map((d) => ({
        key: d.key,
        value: d.value,
        level: level(d.value),
        label: d.date.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        detail: detailFor(d.key),
      })),
    });
  }

  const total = days.reduce((s, d) => s + d.value, 0);

  return (
    <div
      className={`rounded-2xl border border-black/[.08] bg-white p-4 dark:border-white/[.14] dark:bg-[var(--surface-1)] ${className}`}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="text-xs text-neutral-500">
          {formatNumber(total)} {unit}
        </span>
      </div>

      {headline ? <div className="mt-3">{headline}</div> : null}

      <div className="mt-3">
        <HeatmapGrid columns={columns} unit={unit} cell={cell} levelClasses={PALETTES[palette]} />
      </div>

      <div className="mt-2.5 flex items-center justify-end gap-[3px] text-[10px] text-neutral-400">
        <span className="mr-1">Less</span>
        {PALETTES[palette].map((cls, i) => (
          <span key={i} className={`size-[11px] rounded-[3px] ${cls}`} />
        ))}
        <span className="ml-1">More</span>
      </div>
    </div>
  );
}
