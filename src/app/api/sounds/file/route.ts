import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Proxy an Insforge-hosted audio object with a correct audio MIME + Range support.
// Insforge serves objects as binary/octet-stream, which <audio> won't reliably
// play; this relays the bytes with the right Content-Type and passes Range
// through for seeking. Restricted to the configured Insforge host (no SSRF).
const INSFORGE_BASE = process.env.INSFORGE_API_BASE_URL ?? "";

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get("u");
  if (!u) return new NextResponse("Missing u", { status: 400 });

  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return new NextResponse("Bad url", { status: 400 });
  }
  // Only proxy our own Insforge storage host.
  const allowedHost = INSFORGE_BASE ? new URL(INSFORGE_BASE).host : "";
  if (!allowedHost || target.host !== allowedHost) {
    return new NextResponse("Forbidden host", { status: 403 });
  }

  const range = req.headers.get("range");
  const upstream = await fetch(target.toString(), {
    headers: range ? { Range: range } : {},
    cache: "no-store",
  });
  if (!upstream.ok && upstream.status !== 206) {
    return new NextResponse("Upstream error", { status: upstream.status });
  }

  const mime = target.pathname.toLowerCase().endsWith(".mp3")
    ? "audio/mpeg"
    : "audio/mp4";
  const headers = new Headers();
  headers.set("Content-Type", mime);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, max-age=3600");
  for (const h of ["content-length", "content-range"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
