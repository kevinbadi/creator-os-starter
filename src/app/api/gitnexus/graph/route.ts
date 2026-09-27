import { NextResponse } from "next/server";
import { getRepoGraph } from "@/lib/gitnexus/graph";

// Session-gated by src/proxy.ts like every other /api route. The payload is
// the committed export, so it is immutable per deploy — cache it hard and let
// the ETag (commit hash) short-circuit repeat loads.
export async function GET(request: Request) {
  const graph = getRepoGraph();
  const etag = `"gn-${graph.repo.commit.slice(0, 12)}-${graph.nodes.length}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }
  return NextResponse.json(graph, {
    headers: {
      ETag: etag,
      "Cache-Control": "private, max-age=300, stale-while-revalidate=3600",
    },
  });
}
