"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RepoGraph } from "@/lib/gitnexus/types";
import { GraphCanvas } from "./GraphCanvas";
import {
  buildView,
  clusterColor,
  indexGraph,
  shortPath,
  SYMBOL_KINDS,
  type Indexed,
  type Mode,
  type Selection,
} from "./graph-view";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "clusters", label: "Clusters", hint: "Functional areas and how much they talk to each other" },
  { id: "files", label: "Files", hint: "Every source file, wired by imports and cross-file calls" },
  { id: "symbols", label: "Symbols", hint: "Functions, types and routes, wired by calls" },
];

function useIsDark(): boolean {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.classList.contains("dark"));
    read();
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

export function RepoGraphExplorer() {
  const [graph, setGraph] = useState<RepoGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/gitnexus/graph")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as RepoGraph;
      })
      .then((g) => alive && setGraph(g))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="card flex h-[420px] items-center justify-center text-sm text-neutral-600 dark:text-[#b6bac2]">
        Could not load the repo graph ({error}). Run <code className="mx-1 font-mono">npm run repo-graph</code> and redeploy.
      </div>
    );
  }
  if (!graph) {
    return (
      <div className="card flex h-[calc(100vh-270px)] min-h-[560px] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="agent-loader">
            <div className="agent-loader-core" />
          </div>
          <p className="eyebrow">Loading knowledge graph</p>
        </div>
      </div>
    );
  }
  return <Explorer graph={graph} />;
}

