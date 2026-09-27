import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Obsidian media vault ("Marketing OS Broll") for Jev.
 *
 * Kevin 2026-09-20: the vault is the knowledge graph for B-roll, logos and
 * brand assets so the video editor tools can pull them fast. Every media file
 * in the vault has a sidecar markdown note with YAML frontmatter:
 *
 *   type: image | video
 *   pillar: brand-assets | ai-companies
 *   brand: creator-os | no-code-academy | claude | openai ...
 *   kind: logo | icon | profile | wordmark | portrait | clip
 *   file: <vault-relative path to the media file>
 *   tags: [..]
 *   colors: [..]
 *   aliases: [..]           (what people call it: "Claude logo", "sphinx", ...)
 *   description: one line
 *
 * The index is read through the Local REST API plugin (https://127.0.0.1:27124)
 * with OBSIDIAN_API_KEY. It only exists on Kevin's Mac: on Railway the vault
 * is unreachable and the tool says so instead of throwing.
 */

const BASE = (process.env.OBSIDIAN_BASE_URL || "https://127.0.0.1:27124").replace(/\/$/, "");
const KEY = process.env.OBSIDIAN_API_KEY || "";
const VAULT_DIR = process.env.OBSIDIAN_VAULT_DIR || "";
/** Folder inside the vault that holds the media library (the rest of the vault is Kevin's notes). */
const MEDIA_ROOT = (process.env.OBSIDIAN_MEDIA_ROOT || "").replace(/^\/|\/$/g, "");
export const VAULT_NAME = process.env.OBSIDIAN_VAULT_NAME || "Marketing OS Broll";
const INDEX_TTL_MS = 60_000;

export type MediaItem = {
  /** vault-relative path of the sidecar note */
  note: string;
  /** vault-relative path of the media file */
  file: string;
  name: string;
  type: "image" | "video";
  pillar: string;
  brand: string;
  kind: string;
  tags: string[];
  colors: string[];
  aliases: string[];
  description: string;
  width?: number;
  height?: number;
  /** videos: seconds, fps, vault path of the poster frame */
  duration?: number;
  fps?: number;
  poster?: string;
};

export function obsidianConfigured(): boolean {
  return Boolean(KEY);
}

async function api(pathname: string, init?: RequestInit): Promise<Response> {
  // The plugin serves a self-signed cert; this call never leaves localhost.
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    return await fetch(`${BASE}${pathname}`, {
      ...init,
      headers: { Authorization: `Bearer ${KEY}`, ...(init?.headers || {}) },
      signal: AbortSignal.timeout(4_000),
      cache: "no-store",
    });
  } finally {
    if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
  }
}

