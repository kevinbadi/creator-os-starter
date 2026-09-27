"use client";

import { useRef, useState } from "react";
import { LEVEL_CLASSES } from "./heatmap-colors";

export type HeatmapCell = {
  key: string;
  value: number;
  level: number;
  label: string; // pre-formatted date label
  /** Optional per-source breakdown shown in the tooltip (e.g. "Megan · TikTok ×2"). */
  detail?: string[];
};

export type HeatmapColumn = {
  month: string; // month label, or "" when same as previous column
  cells: HeatmapCell[];
};

type Tip = {
  left: number;
  top: number;
  value: number;
  label: string;
  detail?: string[];
};

// GitHub shows weekday labels on alternating rows (Mon/Wed/Fri).
const WEEKDAYS = ["", "Mon", "", "Wed", "", "Fri", ""];

export function HeatmapGrid({
  columns,
  unit,
  cell = 11,
  gap = 3,
  levelClasses = LEVEL_CLASSES,
}: {
  columns: HeatmapColumn[];
  unit: string;
  cell?: number;
  gap?: number;
  /** Palette classes (index 0 = empty … 4 = max) — see heatmap-colors PALETTES. */
  levelClasses?: string[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const monthRowH = Math.round(cell * 1.2);

  function show(e: React.MouseEvent<HTMLSpanElement>, c: HeatmapCell) {
    const wrap = ref.current;
    if (!wrap) return;
    const w = wrap.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    setTip({
      left: r.left - w.left + r.width / 2,
      top: r.top - w.top - 8,
      value: c.value,
      label: c.label,
      detail: c.detail,
    });
  }

  return (
    <div ref={ref} className="relative">
      <div className="overflow-x-auto pb-1">
        <div className="flex w-max" style={{ gap }}>
          {/* weekday labels */}
          <div
            className="flex flex-col text-[9px] text-neutral-400"
            style={{ gap, paddingTop: monthRowH + gap }}
          >
            {WEEKDAYS.map((d, i) => (
              <span
                key={i}
                className="pr-1 text-right"
                style={{ height: cell, lineHeight: `${cell}px` }}
              >
                {d}
              </span>
            ))}
          </div>

          {/* month labels + cells */}
          <div>
            <div
              className="flex text-[10px] text-neutral-400"
              style={{ gap, height: monthRowH, marginBottom: gap }}
            >
              {columns.map((col, ci) => (
                <div
                  key={ci}
                  className="shrink-0 overflow-visible whitespace-nowrap"
                  style={{ width: cell }}
                >
                  {col.month}
                </div>
              ))}
            </div>
            <div className="flex" style={{ gap }}>
              {columns.map((col, ci) => (
                <div key={ci} className="flex flex-col" style={{ gap }}>
                  {col.cells.map((c) => (
                    <span
                      key={c.key}
                      onMouseEnter={(e) => show(e, c)}
                      onMouseLeave={() => setTip(null)}
                      className={`rounded-[3px] ring-1 ring-inset ring-black/[.04] transition-transform hover:scale-125 hover:ring-black/30 dark:ring-white/[.04] dark:hover:ring-white/40 ${levelClasses[c.level]}`}
                      style={{ width: cell, height: cell }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {tip ? (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[11px] text-white shadow-lg dark:bg-[var(--surface-3)]"
          style={{ left: tip.left, top: tip.top }}
        >
          <span className="font-semibold">{tip.value.toLocaleString()}</span> {unit}
          <span className="mx-1 text-neutral-500">·</span>
          <span className="text-neutral-300">{tip.label}</span>
          {tip.detail?.length ? (
            <div className="mt-1 border-t border-white/15 pt-1 text-left text-neutral-300">
              {tip.detail.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
