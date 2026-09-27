import "server-only";
import fs from "node:fs";
import { dbConfigured, isDbConnectError, query } from "@/lib/insforge/db";
import {
  artifacts,
  humanizeSlug,
  isUuid,
  mediaPath,
  pidPath,
  progressPath,
  statusPath,
  workdirFor,
  CLONE_ROOT,
} from "./paths";
import type { AgentEdit, DiskStatus, EditStatus, ProgressEv } from "./types";

type Row = {
  id: string;
  workflow: string;
  slug: string;
  title: string;
  status: EditStatus;
  notes: string | null;
  source_url: string | null;
  clip_name: string | null;
  error: string | null;
  pid: number | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function livePid(pid: number | null): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readDiskStatus(workdir: string): DiskStatus {
  try {
    const raw = fs.readFileSync(statusPath(workdir), "utf8");
    return JSON.parse(raw) as DiskStatus;
  } catch {
    return {};
  }
}

function readPidFile(workdir: string): number | null {
  try {
    const n = Number(fs.readFileSync(pidPath(workdir), "utf8").trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function overlay(base: Omit<AgentEdit, "hasFinal" | "hasBand" | "hasPoster" | "hasClip" | "finalBytes" | "finalMtime" | "lastTool" | "lastText" | "model" | "engine" | "pid"> & Partial<AgentEdit>): AgentEdit {
  const workdir = workdirFor(base.slug);
  const art = artifacts(workdir);
  const disk = readDiskStatus(workdir);
  const pid = disk.pid ?? readPidFile(workdir) ?? base.pid ?? null;
  const alive = livePid(pid);
  const diskStatus = disk.status;
  let status = base.status;
  if (diskStatus === "cancelled") {
    status = "cancelled";
  } else if (diskStatus === "running" && alive) {
    status = "running";
  } else if (art.hasFinal && (diskStatus === "done" || !alive)) {
    if (status === "running" || status === "uploading" || status === "queued") status = "done";
  } else if (status === "running" && !art.hasFinal && !alive) {
    status = "failed";
  } else if (diskStatus === "failed" && !art.hasFinal) {
    status = "failed";
  }
  const error =
    status === "failed"
      ? disk.error || base.error || "Edit stopped before final.mp4"
      : base.error || disk.error || "";
  return {
    workflow: base.workflow,
    id: base.id,
    slug: base.slug,
    title: base.title,
    notes: base.notes,
    sourceUrl: base.sourceUrl,
    clipName: base.clipName,
    error,
    createdAt: base.createdAt,
    updatedAt: disk.finishedAt || base.updatedAt,
    source: base.source,
    status,
    pid: livePid(pid) ? pid : null,
    model: disk.model || base.model || "",
    engine: disk.engine || base.engine || "",
    lastTool: disk.lastTool || base.lastTool || "",
    lastText: disk.lastText || base.lastText || "",
    ...art,
  };
}

function toEdit(r: Row): AgentEdit {
  return overlay({
    id: r.id,
    workflow: r.workflow,
    slug: r.slug,
    title: r.title,
    status: r.status,
    notes: r.notes ?? "",
    sourceUrl: r.source_url ?? "",
    clipName: r.clip_name ?? "",
    error: r.error ?? "",
    pid: r.pid == null ? null : Number(r.pid),
    source: "job",
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  });
}

let schemaReady: Promise<boolean> | null = null;

export function ensureSchema(): Promise<boolean> {
  if (!dbConfigured) return Promise.resolve(false);
  if (!schemaReady) {
    schemaReady = query(
      `create table if not exists agent_edits (
         id uuid primary key default gen_random_uuid(),
         workflow text not null default 'split-animated-talking-head',
         slug text not null,
         title text not null default '',
         status text not null default 'queued',
         notes text,
         source_url text,
         clip_name text,
         error text,
         pid integer,
         created_at timestamptz not null default now(),
         updated_at timestamptz not null default now()
       );
       create index if not exists agent_edits_created_idx on agent_edits (created_at desc);
       create index if not exists agent_edits_slug_idx on agent_edits (slug);`,
    )
      .then(() => true)
      .catch((e) => {
        if (!isDbConnectError(e)) {
          console.error("[agent-edits] schema failed:", e instanceof Error ? e.message : e);
        }
        schemaReady = null;
        return false;
      });
  }
  return schemaReady;
}

const COLS = "id, workflow, slug, title, status, notes, source_url, clip_name, error, pid, created_at, updated_at";

function scanLibrary(): AgentEdit[] {
  if (!fs.existsSync(CLONE_ROOT)) return [];
  const out: AgentEdit[] = [];
  for (const name of fs.readdirSync(CLONE_ROOT)) {
    if (!name.endsWith("-animated")) continue;
    const workdir = workdirFor(name);
    if (!fs.statSync(workdir).isDirectory()) continue;
    const art = artifacts(workdir);
    if (!art.hasFinal && !art.hasBand && !art.hasClip) continue;
    const final = mediaPath(workdir, "final");
    const st = final && art.hasFinal && fs.existsSync(final) ? fs.statSync(final) : fs.statSync(workdir);
    const created = st.mtime.toISOString();
    out.push(
      overlay({
        id: name,
        workflow: "split-animated-talking-head",
        slug: name,
        title: humanizeSlug(name),
        status: art.hasFinal ? "done" : "failed",
        notes: "",
        sourceUrl: "",
        clipName: "",
        error: "",
        pid: null,
        source: "library",
        createdAt: created,
        updatedAt: created,
      }),
    );
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function listEdits(): Promise<AgentEdit[]> {
  let db: AgentEdit[] = [];
  if (await ensureSchema()) {
    try {
      const rows = await query<Row>(`select ${COLS} from agent_edits order by created_at desc limit 80`);
      db = rows.map(toEdit);
    } catch (e) {
      if (!isDbConnectError(e)) {
        console.error("[agent-edits] list:", e instanceof Error ? e.message : e);
      }
    }
  }
  const bySlug = new Set(db.map((j) => j.slug));
  const library = scanLibrary().filter((j) => !bySlug.has(j.slug));
  return [...db, ...library].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getEdit(id: string): Promise<AgentEdit | null> {
  if (isUuid(id) && (await ensureSchema())) {
    const rows = await query<Row>(`select ${COLS} from agent_edits where id = $1`, [id]);
    if (rows[0]) return toEdit(rows[0]);
  }
  const lib = scanLibrary().find((j) => j.id === id || j.slug === id);
  return lib ?? null;
}

export async function createEdit(input: {
  workflow: string;
  slug: string;
  title: string;
  notes: string;
  sourceUrl: string;
  clipName: string;
}): Promise<AgentEdit> {
  if (!(await ensureSchema())) {
    throw new Error("DATABASE_URL is not set — cannot start a new edit.");
  }
  const rows = await query<Row>(
    `insert into agent_edits (workflow, slug, title, status, notes, source_url, clip_name)
     values ($1, $2, $3, 'queued', $4, $5, $6)
     returning ${COLS}`,
    [input.workflow, input.slug, input.title, input.notes, input.sourceUrl, input.clipName],
  );
  return toEdit(rows[0]);
}

export async function updateEdit(
  id: string,
  patch: Partial<{ status: EditStatus; error: string; pid: number | null; clipName: string }>,
): Promise<AgentEdit | null> {
  if (!isUuid(id) || !(await ensureSchema())) return getEdit(id);
  const sets: string[] = ["updated_at = now()"];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.status) {
    sets.push(`status = $${i++}`);
    vals.push(patch.status);
  }
  if (patch.error !== undefined) {
    sets.push(`error = $${i++}`);
    vals.push(patch.error);
  }
  if (patch.pid !== undefined) {
    sets.push(`pid = $${i++}`);
    vals.push(patch.pid);
  }
  if (patch.clipName !== undefined) {
    sets.push(`clip_name = $${i++}`);
    vals.push(patch.clipName);
  }
  vals.push(id);
  const rows = await query<Row>(
    `update agent_edits set ${sets.join(", ")} where id = $${i} returning ${COLS}`,
    vals,
  );
  return rows[0] ? toEdit(rows[0]) : null;
}

export function readProgress(slug: string, limit = 120): ProgressEv[] {
  const file = progressPath(workdirFor(slug));
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const slice = lines.slice(-limit);
  const out: ProgressEv[] = [];
  for (const line of slice) {
    try {
      out.push(JSON.parse(line) as ProgressEv);
    } catch {
      /* skip bad line */
    }
  }
  return out;
}

export { livePid };
