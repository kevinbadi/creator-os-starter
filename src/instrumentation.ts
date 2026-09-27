// Next.js runs this once on server startup. We use it to start the in-process
// daily crons — only in the Node.js runtime and only the ones explicitly
// enabled via env on the deployed web service (all stay off locally).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Trending-sounds refresh (SOUNDS_CRON_ENABLED=1).
  if (process.env.SOUNDS_CRON_ENABLED === "1") {
    const { startSoundsCron } = await import("./lib/sounds/cron");
    startSoundsCron();
  }
  // Content crons — ALWAYS start the manager; lib/content/cron.ts gates each
  // job individually on <PREFIX>_CRON_ENABLED. (Previously gated on the
  // Megan/Danny DAILY flags, so disabling both dailies on 2026-07-07 silently
  // killed every other job — reactions, advice, proof, snapshots, watchdog.)
  const { startContentCrons } = await import("./lib/content/cron");
  startContentCrons();
  // Local Mac only: respawn Agent Edits jobs killed by power loss / Cursor provider drops.
  const { startEditWatchdog } = await import("./lib/agent-edits/watchdog");
  startEditWatchdog();
}
