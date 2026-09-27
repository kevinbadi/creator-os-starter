import "server-only";

// RevenueCat reports money in USD. The dashboard displays CAD, so we convert
// with a live USD→CAD rate, refreshed daily and falling back to a sane constant
// if the FX endpoint is unreachable.

const FALLBACK_USD_TO_CAD = 1.38;

/** Live USD→CAD rate (cached ~24h). Falls back to a constant on any failure. */
export async function getUsdToCad(): Promise<number> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      next: { revalidate: 86_400 },
    });
    if (!res.ok) return FALLBACK_USD_TO_CAD;
    const data = (await res.json()) as { rates?: { CAD?: number } };
    const cad = data.rates?.CAD;
    return typeof cad === "number" && cad > 0 ? cad : FALLBACK_USD_TO_CAD;
  } catch {
    return FALLBACK_USD_TO_CAD;
  }
}
