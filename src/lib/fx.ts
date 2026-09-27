import "server-only";

// USD→CAD for money KPIs (RevenueCat reports USD; Kevin wants CAD).
// ECB reference rate via frankfurter.app (no key), cached for 12h — FX
// precision beyond that is meaningless at this MRR scale.
let cached: { rate: number; at: number } | null = null;
const TTL = 12 * 3600_000;
/** Last-resort if frankfurter is unreachable — better than showing USD as CAD. */
const FALLBACK_USD_CAD = 1.39;
let inflight: Promise<number> | null = null;

async function fetchRate(): Promise<number> {
  const res = await fetch("https://api.frankfurter.dev/v1/latest?from=USD&to=CAD", {
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(String(res.status));
  const rate = (await res.json())?.rates?.CAD;
  if (typeof rate !== "number" || !(rate > 0)) throw new Error("bad rate");
  cached = { rate, at: Date.now() };
  return rate;
}

/** Awaited USD→CAD rate. Always resolves to a usable number (live, cache, or fallback). */
export async function usdToCad(): Promise<number> {
  if (cached && Date.now() - cached.at < TTL) return cached.rate;
  if (!inflight) {
    inflight = fetchRate()
      .catch(() => cached?.rate ?? FALLBACK_USD_CAD)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
