import { NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/agent-edits/http";
import { createEdit, listEdits } from "@/lib/agent-edits/store";
import { ensureWorkdir, humanizeSlug, slugifyName, uniqueSlug, WORKFLOW_ID } from "@/lib/agent-edits/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireSession())) return unauthorized();
  const edits = await listEdits();
  return NextResponse.json({ edits });
}

export async function POST(req: Request) {
  if (!(await requireSession())) return unauthorized();
  let body: {
    title?: string;
    notes?: string;
    sourceUrl?: string;
    filename?: string;
    workflow?: string;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const workflow = (body.workflow || WORKFLOW_ID).trim();
  if (workflow !== WORKFLOW_ID) {
    return NextResponse.json({ error: `Unknown workflow: ${workflow}` }, { status: 400 });
  }
  const filename = (body.filename || "").trim();
  if (!filename) return NextResponse.json({ error: "filename required" }, { status: 400 });
  const title = (body.title || "").trim() || humanizeSlug(slugifyName(filename));
  const slug = uniqueSlug(slugifyName((body.title || filename).trim() || "talking-head"));
  try {
    ensureWorkdir(slug);
    const edit = await createEdit({
      workflow,
      slug,
      title,
      notes: (body.notes || "").trim(),
      sourceUrl: (body.sourceUrl || "").trim(),
      clipName: filename,
    });
    return NextResponse.json({ edit });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not create edit";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
