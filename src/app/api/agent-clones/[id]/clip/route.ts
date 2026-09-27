import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/agent-edits/http";
import { ensureWorkdir } from "@/lib/agent-clones/paths";
import { startCloneRun } from "@/lib/agent-clones/runner";
import { getClone, updateClone } from "@/lib/agent-clones/store";
import type { AgentClone } from "@/lib/agent-clones/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

function extOf(name: string): string {
  const m = /\.(mp4|mov|m4v|webm)$/i.exec(name);
  return m ? m[1].toLowerCase() : "mp4";
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) return unauthorized();
  const { id } = await ctx.params;
  const clone = await getClone(decodeURIComponent(id));
  if (!clone) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!req.body) return NextResponse.json({ error: "No file provided." }, { status: 400 });

  const filename = decodeURIComponent(req.headers.get("x-filename") || clone.clipName || "source.mp4");
  const siblingIds = (req.headers.get("x-sibling-ids") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== clone.id);

  const workdir = ensureWorkdir(clone.slug, clone.format);
  const dest = path.join(workdir, "source", `video.${extOf(filename)}`);

  await updateClone(clone.id, { status: "uploading", clipName: filename });
  try {
    await pipeline(
      Readable.fromWeb(req.body as unknown as import("node:stream/web").ReadableStream),
      createWriteStream(dest),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    await updateClone(clone.id, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const jobs: AgentClone[] = [clone];
  for (const sid of siblingIds) {
    const sib = await getClone(sid);
    if (!sib) continue;
    const sibDir = ensureWorkdir(sib.slug, sib.format);
    const sibDest = path.join(sibDir, "source", `video.${extOf(filename)}`);
    fs.copyFileSync(dest, sibDest);
    await updateClone(sib.id, { status: "uploading", clipName: filename });
    jobs.push(sib);
  }

  const started: AgentClone[] = [];
  for (const job of jobs) {
    const fresh = (await getClone(job.id)) ?? job;
    const clip = path.join(ensureWorkdir(fresh.slug, fresh.format), "source", `video.${extOf(filename)}`);
    try {
      startCloneRun(fresh, clip);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start Claude";
      await updateClone(fresh.id, { status: "failed", error: msg });
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    started.push((await getClone(fresh.id)) ?? fresh);
  }
  return NextResponse.json({ clone: started[0], clones: started, clipPath: dest });
}
