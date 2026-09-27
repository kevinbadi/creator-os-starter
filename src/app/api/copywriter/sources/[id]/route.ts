import { NextResponse } from "next/server";
import { deleteSource } from "@/lib/copywriter/store";

export const runtime = "nodejs";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  await deleteSource(id);
  return NextResponse.json({ ok: true });
}
