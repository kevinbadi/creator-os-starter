import type { TregRow } from "./types";

/** Pull a useful card list out of the provider's raw body. Treg does not normalise. */

const ARRAY_KEYS = [
  "aweme_list",
  "itemList",
  "item_list",
  "awemeList",
  "videos",
  "video_list",
  "music_list",
  "musicList",
  "word_list",
  "wordList",
  "trending_list",
  "hot_list",
  "list",
  "items",
  "data",
  "results",
  "rows",
];

export function extractRows(body: unknown, limit = 24): TregRow[] {
  const arrays = collectArrays(body);
  arrays.sort((a, b) => scoreArray(b) - scoreArray(a));
  for (const arr of arrays) {
    const rows = arr.map(rowFromUnknown).filter((r): r is TregRow => Boolean(r?.title));
    if (rows.length) return rows.slice(0, limit);
  }
  return [];
}

function collectArrays(node: unknown, depth = 0, out: unknown[][] = []): unknown[][] {
  if (depth > 5 || node == null) return out;
  if (Array.isArray(node)) {
    if (node.length && node.every((x) => x && typeof x === "object")) out.push(node);
    return out;
  }
  if (typeof node !== "object") return out;
  const obj = node as Record<string, unknown>;
  for (const key of ARRAY_KEYS) {
    if (Array.isArray(obj[key])) collectArrays(obj[key], depth + 1, out);
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") collectArrays(v, depth + 1, out);
  }
  return out;
}

function scoreArray(arr: unknown[]): number {
  let n = 0;
  for (const item of arr.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (o.desc || o.title || o.word || o.sentence || o.music_name || o.name) n += 3;
    if (o.statistics || o.stats || o.play_count || o.playCount) n += 2;
    if (o.author || o.author_name || o.nickname) n += 1;
    if (o.video || o.video_id || o.aweme_id) n += 1;
  }
  return n * 10 + Math.min(arr.length, 40);
}

function rowFromUnknown(item: unknown): TregRow | null {
  if (!item || typeof item !== "object") return null;
  const o = flatten(item as Record<string, unknown>);
  const title =
    str(o.desc) ||
    str(o.title) ||
    str(o.word) ||
    str(o.sentence) ||
    str(o.music_name) ||
    str(o.musicName) ||
    str(o.name) ||
    str(o.keyword) ||
    str(o.caption) ||
    null;
  if (!title) return null;
  const author =
    str(o.unique_id) ||
    str(o.uniqueId) ||
    str(o.nickname) ||
    str(o.author_name) ||
    str(o.authorName) ||
    str(o.username);
  const plays = num(o.play_count ?? o.playCount ?? o.play ?? o.view_count ?? o.viewCount);
  const likes = num(o.digg_count ?? o.diggCount ?? o.like_count ?? o.likeCount);
  const metric = plays != null ? `${fmt(plays)} plays` : likes != null ? `${fmt(likes)} likes` : undefined;
  const url =
    str(o.share_url) ||
    str(o.shareUrl) ||
    str(o.video_url) ||
    str(o.play_url) ||
    str(o.url) ||
    undefined;
  const thumb =
    str(o.cover) ||
    str(o.origin_cover) ||
    str(o.dynamic_cover) ||
    str(o.cover_url) ||
    str(o.thumbnail) ||
    str(o.avatar_thumb) ||
    undefined;
  return { title: title.slice(0, 220), subtitle: author ? `@${author.replace(/^@/, "")}` : undefined, metric, url, thumb };
}

function flatten(obj: Record<string, unknown>, prefix = "", out: Record<string, unknown> = {}, depth = 0): Record<string, unknown> {
  if (depth > 3) return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}_${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flatten(v as Record<string, unknown>, depth === 0 ? k : key, out, depth + 1);
    } else if (typeof v === "string" || typeof v === "number") {
      if (out[k] == null) out[k] = v;
      out[key] = v;
    }
  }
  return out;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}
