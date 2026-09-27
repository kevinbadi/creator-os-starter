import { NextResponse } from "next/server";
import { uploadToInsforge } from "@/lib/insforge/storage";

// Download a Giphy MP4 and store it in Insforge as a video, so it posts as a
// carousel-safe video item on every platform. Gated by the auth proxy.
export async function POST(req: Request) {
  try {
    const { url, title } = await req.json();
    if (
      typeof url !== "string" ||
      !/^https:\/\/[a-z0-9.-]*giphy\.com\//i.test(url)
    ) {
      return NextResponse.json({ error: "Invalid Giphy URL." }, { status: 400 });
    }

    const res = await fetch(url);
    if (!res.ok) {
      return NextResponse.json(
        { error: `Could not fetch GIF (${res.status}).` },
        { status: 502 },
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const name =
      String(title || "giphy")
        .replace(/[^a-z0-9-_]+/gi, "_")
        .slice(0, 40) +
      "-" +
      buf.length +
      ".mp4";

    const file = new File([buf], name, { type: "video/mp4" });
    const media = await uploadToInsforge(file);
    return NextResponse.json(media); // { url, type: "video" }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Import failed." },
      { status: 500 },
    );
  }
}
