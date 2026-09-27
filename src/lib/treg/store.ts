import "server-only";
import { emptySteps, type TregRun } from "./types";

/**
 * In-process run store (same pattern as a live agent-edits poll).
 * Survives hot reload via globalThis; gone on process restart.
 */

const MAX = 24;

type Bucket = { runs: Map<string, TregRun> };

const g = globalThis as typeof globalThis & { __mosTreg?: Bucket };

function bucket(): Bucket {
  if (!g.__mosTreg) g.__mosTreg = { runs: new Map() };
  return g.__mosTreg;
}

export function createRun(ask: string): TregRun {
  const now = new Date().toISOString();
  const run: TregRun = {
    id: `treg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    ask,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    steps: emptySteps(),
  };
  const b = bucket();
  b.runs.set(run.id, run);
  trim(b);
  return run;
}

export function getRun(id: string): TregRun | undefined {
  return bucket().runs.get(id);
}

export function listRuns(): TregRun[] {
  return [...bucket().runs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function patchRun(id: string, patch: Partial<TregRun>): TregRun | undefined {
  const cur = bucket().runs.get(id);
  if (!cur) return undefined;
  const next: TregRun = { ...cur, ...patch, id: cur.id, updatedAt: new Date().toISOString() };
  bucket().runs.set(id, next);
  return next;
}

export function setStep(
  id: string,
  stepId: TregRun["steps"][number]["id"],
  status: TregRun["steps"][number]["status"],
  detail?: string,
): TregRun | undefined {
  const cur = bucket().runs.get(id);
  if (!cur) return undefined;
  const now = new Date().toISOString();
  const steps = cur.steps.map((s) => {
    if (s.id !== stepId) return s;
    return {
      ...s,
      status,
      detail: detail ?? s.detail,
      startedAt: status === "running" ? now : s.startedAt,
      endedAt: status === "running" ? undefined : now,
    };
  });
  return patchRun(id, { steps, status: status === "error" ? "failed" : "running" });
}

function trim(b: Bucket) {
  if (b.runs.size <= MAX) return;
  const extra = [...b.runs.values()]
    .sort((a, c) => (a.createdAt < c.createdAt ? 1 : -1))
    .slice(MAX);
  for (const r of extra) b.runs.delete(r.id);
}
