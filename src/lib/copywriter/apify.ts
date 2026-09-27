import "server-only";

// Apify actor memo23/instagram-transcript-scraper (Kevin's pick, 2026-09-14).
// Input: { startUrls: [{ url }], whisperModel, language, includeSegments, maxItems }.
// Output items: { url, shortcode, username, fullName, caption, durationSec,
// thumbnailUrl, likeCount, commentCount, viewCount, transcript, hook3s,
// status: "ok" | "no_speech", language }. $0.015 per delivered transcript.
// Override the actor with APIFY_IG_TRANSCRIPT_ACTOR (owner~name form).
const ACTOR = (process.env.APIFY_IG_TRANSCRIPT_ACTOR || "memo23~instagram-transcript-scraper").replace("/", "~");
const BASE = "https://api.apify.com/v2";

export type ApifyRunStatus =
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "ABORTED"
  | "TIMED-OUT"
  | "TIMING-OUT"
  | "ABORTING";

export type TranscriptItem = {
  sourceUrl: string;
  shortcode: string | null;
  status: "success" | "failed";
  transcript: string;
  caption: string;
  hook3s: string;
  username: string;
  fullName: string;
  thumbnailUrl: string;
  likeCount: number | null;
  commentCount: number | null;
  viewCount: number | null;
  language: string | null;
  durationSec: number | null;
  error: string;
};

function token(): string {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error("APIFY_TOKEN is not set");
  return t;
}

export const apifyConfigured = Boolean(process.env.APIFY_TOKEN);

export async function startTranscriptRun(
  urls: string[],
): Promise<{ runId: string; datasetId: string }> {
  const res = await fetch(`${BASE}/acts/${ACTOR}/runs?token=${token()}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      startUrls: urls.map((url) => ({ url })),
      whisperModel: process.env.APIFY_IG_WHISPER_MODEL || "base",
      language: "auto",
      includeSegments: false,
      maxItems: Math.max(urls.length, 1),
      maxDurationSec: 600,
      maxConcurrency: 2,
      analyzeReel: false,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const json = (await res.json().catch(() => null)) as
    | { data?: { id?: string; defaultDatasetId?: string }; error?: { message?: string } }
    | null;
  const runId = json?.data?.id;
  const datasetId = json?.data?.defaultDatasetId;
  if (!res.ok || !runId || !datasetId) {
    throw new Error(
      `Apify run did not start (${res.status}): ${json?.error?.message || JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return { runId, datasetId };
}

export async function getRunStatus(
  runId: string,
): Promise<{ status: ApifyRunStatus; datasetId: string | null }> {
  const res = await fetch(`${BASE}/actor-runs/${runId}?token=${token()}`, {
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as
    | { data?: { status?: ApifyRunStatus; defaultDatasetId?: string } }
    | null;
  if (!res.ok || !json?.data?.status) throw new Error(`Apify run lookup failed (${res.status})`);
  return { status: json.data.status, datasetId: json.data.defaultDatasetId ?? null };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function getRunItems(datasetId: string): Promise<TranscriptItem[]> {
  const res = await fetch(`${BASE}/datasets/${datasetId}/items?token=${token()}&clean=true`, {
    signal: AbortSignal.timeout(30000),
    cache: "no-store",
  });
  const raw = (await res.json().catch(() => [])) as Record<string, unknown>[];
  if (!Array.isArray(raw)) return [];
  return raw.map((it) => {
    const st = String(it.status ?? "").toLowerCase();
    const transcript = text(it.transcript).replace(/\s+/g, " ");
    const ok = (st === "ok" || st === "success") && transcript.length > 0;
    let error = text(it.error);
    if (!ok && !error) error = st === "no_speech" ? "no speech detected (music / silent reel)" : "transcription failed";
    return {
      sourceUrl: text(it.url) || text(it.sourceUrl),
      shortcode: text(it.shortcode) || null,
      status: ok ? "success" : "failed",
      transcript,
      caption: text(it.caption),
      hook3s: text(it.hook3s),
      username: text(it.username),
      fullName: text(it.fullName),
      thumbnailUrl: text(it.thumbnailUrl),
      likeCount: num(it.likeCount),
      commentCount: num(it.commentCount),
      viewCount: num(it.viewCount),
      language: text(it.language) || null,
      durationSec: num(it.durationSec),
      error,
    };
  });
}

/** Normalize an Instagram URL so the same reel matches across share/permalink forms. */
export function normalizeInstagramUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const kind = m[1] === "reels" ? "reel" : m[1];
  return `https://www.instagram.com/${kind}/${m[2]}/`;
}

/** Same reel id regardless of /reel/ vs /p/ form, for matching Apify results back to rows. */
export function instagramId(url: string): string | null {
  const m = url.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}
