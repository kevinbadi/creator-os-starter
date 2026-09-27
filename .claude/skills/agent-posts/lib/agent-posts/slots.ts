import "server-only";
import { listPosts } from "@/lib/zernio/client";
import { listClaimedSlots } from "./store";
import { type AgentPostTarget } from "./types";

function parseHours(raw: string | undefined): number[] | null {
  if (!raw?.trim()) return null;
  const hours = raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 23);
  return hours.length ? [...new Set(hours)].sort((a, b) => a - b) : null;
}

function siblingMap(): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = (process.env.CREATOR_OS_SIBLING_PROFILE_IDS || "").trim();
  if (!raw) return out;
  for (const pair of raw.split(",")) {
    const [a, b] = pair.split(":").map((s) => s.trim());
    if (a && b) {
      out[a] = b;
      out[b] = a;
    }
  }
  return out;
}

/** Default 12am / 3 / 6 / 9pm ET. Override with CREATOR_OS_SLOT_HOURS_ET=0,15,18,21 */
export const SLOT_HOURS_ET = parseHours(process.env.CREATOR_OS_SLOT_HOURS_ET) ?? [
  0, 15, 18, 21,
];
/**
 * Minimum gap between a candidate slot and anything on a sibling socials set
 * (optional CREATOR_OS_SIBLING_PROFILE_IDS=idA:idB).
 */
export const MIN_CROSS_PROFILE_STAGGER_MS = 45 * 60 * 1000;
const ET = "America/New_York";

export type EtParts = {
  date: string;
  hour: number;
  minute: number;
};

export function etParts(at: Date = new Date()): EtParts {
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
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parseInt(parts.hour, 10) % 24,
    minute: parseInt(parts.minute, 10),
  };
}

function addEtDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return utc.toISOString().slice(0, 10);
}

export function siblingProfileId(profileId: string): string | null {
  return siblingMap()[profileId] ?? null;
}

export function slotHoursFor(_profileId?: string | null): readonly number[] {
  return SLOT_HOURS_ET;
}

function hourLabel(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
}

export function slotGridLabel(_profileId?: string | null): string {
  const hours = SLOT_HOURS_ET;
  if (!hours.length) return "no slots";
  return `${hours.map(hourLabel).join(" / ")} ET`;
}

function keyFor(date: string, hour: number): string {
  return `${date}T${String(hour).padStart(2, "0")}`;
}

function snapSlotKey(
  at: Date,
  hours: readonly number[],
  mode: "next" | "prev",
): string | null {
  const p = etParts(at);
  if (hours.includes(p.hour)) return keyFor(p.date, p.hour);
  if (mode === "next") {
    const next = hours.find((h) => h > p.hour);
    if (next !== undefined) return keyFor(p.date, next);
    return keyFor(addEtDays(p.date, 1), hours[0]);
  }
  const prev = [...hours].reverse().find((h) => h < p.hour);
  if (prev !== undefined) return keyFor(p.date, prev);
  return keyFor(addEtDays(p.date, -1), hours[hours.length - 1]);
}

/** Map any instant onto this profile's slot grid. Off-hour times take the next slot. */
export function slotKey(at: Date, profileId?: string | null): string | null {
  return snapSlotKey(at, slotHoursFor(profileId), "next");
}

/** Slot that already fired — used so a 3:03pm publish does not block 4pm. */
export function occupiedSlotKey(at: Date, profileId?: string | null): string | null {
  return snapSlotKey(at, slotHoursFor(profileId), "prev");
}

export function formatSlotEt(at: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at) + " ET";
}

export function isWithinStagger(a: Date, b: Date): boolean {
  return Math.abs(a.getTime() - b.getTime()) < MIN_CROSS_PROFILE_STAGGER_MS;
}

/** Upcoming slot instants for this socials set, DST-aware, starting after `from`. */
export function upcomingSlots(
  from: Date = new Date(),
  count = 24,
  profileId?: string | null,
): Date[] {
  const hours = slotHoursFor(profileId);
  const out: Date[] = [];
  // Snap to whole minutes so slot instants are always hh:00:00, never hh:00:SS.
  const start = Math.floor(from.getTime() / 60_000) * 60_000;
  for (let m = 2; m <= 60 * 24 * 40 && out.length < count; m++) {
    const t = new Date(start + m * 60_000);
    const p = etParts(t);
    if (hours.includes(p.hour) && p.minute === 0) {
      out.push(t);
    }
  }
  return out;
}

function occupyFromIso(
  iso: string | null | undefined,
  into: Set<string>,
  profileId?: string | null,
) {
  if (!iso) return;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return;
  const key = occupiedSlotKey(t, profileId);
  if (key) into.add(key);
}

function collectTimes(iso: string | null | undefined, into: Date[]) {
  if (!iso) return;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return;
  into.push(t);
}

async function loadOccupancy(profileId: string): Promise<{
  keys: Set<string>;
  times: Date[];
}> {
  const keys = new Set<string>();
  const times: Date[] = [];
  const [scheduled, recent, claimed] = await Promise.all([
    listPosts({ profileId, status: "scheduled", limit: 100, fresh: true, timeoutMs: 8000 }).catch(
      () => [],
    ),
    listPosts({ profileId, limit: 80, fresh: true, timeoutMs: 8000 }).catch(() => []),
    listClaimedSlots(profileId).catch(() => []),
  ]);

  for (const post of [...scheduled, ...recent]) {
    occupyFromIso(post.scheduledFor, keys, profileId);
    occupyFromIso(post.publishedAt, keys, profileId);
    collectTimes(post.scheduledFor, times);
    collectTimes(post.publishedAt, times);
    for (const pl of post.platforms ?? []) {
      occupyFromIso(pl.scheduledFor, keys, profileId);
      occupyFromIso(pl.publishedAt, keys, profileId);
      collectTimes(pl.scheduledFor, times);
      collectTimes(pl.publishedAt, times);
    }
  }
  for (const iso of claimed) {
    occupyFromIso(iso, keys, profileId);
    collectTimes(iso, times);
  }
  return { keys, times };
}

export async function nextOpenSlot(profileId: string, from: Date = new Date()): Promise<Date> {
  const sibling = siblingProfileId(profileId);
  const [own, other] = await Promise.all([
    loadOccupancy(profileId),
    sibling ? loadOccupancy(sibling) : Promise.resolve({ keys: new Set<string>(), times: [] }),
  ]);

  for (const slot of upcomingSlots(from, 90, profileId)) {
    const key = slotKey(slot, profileId);
    if (!key || own.keys.has(key)) continue;
    if (other.times.some((t) => isWithinStagger(slot, t))) continue;
    return slot;
  }
  throw new Error("No open slot far enough from the other socials set in the next 40 days.");
}

export async function nextOpenSlots(
  profileIds: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(profileIds.filter(Boolean))];
  const entries = await Promise.all(
    unique.map(async (id) => {
      try {
        const at = await nextOpenSlot(id);
        return [id, at.toISOString()] as const;
      } catch {
        return [id, ""] as const;
      }
    }),
  );
  return Object.fromEntries(entries.filter(([, iso]) => iso));
}

export async function withNextSlots(
  targets: AgentPostTarget[],
): Promise<AgentPostTarget[]> {
  if (!targets.length) return targets;
  const next = await nextOpenSlots(targets.map((t) => t.profileId));
  return targets.map((t) => ({ ...t, nextSlot: next[t.profileId] || null }));
}
