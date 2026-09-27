import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import type { RepoGraph } from "@/lib/gitnexus/types";

export type Mode = "clusters" | "files" | "symbols";

export type Selection = { kind: "cluster"; idx: number } | { kind: "node"; idx: number } | null;

export type VNode = SimulationNodeDatum & {
  /** `c<clusterIdx>` or `n<nodeIdx>` — stable across view rebuilds. */
  id: string;
  ref: number;
  isCluster: boolean;
  label: string;
  sub: string;
  cluster: number;
  degree: number;
  r: number;
  /** Outside the current focus (1-hop context) — drawn faded. */
  dim: boolean;
};

export type VLink = SimulationLinkDatum<VNode> & {
  source: VNode;
  target: VNode;
  type: string;
  w: number;
};

export type View = { nodes: VNode[]; links: VLink[]; byId: Map<string, VNode> };

export type ViewOptions = {
  mode: Mode;
  focusCluster: number | null;
  focusFile: number | null;
  showConsts: boolean;
  /** Symbols mode: focus on an execution flow's steps (node indices). */
  focusFlow: number[] | null;
  /** Always keep this node in the view even if isolated / filtered. */
  pinned: number | null;
};

export const SYMBOL_KINDS = new Set(["Function", "Class", "Method", "TypeAlias", "Route"]);
const SEMANTIC = new Set(["CALLS", "USES", "EXTENDS", "IMPLEMENTS", "HAS_METHOD", "HANDLES_ROUTE", "FETCHES"]);

/** Precomputed lookups shared by every view build + the detail panel. */
export type Indexed = {
  g: RepoGraph;
  kindOf: (i: number) => string;
  typeOf: (t: number) => string;
  fileIdx: Map<string, number>;
  out: number[][]; // edge indices leaving node
  inc: number[][]; // edge indices entering node
  clusterMembers: number[]; // symbol count per cluster (recomputed from nodes)
  flowsByNode: Map<number, number[]>;
};

export function indexGraph(g: RepoGraph): Indexed {
  const fileIdx = new Map<string, number>();
  const out: number[][] = g.nodes.map(() => []);
  const inc: number[][] = g.nodes.map(() => []);
  const clusterMembers = g.clusters.map(() => 0);
  const fileKind = g.kinds.indexOf("File");
  g.nodes.forEach((n, i) => {
    if (n[0] === fileKind) fileIdx.set(n[2], i);
    if (n[3] >= 0 && SYMBOL_KINDS.has(g.kinds[n[0]])) clusterMembers[n[3]]++;
  });
  g.edges.forEach((e, ei) => {
    out[e[0]].push(ei);
    inc[e[1]].push(ei);
  });
  const flowsByNode = new Map<number, number[]>();
  g.flows.forEach((f, fi) => {
    for (const s of f.steps) {
      const arr = flowsByNode.get(s) ?? [];
      arr.push(fi);
      flowsByNode.set(s, arr);
    }
  });
  return {
    g,
    kindOf: (i) => g.kinds[g.nodes[i][0]],
    typeOf: (t) => g.edgeTypes[t],
    fileIdx,
    out,
    inc,
    clusterMembers,
    flowsByNode,
  };
}

