import { NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/agent-edits/http";
import { getClone, readProgress, updateClone } from "@/lib/agent-clones/store";
import { cancelCloneRun } from "@/lib/agent-clones/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) return unauthorized();
  const { id } = await ctx.params;
  const clone = await getClone(decodeURIComponent(id));
  if (!clone) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const events = readProgress(clone.slug);
  return NextResponse.json({ clone, events });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) return unauthorized();
  const { id } = await ctx.params;
  const clone = await getClone(decodeURIComponent(id));
  if (!clone) return NextResponse.json({ error: "Not found" }, { status: 404 });
  cancelCloneRun(clone.slug, clone.pid);
  const next = await updateClone(clone.id, { status: "cancelled", error: "Cancelled", pid: null });
  return NextResponse.json({ clone: next ?? { ...clone, status: "cancelled" } });
}
