// Process-local TTL cache. Dashboard pages read cookies() so Next skips the
// Data Cache — without this, every sidebar click re-hits Zernio and Insforge.

type Entry = { exp: number; value: unknown };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export function ttlGet<T>(key: string): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (e.exp < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return e.value as T;
}

/** Fresh hit, or expired-but-usable stale (for stale-while-revalidate). */
export function ttlGetFreshOrStale<T>(
  key: string,
  staleMs: number,
): { value: T; fresh: boolean } | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  const now = Date.now();
  if (now < e.exp) return { value: e.value as T, fresh: true };
  if (now < e.exp + staleMs) return { value: e.value as T, fresh: false };
  store.delete(key);
  return undefined;
}

export function ttlSet(key: string, value: unknown, ttlMs: number): void {
  store.set(key, { exp: Date.now() + ttlMs, value });
}

export function ttlDel(key: string): void {
  store.delete(key);
}

export function ttlDelPrefix(prefix: string): void {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

/** Deduplicate concurrent work for the same key. */
export function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  let settled = false;
  const p = new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      inflight.delete(key);
      reject(new Error(`timed out: ${key}`));
    }, 8000);
    fn().then(
      (v) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(e);
      },
    );
  }).finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

export async function ttlRemember<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const hit = ttlGet<T>(key);
  if (hit !== undefined) return hit;
  return once(key, async () => {
    const again = ttlGet<T>(key);
    if (again !== undefined) return again;
    const v = await fn();
    ttlSet(key, v, ttlMs);
    return v;
  });
}
