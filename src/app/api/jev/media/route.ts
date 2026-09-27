import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { mediaDiskPath } from "@/lib/jev/obsidian";

/**
 * GET /api/jev/media?file=<vault-relative path>
 * Serves a media file straight from the Obsidian vault on disk so the Jev page
 * can show thumbnails for get_media answers. Local only (OBSIDIAN_VAULT_DIR);
 * on Railway the vault does not exist and this 404s.
 */
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await isValidSession(token))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const file = new URL(req.url).searchParams.get("file") || "";
  const abs = file ? mediaDiskPath(file) : null;
  if (!abs) return NextResponse.json({ error: "not found" }, { status: 404 });
  const type = TYPES[path.extname(abs).toLowerCase()];
  if (!type) return NextResponse.json({ error: "unsupported type" }, { status: 415 });
  const body = fs.readFileSync(abs);
  return new NextResponse(body, {
    headers: { "content-type": type, "cache-control": "private, max-age=300", "content-length": String(body.length) },
  });
}
