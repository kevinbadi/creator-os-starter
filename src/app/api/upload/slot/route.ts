import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { createZernioMediaSlot } from "@/lib/zernio/media";

// Browser PUTs the file straight to Zernio R2 so Next never buffers a 1GB reel.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await isValidSession(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      filename?: string;
      contentType?: string;
    };
    const filename = String(body.filename || "").trim() || "upload.mp4";
    const slot = await createZernioMediaSlot(filename, body.contentType);
    return NextResponse.json({
      uploadUrl: slot.uploadUrl,
      publicUrl: slot.publicUrl,
      contentType: slot.contentType,
      type: slot.type,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not start upload." },
      { status: 500 },
    );
  }
}
