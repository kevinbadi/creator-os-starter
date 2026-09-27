import "server-only";
import { listPosts } from "@/lib/zernio/client";
import { listClaimedSlots } from "./store";
import { ttlDelPrefix } from "@/lib/cache/ttl";
import {
  KEV_AI_PROFILE_ID,
  KEV_BUILDS_APPS_PROFILE_ID,
  MEGAN_PROFILE_ID,
  type AgentPostTarget,
} from "./types";

/** Kev Builds Apps: 12am / 3 / 6 / 9pm ET (Kevin 2026-09-08: 4/day). */
export const SLOT_HOURS_ET = [0, 15, 18, 21] as const;
/** Kev AI sits +1h so the same video never uploads on both socials at once. */
export const KEV_AI_SLOT_HOURS_ET = [1, 16, 19, 22] as const;
/** Megan: staggered off Kevin grids so brands don't collide (Kevin 2026-09-16). */
export const MEGAN_SLOT_HOURS_ET = [2, 14, 17, 20] as const;
/** Minimum gap between a Kev Builds Apps post and the Kev AI twin. */
/**
 * Minimum gap between a candidate slot and anything on the sibling socials set.
 * The two grids are offset by exactly 1h (3/6/9/12 vs 4/7/10/1), so this must be
 * comfortably under 60 min: Zernio publishes a few minutes late (a 2:00pm thread
 * lands at 2:03) and slot instants used to carry the drain's seconds, which made
 * a 6:00pm candidate "collide" with a 7:00:12pm sibling post and skip open slots.
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
  if (profileId === KEV_BUILDS_APPS_PROFILE_ID) return KEV_AI_PROFILE_ID;
  if (profileId === KEV_AI_PROFILE_ID) return KEV_BUILDS_APPS_PROFILE_ID;
  return null;
}

export function slotHoursFor(profileId?: string | null): readonly number[] {
  if (profileId === KEV_AI_PROFILE_ID) return KEV_AI_SLOT_HOURS_ET;
  if (profileId === MEGAN_PROFILE_ID) return MEGAN_SLOT_HOURS_ET;
  return SLOT_HOURS_ET;
}

export function slotGridLabel(profileId?: string | null): string {
  if (profileId === KEV_AI_PROFILE_ID) return "1am / 4 / 7 / 10pm ET";
  if (profileId === MEGAN_PROFILE_ID) return "2am / 2 / 5 / 8pm ET";
  return "12am / 3 / 6 / 9pm ET";
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

type Occupancy = { keys: Set<string>; times: Date[]; degraded: boolean };
const EMPTY_OCC: Occupancy = { keys: new Set<string>(), times: [], degraded: true };

/**
 * `deep` also walks the published history (month board). A rejected Zernio
 * read is reported as `degraded` instead of silently reading as "no posts":
 * the board must never paint red holes because Zernio timed out.
 */
/**
 * `fresh` (scheduler path) bypasses the Zernio TTL cache so a slot just taken
 * is never double-booked. The board/desk path passes fresh=false and rides the
 * 30s zfetch cache (busted by invalidateSlotBoards on every schedule write);
 * the deep published walk is cached for 10 min because history does not move.
 */
