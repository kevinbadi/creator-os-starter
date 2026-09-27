"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { PALETTES } from "@/components/heatmap-colors";
import { PlatformDot } from "@/components/PlatformBadge";
import { formatNumber, bestMonthFromDaily } from "@/lib/format";
import type { DailyFollowerGain } from "@/lib/analytics/followers";

// Compact daily net-follower-growth heatmap for the Overview's right column
// (Kevin 2026-07-12). Cyan ramp = gain days; grey = NET-LOSS days
// (Kevin 2026-09-16: grey not red).
// Week = trailing 7-day strip · Month = calendar month tiles · Year = 52w heatmap.
// Viz area grows with the card (sibling stretch) so no empty dead zone.

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_SHORT = ["S", "M", "T", "W", "T", "F", "S"];

const DECLINE = "bg-[#d4d4d8] dark:bg-[#3f3f46]";
const FUTURE = "invisible";
const EMPTY = "bg-transparent";
const RANGE_KEY = "mos_follower_growth_range";
const YEAR_WEEKS = 52;

export type FollowerGrowthRange = "year" | "month" | "week";

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Tip = { left: number; top: number; text: string };
type DayCell = {
  key: string;
  date: Date;
  value: number;
  future: boolean;
  /** Outside the focused month (calendar padding). */
  outside?: boolean;
  topPlatform?: string | null;
};

function buildDays(
  byDay: Map<string, DailyFollowerGain>,
  range: FollowerGrowthRange,
  cursor: { year: number; month: number },
): DayCell[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let start: Date;
  let end: Date;
  let focusMonth = -1;

  if (range === "week") {
    end = new Date(today);
    start = new Date(today);
    start.setDate(start.getDate() - 6);
  } else if (range === "month") {
    // Selected calendar month, padded to full Sun–Sat weeks.
    focusMonth = cursor.month;
    start = new Date(cursor.year, cursor.month, 1);
    end = new Date(cursor.year, cursor.month + 1, 0);
    start.setDate(start.getDate() - start.getDay());
    end.setDate(end.getDate() + (6 - end.getDay()));
  } else {
    end = new Date(today);
    end.setDate(end.getDate() + (6 - end.getDay()));
    start = new Date(end);
    start.setDate(start.getDate() - (YEAR_WEEKS * 7 - 1));
  }

  const days: DayCell[] = [];
  for (const cursorDay = new Date(start); cursorDay <= end; cursorDay.setDate(cursorDay.getDate() + 1)) {
    const k = dayKey(cursorDay);
    const row = byDay.get(k);
    const outside = focusMonth >= 0 && cursorDay.getMonth() !== focusMonth;
    days.push({
      key: k,
      date: new Date(cursorDay),
      value: outside ? 0 : (row?.gained ?? 0),
      future: cursorDay > today,
      outside,
      topPlatform: outside ? null : (row?.topPlatform ?? null),
    });
  }
  return days;
}

