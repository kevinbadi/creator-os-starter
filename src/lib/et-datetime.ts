const ET = "America/New_York";

function etParts(at: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(at).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: parseInt(parts.hour, 10) % 24,
    minute: Number(parts.minute),
  };
}

function etWallAsUtcMs(at: Date): number {
  const p = etParts(at);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
}

/** `datetime-local` value for an instant, in America/New_York. */
export function isoToEtDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = etParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Parse an ET wall-clock `datetime-local` into an ISO instant. */
export function etDatetimeLocalToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) return null;
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  // ET is UTC-5 or UTC-4. Start from EDT, then walk the offset in.
  let utc = Date.UTC(year, month - 1, day, hour + 4, minute);
  for (let i = 0; i < 4; i++) {
    const delta = wanted - etWallAsUtcMs(new Date(utc));
    if (delta === 0) return new Date(utc).toISOString();
    utc += delta;
  }
  return new Date(utc).toISOString();
}
