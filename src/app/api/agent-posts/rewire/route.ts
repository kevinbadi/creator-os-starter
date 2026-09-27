import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { rewireScheduledResourceCtas } from "@/lib/agent-posts/rewire";

export const maxDuration = 300;

// POST /api/agent-posts/rewire?dry=1&ids=a,b
// Re-applies the per-platform resource delivery (LinkedIn first comment,
// Threads reply, X thread reply, YouTube description) to scheduled agent posts.
export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await isValidSession(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const results = await rewireScheduledResourceCtas({ ids, dryRun });
  return NextResponse.json({ dryRun, count: results.length, results });
}
