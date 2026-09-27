import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { alfredErrorLine, alfredLine, jevVoiceConfigured, synthesizeJev } from "@/lib/jev/voice";

export const runtime = "nodejs";
export const maxDuration = 60;

async function requireSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token);
}

/**
 * POST { question, tool, summary, rowCount, failed }
 *   -> { text, source, audio?: base64 mp3, voice: "elevenlabs" | "browser" }
 *
 * The spoken line is always returned so the client can fall back to the
 * browser's speechSynthesis (with a British voice) when ElevenLabs is not
 * configured or errors.
 */
export async function POST(req: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { question?: string; tool?: string; summary?: string; rowCount?: number; failed?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  const question = String(body.question ?? "").trim().slice(0, 500);
  const summary = String(body.summary ?? "").trim().slice(0, 2000);

  const line = body.failed
    ? { text: alfredErrorLine(question), source: "template" as const }
    : await alfredLine({
        question,
        tool: String(body.tool ?? "").slice(0, 60),
        summary,
        rowCount: Number.isFinite(body.rowCount) ? Number(body.rowCount) : 0,
      });

  if (!jevVoiceConfigured()) {
    return NextResponse.json({ text: line.text, source: line.source, voice: "browser" });
  }
  try {
    const mp3 = await synthesizeJev(line.text, req.signal);
    return NextResponse.json({
      text: line.text,
      source: line.source,
      voice: "elevenlabs",
      audio: mp3.toString("base64"),
    });
  } catch (e) {
    console.warn("[jev-voice] tts failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ text: line.text, source: line.source, voice: "browser" });
  }
}
