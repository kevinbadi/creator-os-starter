import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { layaConfigured, layaEvaluate } from "@/lib/laya/client";
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
  let ready = false;
  if (layaConfigured()) {
    try {
      const base = (process.env.LAYA_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
      ready = r.ok;
    } catch {
      ready = false;
    }
  }
  return NextResponse.json({ configured: ready, tools: TOOLS, ranges: RANGES });
}

/** POST { message } -> Laya picks the tool + range, the same dispatcher runs it. */
export async function POST(req: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!layaConfigured()) {
    return NextResponse.json({ error: "Laya is disabled (LAYA_ENABLED=0)." }, { status: 503 });
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
    decision = await decide(message, { evaluate: layaEvaluate, slimBrands: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = /fetch failed|ECONNREFUSED|aborted/i.test(msg)
      ? " Start the sidecar: npm run laya-server"
      : "";
    return NextResponse.json({ error: `Laya could not decide: ${msg}.${hint}` }, { status: 502 });
  }
  try {
    const result = await runTool(
      decision.tool,
      decision.range,
      decision.sort,
      decision.platform,
      decision.status,
      decision.count,
      decision.media,
      message,
      priorComments,
    );
    void logDecision(message, decision, true, undefined, "laya-chat");
    return NextResponse.json({ decision, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void logDecision(message, decision, false, msg, "laya-chat");
    return NextResponse.json({ decision, error: `Tool ${decision.tool} failed: ${msg}` }, { status: 500 });
  }
}
