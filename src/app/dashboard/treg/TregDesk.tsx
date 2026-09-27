"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_TREG_ASK,
  SEARCH_LANES,
  TREG_STARTERS,
  TREG_STATIONS,
  type SearchLaneId,
  type TregRun,
  type TregStepStatus,
} from "@/lib/treg/types";

type Props = {
  configured: boolean;
  jev: boolean;
  org: string;
  balance: { usd: number | null; micro: number | null };
  initialRuns: TregRun[];
};

function tone(s: TregStepStatus): string {
  if (s === "done") return "text-teal-700 dark:text-[#8ff2e2]";
  if (s === "error") return "text-red-500";
  if (s === "running") return "text-amber-600 dark:text-amber-300";
  if (s === "skipped") return "text-neutral-400 dark:text-[#6b7078]";
  return "text-neutral-500 dark:text-[#8e939d]";
}

function et(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      });
}

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(2)}`;
}

export function TregDesk({ configured, jev, org, balance, initialRuns }: Props) {
  const [ask, setAsk] = useState(DEFAULT_TREG_ASK);
  const [runs, setRuns] = useState<TregRun[]>(initialRuns);
  const [activeId, setActiveId] = useState<string | null>(initialRuns[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rawOpen, setRawOpen] = useState(false);
  const [bal, setBal] = useState(balance);

  const active = runs.find((r) => r.id === activeId) ?? runs[0] ?? null;

  const merge = useCallback((incoming: TregRun) => {
    setRuns((prev) => {
      const map = new Map(prev.map((r) => [r.id, r]));
      map.set(incoming.id, incoming);
      return [...map.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/treg", { cache: "no-store" })
      .then((r) => r.json())
      .then((json: { balance?: { usd: number | null; micro: number | null }; runs?: TregRun[] }) => {
        if (cancelled) return;
        if (json.balance) setBal(json.balance);
        if (json.runs?.length) setRuns(json.runs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeId) return;
    const run = runs.find((r) => r.id === activeId);
    if (run && (run.status === "done" || run.status === "failed")) return;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      try {
        const res = await fetch(`/api/treg/${encodeURIComponent(activeId)}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { run: TregRun };
        if (cancelled) return;
        merge(json.run);
        if (json.run.status === "queued" || json.run.status === "running") {
          timer = window.setTimeout(tick, 900);
        }
      } catch {
        if (!cancelled) timer = window.setTimeout(tick, 2000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeId, active?.status, merge]);

  const start = async (text?: string) => {
    const next = (text ?? ask).trim();
    if (!next || busy) return;
    setBusy(true);
    setError("");
    setRawOpen(false);
    try {
      const res = await fetch("/api/treg", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ask: next }),
      });
      const json = (await res.json()) as { run?: TregRun; error?: string };
      if (!res.ok || !json.run) throw new Error(json.error || "Could not start");
      merge(json.run);
      setActiveId(json.run.id);
      setAsk(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1 font-mono text-[11px] text-[var(--muted)]">
          org {org}
        </span>
        <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1 font-mono text-[11px] text-[var(--muted)]">
          balance {money(bal.usd)}
        </span>
        <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1 font-mono text-[11px] text-[var(--muted)]">
          {jev ? "Jev routes" : "Jev offline · heuristic lanes"}
        </span>
        <button
          type="button"
          className="rounded-full border border-[var(--line)] px-3 py-1 font-mono text-[11px] text-[var(--muted)] hover:text-foreground"
          onClick={async () => {
            const res = await fetch("/api/treg", { cache: "no-store" });
            if (!res.ok) return;
            const json = (await res.json()) as { balance?: { usd: number | null; micro: number | null }; runs?: TregRun[] };
            if (json.balance) setBal(json.balance);
            if (json.runs) setRuns(json.runs);
          }}
        >
          refresh
        </button>
      </div>

      {!configured ? (
        <p className="text-sm text-amber-600 dark:text-amber-300">
          TREG_TOKEN is missing. Add it to creator-os/.env.local and restart the dashboard.
        </p>
      ) : null}

      <form
        className="card sheen flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <label className="eyebrow" htmlFor="treg-ask">
          Ask
        </label>
        <textarea
          id="treg-ask"
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-[14px] outline-none focus:border-[#2dd4bf]"
        />
        <div className="flex flex-wrap gap-1.5">
          {TREG_STARTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void start(s)}
              className="rounded-full border border-[var(--line)] px-2.5 py-1 text-left text-[11px] text-neutral-600 hover:border-[#2dd4bf]/50 hover:text-foreground dark:text-[#b6bac2]"
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-neutral-500 dark:text-[#8e939d]">
            Ceiling $0.02 / call · tagged customer=kevbuildsapps, feature=treg-desk
          </p>
          <button
            type="submit"
            disabled={!configured || busy || !ask.trim()}
            className="inline-flex h-9 items-center rounded-lg bg-neutral-900 px-4 text-[13px] font-medium text-white disabled:opacity-40 dark:bg-[#2dd4bf] dark:text-[#0b1f1c]"
          >
            {busy ? "Starting…" : "Run pipeline"}
          </button>
        </div>
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
      </form>

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {TREG_STATIONS.map((st, i) => {
          const step = active?.steps.find((s) => s.id === st.id);
          const status = step?.status ?? "pending";
          return (
            <li key={st.id} className="card px-3 py-3">
              <p className="eyebrow">
                0{i + 1} · {st.label}
              </p>
              <p className={`mt-1.5 text-[13px] font-medium ${tone(status)}`}>
                {status === "running" ? "running" : status}
              </p>
              <p className="mt-1 line-clamp-2 font-mono text-[10px] text-neutral-500 dark:text-[#8e939d]">
                {step?.detail || st.blurb}
              </p>
            </li>
          );
        })}
      </ol>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-4">
          {active?.error ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-500">
              {active.error}
            </p>
          ) : null}

          {active?.picked ? (
            <div className="card px-4 py-3">
              <p className="eyebrow">Picked endpoint</p>
              <p className="card-title mt-1 text-[22px]">{active.picked.name}</p>
              <p className="mt-1 font-mono text-[11px] text-neutral-500 dark:text-[#8e939d]">
                {active.picked.id}
                {active.pickConfidence != null ? ` · Jev ${Math.round(active.pickConfidence * 100)}%` : ""}
                {active.callId ? ` · ${active.callId}` : ""}
                {active.costUsd != null ? ` · ${money(active.costUsd)}` : ""}
                {active.cacheHit ? " · cache hit" : ""}
              </p>
              <p className="mt-2 text-sm text-neutral-600 dark:text-[#b6bac2]">{active.picked.summary}</p>
            </div>
          ) : null}

          {active?.rows?.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {active.rows.map((row, i) => (
                <article key={`${row.title}-${i}`} className="card flex gap-3 px-3 py-3">
                  {row.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.thumb} alt="" className="h-16 w-12 shrink-0 rounded-md object-cover" />
                  ) : null}
                  <div className="min-w-0">
                    <p className="line-clamp-3 text-[13px] leading-snug">{row.title}</p>
                    <p className="mt-1 font-mono text-[10px] text-neutral-500 dark:text-[#8e939d]">
                      {[row.subtitle, row.metric].filter(Boolean).join(" · ")}
                    </p>
                    {row.url ? (
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-[11px] text-teal-700 dark:text-[#8ff2e2]"
                      >
                        open
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : active?.status === "done" ? (
            <p className="text-sm text-neutral-500">No rows extracted — open raw payload.</p>
          ) : null}

          {active?.raw != null ? (
            <div>
              <button
                type="button"
                className="eyebrow"
                onClick={() => setRawOpen((v) => !v)}
              >
                {rawOpen ? "Hide" : "Show"} raw payload
              </button>
              {rawOpen ? (
                <pre className="mt-2 max-h-80 overflow-auto rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 font-mono text-[10px] leading-relaxed">
                  {JSON.stringify(active.raw, null, 2).slice(0, 20_000)}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>

        <aside className="flex flex-col gap-3">
          {active?.lane ? (
            <div className="card px-3 py-3">
              <p className="eyebrow">Lane</p>
              <p className="mt-1 text-[13px] font-medium">
                {SEARCH_LANES[active.lane as SearchLaneId]?.label ?? active.lane}
              </p>
              <p className="mt-1 font-mono text-[10px] text-neutral-500 dark:text-[#8e939d]">
                {active.catalogQuery || "—"}
                {active.catalogTotal != null ? ` · ${active.catalogTotal} hits` : ""}
              </p>
            </div>
          ) : null}

          {active?.candidates?.length ? (
            <div className="card px-3 py-3">
              <p className="eyebrow">Candidates</p>
              <ul className="mt-2 flex flex-col gap-2">
                {active.candidates.map((c) => (
                  <li key={c.id} className="border-t border-[var(--line)] pt-2 first:border-0 first:pt-0">
                    <p className={`text-[12px] ${c.id === active.picked?.id ? "text-teal-700 dark:text-[#8ff2e2]" : ""}`}>
                      {c.name}
                    </p>
                    <p className="font-mono text-[10px] text-neutral-500 dark:text-[#8e939d]">
                      {c.platform || "?"} · {money(c.costUsd)}
                      {c.okRate != null ? ` · ${Math.round(c.okRate * 100)}%` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="card px-3 py-3">
            <p className="eyebrow">Runs</p>
            {runs.length === 0 ? (
              <p className="mt-2 text-[12px] text-neutral-500">None yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {runs.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(r.id)}
                      className={`w-full rounded-md px-2 py-1.5 text-left text-[12px] ${
                        r.id === active?.id
                          ? "bg-[#2dd4bf]/[.12] text-teal-900 dark:text-[#8ff2e2]"
                          : "hover:bg-black/[.04] dark:hover:bg-white/[.06]"
                      }`}
                    >
                      <span className="line-clamp-2">{r.ask}</span>
                      <span className="mt-0.5 block font-mono text-[10px] text-neutral-500 dark:text-[#8e939d]">
                        {r.status} · {et(r.createdAt)} ET
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
