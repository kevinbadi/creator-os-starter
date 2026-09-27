import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { uploadToInsforge } from "@/lib/insforge/storage";
import { uploadStreamToZernio, uploadToZernio } from "@/lib/zernio/media";

// Insforge S3 policy caps at 50MiB. Composer videos (and anything over that)
// go to Zernio R2, which accepts multi-GB masters.

export const runtime = "nodejs";
export const maxDuration = 800;

const INSFORGE_MAX_BYTES = 45 * 1024 * 1024;

function isHeavy(file: File): boolean {
  if (file.size > INSFORGE_MAX_BYTES) return true;
  if (file.type.startsWith("video/")) return true;
  return /\.(mp4|m4v|mov|webm)$/i.test(file.name);
}

async function requireSession(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token);
}

export async function POST(req: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    const media = isHeavy(file)
      ? await uploadToZernio(file)
      : await uploadToInsforge(file);
    return NextResponse.json(media);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed.";
    const truncated = /formdata|form data/i.test(message);
    return NextResponse.json(
      {
        error: truncated
          ? "Video is too large for the upload proxy. Retry — large files upload directly to storage."
          : message,
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const filename = decodeURIComponent(
    req.headers.get("x-filename") || "upload.mp4",
  );
  const contentType =
    req.headers.get("content-type") || "application/octet-stream";
  const body = req.body;
  if (!body) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  try {
    const media = await uploadStreamToZernio(filename, contentType, body);
    return NextResponse.json(media);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed." },
      { status: 500 },
    );
  }
}
