import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { CREATOR_OS, RUNNER_SCRIPT, pidPath, promptPath, statusPath, workdirFor } from "./paths";
import { buildEditPrompt } from "./prompt";
import { livePid, updateEdit } from "./store";
import type { AgentEdit, DiskStatus } from "./types";

function readDisk(workdir: string): DiskStatus {
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

export function startEditRun(job: AgentEdit, clipPath: string): number {
  if (!fs.existsSync(RUNNER_SCRIPT)) {
    throw new Error(`Missing runner: ${RUNNER_SCRIPT}`);
  }
  const workdir = workdirFor(job.slug);
  const existingPid = readPidFile(workdir) ?? job.pid;
  if (livePid(existingPid)) return existingPid as number;

  const prev = readDisk(workdir);
  const lastError = String(prev.error || "");
  const poisoned = /Provider Error|NonRetriableError|trouble connecting to the model provider/i.test(lastError);
  const prompt = buildEditPrompt({
    workdir,
    clipPath,
    notes: job.notes,
    sourceUrl: job.sourceUrl,
    title: job.title || job.slug,
  });
  fs.writeFileSync(promptPath(workdir), prompt, "utf8");
  fs.writeFileSync(
    statusPath(workdir),
    JSON.stringify(
      {
        ...prev,
        status: "running",
        startedAt: prev.startedAt || new Date().toISOString(),
        resumedAt: new Date().toISOString(),
        jobId: job.id,
        error: "",
        lastError,
        resumeSessionId: poisoned ? "" : prev.sessionId || "",
        finishedAt: "",
        resumeCount: (prev.resumeCount ?? 0) + (prev.status && prev.status !== "queued" ? 1 : 0),
        heartbeatAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const extras = [
    path.join(os.homedir(), ".local/bin"),
    "/opt/homebrew/bin",
    "/Applications/Cursor.app/Contents/Resources/app/bin",
  ];
  const parts = String(env.PATH || "")
    .split(":")
    .filter(Boolean);
  env.PATH = [...extras.filter((e) => !parts.includes(e)), ...parts].join(":");

  const child = spawn(
    process.execPath,
    [RUNNER_SCRIPT, "--workdir", workdir, "--job", job.id, "--prompt", promptPath(workdir)],
    {
      cwd: CREATOR_OS,
      env,
      detached: true,
      stdio: "ignore",
    },
  );
  if (!child.pid) throw new Error("Failed to spawn edit runner");
  fs.writeFileSync(pidPath(workdir), String(child.pid), "utf8");
  child.unref();
  void updateEdit(job.id, { status: "running", pid: child.pid, error: "" });
  return child.pid;
}

export function cancelEditRun(slug: string, pid: number | null): void {
  const workdir = workdirFor(slug);
  const fromFile = readPidFile(workdir);
  const target = pid || fromFile;
  fs.writeFileSync(
    statusPath(workdir),
    JSON.stringify(
      {
        ...readDisk(workdir),
        status: "cancelled",
        finishedAt: new Date().toISOString(),
        error: "Cancelled from Agent edits",
      },
      null,
      2,
    ),
    "utf8",
  );
  if (target && target > 0) {
    try {
      process.kill(-target, "SIGTERM");
    } catch {
      try {
        process.kill(target, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
}