async function loadOccupancy(profileId: string, deep = false, fresh = true): Promise<Occupancy> {
  const keys = new Set<string>();
  const times: Date[] = [];
  let degraded = false;
  const soft = <T,>(p: Promise<T[]>): Promise<T[]> =>
    p.catch(() => {
      degraded = true;
      return [];
    });
  const [scheduled, recent, published, claimed] = await Promise.all([
    soft(listPosts({ profileId, status: "scheduled", limit: 100, fresh, timeoutMs: 8000 })),
    soft(listPosts({ profileId, limit: 80, fresh, timeoutMs: 8000 })),
    deep
      ? soft(publishedHistory(profileId))
      : Promise.resolve([] as Awaited<ReturnType<typeof listPosts>>),
    soft(listClaimedSlots(profileId)),
  ]);

  for (const post of [...scheduled, ...recent, ...published]) {
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
  return { keys, times, degraded };
}

function pickOpenSlot(
  profileId: string,
  own: Occupancy,
  other: Occupancy,
  from: Date,
): Date {
  for (const slot of upcomingSlots(from, 90, profileId)) {
    const key = slotKey(slot, profileId);
    if (!key || own.keys.has(key)) continue;
    if (other.times.some((t) => isWithinStagger(slot, t))) continue;
    return slot;
  }
  throw new Error("No open slot far enough from the other socials set in the next 40 days.");
}

export async function nextOpenSlot(profileId: string, from: Date = new Date()): Promise<Date> {
  const sibling = siblingProfileId(profileId);
  const [own, other] = await Promise.all([
    loadOccupancy(profileId),
    sibling ? loadOccupancy(sibling) : Promise.resolve(EMPTY_OCC),
  ]);
  return pickOpenSlot(profileId, own, other, from);
}

// ───────────────────────── month slot board ─────────────────────────
// Kevin 2026-09-18: a horizontal bar with four dots per day of the month, one
// dot per pipeline slot, so open slots and holes are visible at a glance. It is
// derived from the SAME occupancy the slot picker uses (Zernio scheduled +
// published posts, plus claimed agent_posts rows), never from a stored copy,
// so every upload / reschedule / publish shows up on the next fetch.

export type SlotState = "filled" | "open" | "missed";

export type SlotBoardSlot = {
  hour: number;
  /** ISO instant of the slot in ET. */
  at: string;
  state: SlotState;
};

export type SlotBoardDay = {
  date: string;
  day: number;
  today: boolean;
  slots: SlotBoardSlot[];
};

export type SlotBoard = {
  profileId: string;
  name: string;
  /** YYYY-MM (ET). */
  month: string;
  hours: number[];
  days: SlotBoardDay[];
  filled: number;
  openAhead: number;
  missed: number;
  nextOpen: string | null;
  /** A Zernio read failed while building this board; holes may be false. */
  degraded: boolean;
};

export function currentEtMonth(at: Date = new Date()): string {
  return etParts(at).date.slice(0, 7);
}

export function normalizeMonth(raw: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(raw ?? "").trim());
  if (!m) return currentEtMonth();
  const mo = parseInt(m[2], 10);
  if (mo < 1 || mo > 12) return currentEtMonth();
  return `${m[1]}-${m[2]}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The UTC instant of `date` @ `hour`:00 in ET (DST-aware, no library). */
export function etSlotInstant(date: string, hour: number): Date {
  const [y, m, d] = date.split("-").map(Number);
  for (const off of [4, 5]) {
    const t = new Date(Date.UTC(y, m - 1, d, hour + off));
    const p = etParts(t);
    if (p.date === date && p.hour === hour && p.minute === 0) return t;
  }
  // Non-existent local hour (spring-forward): fall back to +4.
  return new Date(Date.UTC(y, m - 1, d, hour + 4));
}

export function buildSlotBoard(
  profileId: string,
  name: string,
  month: string,
  occ: Occupancy,
  now: Date = new Date(),
): SlotBoard {
  const hours = [...slotHoursFor(profileId)];
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = etParts(now).date;
  const days: SlotBoardDay[] = [];
  let filled = 0;
  let openAhead = 0;
  let missed = 0;
  let nextOpen: string | null = null;
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const slots: SlotBoardSlot[] = hours.map((hour) => {
      const at = etSlotInstant(date, hour);
      const key = keyFor(date, hour);
      let state: SlotState;
      if (occ.keys.has(key)) {
        state = "filled";
        filled++;
      } else if (at.getTime() <= now.getTime()) {
        state = "missed";
        missed++;
      } else {
        state = "open";
        openAhead++;
        if (!nextOpen) nextOpen = at.toISOString();
      }
      return { hour, at: at.toISOString(), state };
    });
    days.push({ date, day, today: date === today, slots });
  }
  return {
    profileId, name, month, hours, days, filled, openAhead, missed, nextOpen,
    degraded: occ.degraded,
  };
}

/**
 * Next open slot + month board for every target, from ONE occupancy load per
 * profile (the desk polls this; do not fetch Zernio twice for the same data).
 */
const HISTORY_TTL_MS = 10 * 60_000;
const historyMemo = new Map<string, { at: number; p: Promise<Awaited<ReturnType<typeof listPosts>>> }>();

function publishedHistory(profileId: string) {
  const hit = historyMemo.get(profileId);
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.p;
  const p = listPosts({ profileId, status: "published", limit: 300, fresh: true, timeoutMs: 10000 });
  historyMemo.set(profileId, { at: Date.now(), p });
  p.catch(() => historyMemo.delete(profileId));
  return p;
}

type BoardsResult = { targets: AgentPostTarget[]; boards: SlotBoard[] };
const BOARD_MEMO_MS = 30_000;
const boardMemo = new Map<string, { at: number; p: Promise<BoardsResult> }>();

export async function slotBoardsForTargets(
  targets: AgentPostTarget[],
  month: string = currentEtMonth(),
): Promise<BoardsResult> {
  if (!targets.length) return { targets, boards: [] };
  // The desk polls every 2.5s while a job runs; share one Zernio walk per window.
  const memoKey = `${month}|${targets.map((t) => t.profileId).sort().join(",")}`;
  const hit = boardMemo.get(memoKey);
  if (hit && Date.now() - hit.at < BOARD_MEMO_MS) return hit.p;
  const p = buildBoardsUncached(targets, month);
  boardMemo.set(memoKey, { at: Date.now(), p });
  p.then((r) => {
    // A degraded walk should not be served for the whole memo window.
    if (r.boards.some((b) => b.degraded)) boardMemo.delete(memoKey);
  }).catch(() => boardMemo.delete(memoKey));
  return p;
}

/** Drop the memo so the next GET rebuilds (call after any schedule change). */
export function invalidateSlotBoards(): void {
  boardMemo.clear();
  historyMemo.clear();
  ttlDelPrefix("zernio:GET:/posts");
}

async function buildBoardsUncached(
  targets: AgentPostTarget[],
  month: string,
): Promise<BoardsResult> {
  const ids = [...new Set(targets.map((t) => t.profileId).filter(Boolean))];
  const siblings = ids.map(siblingProfileId).filter((s): s is string => !!s);
  const loadIds = [...new Set([...ids, ...siblings])];
  const occ = new Map<string, Occupancy>();
  await Promise.all(
    loadIds.map(async (id) => {
      occ.set(id, await loadOccupancy(id, ids.includes(id), false).catch(() => EMPTY_OCC));
    }),
  );
  const now = new Date();
  const next: Record<string, string> = {};
  const boards: SlotBoard[] = [];
  for (const t of targets) {
    const own = occ.get(t.profileId) ?? EMPTY_OCC;
    const sib = siblingProfileId(t.profileId);
    const other = (sib && occ.get(sib)) || EMPTY_OCC;
    try {
      next[t.profileId] = pickOpenSlot(t.profileId, own, other, now).toISOString();
    } catch {
      /* no slot in 40 days */
    }
    boards.push(buildSlotBoard(t.profileId, t.name, month, own, now));
  }
  return {
    targets: targets.map((t) => ({ ...t, nextSlot: next[t.profileId] || null })),
    boards,
  };
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
