import "server-only";
import { spawn } from "child_process";
import path from "path";

// In-process daily scheduler for the trending-sounds refresh. Runs inside the
// always-on web service (no separate Railway cron service needed). Enabled only
// when SOUNDS_CRON_ENABLED=1, so it stays off locally and in preview builds.
//
//   SOUNDS_CRON_ENABLED=1        turn it on
//   SOUNDS_CRON_SPEC="US 20"     region + limit passed to refresh-sounds.mjs
//   SOUNDS_CRON_HOUR_UTC=6       hour of day (UTC) to run; default 6

let started = false;
let running = false;

function runRefresh() {
  if (running) return; // never overlap
  running = true;
  const spec = (process.env.SOUNDS_CRON_SPEC || "both 40").trim().split(/\s+/);
  const script = path.join(process.cwd(), "scripts", "refresh-sounds.mjs");
  console.log(`[sounds-cron] running: refresh-sounds ${spec.join(" ")}`);
  const child = spawn(process.execPath, [script, ...spec], {
    env: process.env,
    stdio: "inherit",
  });
  child.on("close", (code) => {
    running = false;
    console.log(`[sounds-cron] finished (exit ${code})`);
  });
  child.on("error", (e) => {
    running = false;
    console.error("[sounds-cron] failed to start:", e.message);
  });
}

function msUntilNextRun(): number {
  const hour = Number(process.env.SOUNDS_CRON_HOUR_UTC ?? 6);
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export function startSoundsCron() {
  if (started) return;
  started = true;
  const schedule = () => {
    const ms = msUntilNextRun();
    console.log(`[sounds-cron] next run in ${Math.round(ms / 3600000)}h`);
    setTimeout(() => {
      runRefresh();
      schedule();
    }, ms);
  };
  schedule();
}
