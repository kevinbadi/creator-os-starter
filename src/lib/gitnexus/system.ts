import "server-only";
import systemJson from "@/data/system-graph.json";
import type { SystemGraph, SystemGraphMeta } from "./system-types";

/**
 * Marketing OS as a system graph (automations, skills, routes, services,
 * tables, personas, platforms…), exported by `npm run system-graph`
 * (scripts/system-graph-export.mjs). Static per deploy like the code graph.
 */
export function getSystemGraph(): SystemGraph {
  return systemJson as unknown as SystemGraph;
}

export function getSystemGraphMeta(): SystemGraphMeta {
  const g = getSystemGraph();
  const byType: Record<string, number> = {};
  for (const n of g.nodes) {
    const t = g.types[n.t];
    byType[t] = (byType[t] ?? 0) + 1;
  }
  return { generatedAt: g.generatedAt, commit: g.commit, nodes: g.nodes.length, edges: g.edges.length, byType };
}
