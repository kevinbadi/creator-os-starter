import {
  formatCountdown,
  formatElapsed,
  formatExact,
  isCritical,
  ringFraction,
  urgency,
  type Urgency,
} from "@/lib/goals/time";

const RING: Record<Urgency, string> = {
  green: "text-emerald-500",
  yellow: "text-amber-500",
  red: "text-red-500",
};

/**
 * Circular SVG progress ring that depletes as the deadline approaches.
 * Color shifts green → yellow → red; pulses inside the final 2h / when overdue.
 * `now` is passed in (ticked by the parent) so the whole list shares one clock.
 */
export function CountdownRing({
  deadline,
  startedAt,
  now,
  size = 34,
}: {
  deadline: number;
  startedAt: number | null;
  now: number;
  size?: number;
}) {
  const remaining = deadline - now;
  const tone = urgency(remaining);
  const critical = isCritical(remaining);
  const frac = ringFraction(now, deadline, startedAt);

  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const overdue = remaining <= 0;

  const elapsed = startedAt != null ? formatElapsed(now - startedAt) : "";
  const tooltip =
    `Deadline ${formatExact(deadline)}` +
    (elapsed ? ` · ${elapsed} elapsed` : "");

  // Inner label: compact remaining (e.g. "2d", "5h") or "!" when overdue.
  const inner = overdue
    ? "!"
    : remaining >= 86_400_000
      ? `${Math.floor(remaining / 86_400_000)}d`
      : `${Math.max(Math.floor(remaining / 3_600_000), 1)}h`;

  return (
    <span
      title={tooltip}
      className={`relative inline-flex shrink-0 items-center justify-center ${RING[tone]} ${critical ? "animate-pulse" : ""}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="opacity-20"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
        />
      </svg>
      <span className="absolute text-[9px] font-bold tabular-nums">{inner}</span>
    </span>
  );
}

export { formatCountdown };
