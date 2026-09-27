import { NextRequest, NextResponse } from "next/server";
import {
  isAiNewsKind,
  listAiNews,
  upsertAiNewsItems,
  type AiNewsIngestInput,
} from "@/lib/ai-news/store";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";

/**
 * Ingest endpoint for the AI news desk.
 * GET is session-only (dashboard). POST is for future automations:
 *   Authorization: Bearer $AI_NEWS_INGEST_SECRET  (falls back to APP_AUTH_SECRET)
 * or a logged-in session cookie.
 */
export const dynamic = "force-dynamic";

function ingestSecret(): string {
  return process.env.AI_NEWS_INGEST_SECRET || process.env.APP_AUTH_SECRET || "";
}

function bearer(req: Request): string {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : req.headers.get("x-ai-news-key")?.trim() || "";
}

async function authorized(req: NextRequest): Promise<boolean> {
  if (await isValidSession(req.cookies.get(SESSION_COOKIE)?.value)) return true;
  const secret = ingestSecret();
  const token = bearer(req);
  return Boolean(secret && token && token === secret);
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const raw = req.nextUrl.searchParams.get("kind");
  const kind = isAiNewsKind(raw) ? raw : "all";
  const items = await listAiNews({ kind, limit: 80 });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const rawItems = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items)
      ? (body as { items: unknown[] }).items
      : body && typeof body === "object"
        ? [body]
        : [];
  const inputs: AiNewsIngestInput[] = [];
  for (const row of rawItems) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (!isAiNewsKind(r.kind)) continue;
    inputs.push({
      kind: r.kind,
      title: String(r.title ?? ""),
      summary: r.summary == null ? null : String(r.summary),
      url: r.url == null ? null : String(r.url),
      source: r.source == null ? null : String(r.source),
      sourceId: r.sourceId == null && r.source_id == null ? null : String(r.sourceId ?? r.source_id),
      imageUrl: r.imageUrl == null && r.image_url == null ? null : String(r.imageUrl ?? r.image_url),
      publishedAt:
        r.publishedAt == null && r.published_at == null
          ? null
          : String(r.publishedAt ?? r.published_at),
      tags: Array.isArray(r.tags) ? r.tags.map(String) : null,
      extra: r.extra && typeof r.extra === "object" ? (r.extra as Record<string, unknown>) : null,
    });
  }
  if (!inputs.length) {
    return NextResponse.json({ error: "no valid items" }, { status: 400 });
  }
  try {
    const result = await upsertAiNewsItems(inputs);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "ingest failed" },
      { status: 500 },
    );
  }
}
