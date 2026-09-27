import type { SystemGraph, SystemNode } from "@/lib/gitnexus/system-types";

/** A body in the orbital view. */
export type BNode = {
  i: number;
  id: string;
  type: number;
  label: string;
  deg: number;
  /** degree rank, 0 = most connected — drives label priority */
  rank: number;
  phase: number;
  data: SystemNode;
};

export type BLink = {
  source: BNode;
  target: BNode;
  type: number;
  weight: number;
};

export type BrainModel = {
  graph: SystemGraph;
  nodes: BNode[];
  links: BLink[];
  /** node index → adjacent node indices */
  adj: number[][];
  /** node index → link indices */
  nodeLinks: number[][];
  typeCounts: number[];
};

export const TYPE_META: Record<string, { label: string; plural: string; color: string; size: number }> = {
  scheduler: { label: "Scheduler", plural: "Schedulers", color: "#ffffff", size: 1.6 },
  automation: { label: "Automation", plural: "Automations", color: "#2dd4bf", size: 1.35 },
  skill: { label: "Skill", plural: "Skills", color: "#a78bfa", size: 1 },
  helper: { label: "Publish helper", plural: "Publish helpers", color: "#818cf8", size: 1.1 },
  script: { label: "Script", plural: "Scripts", color: "#60a5fa", size: 0.9 },
  route: { label: "API route", plural: "API routes", color: "#fbbf24", size: 0.9 },
  webhook: { label: "Webhook", plural: "Webhooks", color: "#fb7185", size: 1.5 },
  page: { label: "Dashboard page", plural: "Dashboard pages", color: "#38bdf8", size: 1.05 },
  module: { label: "Lib module", plural: "Lib modules", color: "#34d399", size: 1 },
  service: { label: "External service", plural: "External services", color: "#f472b6", size: 1.3 },
  table: { label: "DB table", plural: "DB tables", color: "#a3e635", size: 0.9 },
  persona: { label: "Persona", plural: "Personas", color: "#fb923c", size: 1.5 },
  platform: { label: "Platform", plural: "Platforms", color: "#c7d2fe", size: 1.6 },
};

export const EDGE_LABEL: Record<string, { out: string; in: string }> = {
  schedules: { out: "schedules", in: "scheduled by" },
  runs: { out: "runs", in: "run by" },
  posts_to: { out: "posts to", in: "receives posts from" },
  as: { out: "posts as", in: "voiced in" },
  verifies: { out: "verified against", in: "verifies" },
  uses: { out: "uses", in: "used by" },
  calls: { out: "calls", in: "called by" },
  reads: { out: "reads", in: "read by" },
  writes: { out: "writes", in: "written by" },
  fetches: { out: "fetches", in: "fetched by" },
  triggers: { out: "triggers", in: "triggered by" },
  targets: { out: "targets", in: "targeted by" },
};

export function typeColor(graph: SystemGraph, t: number): string {
  return TYPE_META[graph.types[t]]?.color ?? "#94a3b8";
}

export function buildModel(graph: SystemGraph): BrainModel {
  const n = graph.nodes.length;
  const deg = new Array<number>(n).fill(0);
  const adj: number[][] = Array.from({ length: n }, () => []);
  const nodeLinks: number[][] = Array.from({ length: n }, () => []);
  for (const [s, t] of graph.edges) {
    deg[s]++;
    deg[t]++;
  }
  const order = graph.nodes.map((_, i) => i).sort((a, b) => deg[b] - deg[a]);
  const rank = new Array<number>(n);
  order.forEach((i, r) => (rank[i] = r));

  const nodes: BNode[] = graph.nodes.map((d, i) => ({
    i,
    id: d.id,
    type: d.t,
    label: d.label,
    deg: deg[i],
    rank: rank[i],
    phase: ((i * 2654435761) >>> 0) / 4294967296 * Math.PI * 2,
    data: d,
  }));
  const links: BLink[] = graph.edges.map(([s, t, type, weight], li) => {
    adj[s].push(t);
    adj[t].push(s);
    nodeLinks[s].push(li);
    nodeLinks[t].push(li);
    return { source: nodes[s], target: nodes[t], type, weight };
  });
  const typeCounts = new Array<number>(graph.types.length).fill(0);
  for (const d of graph.nodes) typeCounts[d.t]++;
  return { graph, nodes, links, adj, nodeLinks, typeCounts };
}

/** Node indices within `hops` of `start` (inclusive). */
export function neighborhood(model: BrainModel, start: number, hops: number): Set<number> {
  const seen = new Set<number>([start]);
  let frontier = [start];
  for (let h = 0; h < hops; h++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const j of model.adj[i]) {
        if (!seen.has(j)) {
          seen.add(j);
          next.push(j);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

export function searchNodes(model: BrainModel, q: string, limit = 12): number[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const tokens = s.split(/\s+/).filter(Boolean);
  const hits: { i: number; score: number }[] = [];
  for (const nd of model.nodes) {
    const label = nd.label.toLowerCase();
    const id = nd.id.toLowerCase();
    const desc = nd.data.description?.toLowerCase() ?? "";
    // every token has to land somewhere; the best field decides the score
    let score = 0;
    let ok = true;
    for (const tk of tokens) {
      if (label === tk) score += 0;
      else if (label.startsWith(tk)) score += 1;
      else if (label.includes(tk)) score += 2;
      else if (id.includes(tk)) score += 3;
      else if (desc.includes(tk)) score += 5;
      else {
        ok = false;
        break;
      }
    }
    if (ok) hits.push({ i: nd.i, score: score * 1000 + nd.rank });
  }
  return hits.sort((a, b) => a.score - b.score).slice(0, limit).map((h) => h.i);
}
