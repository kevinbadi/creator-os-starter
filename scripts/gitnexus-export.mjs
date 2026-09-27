#!/usr/bin/env node
/**
 * Export the GitNexus knowledge graph of this repo into a compact JSON the
 * dashboard renders at /dashboard/gitnexus.
 *
 *   npm run repo-graph            # re-index (gitnexus analyze) + export
 *   npm run repo-graph -- --no-analyze   # export from the existing index
 *
 * Reads through `gitnexus serve` (HTTP API) because that is the only stable,
 * JSON-shaped surface the CLI exposes (the `cypher` subcommand prints
 * markdown tables). If a server is already running (GITNEXUS_SERVE_URL or
 * :4747) we use it; otherwise one is spawned on a spare port and torn down.
 *
 * Output: src/data/gitnexus-graph.json (committed — Railway has no gitnexus).
 * The 91MB `.gitnexus/` index itself stays local (gitignored + railwayignored).
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "data", "gitnexus-graph.json");
const ARGS = new Set(process.argv.slice(2));
const ANALYZE = !ARGS.has("--no-analyze");

// Node kinds that become graph vertices. Property/Section/Community/Process
// are folded away: communities become `clusters`, processes become `flows`.
const NODE_KINDS = ["File", "Folder", "Function", "Class", "Method", "TypeAlias", "Const", "Route"];
// Structural + semantic edges the UI draws. MEMBER_OF / STEP_IN_PROCESS /
// ENTRY_POINT_OF are consumed here and re-emitted as cluster ids + flows.
const EDGE_TYPES = [
  "CONTAINS",
  "DEFINES",
  "IMPORTS",
  "CALLS",
  "USES",
  "EXTENDS",
  "IMPLEMENTS",
  "HAS_METHOD",
  "HANDLES_ROUTE",
  "FETCHES",
];

function log(msg) {
  process.stdout.write(`[repo-graph] ${msg}\n`);
}

function which(bin) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim().split("\n")[0] : null;
}

async function reachable(base) {
  try {
    const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function waitFor(base, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await reachable(base)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function getJson(base, p) {
  const r = await fetch(`${base}${p}`, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`${p} → HTTP ${r.status}`);
  return r.json();
}

function runAnalyze(bin) {
  log("indexing repo (gitnexus analyze)…");
  const r = spawnSync(bin, ["analyze", "--skip-agents-md", "--skip-skills", "--no-stats"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (r.status !== 0) throw new Error(`gitnexus analyze exited ${r.status}`);
}

async function main() {
  const bin = which("gitnexus");
  if (!bin) {
    throw new Error("gitnexus CLI not found. Install: npm i -g gitnexus@latest");
  }
  if (ANALYZE) runAnalyze(bin);

  let base = process.env.GITNEXUS_SERVE_URL || "http://localhost:4747";
  let child = null;
  if (!(await reachable(base))) {
    const port = 4790 + Math.floor(Math.random() * 100);
    base = `http://localhost:${port}`;
    log(`starting gitnexus serve on :${port}`);
    let serveLog = "";
    child = spawn(bin, ["serve", "-p", String(port)], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => (serveLog += d));
    child.stderr.on("data", (d) => (serveLog += d));
    if (!(await waitFor(base, 45_000))) {
      child.kill();
      throw new Error(`gitnexus serve did not come up in 45s\n${serveLog.trim()}`);
    }
  } else {
    log(`using running server at ${base}`);
  }

  try {
    const repos = await getJson(base, "/api/repos");
    const repo =
      repos.find((r) => path.resolve(r.repoPath || r.path) === ROOT) ??
      repos.find((r) => r.name === "kevbuildsapps-Marketing-OS") ??
      repos[0];
    if (!repo) throw new Error("no indexed repo — run `gitnexus analyze` first");
    const q = `?repo=${encodeURIComponent(repo.name)}`;

    log(`fetching graph for ${repo.name}…`);
    const [graph, clustersRes, processesRes] = await Promise.all([
      getJson(base, `/api/graph${q}`),
      getJson(base, `/api/clusters${q}`),
      getJson(base, `/api/processes${q}`),
    ]);
    const out = compact({ repo, graph, clusters: clustersRes.clusters ?? [], processes: processesRes.processes ?? [] });
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(out));
    const kb = Math.round(Buffer.byteLength(JSON.stringify(out)) / 1024);
    log(`wrote ${path.relative(ROOT, OUT)} (${kb} KB): ${out.nodes.length} nodes, ${out.edges.length} edges, ${out.clusters.length} clusters, ${out.flows.length} flows`);
  } finally {
    if (child) child.kill();
  }
}

/**
 * Compact wire format (indices everywhere; ids are not shipped):
 *   kinds[k]        node kind name
 *   edgeTypes[t]    edge type name
 *   clusters[c]     { label, symbols, cohesion, communities }
 *   nodes[i]        [kind, name, filePath, cluster(-1 none), startLine, endLine]
 *   edges           [src, dst, type, confidence]
 *   flows           { label, type, entry(node idx|-1), steps[node idx] }
 */
