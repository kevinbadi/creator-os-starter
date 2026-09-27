import { NextResponse } from "next/server";
import { rewriteInKevinTone } from "@/lib/copywriter/rewrite";
import { getSource, updateSource } from "@/lib/copywriter/store";

export const runtime = "nodejs";
export const maxDuration = 180;

// POST /api/copywriter/sources/:id/convert
// Reads the source transcript, picks short-form or long-form from the
// original cut, and writes a Kevin-voice script onto the row.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const source = await getSource(id);
  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  if (source.status !== "done" || !source.transcript.trim()) {
    return NextResponse.json({ error: "Need a finished transcript first." }, { status: 409 });
  }
  try {
    const out = await rewriteInKevinTone(source);
    await updateSource(id, {
      rewrite: out.script,
      rewriteSkill: out.skillDir,
      rewrittenAt: new Date(),
    });
    const updated = await getSource(id);
    return NextResponse.json({ source: updated, skill: out.skill, skillDir: out.skillDir });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Convert failed";
    console.error("[copywriter] convert:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
