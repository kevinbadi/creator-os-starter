import "server-only";
import { dbConfigured, query } from "@/lib/insforge/db";

/** Dropped AI stories, tools, and ideas — filled later by ingest automations. */

export const AI_NEWS_KINDS = ["news", "tool", "idea"] as const;
export type AiNewsKind = (typeof AI_NEWS_KINDS)[number];

export const AI_NEWS_STATUSES = ["new", "saved", "used", "dismissed"] as const;
export type AiNewsStatus = (typeof AI_NEWS_STATUSES)[number];

export const AI_NEWS_VIEWS = ["top", "repos", "products", "models", "stories", "ideas", "saved"] as const;
export type AiNewsView = (typeof AI_NEWS_VIEWS)[number];

export type AiNewsBrief = {
  date: string;
  headline: string;
  bullets: string[];
  videoIdeas: { title: string; hook: string; why: string; refs?: number[] }[];
  itemCount: number;
  sources: Record<string, number>;
  model: string | null;
  createdAt: string;
};

export type AiNewsItem = {
  id: string;
  kind: AiNewsKind;
  title: string;
  summary: string;
  url: string | null;
  source: string;
  sourceId: string;
  imageUrl: string | null;
  publishedAt: string | null;
  ingestedAt: string;
  tags: string[];
  status: AiNewsStatus;
  /** Model's 0-10 video-worthiness (null before the daily agent judged it). */
  videoScore: number | null;
  /** One-line spoken hook the agent suggested (score >= 6). */
  angle: string | null;
  /** Rank position inside its ingest day's top-100. */
  position: number | null;
  day: string | null;
  signal: string | null;
};

export type AiNewsCounts = {
  news: number;
  tool: number;
  idea: number;
  total: number;
  lastIngestedAt: string | null;
};

export type AiNewsIngestInput = {
  kind: AiNewsKind;
  title: string;
  summary?: string | null;
  url?: string | null;
  source?: string | null;
  sourceId?: string | null;
  imageUrl?: string | null;
  publishedAt?: string | null;
  tags?: string[] | null;
  extra?: Record<string, unknown> | null;
};

type Row = {
  id: string;
  kind: string;
  title: string;
  summary: string | null;
  url: string | null;
  source: string;
  source_id: string;
  image_url: string | null;
  published_at: Date | string | null;
  ingested_at: Date | string;
  tags: string[] | null;
  status: string;
  extra: Record<string, unknown> | null;
};

const TABLE = `create table if not exists ai_news_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('news', 'tool', 'idea')),
  title text not null,
  summary text,
  url text,
  source text not null default 'manual',
  source_id text not null,
  image_url text,
  published_at timestamptz,
  ingested_at timestamptz not null default now(),
  tags text[] not null default '{}',
  status text not null default 'new' check (status in ('new', 'saved', 'used', 'dismissed')),
  extra jsonb not null default '{}'::jsonb
)`;

const UNIQUE_SRC = `create unique index if not exists ai_news_items_source_uid
  on ai_news_items (source, source_id)`;

const FEED_IDX = `create index if not exists ai_news_items_feed
  on ai_news_items (status, ingested_at desc)`;

let schemaReady = false;

export async function ensureAiNewsSchema(): Promise<boolean> {
  if (!dbConfigured) return false;
  if (schemaReady) return true;
  await query(TABLE);
  await query(UNIQUE_SRC);
  await query(FEED_IDX);
  schemaReady = true;
  return true;
}

function iso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function asKind(v: string): AiNewsKind {
  return v === "tool" || v === "idea" ? v : "news";
}

function asStatus(v: string): AiNewsStatus {
  return v === "saved" || v === "used" || v === "dismissed" ? v : "new";
}