function compact({ repo, graph, clusters, processes }) {
  const kindIdx = new Map(NODE_KINDS.map((k, i) => [k, i]));
  const typeIdx = new Map(EDGE_TYPES.map((t, i) => [t, i]));

  // Communities → clusters, grouped by label exactly like gitnexus' own
  // aggregateClusters (same-labelled communities are one functional area).
  const communityLabel = new Map();
  for (const n of graph.nodes) {
    if (n.label !== "Community") continue;
    const p = n.properties ?? {};
    communityLabel.set(n.id, p.heuristicLabel || p.name || n.id);
  }
  const clusterByLabel = new Map();
  const outClusters = [];
  for (const c of clusters) {
    const label = c.heuristicLabel || c.label;
    if (clusterByLabel.has(label)) continue;
    clusterByLabel.set(label, outClusters.length);
    outClusters.push({
      label,
      symbols: c.symbolCount ?? 0,
      cohesion: Math.round((c.cohesion ?? 0) * 1000) / 1000,
      communities: c.subCommunities ?? 1,
    });
  }
  // Communities under the 5-symbol floor are not in /api/clusters; still map
  // them so every symbol gets a colour.
  for (const [, label] of communityLabel) {
    if (!clusterByLabel.has(label)) {
      clusterByLabel.set(label, outClusters.length);
      outClusters.push({ label, symbols: 0, cohesion: 0, communities: 1 });
    }
  }

  const index = new Map();
  const nodes = [];
  for (const n of graph.nodes) {
    const k = kindIdx.get(n.label);
    if (k === undefined) continue;
    const p = n.properties ?? {};
    index.set(n.id, nodes.length);
    nodes.push([k, p.name ?? n.id, p.filePath ?? "", -1, p.startLine ?? 0, p.endLine ?? 0]);
  }

  // Cluster assignment: symbols via MEMBER_OF, then files inherit the
  // majority of what they define, then remaining symbols inherit their file.
  const fileVotes = new Map();
  for (const r of graph.relationships) {
    if (r.type !== "MEMBER_OF") continue;
    const i = index.get(r.sourceId);
    const label = communityLabel.get(r.targetId);
    if (i === undefined || !label) continue;
    const c = clusterByLabel.get(label);
    nodes[i][3] = c;
    const f = index.get(`File:${nodes[i][2]}`);
    if (f !== undefined) {
      const votes = fileVotes.get(f) ?? new Map();
      votes.set(c, (votes.get(c) ?? 0) + 1);
      fileVotes.set(f, votes);
    }
  }
  const majority = (votes) => {
    let best = -1;
    let bestN = 0;
    for (const [c, n] of votes) {
      if (n > bestN) {
        best = c;
        bestN = n;
      }
    }
    return best;
  };
  for (const [f, votes] of fileVotes) nodes[f][3] = majority(votes);
  for (const n of nodes) {
    if (n[3] !== -1 || n[0] === kindIdx.get("Folder")) continue;
    const f = index.get(`File:${n[2]}`);
    if (f !== undefined) n[3] = nodes[f][3];
  }
  // Folders: majority of direct children.
  const folderVotes = new Map();
  for (const r of graph.relationships) {
    if (r.type !== "CONTAINS") continue;
    const a = index.get(r.sourceId);
    const b = index.get(r.targetId);
    if (a === undefined || b === undefined || nodes[b][3] === -1) continue;
    const votes = folderVotes.get(a) ?? new Map();
    votes.set(nodes[b][3], (votes.get(nodes[b][3]) ?? 0) + 1);
    folderVotes.set(a, votes);
  }
  for (const [a, votes] of folderVotes) nodes[a][3] = majority(votes);

  const edges = [];
  const seen = new Set();
  for (const r of graph.relationships) {
    const t = typeIdx.get(r.type);
    if (t === undefined) continue;
    const a = index.get(r.sourceId);
    const b = index.get(r.targetId);
    if (a === undefined || b === undefined || a === b) continue;
    const key = `${a}>${b}>${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([a, b, t, Math.round((r.confidence ?? 1) * 100) / 100]);
  }

  // Flows: STEP_IN_PROCESS (symbol → process, ordered by `step`) + entry point.
  const flowSteps = new Map();
  const flowEntry = new Map();
  for (const r of graph.relationships) {
    if (r.type === "STEP_IN_PROCESS") {
      const i = index.get(r.sourceId);
      if (i === undefined) continue;
      const arr = flowSteps.get(r.targetId) ?? [];
      arr.push([r.step ?? 0, i]);
      flowSteps.set(r.targetId, arr);
    } else if (r.type === "ENTRY_POINT_OF") {
      const i = index.get(r.sourceId);
      if (i !== undefined && !flowEntry.has(r.targetId)) flowEntry.set(r.targetId, i);
    }
  }
  const procMeta = new Map(processes.map((p) => [p.id, p]));
  const flows = [];
  for (const n of graph.nodes) {
    if (n.label !== "Process") continue;
    const steps = (flowSteps.get(n.id) ?? []).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    if (steps.length < 2) continue;
    const p = n.properties ?? {};
    const meta = procMeta.get(n.id);
    flows.push({
      label: meta?.label ?? p.heuristicLabel ?? p.name ?? n.id,
      type: p.processType ?? meta?.processType ?? "",
      entry: flowEntry.get(n.id) ?? index.get(p.entryPointId) ?? steps[0],
      steps,
    });
  }
  flows.sort((a, b) => b.steps.length - a.steps.length || a.label.localeCompare(b.label));

  return {
    version: 1,
    repo: {
      name: repo.name,
      path: repo.repoPath || repo.path,
      branch: repo.branch,
      commit: repo.lastCommit,
      indexedAt: repo.indexedAt,
      stats: repo.stats,
    },
    kinds: NODE_KINDS,
    edgeTypes: EDGE_TYPES,
    clusters: outClusters,
    nodes,
    edges,
    flows,
  };
}

main().catch((err) => {
  console.error(`[repo-graph] ${err.message}`);
  process.exit(1);
});
