/**
 * Jev choice capacity (Kevin 2026-09-18: "have an eye on this as we power up
 * Jev before adding him to Claude Code"). Every choice question can carry at
 * most 255 options (verified: option 256 returns "Too many choices"). Shows
 * how many slots each routing question uses. Server component.
 */
const MAX = 255;

export function JevCapacity({
  questions,
  max = MAX,
}: {
  questions: { label: string; used: number }[];
  max?: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" title={`Each choice question is healthiest under ${max} options.`}>
      {questions.map((q) => {
        const pct = Math.min(100, (q.used / max) * 100);
        return (
          <div
            key={q.label}
            className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1 text-xs"
          >
            <span className="text-[var(--muted)]">{q.label}</span>
            <span className="font-medium tabular-nums">
              {q.used}
              <span className="text-[var(--muted-2)]">/{max}</span>
            </span>
            <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-[var(--surface-3)]">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]"
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}
