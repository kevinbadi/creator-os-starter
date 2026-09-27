import "server-only";
import type { TregCatalogHit, TregTestRequest } from "./types";

/**
 * One function wraps every Treg HTTP call (integrate.md). Token + org +
 * X-Treg-Meta are set here, never by Jev or the UI.
 */

const DEFAULT_BASE = "https://treg.to";
const META = "customer=kevbuildsapps, feature=treg-desk";
const DEFAULT_MAX_COST = process.env.TREG_MAX_COST || "0.02";

export function tregConfigured(): boolean {
  return Boolean(process.env.TREG_TOKEN);
}

export function tregBase(): string {
  return (process.env.TREG_BASE || DEFAULT_BASE).replace(/\/$/, "");
}

export function tregOrg(): string {
  return process.env.TREG_ORG || "kevbuildsapps";
}

function token(): string {
  const t = process.env.TREG_TOKEN;
  if (!t) throw new Error("TREG_TOKEN is not set.");
  return t;
}

export type TregHttpResult<T = unknown> = {
  ok: boolean;
  status: number;
  body: T;
  callId: string | null;
  costMicro: number | null;
  cache: string | null;
  tregError: boolean;
  text: string;
};

function headers(extra?: Record<string, string>): Headers {
  const h = new Headers({
    "X-Treg-Token": token(),
    "X-Treg-Org": tregOrg(),
    "X-Treg-Meta": META,
    accept: "application/json, text/plain, */*",
  });
  if (extra) for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return h;
}