function toItem(r: Row): AiNewsItem {
  return {
    id: r.id,
    kind: asKind(r.kind),
    title: r.title,
    summary: r.summary ?? "",
    url: r.url,
    source: r.source,
    sourceId: r.source_id,
    imageUrl: r.image_url,
    publishedAt: iso(r.published_at),
    ingestedAt: iso(r.ingested_at) ?? new Date().toISOString(),
    tags: r.tags ?? [],
    status: asStatus(r.status),
    videoScore: numOrNull(r.extra?.videoScore),
    angle: strOrNull(r.extra?.angle),
    position: numOrNull(r.extra?.position),
    day: strOrNull(r.extra?.day),
    signal: signalOf(r.extra ?? {}),
  };
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
function strOrNull(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
}
/** Human "402 votes" / "1.2k stars today" style badge from the ingest metadata. */
function signalOf(x: Record<string, unknown>): string | null {
  const n = (k: string) => numOrNull(x[k]);
  const fmt = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(v));
  if (n("votes")) return `${fmt(n("votes")!)} votes`;
  if (n("starsToday")) return `${fmt(n("starsToday")!)} stars today`;
  if (n("stars")) return `${fmt(n("stars")!)} stars`;
  if (n("points")) return `${fmt(n("points")!)} pts`;
  if (n("upvotes")) return `${fmt(n("upvotes")!)} upvotes`;
  if (n("likes")) return `${fmt(n("likes")!)} likes`;
  return null;
}

export function isAiNewsView(v: unknown): v is AiNewsView {
  return typeof v === "string" && (AI_NEWS_VIEWS as readonly string[]).includes(v);
}

/** SQL fragment + params for a list view. */
function viewWhere(view: AiNewsView): { sql: string; params: unknown[] } {
  switch (view) {
    case "repos":
      return { sql: `source = 'github' and (extra->>'list') <> 'release'`, params: [] };
    case "products":
      return { sql: `source = 'producthunt'`, params: [] };
    case "models":
      return { sql: `source = 'huggingface'`, params: [] };
    case "stories":
      return { sql: `source in ('hackernews','openai','deepmind','techcrunch','verge') or (source = 'github' and (extra->>'list') = 'release')`, params: [] };
    case "ideas":
      return { sql: `kind = 'idea'`, params: [] };
    case "saved":
      return { sql: `status = 'saved'`, params: [] };
    default:
      return { sql: `true`, params: [] };
  }
}

/**
 * Ranked list for the desk: today's (latest ingest day's) items ordered by the
 * agent's rank, or a source list. `top` = the daily top-100.
 */
export async function listAiNewsView(view: AiNewsView, opts?: { day?: string | null; limit?: number }): Promise<{ items: AiNewsItem[]; day: string | null }> {
  if (!(await ensureAiNewsSchema())) return { items: [], day: null };
  const limit = Math.min(300, Math.max(1, opts?.limit ?? 100));
  let day = opts?.day ?? null;
  if (!day && view !== "saved") {
    const d = await query<{ day: string | null }>(
      `select max(extra->>'day') as day from ai_news_items where (extra->>'day') is not null`,
    );
    day = d[0]?.day ?? null;
  }
  const w = viewWhere(view);
  const dayClause = day && view !== "saved" ? `and (extra->>'day') = $2` : "";
  const rows = await query<Row>(
    `select id, kind, title, summary, url, source, source_id, image_url,
            published_at, ingested_at, tags, status, extra
       from ai_news_items
      where (${w.sql})
        and status <> 'dismissed'
        ${dayClause}
      order by coalesce((extra->>'videoScore')::numeric, -1) desc,
               coalesce((extra->>'rank')::numeric, 0) desc,
               ingested_at desc
      limit $1`,
    dayClause ? [limit, day] : [limit],
  );
  return { items: rows.map(toItem), day };
}

export async function latestAiNewsBrief(): Promise<AiNewsBrief | null> {
  if (!dbConfigured) return null;
  try {
    const rows = await query<{
      brief_date: Date | string; headline: string; bullets: unknown; video_ideas: unknown;
      item_count: number; sources: unknown; model: string | null; created_at: Date | string;
    }>(`select brief_date, headline, bullets, video_ideas, item_count, sources, model, created_at
          from ai_news_briefs order by brief_date desc limit 1`);
    const r = rows[0];
    if (!r) return null;
    const d = r.brief_date instanceof Date
      ? new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(r.brief_date)
      : String(r.brief_date).slice(0, 10);
    return {
      date: d,
      headline: r.headline,
      bullets: Array.isArray(r.bullets) ? r.bullets.map(String) : [],
      videoIdeas: Array.isArray(r.video_ideas) ? (r.video_ideas as AiNewsBrief["videoIdeas"]) : [],
      itemCount: Number(r.item_count) || 0,
      sources: (r.sources && typeof r.sources === "object" ? r.sources : {}) as Record<string, number>,
      model: r.model,
      createdAt: iso(r.created_at) ?? new Date().toISOString(),
    };
  } catch {
    return null; // table appears after the first agent run
  }
}

