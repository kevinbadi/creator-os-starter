"use client";

import { useMemo, useState, useTransition } from "react";
import {
  addAccomplishment,
  deleteAccomplishment,
} from "@/lib/accomplishments/actions";

type Item = { id: string; date: string; text: string };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");

export function AccomplishmentsCalendar({ items }: { items: Item[] }) {
  const [pending, start] = useTransition();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState("");

  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of items) {
      const arr = m.get(it.date) ?? [];
      arr.push(it);
      m.set(it.date, arr);
    }
    return m;
  }, [items]);

  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startOffset = first.getDay();
  const totalCells = Math.ceil((startOffset + last.getDate()) / 7) * 7;
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const monthTotal = items.filter((i) =>
    i.date.startsWith(`${year}-${pad(month + 1)}`),
  ).length;

  function key(day: number) {
    return `${year}-${pad(month + 1)}-${pad(day)}`;
  }
  function shift(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setSelected(null);
  }
  function add() {
    if (!selected || !text.trim()) return;
    start(() => void addAccomplishment({ date: selected, text }));
    setText("");
  }

  const selectedItems = selected ? byDay.get(selected) ?? [] : [];
  const selectedLabel = selected
    ? new Date(
        Number(selected.slice(0, 4)),
        Number(selected.slice(5, 7)) - 1,
        Number(selected.slice(8, 10)),
      ).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    : "";

  return (
    <div className="mt-5 rounded-2xl border border-black/[.08] bg-white p-4 dark:border-white/[.14] dark:bg-[var(--surface-1)]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">What we accomplished</h2>
          <p className="text-xs text-neutral-400">
            Notes on what moved the ball forward · {monthTotal} this month
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => shift(-1)} className="grid size-7 place-items-center rounded-md border border-black/[.12] text-sm transition hover:bg-black/[.04] dark:border-white/[.19] dark:hover:bg-white/[.09]">
            ‹
          </button>
          <span className="w-32 text-center text-sm font-medium tabular-nums">
            {MONTHS[month]} {year}
          </span>
          <button type="button" onClick={() => shift(1)} className="grid size-7 place-items-center rounded-md border border-black/[.12] text-sm transition hover:bg-black/[.04] dark:border-white/[.19] dark:hover:bg-white/[.09]">
            ›
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d) => (
          <div key={d} className="pb-1 text-center text-[10px] font-medium uppercase tracking-wide text-neutral-400">
            {d}
          </div>
        ))}
        {Array.from({ length: totalCells }, (_, i) => {
          const dayNum = i - startOffset + 1;
          const inMonth = dayNum >= 1 && dayNum <= last.getDate();
          const k = inMonth ? key(dayNum) : "";
          const dayItems = k ? byDay.get(k) ?? [] : [];
          const isToday = k === todayKey;
          const isSel = k === selected;
          return (
            <button
              key={i}
              type="button"
              disabled={!inMonth}
              onClick={() => setSelected(k)}
              className={`min-h-[64px] rounded-lg border p-1.5 text-left align-top transition ${
                !inMonth
                  ? "border-transparent"
                  : isSel
                    ? "border-teal-500 bg-teal-500/5"
                    : "border-black/[.06] hover:border-teal-400/60 dark:border-white/[.12]"
              }`}
            >
              {inMonth ? (
                <>
                  <div className="flex items-center justify-between">
                    <span
                      className={`grid size-5 place-items-center rounded-full text-[11px] font-medium tabular-nums ${
                        isToday ? "bg-teal-500 text-white" : "text-neutral-500"
                      }`}
                    >
                      {dayNum}
                    </span>
                    {dayItems.length > 0 ? (
                      <span className="size-1.5 rounded-full bg-teal-500" />
                    ) : null}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {dayItems.slice(0, 2).map((it) => (
                      <p key={it.id} className="truncate rounded bg-teal-500/10 px-1 py-0.5 text-[10px] leading-tight text-teal-800 dark:text-teal-200">
                        {it.text}
                      </p>
                    ))}
                    {dayItems.length > 2 ? (
                      <p className="text-[10px] text-neutral-400">+{dayItems.length - 2} more</p>
                    ) : null}
                  </div>
                </>
              ) : null}
            </button>
          );
        })}
      </div>

      {selected ? (
        <div className="mt-3 rounded-xl border border-black/[.08] bg-black/[.02] p-3 dark:border-white/[.14] dark:bg-white/[.06]">
          <p className="text-xs font-semibold">{selectedLabel}</p>
          <ul className="mt-2 space-y-1.5">
            {selectedItems.length === 0 ? (
              <li className="text-xs text-neutral-400">Nothing logged yet.</li>
            ) : (
              selectedItems.map((it) => (
                <li key={it.id} className="flex items-start justify-between gap-2 text-xs">
                  <span className="min-w-0 flex-1">{it.text}</span>
                  <button
                    type="button"
                    onClick={() => start(() => void deleteAccomplishment(it.id))}
                    className="shrink-0 rounded px-1 text-[11px] text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                  >
                    Del
                  </button>
                </li>
              ))
            )}
          </ul>
          <form onSubmit={(e) => { e.preventDefault(); add(); }} className="mt-2 flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What did we do today to move the ball forward?"
              autoFocus
              className="h-9 flex-1 rounded-lg border border-black/[.12] bg-white px-3 text-sm text-neutral-900 outline-none transition focus:border-teal-400 dark:border-white/[.19] dark:bg-[var(--surface-2)] dark:text-neutral-100"
            />
            <button type="submit" className="inline-flex h-9 items-center rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900" disabled={pending || !text.trim()}>
              Add
            </button>
          </form>
        </div>
      ) : (
        <p className="mt-3 text-center text-xs text-neutral-400">
          Click a day to log what you did.
        </p>
      )}
    </div>
  );
}
