"use client";

import { useMemo, useState } from "react";
import { PALETTES, type HeatmapPalette } from "./heatmap-colors";
import { bestMonthFromDaily, formatNumber } from "@/lib/format";

export type MonthlyEntry = {
  date?: string | null;
  value: number;
  /** Who/where (e.g. "@megan.creatoros · TikTok") — listed in the day panel. */
  label?: string;
};

type DayCell = {
  day: number;
  key: string;
  value: number;
  breakdown: { label: string; n: number }[];
  inMonth: boolean;
  isToday: boolean;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CELL_NUM_OUTLINE = {
  textShadow:
    "-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, -2px 0 0 #000, 2px 0 0 #000, 0 -2px 0 #000, 0 2px 0 #000, 0 2px 3px rgba(0,0,0,.5)",
} as const;

/** Compact in-cell number: 999 → 999, 4231 → 4.2k, 228877 → 229k. */
function compact(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Month-grid heatmap for the content calendar: big day cells colored by
 * activity, ← → month navigation, and a full per-account breakdown for the
 * hovered/selected day — the roomy replacement for the year-strip heatmap.
 */
export function MonthlyCalendar({
  entries,
  title,
  unit,
  palette = "green",
  headline,
}: {
  entries: MonthlyEntry[];
  title: string;
  unit: string;
  palette?: HeatmapPalette;
  /** Optional rich header content (big totals, platform chips) above the grid. */
  headline?: React.ReactNode;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-based
  const [focus, setFocus] = useState<string | null>(null); // day key

  const { cells, monthTotal, monthMax } = useMemo(() => {
    const byDay = new Map<string, { value: number; labels: Map<string, number> }>();
    for (const e of entries) {
      if (!e.date || !e.value) continue;
      const d = new Date(e.date);
      if (Number.isNaN(d.getTime())) continue;
      const k = dayKey(d);
      const cur = byDay.get(k) ?? { value: 0, labels: new Map<string, number>() };
      cur.value += e.value;
      if (e.label) cur.labels.set(e.label, (cur.labels.get(e.label) ?? 0) + e.value);
      byDay.set(k, cur);
    }

    const first = new Date(year, month, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay()); // back to Sunday
    const todayKey = dayKey(new Date());

    const cells: DayCell[] = [];
    let monthTotal = 0;
    let monthMax = 0;
    const cursor = new Date(start);
    // Only the weeks this month needs (5 or 6): a permanent 6th row was a
    // band of empty cells on most months (2026-09-14).
    const lastDay = new Date(year, month + 1, 0);
    const weeksNeeded = Math.ceil((first.getDay() + lastDay.getDate()) / 7);
    for (let i = 0; i < weeksNeeded * 7; i++) {
      const k = dayKey(cursor);
      const rec = byDay.get(k);
      const inMonth = cursor.getMonth() === month;
      const value = rec?.value ?? 0;
      if (inMonth) {
        monthTotal += value;
        monthMax = Math.max(monthMax, value);
      }
      cells.push({
        day: cursor.getDate(),
        key: k,
        value,
        breakdown: rec
          ? [...rec.labels.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([label, n]) => ({ label, n }))
          : [],
        inMonth,
        isToday: k === todayKey,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return { cells, monthTotal, monthMax };
  }, [entries, year, month]);

  const bestMonth = useMemo(
    () => bestMonthFromDaily(entries.map((e) => ({ date: e.date, value: e.value }))),
    [entries],
  );

  const level = (v: number): number => {
    if (v <= 0 || monthMax <= 0) return 0;
    const r = v / monthMax;
    if (r > 0.75) return 4;
    if (r > 0.5) return 3;
    if (r > 0.25) return 2;
    return 1;
  };

  const nav = (dir: 1 | -1) => {
    const d = new Date(year, month + dir, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setFocus(null);
  };

  const monthLabel = new Date(year, month, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const focused = focus ? cells.find((c) => c.key === focus) : null;
  const classes = PALETTES[palette];

  return (
    <div className="card">
      {/* Header: title + month nav */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="card-title">{title}</h2>
          {bestMonth ? (
            <p className="mt-1.5 text-[13px] leading-snug text-neutral-500 dark:text-[#a8adb6]">
              Best month so far ·{" "}
              <span className="font-semibold text-neutral-800 dark:text-neutral-100">
                {bestMonth.label}
              </span>
              <span className="font-semibold tabular-nums text-neutral-800 dark:text-neutral-100">
                {" "}
                ({formatNumber(bestMonth.total)} {unit})
              </span>
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => nav(-1)}
            aria-label="Previous month"
            className="rounded-md px-2 py-1 text-sm text-neutral-500 transition hover:bg-black/[.05] hover:text-neutral-900 dark:hover:bg-white/[.08] dark:hover:text-white"
          >
            ←
          </button>
          <span className="num min-w-32 text-center text-[13px] font-semibold">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={() => nav(1)}
            aria-label="Next month"
            className="rounded-md px-2 py-1 text-sm text-neutral-500 transition hover:bg-black/[.05] hover:text-neutral-900 dark:hover:bg-white/[.08] dark:hover:text-white"
          >
            →
          </button>
        </div>
        <span className="text-xs text-neutral-500">
          <span className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
            {monthTotal.toLocaleString()}
          </span>{" "}
          {unit} this month
        </span>
      </div>

      {headline ? <div className="mt-3">{headline}</div> : null}

      {/* Weekday header */}
      <div className="mt-3 grid grid-cols-7 gap-1.5 text-center text-[9px] font-semibold uppercase tracking-[0.14em] text-neutral-400">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      {/* Day grid */}
      <div className="mt-1.5 grid grid-cols-7 gap-1.5">
        {cells.map((c, i) => (
          <button
            key={c.key}
            type="button"
            style={{ animationDelay: `${i * 14}ms` }}
            onMouseEnter={() => setFocus(c.key)}
            onFocus={() => setFocus(c.key)}
            className={`cell-in relative flex h-14 flex-col items-start rounded-lg p-1.5 text-left ring-1 ring-inset transition hover:brightness-110 sm:h-[3.75rem] ${
              c.inMonth ? classes[level(c.value)] : "bg-transparent"
            } ${
              c.isToday
                ? "glow-today ring-2 ring-[#2dd4bf]"
                : "ring-black/[.05] dark:ring-white/[.06]"
            } ${focus === c.key ? "ring-2 ring-teal-500" : ""} ${
              c.inMonth ? "" : "opacity-30"
            }`}
          >
            <span
              className={`text-[11px] font-medium tabular-nums ${
                level(c.value) >= 3
                  ? "text-white"
                  : "text-neutral-500 dark:text-[#b6bac2]"
              }`}
            >
              {c.day}
            </span>
            {c.value > 0 ? (
              <span
                className="mt-auto text-lg font-extrabold leading-none tabular-nums text-white"
                style={CELL_NUM_OUTLINE}
              >
                {compact(c.value)}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Focused-day breakdown panel — the "hover info" done properly */}
      <div className="mt-3 min-h-9 rounded-lg border border-black/[.06] bg-black/[.02] px-3 py-2 dark:border-white/[.10] dark:bg-white/[.05]">
        {focused ? (
          <>
            <p className="text-xs font-semibold">
              {new Date(focused.key + "T00:00:00").toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
              <span className="ml-2 font-normal text-neutral-500">
                {focused.value} {unit}
              </span>
            </p>
            {focused.breakdown.length ? (
              <div className="mt-1.5 space-y-0.5">
                {focused.breakdown.slice(0, 8).map((b) => (
                  <div key={b.label} className="flex items-baseline gap-2 text-xs">
                    <span className="w-12 shrink-0 text-right font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                      {compact(b.n)}
                    </span>
                    <span className="min-w-0 truncate text-neutral-600 dark:text-neutral-300">
                      {b.label}
                    </span>
                  </div>
                ))}
                {focused.breakdown.length > 8 ? (
                  <p className="pl-14 text-[11px] text-neutral-400">
                    +{focused.breakdown.length - 8} more
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-1 text-xs text-neutral-400">Nothing posted.</p>
            )}
          </>
        ) : (
          <p className="text-[11px] text-neutral-400">
            Hover a day for its per-account breakdown.
          </p>
        )}
      </div>
    </div>
  );
}
