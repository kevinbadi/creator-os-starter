import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/agent-edits/http";
import { ensureWorkdir, mediaPath } from "@/lib/agent-edits/paths";
import { startEditRun } from "@/lib/agent-edits/runner";
import { getEdit, updateEdit } from "@/lib/agent-edits/store";

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
  const edit = await getEdit(decodeURIComponent(id));
  if (!edit) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!req.body) return NextResponse.json({ error: "No file provided." }, { status: 400 });

  const filename = decodeURIComponent(req.headers.get("x-filename") || edit.clipName || "talking-head.mp4");
  const workdir = ensureWorkdir(edit.slug);
  const dest = path.join(workdir, "source", `input.${extOf(filename)}`);

  await updateEdit(edit.id, { status: "uploading", clipName: filename });
  try {
    await pipeline(
      Readable.fromWeb(req.body as unknown as import("node:stream/web").ReadableStream),
      createWriteStream(dest),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    await updateEdit(edit.id, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const fresh = (await getEdit(edit.id)) ?? edit;
  try {
    startEditRun(fresh, dest);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not start the edit agent";
    await updateEdit(edit.id, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  const running = await getEdit(edit.id);
  return NextResponse.json({ edit: running, clipPath: dest });
}

/** Restart a failed job from the clip already on disk — no re-upload. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) return unauthorized();
  const { id } = await ctx.params;
  const edit = await getEdit(decodeURIComponent(id));
  if (!edit) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (edit.status === "running" || edit.status === "uploading") {
    return NextResponse.json({ error: "This edit is already running." }, { status: 409 });
  }
  const dest = mediaPath(ensureWorkdir(edit.slug), "clip");
  if (!dest) {
    return NextResponse.json({ error: "No source clip on disk — drop the file again." }, { status: 400 });
  }
  try {
    startEditRun(edit, dest);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not start the edit agent";
    await updateEdit(edit.id, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  const running = await getEdit(edit.id);
  return NextResponse.json({ edit: running, clipPath: dest });
}
