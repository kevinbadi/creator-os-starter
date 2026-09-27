import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import {
  activeChannelAccountIds,
  loadDeletableComment,
} from "@/lib/comments/delete";
import { replyToComment } from "@/lib/comments/reply";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isValidSession(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let eventId = "";
  let message = "";
  try {
    const body = (await req.json()) as { event_id?: string; message?: string };
    eventId = String(body.event_id ?? "").trim();
    message = String(body.message ?? "").trim().slice(0, 1000);
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  if (!eventId) return NextResponse.json({ error: "Need event_id." }, { status: 400 });
  if (!message) return NextResponse.json({ error: "Say what to reply." }, { status: 400 });
  const accountIds = await activeChannelAccountIds();
  if (!accountIds.length) {
    return NextResponse.json({ error: "No connected accounts on this channel." }, { status: 400 });
  }
  const row = await loadDeletableComment({ eventId, accountIds });
  if (!row) {
    return NextResponse.json({ error: "Comment not found on this channel (or already gone)." }, { status: 404 });
  }
  const out = await replyToComment(row, message);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: 502 });
  return NextResponse.json({
    ok: true,
    event_id: row.event_id,
    reply: out.reply,
    summary: `Replied to @${String(row.author_username ?? "someone").replace(/^@/, "")}: "${out.reply}"`,
  });
}
