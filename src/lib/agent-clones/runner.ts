import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { CREATOR_OS, RUNNER_SCRIPT, pidPath, promptPath, statusPath, workdirFor } from "./paths";
import { buildClonePrompt } from "./prompt";
import { updateClone } from "./store";
import type { AgentClone } from "./types";

export function startCloneRun(job: AgentClone, clipPath: string | null): number {
  if (!fs.existsSync(RUNNER_SCRIPT)) {
    throw new Error(`Missing runner: ${RUNNER_SCRIPT}`);
  }
  const workdir = workdirFor(job.slug);
  const prompt = buildClonePrompt({
    workdir,
    clipPath,
    notes: job.notes,
    sourceUrl: job.sourceUrl,
    title: job.title || job.slug,
    persona: job.persona,
    format: job.format,
  });
  fs.writeFileSync(promptPath(workdir), prompt, "utf8");
  fs.writeFileSync(
    statusPath(workdir),
    JSON.stringify(
      {
        status: "running",
        startedAt: new Date().toISOString(),
        jobId: job.id,
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
  if (!child.pid) throw new Error("Failed to spawn clone runner");
  fs.writeFileSync(pidPath(workdir), String(child.pid), "utf8");
  child.unref();
  void updateClone(job.id, { status: "running", pid: child.pid, error: "" });
  return child.pid;
}

export function cancelCloneRun(slug: string, pid: number | null): void {
  const workdir = workdirFor(slug);
  const fromFile = (() => {
    try {
      return Number(fs.readFileSync(pidPath(workdir), "utf8").trim());
    } catch {
      return null;
    }
  })();
  const target = pid || fromFile;
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
  fs.writeFileSync(
    statusPath(workdir),
    JSON.stringify(
      {
        status: "cancelled",
        finishedAt: new Date().toISOString(),
        error: "Cancelled from Agent Video Cloning",
      },
      null,
      2,
    ),
    "utf8",
  );
}
