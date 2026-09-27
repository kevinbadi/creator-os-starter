import { NextResponse } from "next/server";
import { apifyConfigured, normalizeInstagramUrl, startTranscriptRun } from "@/lib/copywriter/apify";
import { createSources } from "@/lib/copywriter/store";

export const runtime = "nodejs";

// POST { urls: string[] } -> starts ONE Apify run for every valid Instagram
// URL and creates a copywriter_sources row per URL (status transcribing).
// The client then polls /api/copywriter/runs/:runId until the rows are done.
export async function POST(req: Request) {
  let body: { urls?: unknown } = {};
  try {
    body = (await req.json()) as { urls?: unknown };
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const raw = Array.isArray(body.urls)
    ? body.urls
    : typeof body.urls === "string"
      ? body.urls.split(/[\s,]+/)
      : [];
  const seen = new Set<string>();
  const urls: string[] = [];
  const rejected: string[] = [];
  for (const r of raw) {
    if (typeof r !== "string" || !r.trim()) continue;
    const n = normalizeInstagramUrl(r);
    if (!n) {
      rejected.push(r.trim());
      continue;
    }
    if (!seen.has(n)) {
      seen.add(n);
      urls.push(n);
    }
  }
  if (!urls.length) {
    return NextResponse.json(
      { error: "No valid Instagram reel / post URLs found.", rejected },
      { status: 400 },
    );
  }
  if (urls.length > 25) {
    return NextResponse.json({ error: "Max 25 URLs per batch." }, { status: 400 });
  }
  if (!apifyConfigured) {
    return NextResponse.json({ error: "APIFY_TOKEN is not set on the server." }, { status: 500 });
  }
  try {
    const { runId } = await startTranscriptRun(urls);
    const sources = await createSources(urls, runId);
    return NextResponse.json({ runId, sources, rejected });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to start transcription";
    console.error("[copywriter] transcribe:", msg);
    return NextResponse.json({ error: msg, rejected }, { status: 502 });
  }
}