export async function listAiNews(opts?: {
  kind?: AiNewsKind | "all";
  includeDismissed?: boolean;
  limit?: number;
}): Promise<AiNewsItem[]> {
  if (!(await ensureAiNewsSchema())) return [];
  const kind = opts?.kind && opts.kind !== "all" ? opts.kind : null;
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 40));
  const rows = await query<Row>(
    `select id, kind, title, summary, url, source, source_id, image_url,
            published_at, ingested_at, tags, status, extra
       from ai_news_items
      where ($1::text is null or kind = $1)
        and ($2::bool or status <> 'dismissed')
      order by coalesce(published_at, ingested_at) desc, ingested_at desc
      limit $3`,
    [kind, Boolean(opts?.includeDismissed), limit],
  );
  return rows.map(toItem);
}

export async function aiNewsCounts(): Promise<AiNewsCounts> {
  if (!(await ensureAiNewsSchema())) {
    return { news: 0, tool: 0, idea: 0, total: 0, lastIngestedAt: null };
  }
  const rows = await query<{
    kind: string;
    n: string | number;
    last: Date | string | null;
  }>(
    `select kind, count(*)::int as n, max(ingested_at) as last
       from ai_news_items
      where status <> 'dismissed'
      group by kind`,
  );
  const out: AiNewsCounts = {
    news: 0,
    tool: 0,
    idea: 0,
    total: 0,
    lastIngestedAt: null,
  };
  for (const r of rows) {
    const n = Number(r.n) || 0;
    if (r.kind === "news" || r.kind === "tool" || r.kind === "idea") out[r.kind] = n;
    out.total += n;
    const t = iso(r.last);
    if (t && (!out.lastIngestedAt || t > out.lastIngestedAt)) out.lastIngestedAt = t;
  }
  return out;
}

function cleanUrl(u: unknown): string | null {
  const s = String(u ?? "").trim().slice(0, 2000);
  if (!s) return null;
  try {
    const parsed = new URL(s);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isAiNewsKind(v: unknown): v is AiNewsKind {
  return v === "news" || v === "tool" || v === "idea";
}

/** Insert or refresh a drop. Same (source, source_id) updates copy without resetting status. */
export async function upsertAiNewsItems(
  inputs: AiNewsIngestInput[],
): Promise<{ upserted: number; ids: string[] }> {
  if (!(await ensureAiNewsSchema())) {
    throw new Error("DATABASE_URL is not set");
  }
  const ids: string[] = [];
  for (const raw of inputs) {
    if (!isAiNewsKind(raw.kind)) continue;
    const title = String(raw.title ?? "").trim().slice(0, 300);
    if (!title) continue;
    const source = String(raw.source ?? "manual").trim().slice(0, 80) || "manual";
    const sourceId =
      String(raw.sourceId ?? "").trim().slice(0, 400) ||
      cleanUrl(raw.url) ||
      `manual-${crypto.randomUUID()}`;
    const tags = (raw.tags ?? [])
      .map((t) => String(t).trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 12);
    const published = iso(raw.publishedAt ?? null);
    const extra = raw.extra && typeof raw.extra === "object" ? raw.extra : {};
    const rows = await query<{ id: string }>(
      `insert into ai_news_items
         (kind, title, summary, url, source, source_id, image_url, published_at, tags, extra)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       on conflict (source, source_id) do update set
         kind = excluded.kind,
         title = excluded.title,
         summary = excluded.summary,
         url = excluded.url,
         image_url = excluded.image_url,
         published_at = coalesce(excluded.published_at, ai_news_items.published_at),
         tags = excluded.tags,
         extra = ai_news_items.extra || excluded.extra,
         ingested_at = now()
       returning id`,
      [
        raw.kind,
        title,
        String(raw.summary ?? "").trim().slice(0, 2000) || null,
        cleanUrl(raw.url),
        source,
        sourceId,
        cleanUrl(raw.imageUrl),
        published,
        tags,
        JSON.stringify(extra),
      ],
    );
    if (rows[0]) ids.push(rows[0].id);
  }
  return { upserted: ids.length, ids };
}

export async function setAiNewsStatus(
  id: string,
  status: AiNewsStatus,
): Promise<void> {
  if (!(await ensureAiNewsSchema())) return;
  const sid = String(id ?? "").trim();
  if (!sid || !AI_NEWS_STATUSES.includes(status)) return;
  await query(`update ai_news_items set status = $2 where id = $1`, [sid, status]);
}
