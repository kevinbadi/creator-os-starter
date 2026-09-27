export function formatDate(input?: string | Date | null): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(input?: string | Date | null): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d) + " ET"
  );
}

export function formatNumber(n?: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return n.toLocaleString();
}

/** Highest-sum calendar month from daily dated values. Dates as YYYY-MM-DD. */
export function bestMonthFromDaily(
  items: { date?: string | null; value: number }[],
): { label: string; total: number; key: string } | null {
  const byMonth = new Map<string, number>();
  for (const item of items) {
    if (!item.date || !Number.isFinite(item.value)) continue;
    // Accept ISO timestamps too — month key is the first 7 chars of YYYY-MM-DD.
    const day = item.date.length >= 10 ? item.date.slice(0, 10) : item.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      const d = new Date(item.date);
      if (Number.isNaN(d.getTime())) continue;
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      byMonth.set(k, (byMonth.get(k) ?? 0) + item.value);
      continue;
    }
    const k = day.slice(0, 7);
    byMonth.set(k, (byMonth.get(k) ?? 0) + item.value);
  }
  let best: { key: string; total: number } | null = null;
  for (const [key, total] of byMonth) {
    if (!best || total > best.total) best = { key, total };
  }
  if (!best || best.total <= 0) return null;
  const [y, m] = best.key.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  return { label, total: best.total, key: best.key };
}

/** Full integer with grouping — for header KPIs with room (Views, ARR, Valuation). */
export function formatFullNumber(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function relativeTime(input?: string | Date | null): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 3600 * 1000],
    ["month", 30 * 24 * 3600 * 1000],
    ["week", 7 * 24 * 3600 * 1000],
    ["day", 24 * 3600 * 1000],
    ["hour", 3600 * 1000],
    ["minute", 60 * 1000],
  ];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

export const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  twitter: "X",
  x: "X",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  pinterest: "Pinterest",
  reddit: "Reddit",
  bluesky: "Bluesky",
  threads: "Threads",
  google_business: "Google Business",
  telegram: "Telegram",
  snapchat: "Snapchat",
  whatsapp: "WhatsApp",
  discord: "Discord",
};

export function platformLabel(p: string): string {
  return PLATFORM_LABEL[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
}
