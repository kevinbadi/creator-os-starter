import { NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/agent-edits/http";
import { writeKevinScript, type ScriptFormat } from "@/lib/script-writer/write";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!(await requireSession())) return unauthorized();

  let body: {
    topic?: string;
    data?: string;
    format?: string;
    ctaWord?: string;
    angle?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const topic = String(body.topic || "").trim();
  if (!topic) return NextResponse.json({ error: "Topic is required" }, { status: 400 });

  const format = (body.format === "longform" ? "longform" : "shortform") as ScriptFormat;

  try {
    const result = await writeKevinScript({
      topic,
      data: String(body.data || ""),
      format,
      ctaWord: String(body.ctaWord || "").trim() || undefined,
      angle: String(body.angle || "").trim() || undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Script writer failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