async function tregFetch<T = unknown>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<TregHttpResult<T>> {
  const { timeoutMs = 45_000, ...rest } = init;
  const url = path.startsWith("http") ? path : `${tregBase()}${path}`;
  const res = await fetch(url, {
    ...rest,
    headers: rest.headers ?? headers(),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let body: unknown = text;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  } else {
    body = null;
  }
  const costRaw = res.headers.get("X-Treg-Cost-Micro");
  return {
    ok: res.ok,
    status: res.status,
    body: body as T,
    callId: res.headers.get("X-Treg-Call-Id"),
    costMicro: costRaw != null && costRaw !== "" ? Number(costRaw) : null,
    cache: res.headers.get("X-Treg-Cache"),
    tregError: res.headers.get("X-Treg-Error") === "1",
    text,
  };
}

export type TregBalance = {
  usd: number | null;
  micro: number | null;
  raw: unknown;
};

let cachedOrgId: number | null = null;

async function tregOrgId(): Promise<number> {
  if (cachedOrgId != null) return cachedOrgId;
  const r = await tregFetch<Array<{ org_id?: number; slug?: string; active?: boolean }>>("/orgs", {
    timeoutMs: 12_000,
  });
  if (!r.ok || !Array.isArray(r.body)) throw new Error(publicTregError(r));
  const slug = tregOrg();
  const match = r.body.find((o) => o.slug === slug) ?? r.body.find((o) => o.active) ?? r.body[0];
  const id = match?.org_id;
  if (id == null) throw new Error("Treg token has no org.");
  cachedOrgId = id;
  return id;
}

export async function tregBalance(): Promise<TregBalance> {
  const orgId = await tregOrgId();
  const r = await tregFetch(`/orgs/${orgId}/balance?limit=1`, { timeoutMs: 12_000 });
  if (!r.ok) throw new Error(publicTregError(r));
  return normalizeBalance(r.body);
}

function normalizeBalance(body: unknown): TregBalance {
  if (!body || typeof body !== "object") return { usd: null, micro: null, raw: body };
  const o = body as Record<string, unknown>;
  const micro = num(o.balance_micro ?? o.available_micro ?? o.micro ?? o.remaining_micro);
  const usd = num(o.balance_usd ?? o.available_usd ?? o.usd ?? o.balance);
  if (micro != null) return { usd: usd ?? micro / 1_000_000, micro, raw: body };
  if (usd != null) return { usd, micro: Math.round(usd * 1_000_000), raw: body };
  return { usd: null, micro: null, raw: body };
}

export type TregSearchPage = {
  query: string;
  count: number;
  total: number;
  results: TregCatalogHit[];
};

export async function tregCatalogSearch(q: string, limit = 25): Promise<TregSearchPage> {
  const url = `${tregBase()}/catalog/search?q=${encodeURIComponent(q)}&limit=${limit}`;
  let lastErr = "";
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      const text = await res.text();
      if (!res.ok) throw new Error(`treg catalog search ${res.status}: ${text.slice(0, 240)}`);
      const data = JSON.parse(text) as {
        query?: string;
        count?: number;
        total?: number;
        results?: Record<string, unknown>[];
      };
      return {
        query: data.query ?? q,
        count: data.count ?? data.results?.length ?? 0,
        total: data.total ?? data.count ?? 0,
        results: (data.results ?? []).map(normalizeHit),
      };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw new Error(lastErr || "treg catalog search failed");
}

export async function tregCatalogGet(id: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${tregBase()}/catalog/endpoints/${encodeURIComponent(id)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`treg catalog get ${res.status}: ${text.slice(0, 240)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

export async function tregCall(
  hit: TregCatalogHit,
  opts?: { maxCost?: string; idempotencyKey?: string },
): Promise<TregHttpResult> {
  const method = (hit.method || "GET").toUpperCase();
  const test = hit.testRequest ?? {};
  const qs = new URLSearchParams();
  if (test.queryParams) {
    for (const [k, v] of Object.entries(test.queryParams)) {
      if (v == null) continue;
      qs.set(k, typeof v === "string" ? v : String(v));
    }
  }
  const path = `/call/${hit.id}${qs.size ? `?${qs}` : ""}`;
  const extra: Record<string, string> = {
    "X-Treg-Route-Max-Cost": opts?.maxCost || DEFAULT_MAX_COST,
  };
  if (opts?.idempotencyKey) extra["Idempotency-Key"] = opts.idempotencyKey;

  const init: RequestInit & { timeoutMs?: number } = {
    method: method === "GET" || method === "HEAD" ? method : method,
    headers: headers({
      ...extra,
      ...(method !== "GET" && method !== "HEAD" ? { "content-type": "application/json" } : {}),
    }),
    timeoutMs: 45_000,
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = JSON.stringify(test.body ?? {});
  }
  const r = await tregFetch(path, init);
  if (!r.ok) throw new Error(publicTregError(r));
  return r;
}

export function publicTregError(r: TregHttpResult): string {
  const body = r.body;
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    const code = typeof o.error === "string" ? o.error : "";
    if (code === "insufficient_balance" || r.status === 402) {
      return "Treg team balance is empty. Top up at treg.to (Team → Billing).";
    }
    if (code === "route_max_cost") {
      return "This call is over the $0.02 desk ceiling. Raise TREG_MAX_COST or pick a cheaper endpoint.";
    }
    if (typeof o.message === "string" && o.message && !/top.?up/i.test(o.message)) {
      return `treg ${r.status}: ${o.message.slice(0, 240)}`;
    }
    if (code) return `treg ${r.status}: ${code}`;
  }
  return `treg ${r.status}: ${r.text.slice(0, 240)}`;
}

function normalizeHit(raw: Record<string, unknown>): TregCatalogHit {
  const cost = asObj(raw.cost);
  const observed = asObj(raw.observed);
  const input = asObj(raw.input);
  const test = (raw.test_request && typeof raw.test_request === "object"
    ? (raw.test_request as TregTestRequest)
    : inferTestRequest(input));
  return {
    id: String(raw.id ?? ""),
    provider: String(raw.provider ?? ""),
    name: String(raw.name ?? raw.id ?? ""),
    summary: String(raw.summary ?? raw.capability_description ?? ""),
    method: String(raw.method ?? "GET"),
    platform: String(raw.platform ?? ""),
    platformLabel: String(raw.platform_label ?? raw.platform ?? ""),
    capability: String(raw.capability ?? ""),
    costUsd: num(cost?.usd ?? cost?.value),
    okRate: num(observed?.ok_rate),
    samples: num(observed?.samples) ?? 0,
    score: num(raw.score) ?? 0,
    testRequest: test,
  };
}

function inferTestRequest(input: Record<string, unknown> | null): TregTestRequest | null {
  if (!input) return null;
  const qp = asObj(input.queryParams);
  if (!qp) return null;
  const queryParams: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(qp)) {
    const field = asObj(v);
    if (field?.example != null) queryParams[k] = field.example;
  }
  return Object.keys(queryParams).length ? { queryParams } : null;
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}
