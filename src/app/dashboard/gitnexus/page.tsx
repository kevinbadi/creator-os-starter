import { PageHeader } from "@/components/PageHeader";
import { getRepoGraphMeta } from "@/lib/gitnexus/graph";
import { getSystemGraphMeta } from "@/lib/gitnexus/system";
import { GraphTabs } from "./GraphTabs";

export const metadata = { title: "System brain · Marketing OS" };

const ET_STAMP = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default function GitNexusPage() {
  const sys = getSystemGraphMeta();
  const code = getRepoGraphMeta();
  const b = sys.byType;
  return (
    <main className="w-full px-6 pb-6 pt-4">
      <PageHeader
        eyebrow="Codebase"
        title="System brain"
        description="Marketing OS as a living system: the core at the centre, every automation, skill, route, table, service and platform orbiting on its own plane, wired by what actually runs, reads, writes and posts. Drag to orbit, hover to light up a neighbourhood, click anything to see its wiring."
        actions={
          <div className="flex flex-col items-end gap-0.5 text-right">
            <p className="eyebrow">{sys.commit.slice(0, 7) || "local"}</p>
            <p className="font-mono text-[11px] text-neutral-500 dark:text-[#8e939d]">
              mapped {ET_STAMP.format(new Date(sys.generatedAt))} ET · <code>npm run system-graph</code> to refresh
            </p>
          </div>
        }
      />

      <div className="stagger mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Automations" value={b.automation ?? 0} sub="scheduled jobs" />
        <Kpi label="Skills" value={b.skill ?? 0} sub="content pipelines" />
        <Kpi label="Routes" value={(b.route ?? 0) + (b.webhook ?? 0)} sub={`${b.webhook ?? 0} webhook`} />
        <Kpi label="Pages" value={b.page ?? 0} sub="dashboard" />
        <Kpi label="Services" value={b.service ?? 0} sub="external APIs" />
        <Kpi label="Tables" value={b.table ?? 0} sub="postgres" />
      </div>

      <GraphTabs codeMeta={{ files: code.repo.stats.files, symbols: code.nodes - code.repo.stats.files, edges: code.edges, clusters: code.clusters, flows: code.flows }} />
    </main>
  );
}

function Kpi({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="card sheen px-4 py-3">
      <p className="eyebrow">{label}</p>
      <p className="num mt-1 text-[22px] font-semibold leading-none tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub ? <p className="mt-1 font-mono text-[10px] text-neutral-500 dark:text-[#8e939d]">{sub}</p> : null}
    </div>
  );
}
