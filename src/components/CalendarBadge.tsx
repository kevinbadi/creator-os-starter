// Desk-calendar style "date card": colored month header over a big day number.
// Turns red (and can shake) when the target date has slipped without completion.

export function CalendarBadge({
  date,
  slipped = false,
  done = false,
}: {
  /** "YYYY-MM-DD" */
  date: string;
  /** Past the target date and not complete → schedule slip. */
  slipped?: boolean;
  done?: boolean;
}) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const month = dt.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  const day = String(d);

  const header = done
    ? "bg-emerald-500"
    : slipped
      ? "bg-red-500"
      : "bg-neutral-800 dark:bg-neutral-700";

  return (
    <span
      title={dt.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })}
      className={`inline-flex w-9 shrink-0 flex-col overflow-hidden rounded-md border border-black/[.12] bg-white text-center leading-none dark:border-white/[.19] dark:bg-[var(--surface-1)] ${
        slipped && !done ? "goal-slip-shake" : ""
      }`}
    >
      <span className={`py-0.5 text-[8px] font-bold tracking-wide text-white ${header}`}>
        {month}
      </span>
      <span className="py-0.5 text-sm font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
        {day}
      </span>
    </span>
  );
}
