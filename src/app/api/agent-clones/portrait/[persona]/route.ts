import { NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { requireSession, unauthorized } from "@/lib/agent-edits/http";
import { CLONE_PERSONAS, isClonePersona } from "@/lib/agent-clones/personas";
import { CREATOR_OS } from "@/lib/agent-clones/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ persona: string }> }) {
  if (!(await requireSession())) return unauthorized();
  const { persona } = await ctx.params;
  if (!isClonePersona(persona)) return new NextResponse("Unknown persona", { status: 404 });
  const rel = CLONE_PERSONAS[persona].portraitRel;
  const abs = path.resolve(CREATOR_OS, rel);
  if (!abs.startsWith(CREATOR_OS + path.sep) || !fs.existsSync(abs)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const cacheDir = path.join(os.tmpdir(), "mos-clone-portraits");
  fs.mkdirSync(cacheDir, { recursive: true });
  const thumb = path.join(cacheDir, `${persona}.jpg`);
  const srcM = fs.statSync(abs).mtimeMs;
  let fresh = false;
  try {
    fresh = fs.statSync(thumb).mtimeMs >= srcM && fs.statSync(thumb).size > 800;
  } catch {
    fresh = false;
  }
  if (!fresh) {
    const r = spawnSync(
      "ffmpeg",
      ["-y", "-i", abs, "-vf", "scale=480:-2", "-q:v", "4", thumb],
      { encoding: "utf8" },
    );
    if (r.status !== 0 || !fs.existsSync(thumb)) {
      const mime = abs.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      const buf = fs.readFileSync(abs);
      return new NextResponse(new Uint8Array(buf), {
        headers: { "Content-Type": mime, "Cache-Control": "private, max-age=86400" },
      });
    }
  }
  const buf = fs.readFileSync(thumb);
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" },
  });
}
