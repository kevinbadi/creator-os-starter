"use client";

import type { SlotBoard as SlotBoardData, SlotState } from "@/lib/agent-posts/slots";

const ET = "America/New_York";

function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

function hourLabel(h: number): string {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function slotTitle(iso: string, state: SlotState): string {
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
  const what = state === "filled" ? "booked" : state === "open" ? "open" : "missed (no post)";
  return `${when} ET · ${what}`;
}

function dotClass(state: SlotState, past: boolean): string {
  if (state === "filled") {
    return past
      ? "bg-[var(--muted-2)]"
      : "bg-[var(--accent)] shadow-[0_0_0_2px_rgba(45,212,191,0.25)]";
  }
  if (state === "missed") {
    return "border border-red-400/70 bg-transparent";
  }
  return "border border-[var(--line-strong)] bg-transparent";
}

export function SlotBoardStrip({
  boards,
  month,
  onMonth,
  loading,
}: {
  boards: SlotBoardData[];
  month: string;
  onMonth: (next: string) => void;
  loading?: boolean;
}) {
  const shift = (delta: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    onMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const now = Date.now();

  return (
    <section className="card p-0!">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <div>
          <div className="eyebrow">Pipeline slots</div>
          <h2 className="card-title">{monthTitle(month)}</h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            One bar per day, one dot per upload slot. Teal is booked, hollow is open,
            red hollow is a slot that passed with nothing scheduled. A fully booked day
            lights up green.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs hover:border-[var(--line-strong)]"
            aria-label="Previous month"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs hover:border-[var(--line-strong)]"
            aria-label="Next month"
          >
            →
          </button>
          {loading ? <span className="text-xs text-[var(--muted-2)]">updating…</span> : null}
        </div>
      </div>

      {boards.length === 0 ? (
        <div className="px-4 py-6 text-sm text-[var(--muted)]">No Agent Post targets connected.</div>
      ) : (
        <div className="divide-y divide-[var(--line)]">
          {boards.map((b) => (
            <div key={b.profileId} className="px-4 py-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{b.name}</span>
                  <span className="text-xs text-[var(--muted-2)]">
                    {b.hours.map(hourLabel).join(" / ")} ET
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
                  <span>
                    <span className="font-medium text-[var(--accent-ink)]">{b.openAhead}</span> open
                  </span>
                  <span>
                    <span className="font-medium">{b.filled}</span> booked
                  </span>
                  {b.missed > 0 ? (
                    <span>
                      <span className="font-medium text-red-400">{b.missed}</span> missed
                    </span>
                  ) : null}
                  {b.degraded ? (
                    <span className="text-amber-500" title="A Zernio read timed out; showing the last good board.">
                      Zernio slow · last good
                    </span>
                  ) : null}
                  {b.nextOpen ? (
                    <span>
                      next open{" "}
                      <span className="font-medium">
                        {new Intl.DateTimeFormat("en-US", {
                          timeZone: ET,
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          hour12: true,
                        }).format(new Date(b.nextOpen))}
                      </span>
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="overflow-x-auto">
                <div
                  className="grid gap-1"
                  style={{ gridTemplateColumns: `repeat(${b.days.length}, minmax(30px, 1fr))` }}
                >
                  {b.days.map((d) => {
                    const dayFilled = d.slots.filter((s) => s.state === "filled").length;
                    const dayMissed = d.slots.some((s) => s.state === "missed");
                    return (
                      <div key={d.date} className="flex flex-col items-center gap-1">
                        <div
                          className={[
                            "flex h-5 w-full items-center justify-around rounded-full border px-1",
                            dayFilled === d.slots.length
                              ? "border-[#39ff84] bg-[#39ff84] shadow-[0_0_10px_rgba(57,255,132,0.55)]"
                              : d.today
                                ? "border-[var(--accent)] bg-[var(--surface-3)]"
                                : dayMissed
                                  ? "border-red-400/30 bg-[var(--surface-2)]"
                                  : "border-[var(--line)] bg-[var(--surface-2)]",
                          ].join(" ")}
                          title={`${d.date} · ${dayFilled}/${d.slots.length} booked`}
                        >
                          {d.slots.map((s) => (
                            <span
                              key={s.hour}
                              title={slotTitle(s.at, s.state)}
                              className={[
                                "block h-2.5 w-2.5 shrink-0 rounded-full",
                                dayFilled === d.slots.length
                                  ? "bg-[#0a0b0e]/70"
                                  : dotClass(s.state, new Date(s.at).getTime() <= now),
                              ].join(" ")}
                            />
                          ))}
                        </div>
                        <span
                          className={[
                            "text-[10px] leading-none tabular-nums",
                            d.today ? "font-semibold text-[var(--accent-ink)]" : "text-[var(--muted-2)]",
                          ].join(" ")}
                        >
                          {d.day}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
