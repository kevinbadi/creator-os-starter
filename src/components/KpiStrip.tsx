import { CountUp } from "./CountUp";

export type Kpi = {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  /** Signed % change rendered as a colored ↑/↓ before the sub text. */
  trend?: number | null;
};

const KPI_NUM_OUTLINE = {
  textShadow:
    "-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, -2px 0 0 #000, 2px 0 0 #000, 0 -2px 0 #000, 0 2px 0 #000, 0 2px 3px rgba(0,0,0,.5)",
} as const;

// Editorial stat band (2026-09-14): one raised surface, cells divided by
// hairlines instead of six small boxes, serif numerals large enough to read
// from across the room. Still a single row on desktop (Kevin 2026-07-12: the
// 7th chip must not wrap) and a 2/4-col grid on small screens. The accent
// KPI (Downloads) keeps its teal but as ink + a glowing underline rather than
// a solid block. Numbers: extrabold white + black outline (Kevin 2026-09-16).
export function KpiStrip({ items }: { items: Kpi[] }) {
  if (items.length === 0) return null;

  return (
    <div className="card sheen grid grid-cols-2 gap-y-4 p-0! sm:grid-cols-4 lg:flex lg:flex-nowrap">
      {items.map((k, i) => (
        <div
          key={k.label}
          className={`relative min-w-0 px-4 py-3.5 lg:flex-1 ${
            i > 0 ? "lg:border-l lg:border-[var(--line)]" : ""
          }`}
        >
          <p className={`eyebrow truncate ${k.accent ? "text-[#2dd4bf]!" : ""}`}>{k.label}</p>
          <p
            className={`num mt-1.5 whitespace-nowrap font-serif text-[28px] font-extrabold leading-none tracking-tight lg:text-[32px] ${
              k.accent
                ? "text-[#2dd4bf] drop-shadow-[0_0_14px_rgba(45,212,191,0.35)]"
                : "text-white"
            }`}
            style={KPI_NUM_OUTLINE}
          >
            <CountUp value={k.value} />
          </p>
          {k.sub || k.trend != null ? (
            <p className="mt-1.5 flex items-center gap-1.5 truncate text-[11px] text-neutral-500 dark:text-[#8b909a]">
              {k.trend != null ? (
                <span
                  className={`num inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-semibold ${
                    k.trend >= 0
                      ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300"
                      : "bg-rose-500/12 text-rose-600 dark:text-rose-300"
                  }`}
                >
                  {k.trend >= 0 ? "↑" : "↓"}
                  {Math.abs(Math.round(k.trend))}%
                </span>
              ) : null}
              <span className="truncate">{k.sub}</span>
            </p>
          ) : null}
          {k.accent ? (
            <span
              aria-hidden
              className="absolute inset-x-4 bottom-0 h-px bg-[#2dd4bf]"
              style={{ boxShadow: "0 0 12px 1px rgba(45,212,191,0.6)" }}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
