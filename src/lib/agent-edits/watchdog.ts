import "server-only";
import fs from "node:fs";
import { mediaPath, statusPath, workdirFor } from "./paths";
import { startEditRun } from "./runner";
import { listEdits, livePid } from "./store";
import type { DiskStatus } from "./types";

const MAX_RESUME = 8;
const WINDOW_MS = 36 * 60 * 60 * 1000;

function readDisk(slug: string): DiskStatus {
  try {
    return JSON.parse(fs.readFileSync(statusPath(workdirFor(slug)), "utf8")) as DiskStatus;
  } catch {
    return {};
  }
}

function fatalError(err: string): boolean {
  return /not logged in|cursor-agent not found|Cancelled from Agent edits|^Cancelled$|No source clip/i.test(
    err,
  );
}

function shouldResume(err: string, diskStatus: string | undefined): boolean {
  if (diskStatus === "running") return true;
  if (!err || /Edit stopped before final\.mp4/i.test(err)) return true;
  return /trouble connecting to the model provider|Provider Error|NonRetriableError|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|Interrupted|will resume when Marketing OS/i.test(
    err,
  );
}

async function tick(): Promise<void> {
  const edits = await listEdits();
  for (const job of edits) {
    if (job.source !== "job") continue;
    if (!job.hasClip || job.hasFinal) continue;
    if (job.status === "cancelled" || job.status === "done") continue;
    if (job.pid && livePid(job.pid)) continue;

    const disk = readDisk(job.slug);
    if (disk.status === "cancelled") continue;
    const err = String(disk.error || job.error || "");
    if (fatalError(err)) continue;
    if ((disk.resumeCount ?? 0) >= MAX_RESUME) continue;

    const stamp = Date.parse(disk.startedAt || disk.finishedAt || job.updatedAt || job.createdAt);
    if (Number.isFinite(stamp) && Date.now() - stamp > WINDOW_MS) continue;
    if (!shouldResume(err, disk.status)) continue;

    const clip = mediaPath(workdirFor(job.slug), "clip");
    if (!clip) continue;

    console.log(`[agent-edits] watchdog resume ${job.slug} (${job.id})`);
    try {
      startEditRun(job, clip);
    } catch (e) {
      console.error(
        `[agent-edits] watchdog resume failed ${job.slug}:`,
        e instanceof Error ? e.message : e,
      );
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
}

export function startEditWatchdog(): void {
  if (process.env.RAILWAY_ENVIRONMENT) return;
  if (process.env.EDIT_WATCHDOG === "0") return;
  const bootMs = Number(process.env.EDIT_WATCHDOG_BOOT_MS || 4_000);
  const everyMs = Number(process.env.EDIT_WATCHDOG_MS || 120_000);
  setTimeout(() => {
    tick().catch((e) => console.error("[agent-edits] watchdog:", e));
  }, Number.isFinite(bootMs) ? bootMs : 4_000);
  setInterval(() => {
    tick().catch((e) => console.error("[agent-edits] watchdog:", e));
  }, Number.isFinite(everyMs) ? everyMs : 120_000);
  console.log("[agent-edits] watchdog armed — will resume crashed / power-loss edits");
}
