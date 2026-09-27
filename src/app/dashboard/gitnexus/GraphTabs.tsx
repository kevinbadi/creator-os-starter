"use client";

import { useState } from "react";
import { RepoGraphExplorer } from "./RepoGraphExplorer";
import { SystemBrain } from "./SystemBrain";

type Tab = "brain" | "code";

export function GraphTabs({ codeMeta }: { codeMeta: { files: number; symbols: number; edges: number; clusters: number; flows: number } }) {
  const [tab, setTab] = useState<Tab>("brain");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex rounded-md border border-black/[.12] p-0.5 dark:border-white/[.16]">
          {(
            [
              { id: "brain", label: "System brain", hint: "Automations, skills, routes, services, tables, personas, platforms" },
              { id: "code", label: "Code graph", hint: "GitNexus: files, symbols and call chains" },
            ] as { id: Tab; label: string; hint: string }[]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.hint}
              onClick={() => setTab(t.id)}
              className={`rounded-[5px] px-2.5 py-1 text-[12px] font-medium transition ${
                tab === t.id
                  ? "bg-neutral-900 text-white dark:bg-[#2dd4bf] dark:text-[#0b1f1c]"
                  : "text-neutral-600 hover:bg-black/[.05] dark:text-[#b6bac2] dark:hover:bg-white/[.08]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "code" ? (
          <p className="font-mono text-[11px] text-neutral-500 dark:text-[#8e939d]">
            {codeMeta.files.toLocaleString()} files · {codeMeta.symbols.toLocaleString()} symbols · {codeMeta.edges.toLocaleString()} edges · {codeMeta.clusters} clusters ·{" "}
            {codeMeta.flows} flows · <code>npm run repo-graph</code> to refresh
          </p>
        ) : null}
      </div>
      {tab === "brain" ? <SystemBrain /> : <RepoGraphExplorer />}
    </div>
  );
}
