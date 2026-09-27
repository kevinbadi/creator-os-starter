"use client";

import { DAY, HOUR, MINUTE } from "@/lib/goals/time";

// Days / Hours / Minutes / Seconds countdown to a deadline.
// Silver/black cells with turquoise digits. `now` is ticked by the parent so
// the whole list shares one clock (and avoids SSR hydration mismatch).

function pad(n: number): string {
  return String(Math.max(0, n)).padStart(2, "0");
}

export function DeadlineCountdown({
  deadline,
  now,
  size = "md",
}: {
  deadline: number;
  now: number;
  size?: "sm" | "md";
}) {
  const rem = deadline - now;
  const overdue = rem <= 0;
  const r = Math.max(0, rem);

  const segs: [string, string][] = [
    [pad(Math.floor(r / DAY)), "Days"],
    [pad(Math.floor((r % DAY) / HOUR)), "Hrs"],
    [pad(Math.floor((r % HOUR) / MINUTE)), "Min"],
    [pad(Math.floor((r % MINUTE) / 1000)), "Sec"],
  ];

  const cell = size === "sm" ? "w-9 py-1" : "w-11 py-1.5";
  const num = size === "sm" ? "text-sm" : "text-lg";

  return (
    <div className="inline-flex items-center gap-1">
      {segs.map(([val, label], i) => (
        <div key={label} className="flex items-center gap-1">
          <div
            className={`flex ${cell} flex-col items-center rounded-md border border-black/[.08] bg-neutral-100 dark:border-white/[.14] dark:bg-[var(--surface-2)]`}
          >
            <span
              className={`${num} font-bold leading-none tabular-nums ${
                overdue
                  ? "text-red-500"
                  : "text-teal-600 dark:text-teal-400"
              }`}
            >
              {overdue ? "00" : val}
            </span>
            <span className="mt-0.5 text-[8px] font-medium uppercase tracking-wide text-neutral-400">
              {label}
            </span>
          </div>
          {i < segs.length - 1 ? (
            <span className="text-xs font-bold text-neutral-300 dark:text-neutral-600">
              :
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