export function buildView(ix: Indexed, opt: ViewOptions): View {
  const { g } = ix;
  const nodes: VNode[] = [];
  const byId = new Map<string, VNode>();
  const links: VLink[] = [];
  const linkKey = new Map<string, VLink>();

  const addLink = (a: VNode, b: VNode, type: string, w = 1) => {
    if (a === b) return;
    const key = `${a.id}>${b.id}`;
    const ex = linkKey.get(key);
    if (ex) {
      ex.w += w;
      return;
    }
    const l: VLink = { source: a, target: b, type, w };
    linkKey.set(key, l);
    links.push(l);
  };

  if (opt.mode === "clusters") {
    g.clusters.forEach((c, i) => {
      const members = ix.clusterMembers[i];
      if (members === 0) return;
      const n: VNode = {
        id: `c${i}`,
        ref: i,
        isCluster: true,
        label: c.label,
        sub: `${members} symbols · ${c.communities} ${c.communities === 1 ? "community" : "communities"}`,
        cluster: i,
        degree: 0,
        r: 10 + Math.sqrt(members) * 2.4,
        dim: false,
      };
      nodes.push(n);
      byId.set(n.id, n);
    });
    for (const e of g.edges) {
      const t = ix.typeOf(e[2]);
      if (!SEMANTIC.has(t) && t !== "IMPORTS") continue;
      const ca = g.nodes[e[0]][3];
      const cb = g.nodes[e[1]][3];
      if (ca < 0 || cb < 0 || ca === cb) continue;
      const a = byId.get(`c${ca}`);
      const b = byId.get(`c${cb}`);
      if (a && b) addLink(a, b, t);
    }
    for (const l of links) {
      l.source.degree += l.w;
      l.target.degree += l.w;
    }
    return { nodes, links, byId };
  }

  // Files + symbols share the focus machinery: a core set, then 1-hop context.
  const isFile = (i: number) => ix.kindOf(i) === "File";
  const isSymbol = (i: number) => {
    const k = ix.kindOf(i);
    return SYMBOL_KINDS.has(k) || (opt.showConsts && k === "Const");
  };
  const eligible = opt.mode === "files" ? isFile : isSymbol;

  // Edge → (fileA, fileB) or (symA, symB) endpoints for this mode.
  const endpoints = (e: RepoGraph["edges"][number]): [number, number] | null => {
    const t = ix.typeOf(e[2]);
    if (opt.mode === "files") {
      if (t === "IMPORTS") return isFile(e[0]) && isFile(e[1]) ? [e[0], e[1]] : null;
      if (!SEMANTIC.has(t)) return null;
      const fa = ix.fileIdx.get(g.nodes[e[0]][2]);
      const fb = ix.fileIdx.get(g.nodes[e[1]][2]);
      return fa !== undefined && fb !== undefined && fa !== fb ? [fa, fb] : null;
    }
    if (!SEMANTIC.has(t)) return null;
    return isSymbol(e[0]) && isSymbol(e[1]) ? [e[0], e[1]] : null;
  };

  const pairs: [number, number, string][] = [];
  for (const e of g.edges) {
    const p = endpoints(e);
    if (p) pairs.push([p[0], p[1], ix.typeOf(e[2])]);
  }

  let core: Set<number> | null = null;
  if (opt.mode === "symbols" && opt.focusFlow) {
    core = new Set(opt.focusFlow);
  } else if (opt.focusFile !== null) {
    const path = g.nodes[opt.focusFile][2];
    core = new Set<number>();
    if (opt.mode === "files") core.add(opt.focusFile);
    else g.nodes.forEach((n, i) => n[2] === path && eligible(i) && core!.add(i));
  } else if (opt.focusCluster !== null) {
    core = new Set<number>();
    g.nodes.forEach((n, i) => n[3] === opt.focusCluster && eligible(i) && core!.add(i));
  }
  if (core && opt.pinned !== null && eligible(opt.pinned)) core.add(opt.pinned);

  const include = new Set<number>();
  const dimmed = new Set<number>();
  if (core) {
    for (const i of core) include.add(i);
    for (const [a, b] of pairs) {
      if (core.has(a) && !core.has(b)) {
        include.add(b);
        dimmed.add(b);
      } else if (core.has(b) && !core.has(a)) {
        include.add(a);
        dimmed.add(a);
      }
    }
  } else {
    // Unfocused: everything with at least one edge; files always all shown.
    const connected = new Set<number>();
    for (const [a, b] of pairs) {
      connected.add(a);
      connected.add(b);
    }
    g.nodes.forEach((_, i) => {
      if (!eligible(i)) return;
      if (opt.mode === "files" || connected.has(i) || i === opt.pinned) include.add(i);
    });
  }

  for (const i of include) {
    const n = g.nodes[i];
    const kind = ix.kindOf(i);
    const v: VNode = {
      id: `n${i}`,
      ref: i,
      isCluster: false,
      label: kind === "File" ? fileLabel(n[2]) : n[1],
      sub: kind === "File" ? n[2] : `${kind} · ${n[2]}${n[4] ? `:${n[4]}` : ""}`,
      cluster: n[3],
      degree: 0,
      r: 0,
      dim: dimmed.has(i),
    };
    nodes.push(v);
    byId.set(v.id, v);
  }
  for (const [a, b, t] of pairs) {
    const va = byId.get(`n${a}`);
    const vb = byId.get(`n${b}`);
    if (va && vb) addLink(va, vb, t);
  }
  // A traced flow can hop through steps the static edge set doesn't join
  // directly; stitch those so the path reads as one line.
  if (opt.mode === "symbols" && opt.focusFlow) {
    for (let i = 0; i < opt.focusFlow.length - 1; i++) {
      const a = byId.get(`n${opt.focusFlow[i]}`);
      const b = byId.get(`n${opt.focusFlow[i + 1]}`);
      if (a && b && !linkKey.has(`${a.id}>${b.id}`) && !linkKey.has(`${b.id}>${a.id}`)) addLink(a, b, "FLOW");
    }
  }
  for (const l of links) {
    l.source.degree += 1;
    l.target.degree += 1;
  }
  const base = opt.mode === "files" ? 4 : 2.6;
  for (const v of nodes) v.r = base + Math.sqrt(v.degree) * (opt.mode === "files" ? 1.4 : 1.1);
  return { nodes, links, byId };
}

/** Distinct, theme-tuned hue per cluster. Teal (~170°) is reserved for UI accents. */
export function clusterColor(i: number, dark: boolean): string {
  if (i < 0) return dark ? "hsl(220 8% 62%)" : "hsl(220 8% 55%)";
  let h = (28 + i * 137.508) % 360;
  if (h > 150 && h < 195) h = (h + 50) % 360;
  return dark ? `hsl(${h.toFixed(0)} 66% 64%)` : `hsl(${h.toFixed(0)} 62% 46%)`;
}

const GENERIC_FILES = /^(route|page|layout|index|types|store|client|utils|actions|loading|error)\.[cm]?[jt]sx?$/;

/** `route.ts` alone says nothing; show `agent-posts/route.ts` for generic names. */
export function fileLabel(filePath: string): string {
  const parts = filePath.split("/");
  const name = parts[parts.length - 1];
  if (parts.length > 1 && GENERIC_FILES.test(name)) return `${parts[parts.length - 2]}/${name}`;
  return name;
}

export function shortPath(p: string, max = 42): string {
  if (p.length <= max) return p;
  const parts = p.split("/");
  let out = parts[parts.length - 1];
  for (let i = parts.length - 2; i >= 0; i--) {
    const next = `${parts[i]}/${out}`;
    if (next.length + 2 > max) return `…/${out}`;
    out = next;
  }
  return out;
}
