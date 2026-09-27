import { NextResponse } from "next/server";
import { searchGiphy, trendingGiphy } from "@/lib/giphy/client";

// Proxied so the Giphy key stays server-side. Gated by the auth proxy.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  try {
    const results = q ? await searchGiphy(q, 24) : await trendingGiphy(24);
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Giphy search failed", results: [] },
      { status: 500 },
    );
  }
}
