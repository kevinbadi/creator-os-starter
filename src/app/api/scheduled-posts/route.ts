import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { editScheduledPost } from "@/lib/posts/edit-scheduled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token);
}

export async function PATCH(req: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const str = (key: string): string | undefined => {
    if (!(key in body)) return undefined;
    const v = body[key];
    if (v == null) return "";
    return String(v);
  };

  const result = await editScheduledPost({
    zernioPostId: str("zernioPostId"),
    agentPostId: str("agentPostId"),
    title: str("title"),
    caption: str("caption"),
    scheduledFor: str("scheduledFor"),
    keyword: str("keyword"),
    dmText: str("dmText"),
    commentReply: str("commentReply"),
    resourceUrl: str("resourceUrl"),
    thumbnailUrl: str("thumbnailUrl"),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/posts");
  revalidatePath("/dashboard/agent-posts");
  return NextResponse.json(result.data);
}
