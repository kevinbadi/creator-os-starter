import "server-only";
import { dbConfigured, query } from "@/lib/insforge/db";

// Copywriter sources: Instagram videos Kevin feeds in. Each row tracks one
// URL through transcribe (Apify) -> analyze (LLM topic read) -> done. The
// transcript + topic read are the raw material the copywriting steps build on.

export type SourceStatus = "queued" | "transcribing" | "analyzing" | "done" | "failed";

export type CopySource = {
  id: string;
  url: string;
  runId: string | null;
  status: SourceStatus;
  transcript: string;
  caption: string;
  hook3s: string;
  username: string;
  thumbnailUrl: string;
  likeCount: number | null;
  commentCount: number | null;
  viewCount: number | null;
  durationSec: number | null;
  language: string | null;
  topic: string;
  summary: string;
  hook: string;
  keyPoints: string[];
  format: string;
  cta: string;
  error: string;
  tag: string | null;
  title: string;
  postedAt: string | null;
  rewrite: string;
  rewriteSkill: string;
  rewrittenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string;
  url: string;
  run_id: string | null;
  status: SourceStatus;
  transcript: string | null;
  caption: string | null;
  hook3s: string | null;
  username: string | null;
  thumbnail_url: string | null;
  like_count: number | string | null;
  comment_count: number | string | null;
  view_count: number | string | null;
  duration_sec: number | string | null;
  language: string | null;
  topic: string | null;
  summary: string | null;
  hook: string | null;
  key_points: unknown;
  format: string | null;
  cta: string | null;
  error: string | null;
  tag: string | null;
  title: string | null;
  posted_at: Date | string | null;
  rewrite: string | null;
  rewrite_skill: string | null;
  rewritten_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function toSource(r: Row): CopySource {
  return {
    id: r.id,
    url: r.url,
    runId: r.run_id,
    status: r.status,
    transcript: r.transcript ?? "",
    caption: r.caption ?? "",
    hook3s: r.hook3s ?? "",
    username: r.username ?? "",
    thumbnailUrl: r.thumbnail_url ?? "",
    likeCount: r.like_count == null ? null : Number(r.like_count),
    commentCount: r.comment_count == null ? null : Number(r.comment_count),
    viewCount: r.view_count == null ? null : Number(r.view_count),
    durationSec: r.duration_sec == null ? null : Number(r.duration_sec),
    language: r.language,
    topic: r.topic ?? "",
    summary: r.summary ?? "",
    hook: r.hook ?? "",
    keyPoints: Array.isArray(r.key_points) ? (r.key_points as string[]) : [],
    format: r.format ?? "",
    cta: r.cta ?? "",
    error: r.error ?? "",
    tag: r.tag ?? null,
    title: r.title ?? "",
    postedAt: r.posted_at ? iso(r.posted_at) : null,
    rewrite: r.rewrite ?? "",
    rewriteSkill: r.rewrite_skill ?? "",
    rewrittenAt: r.rewritten_at ? iso(r.rewritten_at) : null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

let schemaReady: Promise<boolean> | null = null;

export function ensureSchema(): Promise<boolean> {
  if (!dbConfigured) return Promise.resolve(false);
  if (!schemaReady) {
    schemaReady = query(
      `create table if not exists copywriter_sources (
         id uuid primary key default gen_random_uuid(),
         url text not null,
         run_id text,
         status text not null default 'queued',
         transcript text,
         caption text,
         hook3s text,
         username text,
         thumbnail_url text,
         like_count bigint,
         comment_count bigint,
         view_count bigint,
         duration_sec numeric,
         language text,
         topic text,
         summary text,
         hook text,
         key_points jsonb,
         format text,
         cta text,
         error text,
         created_at timestamptz not null default now(),
         updated_at timestamptz not null default now()
       );
       create index if not exists copywriter_sources_run_idx on copywriter_sources (run_id);
       create index if not exists copywriter_sources_created_idx on copywriter_sources (created_at desc);
       alter table copywriter_sources add column if not exists tag text;
       alter table copywriter_sources add column if not exists posted_at timestamptz;
       alter table copywriter_sources add column if not exists title text;
       alter table copywriter_sources add column if not exists rewrite text;
       alter table copywriter_sources add column if not exists rewrite_skill text;
       alter table copywriter_sources add column if not exists rewritten_at timestamptz;
       create index if not exists copywriter_sources_tag_idx on copywriter_sources (tag);`,
    )
      .then(() => true)
      .catch((e) => {
        console.error("[copywriter] schema failed:", e instanceof Error ? e.message : e);
        schemaReady = null;
        return false;
      });
  }
  return schemaReady;
}

const COLS =
  "id, url, run_id, status, transcript, caption, hook3s, username, thumbnail_url, like_count, comment_count, view_count, duration_sec, language, topic, summary, hook, key_points, format, cta, error, tag, title, posted_at, rewrite, rewrite_skill, rewritten_at, created_at, updated_at";

export async function listSources(limit = 60): Promise<CopySource[]> {
  if (!(await ensureSchema())) return [];
  const rows = await query<Row>(
    `select ${COLS} from copywriter_sources where tag is null order by created_at desc limit $1`,
    [limit],
  );
  return rows.map(toSource);
}

export async function listStyleSources(limit = 200): Promise<CopySource[]> {
  if (!(await ensureSchema())) return [];
  const rows = await query<Row>(
    `select ${COLS} from copywriter_sources
      where tag is not null
      order by tag asc, posted_at desc nulls last, created_at desc
      limit $1`,
    [limit],
  );
  return rows.map(toSource);
}

export async function getSource(id: string): Promise<CopySource | null> {
  if (!(await ensureSchema())) return null;
  const rows = await query<Row>(`select ${COLS} from copywriter_sources where id = $1`, [id]);
  return rows[0] ? toSource(rows[0]) : null;
}

export async function listSourcesByRun(runId: string): Promise<CopySource[]> {
  if (!(await ensureSchema())) return [];
  const rows = await query<Row>(
    `select ${COLS} from copywriter_sources where run_id = $1 order by created_at asc`,
    [runId],
  );
  return rows.map(toSource);
}

export async function createSources(urls: string[], runId: string | null): Promise<CopySource[]> {
  if (!(await ensureSchema())) throw new Error("DATABASE_URL is not configured");
  const out: CopySource[] = [];
  for (const url of urls) {
    const rows = await query<Row>(
      `insert into copywriter_sources (url, run_id, status)
       values ($1, $2, $3) returning ${COLS}`,
      [url, runId, runId ? "transcribing" : "failed"],
    );
    if (rows[0]) out.push(toSource(rows[0]));
  }
  return out;
}

export async function updateSource(
  id: string,
  patch: Partial<{
    status: SourceStatus;
    transcript: string;
    caption: string;
    hook3s: string;
    username: string;
    thumbnailUrl: string;
    likeCount: number | null;
    commentCount: number | null;
    viewCount: number | null;
    durationSec: number | null;
    language: string | null;
    topic: string;
    summary: string;
    hook: string;
    keyPoints: string[];
    format: string;
    cta: string;
    error: string;
    rewrite: string;
    rewriteSkill: string;
    rewrittenAt: Date | null;
  }>,
): Promise<void> {
  if (!(await ensureSchema())) return;
  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.status !== undefined) add("status", patch.status);
  if (patch.transcript !== undefined) add("transcript", patch.transcript);
  if (patch.caption !== undefined) add("caption", patch.caption);
  if (patch.hook3s !== undefined) add("hook3s", patch.hook3s);
  if (patch.username !== undefined) add("username", patch.username);
  if (patch.thumbnailUrl !== undefined) add("thumbnail_url", patch.thumbnailUrl);
  if (patch.likeCount !== undefined) add("like_count", patch.likeCount);
  if (patch.commentCount !== undefined) add("comment_count", patch.commentCount);
  if (patch.viewCount !== undefined) add("view_count", patch.viewCount);
  if (patch.durationSec !== undefined) add("duration_sec", patch.durationSec);
  if (patch.language !== undefined) add("language", patch.language);
  if (patch.topic !== undefined) add("topic", patch.topic);
  if (patch.summary !== undefined) add("summary", patch.summary);
  if (patch.hook !== undefined) add("hook", patch.hook);
  if (patch.keyPoints !== undefined) add("key_points", JSON.stringify(patch.keyPoints));
  if (patch.format !== undefined) add("format", patch.format);
  if (patch.cta !== undefined) add("cta", patch.cta);
  if (patch.error !== undefined) add("error", patch.error);
  if (patch.rewrite !== undefined) add("rewrite", patch.rewrite);
  if (patch.rewriteSkill !== undefined) add("rewrite_skill", patch.rewriteSkill);
  if (patch.rewrittenAt !== undefined) add("rewritten_at", patch.rewrittenAt);
  if (!sets.length) return;
  params.push(id);
  await query(
    `update copywriter_sources set ${sets.join(", ")}, updated_at = now() where id = $${params.length}`,
    params,
  );
}

export async function deleteSource(id: string): Promise<void> {
  if (!(await ensureSchema())) return;
  await query(`delete from copywriter_sources where id = $1`, [id]);
}
