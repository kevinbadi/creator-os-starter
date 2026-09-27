import "server-only";
import { dbConfigured, isDbConnectError, query } from "@/lib/insforge/db";
import {
  agentPostPlatformsOverlap,
  parseAgentPostPlatforms,
  type AgentPost,
  type AgentPostStatus,
} from "./types";

export const AGENT_POSTS_PROFILE_ID = (
  process.env.CREATOR_OS_PROFILE_ID || ""
).trim();
export type { AgentPost, AgentPostStatus } from "./types";

type Row = {
  id: string;
  status: string;
  step: string | null;
  error: string | null;
  profile_id: string;
  video_url: string;
  resource_url: string;
  dm_note: string | null;
  transcript: string | null;
  keyword: string | null;
  caption: string | null;
  youtube_title: string | null;
  youtube_description: string | null;
  twitter_caption: string | null;
  linkedin_caption: string | null;
  threads_caption: string | null;
  dm_text: string | null;
  comment_reply: string | null;
  thumbnail_url: string | null;
  scheduled_for: Date | string | null;
  zernio_post_id: string | null;
  followup_zernio_post_id: string | null;
  comment_dm_status: string | null;
  platforms: string[] | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const TABLE = `create table if not exists agent_posts (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued',
  step text,
  error text,
  profile_id text not null,
  video_url text not null,
  resource_url text not null,
  dm_note text,
  transcript text,
  keyword text,
  caption text,
  youtube_title text,
  youtube_description text,
  twitter_caption text,
  linkedin_caption text,
  threads_caption text,
  dm_text text,
  comment_reply text,
  thumbnail_url text,
  scheduled_for timestamptz,
  zernio_post_id text,
  comment_dm_status text,
  platforms text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)`;

const STATUS_IDX = `create index if not exists agent_posts_status_created
  on agent_posts (status, created_at)`;

const SLOT_IDX = `create index if not exists agent_posts_profile_slot
  on agent_posts (profile_id, scheduled_for)
  where scheduled_for is not null and status <> 'failed'`;

let schemaReady = false;

async function ensureSchema(): Promise<boolean> {
  if (!dbConfigured) return false;
  if (schemaReady) return true;
  try {
    await query(
      `${TABLE};
       alter table agent_posts add column if not exists dm_note text;
       alter table agent_posts add column if not exists followup_zernio_post_id text;
       alter table agent_posts add column if not exists platforms text[];
       ${STATUS_IDX};
       ${SLOT_IDX}`,
    );
    schemaReady = true;
    return true;
  } catch {
    return false;
  }
}

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

function mapRow(r: Row): AgentPost {
  return {
    id: r.id,
    status: r.status as AgentPostStatus,
    step: r.step,
    error: r.error,
    profileId: r.profile_id,
    videoUrl: r.video_url,
    resourceUrl: r.resource_url,
    dmNote: r.dm_note,
    transcript: r.transcript,
    keyword: r.keyword,
    caption: r.caption,
    youtubeTitle: r.youtube_title,
    youtubeDescription: r.youtube_description,
    twitterCaption: r.twitter_caption,
    linkedinCaption: r.linkedin_caption,
    threadsCaption: r.threads_caption,
    dmText: r.dm_text,
    commentReply: r.comment_reply,
    thumbnailUrl: r.thumbnail_url,
    scheduledFor: iso(r.scheduled_for),
    zernioPostId: r.zernio_post_id,
    followupZernioPostId: r.followup_zernio_post_id,
    commentDmStatus: r.comment_dm_status,
    platforms: parseAgentPostPlatforms(r.platforms),
    createdAt: iso(r.created_at) ?? new Date().toISOString(),
    updatedAt: iso(r.updated_at) ?? new Date().toISOString(),
  };
}

/** Same video already queued/scheduled/live on overlapping platforms for this socials set. */
export async function findActiveDuplicateOnProfile(
  profileId: string,
  videoUrl: string,
  platforms?: string[] | null,
): Promise<AgentPost | null> {
  if (!(await ensureSchema())) return null;
  const rows = await query<Row>(
    `select * from agent_posts
      where profile_id = $1
        and video_url = $2
        and status <> 'failed'
      order by created_at desc`,
    [profileId, videoUrl],
  );
  for (const row of rows) {
    const job = mapRow(row);
    if (agentPostPlatformsOverlap(job.platforms, platforms ?? null)) return job;
  }
  return null;
}

export async function createAgentPost(input: {
  profileId: string;
  videoUrl: string;
  resourceUrl: string;
  dmNote?: string | null;
  youtubeTitle?: string | null;
  caption?: string | null;
  platforms?: string[] | null;
}): Promise<AgentPost> {
  if (!(await ensureSchema())) {
    throw new Error("Database is not configured.");
  }
  const platforms = parseAgentPostPlatforms(input.platforms);
  const dup = await findActiveDuplicateOnProfile(
    input.profileId,
    input.videoUrl,
    platforms,
  );
  if (dup) {
    throw new Error(
      "That video is already on one of those platforms for this socials set. Same video on Kev Builds Apps and Kev AI is fine — or pick platforms that are still free.",
    );
  }
  const rows = await query<Row>(
    `insert into agent_posts (profile_id, video_url, resource_url, dm_note, youtube_title, caption, platforms, status, step)
     values ($1, $2, $3, $4, $5, $6, $7, 'queued', 'queued')
     returning *`,
    [
      input.profileId,
      input.videoUrl,
      input.resourceUrl,
      input.dmNote || null,
      input.youtubeTitle || null,
      input.caption || null,
      platforms,
    ],
  );
  return mapRow(rows[0]);
}

/** Twin job already covering the same file — wait instead of racing fal/download. */
export async function findWorkingSibling(
  videoUrl: string,
  exceptId: string,
  profileId?: string,
): Promise<AgentPost | null> {
  if (!(await ensureSchema())) return null;
  const rows = await query<Row>(
    profileId
      ? `select * from agent_posts
          where video_url = $1
            and id <> $2
            and profile_id = $3
            and status = 'working'
            and updated_at > now() - interval '20 minutes'
          order by updated_at desc
          limit 1`
      : `select * from agent_posts
          where video_url = $1
            and id <> $2
            and status = 'working'
            and updated_at > now() - interval '20 minutes'
          order by updated_at desc
          limit 1`,
    profileId ? [videoUrl, exceptId, profileId] : [videoUrl, exceptId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function findReusableGeneration(
  videoUrl: string,
  exceptId: string,
  profileId?: string,
): Promise<AgentPost | null> {
  if (!(await ensureSchema())) return null;
  // Same profile only — Kevin + Megan must not share covers / keywords.
  const rows = await query<Row>(
    profileId
      ? `select * from agent_posts
          where video_url = $1
            and id <> $2
            and profile_id = $3
            and thumbnail_url is not null
            and caption is not null
            and status in ('working', 'scheduled', 'published')
          order by updated_at desc
          limit 1`
      : `select * from agent_posts
          where video_url = $1
            and id <> $2
            and thumbnail_url is not null
            and caption is not null
            and status in ('working', 'scheduled', 'published')
          order by updated_at desc
          limit 1`,
    profileId ? [videoUrl, exceptId, profileId] : [videoUrl, exceptId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getAgentPost(id: string): Promise<AgentPost | null> {
  if (!(await ensureSchema())) return null;
  const rows = await query<Row>(`select * from agent_posts where id = $1`, [id]);
  return rows[0] ? mapRow(rows[0]) : null;
}

function rollupDmStatuses(statuses: string[]): "wired" | "pending" | "error" | null {
  if (!statuses.length) return null;
  if (statuses.every((s) => s === "wired")) return "wired";
  if (statuses.some((s) => s === "pending")) return "pending";
  return "error";
}

/** Live comment-to-DM badge keyed by Zernio post id. Never throws. */
async function liveDmStatusesByZernioId(
  ids: string[],
): Promise<Map<string, string[]>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const byPost = new Map<string, string[]>();
  if (!unique.length) return byPost;
  try {
    const rows = await query<{ zernio_post_id: string; status: string }>(
      `select zernio_post_id, status from comment_dm_setups
        where zernio_post_id = any($1::text[])`,
      [unique],
    );
    for (const r of rows) {
      const arr = byPost.get(r.zernio_post_id) ?? [];
      arr.push(r.status);
      byPost.set(r.zernio_post_id, arr);
    }
  } catch {
    /* table missing or a db blip — keep the stamp on agent_posts */
  }
  return byPost;
}

function withLiveDm(
  post: AgentPost,
  byPost: Map<string, string[]>,
): AgentPost {
  const statuses = [
    ...(post.zernioPostId ? byPost.get(post.zernioPostId) ?? [] : []),
    ...(post.followupZernioPostId ? byPost.get(post.followupZernioPostId) ?? [] : []),
  ];
  const live = rollupDmStatuses(statuses);
  return live ? { ...post, commentDmStatus: live } : post;
}

export async function listAgentPosts(limit = 30): Promise<AgentPost[]> {
  try {
    if (!(await ensureSchema())) return [];
    // Badge is computed live from comment_dm_setups (which every process that
    // wires an automation writes to) instead of trusting the stamp the drain
    // left at schedule time: a dev server with a stale in-process drain kept
    // showing "pending" on wired posts (2026-09-12).
    const rows = await query<Row>(
      `select * from agent_posts order by created_at desc limit $1`,
      [limit],
    );
    const posts = rows.map(mapRow);
    const byPost = await liveDmStatusesByZernioId(
      posts.flatMap((p) => [p.zernioPostId ?? "", p.followupZernioPostId ?? ""]),
    );
    return posts.map((p) => withLiveDm(p, byPost));
  } catch (e) {
    if (!isDbConnectError(e)) {
      console.error("[agent-posts] list:", e instanceof Error ? e.message : e);
    }
    return [];
  }
}

export async function listScheduledAgentZernioIds(): Promise<string[]> {
  if (!(await ensureSchema())) return [];
  const rows = await query<{ zernio_post_id: string }>(
    `select zernio_post_id from agent_posts
      where status = 'scheduled'
        and zernio_post_id is not null
      order by scheduled_for nulls last
      limit 40`,
  );
  return rows.map((r) => r.zernio_post_id);
}

/** Slots that already fired and may still be mid-publish on Zernio. */
export async function listAgentPostsInPublishWindow(): Promise<AgentPost[]> {
  if (!(await ensureSchema())) return [];
  const rows = await query<Row>(
    `select * from agent_posts
      where zernio_post_id is not null
        and scheduled_for is not null
        and scheduled_for < now() - interval '8 minutes'
        and scheduled_for > now() - interval '12 hours'
        and status in ('scheduled', 'published', 'working')
      order by scheduled_for
      limit 20`,
  );
  return rows.map(mapRow);
}

export async function listAgentPostsByZernioIds(
  ids: string[],
): Promise<AgentPost[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length || !(await ensureSchema())) return [];
  const rows = await query<Row>(
    `select * from agent_posts where zernio_post_id = any($1::text[])`,
    [unique],
  );
  return rows.map(mapRow);
}

export async function markAgentPostsPublished(
  zernioPostIds: string[],
): Promise<number> {
  const ids = [...new Set(zernioPostIds.filter(Boolean))];
  if (!ids.length || !(await ensureSchema())) return 0;
  const rows = await query<{ id: string }>(
    `update agent_posts
        set status = 'published', step = 'published', updated_at = now()
      where (zernio_post_id = any($1::text[]) or followup_zernio_post_id = any($1::text[]))
        and status in ('scheduled', 'working')
      returning id`,
    [ids],
  );
  return rows.length;
}

export async function listClaimedSlots(profileId: string): Promise<string[]> {
  if (!(await ensureSchema())) return [];
  const rows = await query<{ scheduled_for: Date | string }>(
    `select scheduled_for from agent_posts
      where profile_id = $1
        and scheduled_for is not null
        and status <> 'failed'`,
    [profileId],
  );
  return rows.map((r) => iso(r.scheduled_for)).filter((v): v is string => !!v);
}

export async function claimNextAgentPost(): Promise<AgentPost | null> {
  if (!(await ensureSchema())) return null;
  const rows = await query<Row>(
    `with next as (
       select id from agent_posts p
        where (
             p.status = 'queued'
          or (p.status = 'working' and p.updated_at < now() - interval '20 minutes')
          or (
               p.status = 'failed'
           and p.error ~* 'fetch failed|network|ECONN|ETIMEDOUT|timeout|socket'
           and p.updated_at > now() - interval '12 hours'
           and exists (
             select 1 from agent_posts s
              where s.video_url = p.video_url
                and s.id <> p.id
                and s.thumbnail_url is not null
                and s.caption is not null
                and s.status in ('working', 'scheduled', 'published')
           )
          )
        )
        and not exists (
          select 1 from agent_posts s
           where s.video_url = p.video_url
             and s.id <> p.id
             and s.status = 'working'
             and s.updated_at > now() - interval '20 minutes'
        )
        order by p.created_at
        limit 1
        for update skip locked
     )
     update agent_posts p
        set status = 'working',
            step = 'starting',
            error = null,
            updated_at = now()
       from next
      where p.id = next.id
      returning p.*`,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function patchAgentPost(
  id: string,
  patch: Partial<{
    status: AgentPostStatus;
    step: string | null;
    error: string | null;
    transcript: string | null;
    keyword: string | null;
    caption: string | null;
    youtubeTitle: string | null;
    youtubeDescription: string | null;
    twitterCaption: string | null;
    linkedinCaption: string | null;
    threadsCaption: string | null;
    dmText: string | null;
    commentReply: string | null;
    thumbnailUrl: string | null;
    scheduledFor: string | null;
    zernioPostId: string | null;
    followupZernioPostId: string | null;
    commentDmStatus: string | null;
    resourceUrl: string | null;
  }>,
): Promise<AgentPost | null> {
  if (!(await ensureSchema())) return null;
  const sets: string[] = ["updated_at = now()"];
  const vals: unknown[] = [];
  const add = (col: string, value: unknown) => {
    vals.push(value);
    sets.push(`${col} = $${vals.length}`);
  };
  if (patch.status !== undefined) add("status", patch.status);
  if (patch.step !== undefined) add("step", patch.step);
  if (patch.error !== undefined) add("error", patch.error);
  if (patch.transcript !== undefined) add("transcript", patch.transcript);
  if (patch.keyword !== undefined) add("keyword", patch.keyword);
  if (patch.caption !== undefined) add("caption", patch.caption);
  if (patch.youtubeTitle !== undefined) add("youtube_title", patch.youtubeTitle);
  if (patch.youtubeDescription !== undefined) {
    add("youtube_description", patch.youtubeDescription);
  }
  if (patch.twitterCaption !== undefined) {
    add("twitter_caption", patch.twitterCaption);
  }
  if (patch.linkedinCaption !== undefined) {
    add("linkedin_caption", patch.linkedinCaption);
  }
  if (patch.threadsCaption !== undefined) {
    add("threads_caption", patch.threadsCaption);
  }
  if (patch.dmText !== undefined) add("dm_text", patch.dmText);
  if (patch.commentReply !== undefined) add("comment_reply", patch.commentReply);
  if (patch.thumbnailUrl !== undefined) add("thumbnail_url", patch.thumbnailUrl);
  if (patch.scheduledFor !== undefined) add("scheduled_for", patch.scheduledFor);
  if (patch.zernioPostId !== undefined) add("zernio_post_id", patch.zernioPostId);
  if (patch.followupZernioPostId !== undefined) {
    add("followup_zernio_post_id", patch.followupZernioPostId);
  }
  if (patch.commentDmStatus !== undefined) {
    add("comment_dm_status", patch.commentDmStatus);
  }
  if (patch.resourceUrl !== undefined) add("resource_url", patch.resourceUrl);
  vals.push(id);
  const rows = await query<Row>(
    `update agent_posts set ${sets.join(", ")} where id = $${vals.length} returning *`,
    vals,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}
