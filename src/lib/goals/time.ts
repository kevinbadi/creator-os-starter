// Pure, client-safe time helpers for goal deadlines. No server-only imports.

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export type Urgency = "green" | "yellow" | "red";

/** Urgency band from ms remaining. >24h green · 2–24h yellow · <2h or overdue red. */
export function urgency(msRemaining: number): Urgency {
  if (msRemaining <= 0) return "red";
  if (msRemaining < 2 * HOUR) return "red";
  if (msRemaining < 24 * HOUR) return "yellow";
  return "green";
}

/** True when the deadline is within 2h or already passed — drives the pulse. */
export function isCritical(msRemaining: number): boolean {
  return msRemaining < 2 * HOUR;
}

/** "2d 14h" · "14h 3m" · "8m" · "Overdue". */
export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "Overdue";
  const d = Math.floor(msRemaining / DAY);
  const h = Math.floor((msRemaining % DAY) / HOUR);
  const m = Math.floor((msRemaining % HOUR) / MINUTE);
  if (d >= 1) return `${d}d ${h}h`;
  if (h >= 1) return `${h}h ${m}m`;
  return `${Math.max(m, 1)}m`;
}

/** "3d 5h" elapsed since start. Empty string if not started / future. */
export function formatElapsed(msElapsed: number): string {
  if (!Number.isFinite(msElapsed) || msElapsed <= 0) return "";
  const d = Math.floor(msElapsed / DAY);
  const h = Math.floor((msElapsed % DAY) / HOUR);
  const m = Math.floor((msElapsed % HOUR) / MINUTE);
  if (d >= 1) return `${d}d ${h}h`;
  if (h >= 1) return `${h}h ${m}m`;
  return `${Math.max(m, 1)}m`;
}

/**
 * Fraction of time remaining (1 = just started, 0 = due now) for the ring.
 * Window is start→deadline when a start exists, else a rolling 7-day window.
 */
export function ringFraction(
  now: number,
  deadline: number,
  startedAt: number | null,
): number {
  const window = startedAt != null ? Math.max(deadline - startedAt, MINUTE) : 7 * DAY;
  const remaining = deadline - now;
  return Math.max(0, Math.min(1, remaining / window));
}

/** "2026-10-24 17:00" in local time, for the hover tooltip. */
export function formatExact(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