async function listDir(dir: string): Promise<string[]> {
  const res = await api(`/vault/${dir ? encodeURI(dir).replace(/\/?$/, "/") : ""}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { files?: string[] };
  return data.files ?? [];
}

async function walk(dir = "", depth = 0): Promise<string[]> {
  if (depth > 5) return [];
  const out: string[] = [];
  for (const f of await listDir(dir)) {
    const p = dir ? `${dir}${f}` : f;
    if (f.endsWith("/")) out.push(...(await walk(p, depth + 1)));
    else if (f.endsWith(".md")) out.push(p);
  }
  return out;
}

async function readNote(notePath: string): Promise<string | null> {
  const res = await api(`/vault/${encodeURI(notePath)}`, { headers: { Accept: "text/markdown" } });
  if (!res.ok) return null;
  return res.text();
}

function parseFrontmatter(md: string): Record<string, string | string[]> {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const raw of m[1].split("\n")) {
    const line = raw.replace(/\r$/, "");
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      (out[listKey] as string[]).push(item[1].replace(/^["']|["']$/g, "").trim());
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, k, v] = kv;
    if (v === "") {
      out[k] = [];
      listKey = k;
    } else if (v.startsWith("[") && v.endsWith("]")) {
      out[k] = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      listKey = null;
    } else {
      out[k] = v.replace(/^["']|["']$/g, "").trim();
      listKey = null;
    }
  }
  return out;
}

let cache: { at: number; items: MediaItem[] } | null = null;

/** Every media note in the vault, cached for a minute. Empty when unreachable. */
export async function mediaIndex(force = false): Promise<MediaItem[]> {
  if (!KEY) return [];
  if (!force && cache && Date.now() - cache.at < INDEX_TTL_MS) return cache.items;
  let items: MediaItem[] = [];
  try {
    const notes = await walk(MEDIA_ROOT ? `${MEDIA_ROOT}/` : "");
    const results: (MediaItem | null)[] = await Promise.all(
      notes.map(async (note): Promise<MediaItem | null> => {
        const md = await readNote(note);
        if (!md) return null;
        const fm = parseFrontmatter(md);
        if (!fm.file || !fm.pillar) return null;
        const arr = (v: unknown) => (Array.isArray(v) ? v : v ? [String(v)] : []);
        return {
          note,
          file: String(fm.file),
          name: String(fm.name || path.basename(note, ".md")),
          type: (String(fm.type) === "video" ? "video" : "image") as "image" | "video",
          pillar: String(fm.pillar),
          brand: String(fm.brand || ""),
          kind: String(fm.kind || ""),
          tags: arr(fm.tags),
          colors: arr(fm.colors),
          aliases: arr(fm.aliases),
          description: String(fm.description || ""),
          width: fm.width ? Number(fm.width) : undefined,
          height: fm.height ? Number(fm.height) : undefined,
          duration: fm.duration ? Number(fm.duration) : undefined,
          fps: fm.fps ? Number(fm.fps) : undefined,
          poster: fm.poster ? String(fm.poster) : undefined,
        };
      }),
    );
    items = results.filter((x): x is MediaItem => Boolean(x));
  } catch {
    items = cache?.items ?? [];
  }
  cache = { at: Date.now(), items };
  return items;
}

/** Jev choice criteria: one option per brand/company in the vault (<=255). */
export function brandCriteria(items: MediaItem[]): Record<string, string> {
  const by = new Map<string, { names: Set<string>; pillar: string; aliases: Set<string> }>();
  for (const it of items) {
    if (!it.brand) continue;
    const e = by.get(it.brand) ?? { names: new Set(), pillar: it.pillar, aliases: new Set() };
    e.names.add(it.name);
    for (const a of it.aliases) e.aliases.add(a);
    by.set(it.brand, e);
  }
  const out: Record<string, string> = {};
  for (const [brand, e] of [...by.entries()].sort()) {
    const al = [...e.aliases].slice(0, 6).join(", ");
    out[brand] = `${e.pillar === "brand-assets" ? "One of OUR accounts/brands, only when named" : "AI company, only when named"}: ${brand.replace(/-/g, " ")}${al ? ` (${al})` : ""}. ${e.names.size} file${e.names.size === 1 ? "" : "s"}.`;
    if (Object.keys(out).length >= 250) break;
  }
  out.any = "No single brand or company is named: 'what brand assets do we have', 'all our logos', 'which AI company logos do we have', 'what's in the vault', 'everything'.";
  return out;
}

export const PILLARS = {
  "brand-assets": "Our own brand assets: Creator OS logos and app icon, No Code Academy logo, Hoops AI app icon, profile pictures of our social accounts (kevbuildsapps, Kev AI, Megan, Danny, Creator OS).",
  "ai-companies": "AI company and startup B-roll marks: Claude, Anthropic, OpenAI, ChatGPT, Codex, Cursor, Gemini, NVIDIA, Meta, GitHub, Apify, Expo, Vercel, Supabase and the rest of the startup logo set.",
  "video-broll": "Video B-roll clips (real footage): Hoops AI court demos, GitNexus graph screen recording, iPhone foldable duo, Jev playing Subway Surfers. Use for 'b-roll', 'footage', 'clip', 'video of'.",
  any: "No pillar named / not specified.",
} as const;
export type PillarId = keyof typeof PILLARS;

export const MEDIA_KINDS = {
  logo: "A logo or wordmark.",
  icon: "An app icon or square tile.",
  profile: "A social account profile picture / avatar.",
  clip: "A video clip.",
  any: "Any kind.",
} as const;
export type MediaKindId = keyof typeof MEDIA_KINDS;

/** Absolute path on disk when the vault folder is known (local only), for serving thumbnails. */
export function mediaDiskPath(file: string): string | null {
  if (!VAULT_DIR) return null;
  const abs = path.resolve(VAULT_DIR, file);
  if (!abs.startsWith(path.resolve(VAULT_DIR))) return null;
  return fs.existsSync(abs) ? abs : null;
}
