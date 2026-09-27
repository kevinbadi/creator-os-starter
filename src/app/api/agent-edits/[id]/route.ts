import { NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/agent-edits/http";
import { getEdit, readProgress, updateEdit } from "@/lib/agent-edits/store";
import { cancelEditRun } from "@/lib/agent-edits/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) return unauthorized();
  const { id } = await ctx.params;
  const edit = await getEdit(decodeURIComponent(id));
  if (!edit) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const events = readProgress(edit.slug);
  return NextResponse.json({ edit, events });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) return unauthorized();
  const { id } = await ctx.params;
  const edit = await getEdit(decodeURIComponent(id));
  if (!edit) return NextResponse.json({ error: "Not found" }, { status: 404 });
  cancelEditRun(edit.slug, edit.pid);
  const next = await updateEdit(edit.id, { status: "cancelled", error: "Cancelled", pid: null });
  return NextResponse.json({ edit: next ?? { ...edit, status: "cancelled" } });
}
