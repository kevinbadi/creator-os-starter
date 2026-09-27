import "server-only";
import graphJson from "@/data/gitnexus-graph.json";
import type { RepoGraph, RepoGraphMeta } from "./types";

/**
 * The GitNexus knowledge graph of this repo, exported by
 * `npm run repo-graph` (scripts/gitnexus-export.mjs). Static at build time —
 * Railway has no gitnexus CLI, so the JSON is committed and refreshed locally.
 */
export function getRepoGraph(): RepoGraph {
  return graphJson as unknown as RepoGraph;
}

export function getRepoGraphMeta(): RepoGraphMeta {
  const g = getRepoGraph();
  return {
    repo: g.repo,
    clusters: g.clusters.length,
    nodes: g.nodes.length,
    edges: g.edges.length,
    flows: g.flows.length,
  };
}
