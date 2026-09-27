"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SystemGraph } from "@/lib/gitnexus/system-types";
import { BrainCanvas } from "./BrainCanvas";
import { buildModel, EDGE_LABEL, neighborhood, searchNodes, TYPE_META, type BrainModel } from "./brain-model";

export function SystemBrain() {
  const [graph, setGraph] = useState<SystemGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/gitnexus/system")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as SystemGraph;
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
        Could not load the system graph ({error}). Run <code className="mx-1 font-mono">npm run system-graph</code> and redeploy.
      </div>
    );
  }
  if (!graph) {
    return (
      <div className="card flex h-[calc(100vh-270px)] min-h-[600px] items-center justify-center overflow-hidden p-0" style={{ background: "#04070f" }}>
        <div className="flex items-center gap-3 text-[12px] text-[#8e939d]">
          <span className="size-2 animate-pulse rounded-full bg-[#2dd4bf]" />
          waking the brain…
        </div>
      </div>
    );
  }
  return <Brain graph={graph} />;
}

function Brain({ graph }: { graph: SystemGraph }) {
  const model = useMemo(() => buildModel(graph), [graph]);
  const types = graph.types;

  const [typesOn, setTypesOn] = useState<boolean[]>(() => types.map(() => true));
  const [focus, setFocus] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);

  const focusSet = useMemo(() => (focus === null ? null : neighborhood(model, focus, 2)), [model, focus]);
  const visible = useMemo(
    () => model.nodes.map((n) => typesOn[n.type] && (focusSet ? focusSet.has(n.i) : true)),
    [model, typesOn, focusSet],
  );
  const results = useMemo(() => searchNodes(model, query), [model, query]);
  const emphasis = useMemo(() => (query.trim() && results.length ? new Set(results) : null), [query, results]);

  const reveal = useCallback(
    (i: number) => {
      // make sure the target is actually on screen before selecting it
      const n = model.nodes[i];
      if (!typesOn[n.type]) setTypesOn((t) => t.map((v, k) => (k === n.type ? true : v)));
      if (focusSet && !focusSet.has(i)) setFocus(null);
      setSelected(i);
    },
    [model, typesOn, focusSet],
  );

  // click a pillar = solo it (click again to bring everything back); shift-click adds/removes
  const pickType = useCallback(
    (k: number, additive: boolean) =>
      setTypesOn((prev) => {
        if (additive) return prev.map((v, j) => (j === k ? !v : v));
        const soloed = prev[k] && prev.every((v, j) => v === (j === k));
        return prev.map((_, j) => soloed || j === k);
      }),
    [],
  );
  const allOn = typesOn.every(Boolean);

  // a selection that filters hid is simply not shown (no state churn)
  const activeSelected = selected !== null && visible[selected] ? selected : null;
  const shown = visible.filter(Boolean).length;
  const status = hover !== null ? model.nodes[hover] : null;

  return (
    <div className="card flex h-[calc(100vh-270px)] min-h-[620px] flex-col overflow-hidden p-0">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-black/[.08] px-3 py-2 dark:border-white/[.12]">
        <div className="flex flex-wrap items-center gap-1">
          {types.map((t, k) => {
            const meta = TYPE_META[t];
            const on = typesOn[k];
            const soloed = on && !allOn && typesOn.every((v, j) => v === (j === k));
            return (
              <button
                key={t}
                type="button"
                title={soloed ? "Show everything" : `Focus on ${meta?.plural.toLowerCase() ?? t} · shift-click to add or remove`}
                onClick={(e) => pickType(k, e.shiftKey)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[11px] transition ${
                  on
                    ? "border-black/[.12] text-neutral-800 dark:border-white/[.16] dark:text-neutral-100"
                    : "border-transparent text-neutral-400 line-through dark:text-[#6b7079]"
                }`}
              >
                <span className="size-2 rounded-full" style={{ background: meta?.color, opacity: on ? 1 : 0.35, boxShadow: on ? `0 0 8px ${meta?.color}` : "none" }} />
                {meta?.plural ?? t}
                <span className="font-mono text-[10px] opacity-60">{model.typeCounts[k]}</span>
              </button>
            );
          })}
          {!allOn ? (
            <button
              type="button"
              onClick={() => setTypesOn(types.map(() => true))}
              className="inline-flex items-center rounded-full border border-dashed border-black/[.2] px-2 py-[3px] text-[11px] text-neutral-600 hover:border-black/[.4] dark:border-white/[.25] dark:text-[#b6bac2] dark:hover:border-white/[.5]"
              title="Show every type"
            >
              Show all
            </button>
          ) : null}
        </div>

        {focus !== null ? (
          <button
            type="button"
            onClick={() => setFocus(null)}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#2dd4bf]/50 bg-[#2dd4bf]/[.10] px-2 py-1 text-[12px] text-teal-900 hover:bg-[#2dd4bf]/[.18] dark:text-[#8ff2e2]"
            title="Clear focus"
          >
            <span className="eyebrow text-[9px] text-teal-800/80 dark:text-[#8ff2e2]/70">Focus</span>
            <span className="max-w-[220px] truncate font-medium">{model.nodes[focus].label}</span>
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
              if (e.key === "Enter" && results[0] !== undefined) {
                reveal(results[0]);
                setQuery("");
              }
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search automations, skills, tables, services…"
            className="h-8 w-[280px] rounded-md border border-black/[.12] bg-transparent px-2.5 text-[12.5px] text-neutral-800 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none dark:border-white/[.16] dark:text-neutral-100 dark:placeholder:text-[#8e939d]"
          />
          {query && results.length ? (
            <ul className="absolute right-0 top-9 z-20 w-[380px] overflow-hidden rounded-md border border-black/[.1] bg-white shadow-xl dark:border-white/[.16] dark:bg-[#333740]">
              {results.map((i) => {
                const n = model.nodes[i];
                const meta = TYPE_META[types[n.type]];
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => {
                        reveal(i);
                        setQuery("");
                      }}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.07]"
                    >
                      <span className="size-2 shrink-0 rounded-full" style={{ background: meta?.color }} />
                      <span className="truncate text-[12.5px] font-medium">{n.label}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-neutral-500 dark:text-[#8e939d]">{meta?.label ?? types[n.type]}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <div className="flex gap-1">
          <ToolButton onClick={() => setPaused((p) => !p)} title={paused ? "Resume motion" : "Pause motion"}>
            {paused ? "Resume" : "Pause"}
          </ToolButton>
          <ToolButton
            onClick={() => {
              setResetSignal((s) => s + 1);
              setFocus(null);
              setSelected(null);
            }}
            title="Reset the camera"
          >
            Reset
          </ToolButton>
        </div>
      </div>

      {/* body */}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 p-2">
          <BrainCanvas
            model={model}
            visible={visible}
            selected={activeSelected}
            emphasis={emphasis}
            paused={paused}
            onHover={setHover}
            onSelect={setSelected}
            onFocus={(i) => {
              setFocus(i);
              setSelected(i);
            }}
            resetSignal={resetSignal}
          />
          <div className="pointer-events-none absolute bottom-4 left-4 flex max-w-[60%] flex-col gap-1">
            {status ? (
              <div className="flex items-center gap-2 rounded-md bg-black/50 px-2.5 py-1.5 text-[12px] text-neutral-100 backdrop-blur">
                <span className="size-2 rounded-full" style={{ background: TYPE_META[types[status.type]]?.color }} />
                <span className="font-medium">{status.label}</span>
                <span className="font-mono text-[10px] text-[#b6bac2]">
                  {TYPE_META[types[status.type]]?.label} · {status.deg} connection{status.deg === 1 ? "" : "s"}
                </span>
              </div>
            ) : null}
          </div>
          <div className="pointer-events-none absolute bottom-4 right-4 text-right font-mono text-[10px] leading-relaxed text-[#8e939d]/80">
            <div>
              {shown.toLocaleString()} / {model.nodes.length.toLocaleString()} nodes · {model.links.length.toLocaleString()} edges
            </div>
            <div>drag to orbit the camera · scroll to zoom · click a body to inspect · double-click to focus</div>
          </div>
        </div>

        <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-black/[.08] px-4 py-3 text-[12.5px] dark:border-white/[.12] lg:block">
          {activeSelected !== null ? (
            <Detail model={model} i={activeSelected} onOpen={reveal} onFocus={(i) => setFocus(i)} focused={focus === activeSelected} onClearFocus={() => setFocus(null)} />
          ) : (
            <Legend model={model} typesOn={typesOn} onToggle={pickType} onAll={() => setTypesOn(types.map(() => true))} />
          )}
        </aside>
      </div>
    </div>
  );
}

/* ───────────── side panel ───────────── */

function Legend({ model, typesOn, onToggle, onAll }: { model: BrainModel; typesOn: boolean[]; onToggle: (k: number, additive: boolean) => void; onAll: () => void }) {
  const types = model.graph.types;
  const allOn = typesOn.every(Boolean);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="eyebrow">Marketing OS · system brain</p>
        <p className="mt-1.5 leading-relaxed text-neutral-600 dark:text-[#b6bac2]">
          Marketing OS at the centre; every node type on its own orbit, inner engine to outer audience: the scheduler and its automations, the skills and
          scripts they run, the dashboard&apos;s routes, pages and modules, then the tables, the external services, and finally the personas and platforms
          the content lands on. Dense types spread into belts. Pulses travel along real dependencies.
        </p>
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="eyebrow">Node types</p>
          {!allOn ? (
            <button type="button" onClick={onAll} className="text-[11px] text-teal-700 hover:underline dark:text-[#8ff2e2]">
              show all
            </button>
          ) : null}
        </div>
        <ul className="flex flex-col">
          {types.map((t, k) => {
            const meta = TYPE_META[t];
            return (
              <li key={t}>
                <button
                  type="button"
                  onClick={(e) => onToggle(k, e.shiftKey)}
                  title="Click to focus on this type · shift-click to add or remove"
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-black/[.04] dark:hover:bg-white/[.06] ${typesOn[k] ? "" : "opacity-40"}`}
                >
                  <span className="size-2.5 rounded-full" style={{ background: meta?.color, boxShadow: `0 0 10px ${meta?.color}` }} />
                  <span className="font-medium">{meta?.plural ?? t}</span>
                  <span className="ml-auto font-mono text-[10.5px] text-neutral-500 dark:text-[#8e939d]">{model.typeCounts[k]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Nodes" value={model.nodes.length} />
        <Stat label="Edges" value={model.links.length} />
      </div>
      <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-[#8e939d]">
        Click a type to isolate its orbit; shift-click to combine types. Hover anything to light up its neighbourhood; click for the full wiring.
      </p>
    </div>
  );
}

function Detail({ model, i, onOpen, onFocus, focused, onClearFocus }: { model: BrainModel; i: number; onOpen: (i: number) => void; onFocus: (i: number) => void; focused: boolean; onClearFocus: () => void }) {
  const n = model.nodes[i];
  const d = n.data;
  const types = model.graph.types;
  const edgeTypes = model.graph.edgeTypes;
  const meta = TYPE_META[types[n.type]];

  // connections grouped by relation label, sorted by group size
  const groups = new Map<string, { label: string; color: string; items: number[] }>();
  for (const li of model.nodeLinks[i]) {
    const l = model.links[li];
    const out = l.source.i === i;
    const other = out ? l.target : l.source;
    const et = edgeTypes[l.type];
    const label = (EDGE_LABEL[et] ?? { out: et, in: et })[out ? "out" : "in"];
    const key = `${out ? ">" : "<"}${et}`;
    if (!groups.has(key)) groups.set(key, { label, color: out ? meta?.color ?? "#fff" : TYPE_META[types[other.type]]?.color ?? "#fff", items: [] });
    groups.get(key)!.items.push(other.i);
  }
  const ordered = [...groups.values()].sort((a, b) => b.items.length - a.items.length);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="eyebrow" style={{ color: meta?.color }}>
          {meta?.label ?? types[n.type]}
        </p>
        <h3 className="mt-1 break-words text-[16px] font-semibold leading-tight">{n.label}</h3>
        {d.description ? <p className="mt-1.5 leading-relaxed text-neutral-600 dark:text-[#b6bac2]">{d.description}</p> : null}
      </div>

      {d.hours?.length || d.methods?.length || d.route || d.args?.length || d.envPrefix ? (
        <div className="flex flex-col gap-2">
          {d.hours?.length ? (
            <Meta label="Runs (ET)">
              <div className="flex flex-wrap gap-1">
                {d.hours.map((h) => (
                  <span key={h} className="rounded bg-black/[.05] px-1.5 py-0.5 font-mono text-[10.5px] dark:bg-white/[.08]">
                    {/^\d+(:\d+)?$/.test(h) ? fmtHour(h) : h}
                  </span>
                ))}
              </div>
            </Meta>
          ) : null}
          {d.envPrefix ? (
            <Meta label="Toggle">
              <code className="font-mono text-[11px]">{d.envPrefix}_CRON_ENABLED</code>
            </Meta>
          ) : null}
          {d.args?.length ? (
            <Meta label="Args">
              <code className="break-all font-mono text-[11px]">{d.args.join(" ")}</code>
            </Meta>
          ) : null}
          {d.methods?.length ? (
            <Meta label="Methods">
              <span className="font-mono text-[11px]">{d.methods.join(" · ")}</span>
            </Meta>
          ) : null}
          {d.route ? (
            <Meta label="Route">
              <a href={d.route} className="font-mono text-[11px] text-teal-700 hover:underline dark:text-[#8ff2e2]">
                {d.route}
              </a>
            </Meta>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-1.5">
        {focused ? (
          <ToolButton onClick={onClearFocus} title="Show the whole brain again">
            Clear focus
          </ToolButton>
        ) : (
          <ToolButton onClick={() => onFocus(i)} title="Show only this node and everything within two hops">
            Focus
          </ToolButton>
        )}
      </div>

      {ordered.length ? (
        <div className="flex flex-col gap-3">
          {ordered.map((g) => (
            <Section key={g.label} title={`${g.label} · ${g.items.length}`}>
              {g.items
                .map((j) => model.nodes[j])
                .sort((a, b) => a.rank - b.rank)
                .map((o) => (
                  <Row key={o.i} onClick={() => onOpen(o.i)} color={TYPE_META[types[o.type]]?.color} meta={TYPE_META[types[o.type]]?.label}>
                    {o.label}
                  </Row>
                ))}
            </Section>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-neutral-500 dark:text-[#8e939d]">Nothing in the repo is wired to this yet.</p>
      )}

      {d.files?.length ? (
        <Section title={`Source · ${d.files.length}`}>
          {d.files.slice(0, 14).map((f) => (
            <p key={f} className="truncate font-mono text-[10.5px] text-neutral-600 dark:text-[#b6bac2]" title={f}>
              {f}
            </p>
          ))}
          {d.files.length > 14 ? <p className="font-mono text-[10.5px] text-neutral-500">+{d.files.length - 14} more</p> : null}
        </Section>
      ) : null}

      {d.envs?.length ? (
        <Section title={`Env · ${d.envs.length}`}>
          <div className="flex flex-wrap gap-1">
            {d.envs.map((e) => (
              <span key={e} className="rounded bg-black/[.05] px-1.5 py-0.5 font-mono text-[10px] dark:bg-white/[.08]">
                {e}
              </span>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function fmtHour(h: string): string {
  const [hh, mm = "00"] = h.split(":");
  const n = parseInt(hh, 10);
  const h12 = n % 12 === 0 ? 12 : n % 12;
  return `${h12}:${mm}${n < 12 ? "am" : "pm"}`;
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-[62px] shrink-0 pt-0.5 font-mono text-[10px] uppercase tracking-wide text-neutral-500 dark:text-[#8e939d]">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-black/[.08] px-2.5 py-2 dark:border-white/[.12]">
      <p className="eyebrow text-[9.5px]">{label}</p>
      <p className="num mt-0.5 text-[15px] font-semibold tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow mb-1">{title}</p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function Row({ children, onClick, meta, color }: { children: React.ReactNode; onClick?: () => void; meta?: string; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-black/[.04] dark:hover:bg-white/[.06]"
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {meta ? <span className="shrink-0 font-mono text-[10px] text-neutral-500 dark:text-[#8e939d]">{meta}</span> : null}
    </button>
  );
}

function ToolButton({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="h-8 rounded-md border border-black/[.12] px-2.5 text-[12px] font-medium text-neutral-700 hover:bg-black/[.05] dark:border-white/[.16] dark:text-[#b6bac2] dark:hover:bg-white/[.08]"
    >
      {children}
    </button>
  );
}
