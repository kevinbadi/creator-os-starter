import { NextResponse } from "next/server";
import { getSystemGraph } from "@/lib/gitnexus/system";

// Session-gated by src/proxy.ts. Immutable per deploy → cache hard, ETag on
// the export stamp so repeat loads short-circuit.
export async function GET(request: Request) {
  const graph = getSystemGraph();
  const etag = `"sg-${graph.commit.slice(0, 12)}-${graph.nodes.length}-${graph.edges.length}"`;
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
