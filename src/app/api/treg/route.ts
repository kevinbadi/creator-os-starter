import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { jevConfigured } from "@/lib/jev/client";
import { tregBalance, tregConfigured, tregOrg } from "@/lib/treg/client";
import { runTregPipeline } from "@/lib/treg/pipeline";
import { createRun, listRuns } from "@/lib/treg/store";

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
  let balance: { usd: number | null; micro: number | null } = { usd: null, micro: null };
  if (tregConfigured()) {
    try {
      const b = await Promise.race([
        tregBalance(),
        new Promise<{ usd: null; micro: null }>((resolve) =>
          setTimeout(() => resolve({ usd: null, micro: null }), 8000),
        ),
      ]);
      balance = { usd: b.usd, micro: b.micro };
    } catch {
      balance = { usd: null, micro: null };
    }
  }
  return NextResponse.json({
    configured: tregConfigured(),
    jev: jevConfigured(),
    org: tregOrg(),
    balance,
    runs: listRuns(),
  });
}

export async function POST(req: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!tregConfigured()) {
    return NextResponse.json({ error: "TREG_TOKEN is not set on this server." }, { status: 503 });
  }
  let ask = "";
  try {
    const body = (await req.json()) as { ask?: string };
    ask = String(body.ask ?? "").trim().slice(0, 500);
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  if (!ask) return NextResponse.json({ error: "Ask for live data." }, { status: 400 });
  const run = createRun(ask);
  void runTregPipeline(run);
  return NextResponse.json({ run });
}
