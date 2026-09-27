import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { jevConfigured } from "@/lib/jev/client";
import { decide, logDecision, priorCommentsFromBody, runTool, TOOLS, RANGES } from "@/lib/jev/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

async function requireSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token);
}

export async function GET() {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ configured: jevConfigured(), tools: TOOLS, ranges: RANGES });
}

/** POST { message } -> Jev picks the tool + range, the dispatcher runs it. */
export async function POST(req: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!jevConfigured()) {
    return NextResponse.json({ error: "TYPESAFE_API_KEY is not set on this server." }, { status: 503 });
  }
  let message = "";
  let priorComments = priorCommentsFromBody(undefined);
  try {
    const body = (await req.json()) as { message?: string; priorComments?: unknown };
    message = String(body.message ?? "").trim().slice(0, 2000);
    priorComments = priorCommentsFromBody(body.priorComments);
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  if (!message) return NextResponse.json({ error: "Say something." }, { status: 400 });

  let decision;
  try {
    decision = await decide(message);
  } catch (e) {
    return NextResponse.json(
      { error: `Jev could not decide: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
  try {
    const result = await runTool(decision.tool, decision.range, decision.sort, decision.platform, decision.status, decision.count, decision.media, message, priorComments);
    void logDecision(message, decision, true);
    return NextResponse.json({ decision, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void logDecision(message, decision, false, msg);
    return NextResponse.json({ decision, error: `Tool ${decision.tool} failed: ${msg}` }, { status: 500 });
  }
}
