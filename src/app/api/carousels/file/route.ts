import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

// Serve a generated carousel slide (image or reaction-reel video) from local
// disk. Sandboxed hard to `.claude/brand-content` and to these extensions —
// the `p` param is resolved and must stay inside the base dir (no path
// traversal). Protected by the auth proxy like the rest of /dashboard.
const BRAND_BASE = path.join(process.cwd(), ".claude", "brand-content");

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("p");
  if (!p) return new NextResponse("Missing p", { status: 400 });

  const abs = path.resolve(BRAND_BASE, p);
  if (abs !== BRAND_BASE && !abs.startsWith(BRAND_BASE + path.sep)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const mime = MIME[path.extname(abs).toLowerCase()];
  if (!mime) return new NextResponse("Unsupported media type", { status: 415 });
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const buf = fs.readFileSync(abs);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
