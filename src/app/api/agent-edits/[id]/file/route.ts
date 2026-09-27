import { NextResponse } from "next/server";
import { fileResponse, requireSession, unauthorized } from "@/lib/agent-edits/http";
import { mediaPath, workdirFor, type MediaKind } from "@/lib/agent-edits/paths";
import { getEdit } from "@/lib/agent-edits/store";
import fs from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

const KINDS = new Set<MediaKind>(["final", "band", "poster", "clip"]);

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) return unauthorized();
  const { id } = await ctx.params;
  const kind = (new URL(req.url).searchParams.get("kind") || "final") as MediaKind;
  if (!KINDS.has(kind)) return new NextResponse("Unknown kind", { status: 400 });
  const edit = await getEdit(decodeURIComponent(id));
  if (!edit) return new NextResponse("Not found", { status: 404 });
  const abs = mediaPath(workdirFor(edit.slug), kind);
  if (!abs || !fs.existsSync(abs)) return new NextResponse("Not found", { status: 404 });
  const mime = MIME[abs.slice(abs.lastIndexOf(".")).toLowerCase()] || "application/octet-stream";
  return fileResponse(abs, mime, req);
}
