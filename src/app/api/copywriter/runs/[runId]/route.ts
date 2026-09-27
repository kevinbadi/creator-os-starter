import { NextResponse } from "next/server";
import { getRunItems, getRunStatus, instagramId } from "@/lib/copywriter/apify";
import { analyzeTranscript } from "@/lib/copywriter/analyze";
import { listSourcesByRun, updateSource, type CopySource } from "@/lib/copywriter/store";

export const runtime = "nodejs";

// GET -> { status, sources }. While the Apify run is going we just report it.
// Once it SUCCEEDED we pull the dataset, write transcripts onto the rows and
// run the topic read for each one (idempotent: rows already past
// "transcribing" are left alone, so repeated polls do not double-charge the LLM).
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });

  let sources = await listSourcesByRun(runId);
  const pending = sources.filter((s) => s.status === "transcribing");
  if (!pending.length) {
    return NextResponse.json({ status: "done", sources });
  }

  let run: { status: string; datasetId: string | null };
  try {
    run = await getRunStatus(runId);
  } catch (e) {
    return NextResponse.json(
      { status: "running", sources, warning: e instanceof Error ? e.message : "poll failed" },
    );
  }

  if (["FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
    for (const s of pending) await updateSource(s.id, { status: "failed", error: `Apify run ${run.status}` });
    sources = await listSourcesByRun(runId);
    return NextResponse.json({ status: "done", sources });
  }
  if (run.status !== "SUCCEEDED" || !run.datasetId) {
    return NextResponse.json({ status: "running", apify: run.status, sources });
  }

  const items = await getRunItems(run.datasetId);
  const byId = new Map(items.map((it) => [instagramId(it.sourceUrl) ?? it.sourceUrl, it]));

  for (const s of pending) {
    const it = byId.get(instagramId(s.url) ?? s.url);
    if (!it) {
      await updateSource(s.id, { status: "failed", error: "Apify returned no result for this URL" });
      continue;
    }
    const meta = {
      caption: it.caption,
      hook3s: it.hook3s,
      username: it.username,
      thumbnailUrl: it.thumbnailUrl,
      likeCount: it.likeCount,
      commentCount: it.commentCount,
      viewCount: it.viewCount,
      durationSec: it.durationSec,
      language: it.language,
    };
    if (it.status !== "success") {
      await updateSource(s.id, { ...meta, status: "failed", error: it.error });
      continue;
    }
    await updateSource(s.id, { ...meta, transcript: it.transcript, status: "analyzing", error: "" });
    try {
      const read = await analyzeTranscript(it.transcript, it.caption);
      await updateSource(s.id, { ...read, status: "done" });
    } catch (e) {
      // Transcript is still valuable without the topic read: keep it, flag the LLM error.
      await updateSource(s.id, {
        status: "done",
        error: `topic read failed: ${e instanceof Error ? e.message : "unknown"}`,
      });
    }
  }
  sources = await listSourcesByRun(runId);
  const out: { status: string; sources: CopySource[] } = { status: "done", sources };
  return NextResponse.json(out);
}