function RangeToggle({
  value,
  onChange,
}: {
  value: FollowerGrowthRange;
  onChange: (v: FollowerGrowthRange) => void;
}) {
  const opts: { id: FollowerGrowthRange; label: string }[] = [
    { id: "week", label: "Week" },
    { id: "month", label: "Month" },
    { id: "year", label: "Year" },
  ];
  return (
    <div
      className="inline-flex rounded-md border border-black/[.10] p-0.5 dark:border-white/[.14]"
      role="tablist"
      aria-label="Follower growth range"
    >
      {opts.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.id)}
            className={`rounded-[5px] px-2 py-0.5 text-[11px] font-medium transition ${
              on
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "text-neutral-500 hover:text-neutral-800 dark:text-[#8e939d] dark:hover:text-neutral-200"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const GAIN_NUM_STYLE: CSSProperties = {
  // Multi-offset halo reads thicker than 1px without filling digit counters
  // the way a heavy WebkitTextStroke does.
  textShadow:
    "-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, -2px 0 0 #000, 2px 0 0 #000, 0 -2px 0 #000, 0 2px 0 #000, 0 2px 3px rgba(0,0,0,.5)",
};

function DayTile({
  d,
  levelClass,
  showTip,
  clearTip,
  label,
  logoSize = 16,
  numClass = "text-[20px]",
}: {
  d: DayCell;
  levelClass: (d: DayCell) => string;
  showTip: (e: MouseEvent<HTMLElement>, d: DayCell) => void;
  clearTip: () => void;
  label: string;
  logoSize?: number;
  numClass?: string;
}) {
  const gain = d.value === 0 ? "0" : `${d.value > 0 ? "+" : ""}${formatNumber(d.value)}`;
  return (
    <button
      type="button"
      onMouseEnter={(e) => showTip(e, d)}
      onMouseLeave={clearTip}
      className={`cell-in relative grid h-full min-h-0 grid-rows-[auto_1fr] gap-0.5 rounded-md px-1.5 py-1 text-left ring-1 ring-inset ring-black/[.04] transition hover:ring-black/25 dark:ring-white/[.06] dark:hover:ring-white/35 ${levelClass(d)}`}
    >
      <div className="flex items-start justify-between gap-0.5">
        <span className="text-[10px] font-semibold leading-none text-neutral-800 dark:text-white/90">
          {label}
        </span>
        {d.topPlatform ? (
          <span className="shrink-0">
            <PlatformDot platform={d.topPlatform} size={logoSize} />
          </span>
        ) : null}
      </div>
      <span
        className={`self-end font-extrabold tabular-nums leading-none tracking-tight text-white ${numClass}`}
        style={GAIN_NUM_STYLE}
      >
        {gain}
      </span>
    </button>
  );
}

function WeekStrip({
  days,
  levelClass,
  showTip,
  clearTip,
}: {
  days: DayCell[];
  levelClass: (d: DayCell) => string;
  showTip: (e: MouseEvent<HTMLElement>, d: DayCell) => void;
  clearTip: () => void;
}) {
  return (
    <div className="grid h-full w-full grid-cols-7 gap-1.5">
      {days.map((d) => (
        <DayTile
          key={d.key}
          d={d}
          levelClass={levelClass}
          showTip={showTip}
          clearTip={clearTip}
          label={`${DOW[d.date.getDay()]} ${d.date.getDate()}`}
          logoSize={18}
          numClass="text-[24px]"
        />
      ))}
    </div>
  );
}

function MonthCalendar({
  days,
  levelClass,
  showTip,
  clearTip,
}: {
  days: DayCell[];
  levelClass: (d: DayCell) => string;
  showTip: (e: MouseEvent<HTMLElement>, d: DayCell) => void;
  clearTip: () => void;
}) {
  const weeks: DayCell[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div className="flex h-full w-full flex-col gap-1">
      <div className="grid shrink-0 grid-cols-7 gap-1">
        {DOW_SHORT.map((d, i) => (
          <span
            key={`${d}-${i}`}
            className="text-center text-[10px] font-medium uppercase tracking-wide text-neutral-400"
          >
            {d}
          </span>
        ))}
      </div>
      <div
        className="grid min-h-0 flex-1 gap-1"
        style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0,1fr))` }}
      >
        {weeks.map((week, wi) => (
          <div key={wi} className="grid min-h-0 grid-cols-7 gap-1">
            {week.map((d) => {
              if (d.outside || d.future) {
                return (
                  <div
                    key={d.key}
                    className="min-h-0 rounded-md bg-black/[.03] dark:bg-white/[.03]"
                  />
                );
              }
              return (
                <DayTile
                  key={d.key}
                  d={d}
                  levelClass={levelClass}
                  showTip={showTip}
                  clearTip={clearTip}
                  label={String(d.date.getDate())}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FollowerGrowthHeatmap({
  gains,
  label,
}: {
  gains: DailyFollowerGain[];
  /** Active channel name — these grids are per-channel, not org-wide. */
  label?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [range, setRange] = useState<FollowerGrowthRange>("month");
  const now = new Date();
  const [cursorYear, setCursorYear] = useState(now.getFullYear());
  const [cursorMonth, setCursorMonth] = useState(now.getMonth());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RANGE_KEY);
      if (raw === "week" || raw === "month" || raw === "year") setRange(raw);
    } catch {
      /* ignore */
    }
  }, []);

  function setRangePersist(v: FollowerGrowthRange) {
    setRange(v);
    if (v === "month") {
      const t = new Date();
      setCursorYear(t.getFullYear());
      setCursorMonth(t.getMonth());
    }
    try {
      localStorage.setItem(RANGE_KEY, v);
    } catch {
      /* ignore */
    }
  }

  function navMonth(dir: 1 | -1) {
    const d = new Date(cursorYear, cursorMonth + dir, 1);
    const t = new Date();
    // Don't navigate past the current calendar month.
    if (dir === 1 && (d.getFullYear() > t.getFullYear() || (d.getFullYear() === t.getFullYear() && d.getMonth() > t.getMonth()))) {
      return;
    }
    setCursorYear(d.getFullYear());
    setCursorMonth(d.getMonth());
  }

  function showTip(e: MouseEvent<HTMLElement>, d: DayCell) {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const w = wrap.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    const plat = d.topPlatform ? ` · led by ${d.topPlatform}` : "";
    setTip({
      left: r.left - w.left + r.width / 2,
      top: r.top - w.top - 8,
      text: `${d.value >= 0 ? "+" : ""}${d.value.toLocaleString()} followers · ${d.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}${plat}`,
    });
  }

  const byDay = useMemo(
    () => new Map(gains.map((g) => [g.date, g])),
    [gains],
  );
  const days = useMemo(
    () => buildDays(byDay, range, { year: cursorYear, month: cursorMonth }),
    [byDay, range, cursorYear, cursorMonth],
  );

  const scored = days.filter((d) => !d.outside && !d.future);
  const max = Math.max(0, ...scored.map((d) => d.value));
  const levelClass = (d: DayCell): string => {
    if (d.outside) return EMPTY;
    if (d.future) return FUTURE;
    if (d.value < 0) return DECLINE;
    const ramp = PALETTES.cyan;
    if (d.value === 0 || max <= 0) return ramp[0];
    const r = d.value / max;
    return ramp[r > 0.66 ? 4 : r > 0.33 ? 3 : r > 0.1 ? 2 : 1];
  };

  const weekCols: DayCell[][] = [];
  if (range === "year") {
    for (let i = 0; i < days.length; i += 7) weekCols.push(days.slice(i, i + 7));
  }

  const monthAbbrev = (ci: number): string => {
    const m = weekCols[ci]?.[0]?.date.getMonth();
    if (m == null) return "";
    const prev = ci > 0 ? weekCols[ci - 1][0].date.getMonth() : -1;
    return m !== prev ? MONTHS[m] : "";
  };

  const total = scored.reduce((s, d) => s + d.value, 0);
  const today = new Date();
  const canNextMonth =
    cursorYear < today.getFullYear() ||
    (cursorYear === today.getFullYear() && cursorMonth < today.getMonth());
  const cursorMonthLabel = new Date(cursorYear, cursorMonth, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const rangeHint =
    range === "week"
      ? "last 7 days"
      : range === "month"
        ? null
        : "last 52 weeks";

  const bestMonth = useMemo(
    () => bestMonthFromDaily(gains.map((g) => ({ date: g.date, value: g.gained }))),
    [gains],
  );

  return (
    <div ref={wrapRef} className="card relative flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="card-title">
          Follower growth
          {label ? (
            <span className="ml-2 font-sans text-xs not-italic text-neutral-400">{label}</span>
          ) : null}
        </h2>
        <div className="flex flex-wrap items-center gap-2.5">
          {range === "month" ? (
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => navMonth(-1)}
                aria-label="Previous month"
                className="rounded-md px-1.5 py-0.5 text-sm text-neutral-500 transition hover:bg-black/[.05] hover:text-neutral-900 dark:hover:bg-white/[.08] dark:hover:text-white"
              >
                ←
              </button>
              <span className="num min-w-[7.5rem] text-center text-[12px] font-semibold">
                {cursorMonthLabel}
              </span>
              <button
                type="button"
                onClick={() => navMonth(1)}
                aria-label="Next month"
                disabled={!canNextMonth}
                className="rounded-md px-1.5 py-0.5 text-sm text-neutral-500 transition hover:bg-black/[.05] hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/[.08] dark:hover:text-white"
              >
                →
              </button>
            </div>
          ) : null}
          <RangeToggle value={range} onChange={setRangePersist} />
          <span className="text-xs tabular-nums text-neutral-500">
            {total >= 0 ? "+" : ""}
            {formatNumber(total)} net
          </span>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px] leading-snug text-neutral-500 dark:text-[#a8adb6]">
        {rangeHint ? <span>{rangeHint}</span> : null}
        {bestMonth ? (
          <span>
            {rangeHint ? "· " : ""}Best month so far ·{" "}
            <span className="font-semibold text-neutral-800 dark:text-neutral-100">
              {bestMonth.label}
            </span>
            <span className="font-semibold tabular-nums text-neutral-800 dark:text-neutral-100">
              {" "}
              (+{formatNumber(bestMonth.total)})
            </span>
          </span>
        ) : null}
      </div>

      <div className="mt-3 min-h-[118px] flex-1">
        {range === "week" ? (
          <WeekStrip
            days={days}
            levelClass={levelClass}
            showTip={showTip}
            clearTip={() => setTip(null)}
          />
        ) : range === "month" ? (
          <MonthCalendar
            days={days}
            levelClass={levelClass}
            showTip={showTip}
            clearTip={() => setTip(null)}
          />
        ) : (
          <div className="flex h-full w-full flex-col">
            <div
              className="grid w-full shrink-0 gap-[3px] text-[9px] leading-none text-neutral-400"
              style={{ gridTemplateColumns: `repeat(${weekCols.length}, minmax(0,1fr))` }}
            >
              {weekCols.map((_, ci) => (
                <span key={ci} className="overflow-visible whitespace-nowrap">
                  {monthAbbrev(ci)}
                </span>
              ))}
            </div>
            <div
              className="mt-1 grid min-h-0 w-full flex-1 gap-[3px]"
              style={{ gridTemplateColumns: `repeat(${weekCols.length}, minmax(0,1fr))` }}
            >
              {weekCols.map((col, ci) => (
                <div key={ci} className="grid min-h-0 grid-rows-7 gap-[3px]">
                  {col.map((d) => (
                    <span
                      key={d.key}
                      onMouseEnter={(e) => !d.future && showTip(e, d)}
                      onMouseLeave={() => setTip(null)}
                      style={{ animationDelay: `${ci * 28}ms` }}
                      className={`cell-in min-h-0 w-full rounded-[3px] ring-1 ring-inset ring-black/[.04] transition-transform hover:scale-110 hover:ring-black/30 dark:ring-white/[.04] dark:hover:ring-white/40 ${levelClass(d)}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-2.5 flex shrink-0 items-center justify-end gap-[3px] text-[10px] text-neutral-400">
        <span className={`size-[9px] rounded-[2px] ${DECLINE}`} />
        <span className="mr-2">loss</span>
        <span className="mr-1">Less</span>
        {PALETTES.cyan.map((cls, i) => (
          <span key={i} className={`size-[9px] rounded-[2px] ${cls}`} />
        ))}
        <span className="ml-1">More</span>
      </div>

      {tip ? (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[11px] text-white shadow-lg dark:bg-[var(--surface-3)]"
          style={{ left: tip.left, top: tip.top }}
        >
          {tip.text}
        </div>
      ) : null}
    </div>
  );
}
