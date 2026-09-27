/**
 * Is this process the WORKER (Railway) or a local viewer?
 * Kevin 2026-09-18: the local dev server was draining agent posts, flushing
 * comment-DM setups and running the content watchdog against the shared DB,
 * competing with Railway (drain query timeouts, 10s desk polls). Background
 * workers now arm only on Railway, or locally with LOCAL_WORKERS=1.
 */
export function isWorkerHost(): boolean {
  if (process.env.LOCAL_WORKERS === "1") return true;
  if (process.env.LOCAL_WORKERS === "0") return false;
  return Boolean(process.env.RAILWAY_ENVIRONMENT);
}