function Explorer({ graph }: { graph: RepoGraph }) {
  const dark = useIsDark();
  const ix = useMemo(() => indexGraph(graph), [graph]);

  const [mode, setMode] = useState<Mode>("clusters");
  const [focusCluster, setFocusCluster] = useState<number | null>(null);
  const [focusFile, setFocusFile] = useState<number | null>(null);
  const [flowIdx, setFlowIdx] = useState<number | null>(null);
  const [showConsts, setShowConsts] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [followId, setFollowId] = useState<string | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [relayoutSignal, setRelayoutSignal] = useState(0);
  const [query, setQuery] = useState("");

  const focusFlow = flowIdx !== null ? graph.flows[flowIdx].steps : null;

  const view = useMemo(
    () => buildView(ix, { mode, focusCluster, focusFile, showConsts, focusFlow, pinned: null }),
    [ix, mode, focusCluster, focusFile, showConsts, focusFlow],
  );
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);

  const selectedId = selection ? (selection.kind === "cluster" ? `c${selection.idx}` : `n${selection.idx}`) : null;
  const flowPath = focusFlow ? focusFlow.map((i) => `n${i}`) : null;

  const clearFocus = () => {
    setFocusCluster(null);
    setFocusFile(null);
    setFlowIdx(null);
  };

  const go = (next: Partial<{ mode: Mode; cluster: number | null; file: number | null; flow: number | null }>) => {
    if (next.mode) setMode(next.mode);
    if ("cluster" in next) setFocusCluster(next.cluster ?? null);
    if ("file" in next) setFocusFile(next.file ?? null);
    if ("flow" in next) setFlowIdx(next.flow ?? null);
  };

  const followSeq = useRef(0);
  const selectNode = (idx: number, follow = true) => {
    setSelection({ kind: "node", idx });
    // Sequence suffix so re-picking the same node re-centers the camera.
    if (follow) setFollowId(`n${idx}#${++followSeq.current}`);
  };

  const onSelect = (id: string | null) => {
    if (!id) return setSelection(null);
    if (id[0] === "c") setSelection({ kind: "cluster", idx: Number(id.slice(1)) });
    else setSelection({ kind: "node", idx: Number(id.slice(1)) });
  };

  const onDrill = (id: string) => {
    if (id[0] === "c") {
      go({ mode: "files", cluster: Number(id.slice(1)), file: null, flow: null });
      setSelection(null);
      return;
    }
    const idx = Number(id.slice(1));
    const kind = ix.kindOf(idx);
    if (kind === "File") {
      go({ mode: "symbols", file: idx, cluster: null, flow: null });
      setSelection({ kind: "node", idx });
    } else {
      const f = ix.fileIdx.get(graph.nodes[idx][2]);
      if (f !== undefined) go({ mode: "symbols", file: f, cluster: null, flow: null });
      selectNode(idx);
    }
  };

  const openSymbol = (idx: number) => {
    const kind = ix.kindOf(idx);
    if (kind === "File") {
      if (mode === "clusters") go({ mode: "files", cluster: null, file: null, flow: null });
      selectNode(idx);
      return;
    }
    const f = ix.fileIdx.get(graph.nodes[idx][2]);
    if (kind === "Const") setShowConsts(true);
    if (mode !== "symbols" || !viewRef.current.byId.has(`n${idx}`)) {
      go({ mode: "symbols", file: f ?? null, cluster: null, flow: null });
    }
    selectNode(idx);
  };

  const openFlow = (fi: number) => {
    go({ mode: "symbols", flow: fi, cluster: null, file: null });
    setSelection({ kind: "node", idx: graph.flows[fi].entry });
    setFitSignal((s) => s + 1);
  };

  const results = useMemo(() => searchNodes(ix, query), [ix, query]);

  const focusLabel =
    flowIdx !== null
      ? { kind: "Flow", text: graph.flows[flowIdx].label }
      : focusFile !== null
        ? { kind: "File", text: shortPath(graph.nodes[focusFile][2], 40) }
        : focusCluster !== null
          ? { kind: "Cluster", text: graph.clusters[focusCluster].label }
          : null;

  return (
    <div className="card flex h-[calc(100vh-270px)] min-h-[600px] flex-col overflow-hidden p-0">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-black/[.08] px-3 py-2 dark:border-white/[.12]">
        <div className="flex rounded-md border border-black/[.12] p-0.5 dark:border-white/[.16]">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              title={m.hint}
              onClick={() => {
                setMode(m.id);
                if (m.id === "clusters") clearFocus();
                if (m.id !== "symbols") setFlowIdx(null);
                setSelection(null);
              }}
              className={`rounded-[5px] px-2.5 py-1 text-[12px] font-medium transition ${
                mode === m.id
                  ? "bg-neutral-900 text-white dark:bg-[#2dd4bf] dark:text-[#0b1f1c]"
                  : "text-neutral-600 hover:bg-black/[.05] dark:text-[#b6bac2] dark:hover:bg-white/[.08]"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {focusLabel ? (
          <button
            type="button"
            onClick={() => {
              clearFocus();
              setFitSignal((s) => s + 1);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#2dd4bf]/50 bg-[#2dd4bf]/[.10] px-2 py-1 text-[12px] text-teal-900 hover:bg-[#2dd4bf]/[.18] dark:text-[#8ff2e2]"
            title="Clear focus"
          >
            <span className="eyebrow text-[9px] text-teal-800/80 dark:text-[#8ff2e2]/70">{focusLabel.kind}</span>
            <span className="max-w-[260px] truncate font-medium">{focusLabel.text}</span>
            <span aria-hidden className="ml-0.5 text-[13px] leading-none opacity-70">
              ×
            </span>
          </button>
        ) : null}

        <div className="relative ml-auto">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) {
                openSymbol(results[0]);
                setQuery("");
              }
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search files, functions, routes…"
            className="h-8 w-[260px] rounded-md border border-black/[.12] bg-transparent px-2.5 text-[12.5px] text-neutral-800 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none dark:border-white/[.16] dark:text-neutral-100 dark:placeholder:text-[#8e939d]"
          />
          {query && results.length ? (
            <ul className="absolute right-0 top-9 z-20 w-[360px] overflow-hidden rounded-md border border-black/[.1] bg-white shadow-xl dark:border-white/[.16] dark:bg-[#333740]">
              {results.map((idx) => {
                const n = graph.nodes[idx];
                const kind = ix.kindOf(idx);
                return (
                  <li key={idx}>
                    <button
                      type="button"
                      onClick={() => {
                        openSymbol(idx);
                        setQuery("");
                      }}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.07]"
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: clusterColor(n[3], dark) }}
                      />
                      <span className="truncate text-[12.5px] font-medium">{n[1]}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-neutral-500 dark:text-[#8e939d]">
                        {kind === "File" ? shortPath(n[2], 30) : kind}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <FlowPicker graph={graph} value={flowIdx} onChange={(fi) => (fi === null ? go({ flow: null }) : openFlow(fi))} />

        {mode === "symbols" ? (
          <label className="flex items-center gap-1.5 text-[12px] text-neutral-600 dark:text-[#b6bac2]">
            <input
              type="checkbox"
              checked={showConsts}
              onChange={(e) => setShowConsts(e.target.checked)}
              className="accent-[#2dd4bf]"
            />
            consts
          </label>
        ) : null}

        <div className="flex gap-1">
          <ToolButton onClick={() => setFitSignal((s) => s + 1)} title="Fit to view">
            Fit
          </ToolButton>
          <ToolButton onClick={() => setRelayoutSignal((s) => s + 1)} title="Shuffle and re-run the layout">
            Re-layout
          </ToolButton>
        </div>
      </div>

      {/* body */}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 bg-[radial-gradient(rgba(0,0,0,0.05)_1px,transparent_1px)] [background-size:22px_22px] dark:bg-[radial-gradient(rgba(255,255,255,0.045)_1px,transparent_1px)]">
          <GraphCanvas
            view={view}
            mode={mode}
            dark={dark}
            selectedId={selectedId}
            flowPath={flowPath}
            fitSignal={fitSignal}
            relayoutSignal={relayoutSignal}
            followId={followId}
            onSelect={onSelect}
            onDrill={onDrill}
          />
          <div className="pointer-events-none absolute bottom-2 left-3 flex items-center gap-3 font-mono text-[10px] text-neutral-500 dark:text-[#8e939d]">
            <span className="num">
              {view.nodes.length} nodes · {view.links.length} edges
            </span>
            <span className="hidden sm:inline">drag to pan · scroll to zoom · double-click to drill in</span>
          </div>
        </div>

        <aside className="w-[312px] shrink-0 overflow-y-auto border-l border-black/[.08] dark:border-white/[.12]">
          {selection ? (
            <DetailPanel
              ix={ix}
              dark={dark}
              selection={selection}
              onOpenNode={openSymbol}
              onOpenFlow={openFlow}
              onFocusCluster={(c, m) => {
                go({ mode: m, cluster: c, file: null, flow: null });
                setSelection(null);
              }}
              onFocusFile={(f) => {
                go({ mode: "symbols", file: f, cluster: null, flow: null });
                setSelection({ kind: "node", idx: f });
              }}
            />
          ) : (
            <Legend
              ix={ix}
              dark={dark}
              mode={mode}
              focusCluster={focusCluster}
              onPick={(c) => {
                if (mode === "clusters") setSelection({ kind: "cluster", idx: c });
                else go({ cluster: focusCluster === c ? null : c, file: null, flow: null });
              }}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

/* ───────────────────────── toolbar bits ───────────────────────── */

function ToolButton({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="h-8 rounded-md border border-black/[.12] px-2.5 text-[12px] text-neutral-700 transition hover:bg-black/[.04] dark:border-white/[.16] dark:text-[#d5d8de] dark:hover:bg-white/[.08]"
    >
      {children}
    </button>
  );
}

function FlowPicker({
  graph,
  value,
  onChange,
}: {
  graph: RepoGraph;
  value: number | null;
  onChange: (fi: number | null) => void;
}) {
  // Longest 150 flows; the tail is mostly 2-step stubs. A flow opened from the
  // detail panel may sit outside that cut, so it is appended to stay selectable.
  const options = useMemo(() => {
    const top = graph.flows.map((f, i) => ({ i, f })).slice(0, 150);
    if (value !== null && value >= 150) top.push({ i: value, f: graph.flows[value] });
    return top;
  }, [graph, value]);
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="h-8 max-w-[240px] rounded-md border border-black/[.12] bg-transparent px-2 text-[12px] text-neutral-700 focus:outline-none dark:border-white/[.16] dark:bg-[#2c2f35] dark:text-[#d5d8de]"
      title="Highlight a traced execution flow"
    >
      <option value="">Execution flows…</option>
      {options.map(({ i, f }) => (
        <option key={i} value={i}>
          {f.label} ({f.steps.length})
        </option>
      ))}
    </select>
  );
}

/* ───────────────────────── side panel ───────────────────────── */

function Legend({
  ix,
  dark,
  mode,
  focusCluster,
  onPick,
}: {
  ix: Indexed;
  dark: boolean;
  mode: Mode;
  focusCluster: number | null;
  onPick: (c: number) => void;
}) {
  const rows = ix.g.clusters
    .map((c, i) => ({ i, c, members: ix.clusterMembers[i] }))
    .filter((r) => r.members > 0)
    .sort((a, b) => b.members - a.members);
  const max = rows[0]?.members ?? 1;
  return (
    <div className="p-3">
      <p className="eyebrow mb-1">Clusters</p>
      <p className="mb-3 text-[12px] leading-snug text-neutral-600 dark:text-[#b6bac2]">
        Functional areas GitNexus detected (Leiden communities, merged by label).{" "}
        {mode === "clusters" ? "Click one to inspect it." : "Click one to focus the graph on it."}
      </p>
      <ul className="flex flex-col gap-px">
        {rows.map(({ i, c, members }) => {
          const active = focusCluster === i;
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onPick(i)}
                className={`group relative flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-left transition ${
                  active ? "bg-[#2dd4bf]/[.12]" : "hover:bg-black/[.04] dark:hover:bg-white/[.06]"
                }`}
              >
                <span
                  className="absolute inset-y-1 left-0 rounded-r-sm opacity-[.13]"
                  style={{ width: `${(members / max) * 100}%`, background: clusterColor(i, dark) }}
                />
                <span className="relative size-2.5 shrink-0 rounded-full" style={{ background: clusterColor(i, dark) }} />
                <span className="relative truncate text-[12.5px]">{c.label}</span>
                <span className="relative ml-auto shrink-0 font-mono text-[10.5px] text-neutral-500 dark:text-[#8e939d]">
                  {members}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DetailPanel({
  ix,
  dark,
  selection,
  onOpenNode,
  onOpenFlow,
  onFocusCluster,
  onFocusFile,
}: {
  ix: Indexed;
  dark: boolean;
  selection: NonNullable<Selection>;
  onOpenNode: (idx: number) => void;
  onOpenFlow: (fi: number) => void;
  onFocusCluster: (c: number, mode: Mode) => void;
  onFocusFile: (f: number) => void;
}) {
  const { g } = ix;
  if (selection.kind === "cluster") {
    const c = g.clusters[selection.idx];
    const members: number[] = [];
    g.nodes.forEach((n, i) => n[3] === selection.idx && SYMBOL_KINDS.has(ix.kindOf(i)) && members.push(i));
    const byFile = new Map<string, number>();
    for (const m of members) byFile.set(g.nodes[m][2], (byFile.get(g.nodes[m][2]) ?? 0) + 1);
    const files = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const hubs = members
      .map((i) => ({ i, d: ix.inc[i].length + ix.out[i].length }))
      .sort((a, b) => b.d - a.d)
      .slice(0, 8);
    return (
      <div className="p-3">
        <Eyebrow color={clusterColor(selection.idx, dark)}>Cluster</Eyebrow>
        <h3 className="card-title mt-1 text-[22px]">{c.label}</h3>
        <dl className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="symbols" value={members.length} />
          <Stat label="files" value={byFile.size} />
          <Stat label="cohesion" value={`${Math.round(c.cohesion * 100)}%`} />
        </dl>
        <div className="mt-3 flex gap-1.5">
          <ToolButton onClick={() => onFocusCluster(selection.idx, "files")}>Explore files</ToolButton>
          <ToolButton onClick={() => onFocusCluster(selection.idx, "symbols")}>Explore symbols</ToolButton>
        </div>
        <Section title={`Files (${byFile.size})`}>
          {files.map(([p, n]) => {
            const f = ix.fileIdx.get(p);
            return (
              <Row key={p} onClick={f !== undefined ? () => onOpenNode(f) : undefined} meta={String(n)}>
                {shortPath(p, 38)}
              </Row>
            );
          })}
        </Section>
        <Section title="Most connected">
          {hubs.map(({ i, d }) => (
            <Row key={i} onClick={() => onOpenNode(i)} meta={String(d)}>
              {g.nodes[i][1]}
            </Row>
          ))}
        </Section>
      </div>
    );
  }

  const idx = selection.idx;
  const n = g.nodes[idx];
  const kind = ix.kindOf(idx);
  const cluster = n[3];
  const abs = `${g.repo.path.replace(/\/$/, "")}/${n[2]}`;
  const cursorHref = `cursor://file/${encodeURI(abs)}${n[4] ? `:${n[4]}` : ""}`;

  if (kind === "File" || kind === "Folder") {
    const defines = ix.out[idx].filter((e) => ix.typeOf(g.edges[e][2]) === "DEFINES").map((e) => g.edges[e][1]);
    const imports = ix.out[idx].filter((e) => ix.typeOf(g.edges[e][2]) === "IMPORTS").map((e) => g.edges[e][1]);
    const importedBy = ix.inc[idx].filter((e) => ix.typeOf(g.edges[e][2]) === "IMPORTS").map((e) => g.edges[e][0]);
    const routes = ix.out[idx].filter((e) => ix.typeOf(g.edges[e][2]) === "HANDLES_ROUTE").map((e) => g.edges[e][1]);
    const grouped = new Map<string, number[]>();
    for (const d of defines) {
      const k = ix.kindOf(d);
      grouped.set(k, [...(grouped.get(k) ?? []), d]);
    }
    return (
      <div className="p-3">
        <Eyebrow color={clusterColor(cluster, dark)}>
          {kind}
          {cluster >= 0 ? ` · ${g.clusters[cluster].label}` : ""}
        </Eyebrow>
        <h3 className="card-title mt-1 break-all text-[20px]">{n[1]}</h3>
        <p className="mt-1 break-all font-mono text-[11px] text-neutral-500 dark:text-[#8e939d]">{n[2]}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {kind === "File" ? <ToolButton onClick={() => onFocusFile(idx)}>Symbols in file</ToolButton> : null}
          <a
            href={cursorHref}
            className="inline-flex h-8 items-center rounded-md border border-black/[.12] px-2.5 text-[12px] text-neutral-700 transition hover:bg-black/[.04] dark:border-white/[.16] dark:text-[#d5d8de] dark:hover:bg-white/[.08]"
          >
            Open in Cursor
          </a>
        </div>
        {routes.length ? (
          <Section title="Handles route">
            {routes.map((r) => (
              <Row key={r} onClick={() => onOpenNode(r)}>
                {g.nodes[r][1]}
              </Row>
            ))}
          </Section>
        ) : null}
        {[...grouped.entries()]
          .sort((a, b) => b[1].length - a[1].length)
          .map(([k, ids]) => (
            <Section key={k} title={`${k === "TypeAlias" ? "Types" : k + "s"} (${ids.length})`}>
              {ids.slice(0, 40).map((d) => (
                <Row key={d} onClick={() => onOpenNode(d)} meta={g.nodes[d][4] ? `L${g.nodes[d][4]}` : undefined}>
                  {g.nodes[d][1]}
                </Row>
              ))}
            </Section>
          ))}
        <Section title={`Imports (${imports.length})`}>
          {imports.map((i) => (
            <Row key={i} onClick={() => onOpenNode(i)}>
              {shortPath(g.nodes[i][2], 40)}
            </Row>
          ))}
        </Section>
        <Section title={`Imported by (${importedBy.length})`}>
          {importedBy.map((i) => (
            <Row key={i} onClick={() => onOpenNode(i)}>
              {shortPath(g.nodes[i][2], 40)}
            </Row>
          ))}
        </Section>
      </div>
    );
  }

  const semantic = (t: string) => ["CALLS", "USES", "EXTENDS", "IMPLEMENTS", "HAS_METHOD", "FETCHES"].includes(t);
  const callees = ix.out[idx].filter((e) => semantic(ix.typeOf(g.edges[e][2]))).map((e) => g.edges[e]);
  const callers = ix.inc[idx].filter((e) => semantic(ix.typeOf(g.edges[e][2]))).map((e) => g.edges[e]);
  const handlers = ix.inc[idx].filter((e) => ix.typeOf(g.edges[e][2]) === "HANDLES_ROUTE").map((e) => g.edges[e][0]);
  const flows = ix.flowsByNode.get(idx) ?? [];
  const file = ix.fileIdx.get(n[2]);
  return (
    <div className="p-3">
      <Eyebrow color={clusterColor(cluster, dark)}>
        {kind}
        {cluster >= 0 ? ` · ${g.clusters[cluster].label}` : ""}
      </Eyebrow>
      <h3 className="card-title mt-1 break-all text-[20px]">{n[1]}</h3>
      <button
        type="button"
        onClick={file !== undefined ? () => onOpenNode(file) : undefined}
        className="mt-1 break-all text-left font-mono text-[11px] text-neutral-500 hover:text-neutral-800 dark:text-[#8e939d] dark:hover:text-neutral-200"
      >
        {n[2]}
        {n[4] ? `:${n[4]}${n[5] && n[5] !== n[4] ? `-${n[5]}` : ""}` : ""}
      </button>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {file !== undefined ? <ToolButton onClick={() => onFocusFile(file)}>Focus file</ToolButton> : null}
        {kind !== "Route" ? (
          <a
            href={cursorHref}
            className="inline-flex h-8 items-center rounded-md border border-black/[.12] px-2.5 text-[12px] text-neutral-700 transition hover:bg-black/[.04] dark:border-white/[.16] dark:text-[#d5d8de] dark:hover:bg-white/[.08]"
          >
            Open in Cursor
          </a>
        ) : null}
      </div>
      {handlers.length ? (
        <Section title="Handled by">
          {handlers.map((h) => (
            <Row key={h} onClick={() => onOpenNode(h)}>
              {ix.kindOf(h) === "File" ? shortPath(g.nodes[h][2], 40) : g.nodes[h][1]}
            </Row>
          ))}
        </Section>
      ) : null}
      <Section title={`Called by (${callers.length})`}>
        {callers.slice(0, 40).map((e, i) => (
          <Row key={i} onClick={() => onOpenNode(e[0])} meta={edgeMeta(ix, e)}>
            {g.nodes[e[0]][1]}
          </Row>
        ))}
      </Section>
      <Section title={`Calls (${callees.length})`}>
        {callees.slice(0, 40).map((e, i) => (
          <Row key={i} onClick={() => onOpenNode(e[1])} meta={edgeMeta(ix, e)}>
            {g.nodes[e[1]][1]}
          </Row>
        ))}
      </Section>
      {flows.length ? (
        <Section title={`In flows (${flows.length})`}>
          {flows.slice(0, 20).map((fi) => (
            <Row key={fi} onClick={() => onOpenFlow(fi)} meta={`${g.flows[fi].steps.length} steps`}>
              {g.flows[fi].label}
            </Row>
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function edgeMeta(ix: Indexed, e: RepoGraph["edges"][number]): string {
  const t = ix.typeOf(e[2]);
  const conf = e[3] < 1 ? ` ${Math.round(e[3] * 100)}%` : "";
  return `${t.toLowerCase()}${conf}`;
}

function Eyebrow({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <p className="eyebrow flex items-center gap-1.5">
      <span className="size-2 rounded-full" style={{ background: color }} />
      {children}
    </p>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-black/[.08] px-2 py-1.5 dark:border-white/[.12]">
      <dt className="eyebrow text-[8.5px]">{label}</dt>
      <dd className="num mt-0.5 text-[15px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const empty = !children || (Array.isArray(children) && children.length === 0);
  return (
    <div className="mt-4">
      <p className="eyebrow mb-1">{title}</p>
      {empty ? (
        <p className="px-2 text-[12px] text-neutral-400 dark:text-[#8e939d]">none</p>
      ) : (
        <ul className="flex flex-col gap-px">{children}</ul>
      )}
    </div>
  );
}

function Row({ children, onClick, meta }: { children: React.ReactNode; onClick?: () => void; meta?: string }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] transition enabled:hover:bg-black/[.04] disabled:cursor-default dark:enabled:hover:bg-white/[.06]"
      >
        <span className="truncate">{children}</span>
        {meta ? (
          <span className="ml-auto shrink-0 font-mono text-[10px] text-neutral-500 dark:text-[#8e939d]">{meta}</span>
        ) : null}
      </button>
    </li>
  );
}

/* ───────────────────────── search ───────────────────────── */

const SEARCH_KINDS = new Set(["File", "Function", "Class", "Method", "TypeAlias", "Route", "Const"]);

function searchNodes(ix: Indexed, q: string): number[] {
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const scored: [number, number][] = [];
  ix.g.nodes.forEach((n, i) => {
    const kind = ix.kindOf(i);
    if (!SEARCH_KINDS.has(kind)) return;
    const name = n[1].toLowerCase();
    const path = n[2].toLowerCase();
    let score = 0;
    if (name === s) score = 100;
    else if (name.startsWith(s)) score = 80;
    else if (name.includes(s)) score = 60;
    else if (kind === "File" && path.includes(s)) score = 40;
    else if (path.includes(s)) score = 20;
    if (!score) return;
    if (kind === "Const") score -= 15;
    if (kind === "File") score += 5;
    score += Math.min(10, ix.inc[i].length + ix.out[i].length) * 0.3;
    scored.push([score, i]);
  });
  return scored
    .sort((a, b) => b[0] - a[0])
    .slice(0, 10)
    .map((x) => x[1]);
}
