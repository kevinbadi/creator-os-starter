import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import {
  activeChannelAccountIds,
  loadDeletableComment,
  removeComment,
} from "@/lib/comments/delete";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isValidSession(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let eventId = "";
  let commentId = "";
  try {
    const body = (await req.json()) as { event_id?: string; comment_id?: string };
    eventId = String(body.event_id ?? "").trim();
    commentId = String(body.comment_id ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  if (!eventId && !commentId) {
    return NextResponse.json({ error: "Need event_id or comment_id." }, { status: 400 });
  }
  const accountIds = await activeChannelAccountIds();
  if (!accountIds.length) {
    return NextResponse.json({ error: "No connected accounts on this channel." }, { status: 400 });
  }
  const row = await loadDeletableComment({ eventId: eventId || undefined, commentId: commentId || undefined, accountIds });
  if (!row) {
    return NextResponse.json({ error: "Comment not found on this channel (or already deleted)." }, { status: 404 });
  }
  const out = await removeComment(row);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: 502 });
  return NextResponse.json({
    ok: true,
    event_id: row.event_id,
    hidden: Boolean(out.hidden),
    summary: out.hidden
      ? `Hidden @${String(row.author_username ?? "someone").replace(/^@/, "")} (Threads cannot delete replies).`
      : `Deleted @${String(row.author_username ?? "someone").replace(/^@/, "")}: "${String(row.comment_text ?? "").replace(/\s+/g, " ").trim()}"`,
  });
}
