import "server-only";
import fs from "node:fs";
import path from "node:path";
import { dbConfigured, isDbConnectError, query } from "@/lib/insforge/db";
import {
  artifacts,
  humanizeSlug,
  isUuid,
  mediaPath,
  personaFromSlug,
  pidPath,
  progressPath,
  statusPath,
  workdirFor,
  CLONE_ROOT,
} from "./paths";
import { isCloneFormat, isClonePersona } from "./personas";
import type { AgentClone, CloneFormat, ClonePersonaId, CloneStatus, DiskStatus, ProgressEv } from "./types";

type Row = {
  id: string;
  persona: string;
  format: string;
  slug: string;
  title: string;
  status: CloneStatus;
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
    return JSON.parse(fs.readFileSync(statusPath(workdir), "utf8")) as DiskStatus;
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

function overlay(
  base: Omit<
    AgentClone,
    | "hasFinal"
    | "hasPreview"
    | "hasPoster"
    | "hasClip"
    | "finalBytes"
    | "finalMtime"
    | "lastTool"
    | "lastText"
    | "model"
    | "pid"
  > &
    Partial<AgentClone>,
): AgentClone {
  const workdir = workdirFor(base.slug);
  const art = artifacts(workdir);
  const disk = readDiskStatus(workdir);
  const pid = disk.pid ?? readPidFile(workdir) ?? base.pid ?? null;
  const alive = livePid(pid);
  const diskStatus = disk.status;
  let status = base.status;
  if (diskStatus === "cancelled") {
    status = "cancelled";
  } else if (art.hasFinal && (diskStatus === "done" || !alive)) {
    if (status === "running" || status === "uploading" || status === "queued") status = "done";
  } else if (status === "running" && !art.hasFinal && !alive) {
    status = "failed";
  } else if (diskStatus === "failed" && !art.hasFinal) {
    status = "failed";
  }
  const error =
    status === "failed"
      ? disk.error || base.error || "Clone stopped before final_clone.mp4"
      : base.error || disk.error || "";
  return {
    ...base,
    error,
    updatedAt: disk.finishedAt || base.updatedAt,
    source: base.source,
    status,
    pid: livePid(pid) ? pid : null,
    model: disk.model || base.model || "",
    lastTool: disk.lastTool || base.lastTool || "",
    lastText: disk.lastText || base.lastText || "",
    ...art,
  };
}

function toClone(r: Row): AgentClone {
  const persona = isClonePersona(r.persona) ? r.persona : "kevin";
  const format = isCloneFormat(r.format) ? r.format : "shortform";
  return overlay({
    id: r.id,
    persona,
    format,
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
      `create table if not exists agent_clones (
         id uuid primary key default gen_random_uuid(),
         persona text not null,
         format text not null,
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
       create index if not exists agent_clones_created_idx on agent_clones (created_at desc);
       create index if not exists agent_clones_slug_idx on agent_clones (slug);`,
    )
      .then(() => true)
      .catch((e) => {
        if (!isDbConnectError(e)) {
          console.error("[agent-clones] schema failed:", e instanceof Error ? e.message : e);
        }
        schemaReady = null;
        return false;
      });
  }
  return schemaReady;
}

const COLS =
  "id, persona, format, slug, title, status, notes, source_url, clip_name, error, pid, created_at, updated_at";

function guessFormat(workdir: string): CloneFormat {
  if (fs.existsSync(path.join(workdir, "renders", "preview_640p.mp4"))) return "longform";
  return "shortform";
}

function scanLibrary(): AgentClone[] {
  if (!fs.existsSync(CLONE_ROOT)) return [];
  const out: AgentClone[] = [];
  for (const name of fs.readdirSync(CLONE_ROOT)) {
    const persona = personaFromSlug(name);
    if (!persona) continue;
    if (name.endsWith("-animated")) continue;
    const workdir = workdirFor(name);
    try {
      if (!fs.statSync(workdir).isDirectory()) continue;
    } catch {
      continue;
    }
    const art = artifacts(workdir);
    if (!art.hasFinal && !art.hasClip) continue;
    const final = mediaPath(workdir, "final");
    const st = final && fs.existsSync(final) ? fs.statSync(final) : fs.statSync(workdir);
    const created = st.mtime.toISOString();
    out.push(
      overlay({
        id: name,
        persona,
        format: guessFormat(workdir),
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

export async function listClones(): Promise<AgentClone[]> {
  let db: AgentClone[] = [];
  if (await ensureSchema()) {
    try {
      const rows = await query<Row>(`select ${COLS} from agent_clones order by created_at desc limit 80`);
      db = rows.map(toClone);
    } catch (e) {
      if (!isDbConnectError(e)) {
        console.error("[agent-clones] list:", e instanceof Error ? e.message : e);
      }
    }
  }
  const bySlug = new Set(db.map((j) => j.slug));
  const library = scanLibrary().filter((j) => !bySlug.has(j.slug));
  return [...db, ...library].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getClone(id: string): Promise<AgentClone | null> {
  if (isUuid(id) && (await ensureSchema())) {
    const rows = await query<Row>(`select ${COLS} from agent_clones where id = $1`, [id]);
    if (rows[0]) return toClone(rows[0]);
  }
  const lib = scanLibrary().find((j) => j.id === id || j.slug === id);
  return lib ?? null;
}

export async function createClone(input: {
  persona: ClonePersonaId;
  format: CloneFormat;
  slug: string;
  title: string;
  notes: string;
  sourceUrl: string;
  clipName: string;
}): Promise<AgentClone> {
  if (!(await ensureSchema())) {
    throw new Error("DATABASE_URL is not set — cannot start a new clone.");
  }
  const rows = await query<Row>(
    `insert into agent_clones (persona, format, slug, title, status, notes, source_url, clip_name)
     values ($1, $2, $3, $4, 'queued', $5, $6, $7)
     returning ${COLS}`,
    [
      input.persona,
      input.format,
      input.slug,
      input.title,
      input.notes,
      input.sourceUrl,
      input.clipName,
    ],
  );
  return toClone(rows[0]);
}

export async function updateClone(
  id: string,
  patch: Partial<{ status: CloneStatus; error: string; pid: number | null; clipName: string }>,
): Promise<AgentClone | null> {
  if (!isUuid(id) || !(await ensureSchema())) return getClone(id);
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
    `update agent_clones set ${sets.join(", ")} where id = $${i} returning ${COLS}`,
    vals,
  );
  return rows[0] ? toClone(rows[0]) : null;
}

export function readProgress(slug: string, limit = 120): ProgressEv[] {
  const file = progressPath(workdirFor(slug));
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const out: ProgressEv[] = [];
  for (const line of lines.slice(-limit)) {
    try {
      out.push(JSON.parse(line) as ProgressEv);
    } catch {
      /* skip */
    }
  }
  return out;
}

export { livePid };
