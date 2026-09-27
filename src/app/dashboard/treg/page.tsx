import { PageHeader } from "@/components/PageHeader";
import { jevConfigured } from "@/lib/jev/client";
import { tregConfigured, tregOrg } from "@/lib/treg/client";
import { listRuns } from "@/lib/treg/store";
import { TregDesk } from "./TregDesk";

export const metadata = { title: "Treg · Marketing OS" };
export const dynamic = "force-dynamic";

export default async function TregPage() {
  return (
    <main className="flex h-full w-full flex-col px-6 pb-6 pt-4">
      <PageHeader
        eyebrow="Intelligence"
        title="Treg"
        description="Jev routes the ask, Treg fetches live catalog data. First lane is US TikTok trends — For You, search terms, viral sounds — so we can see what to post today."
        actions={
          <div className="flex flex-col items-end gap-1 text-right">
            <p className="eyebrow">{tregOrg()}</p>
            <p className="font-mono text-[11px] text-neutral-500 dark:text-[#8e939d]">
              {tregConfigured() ? "token on" : "no token"}
              {jevConfigured() ? " · Jev on" : " · Jev off"}
            </p>
          </div>
        }
      />
      <TregDesk
        configured={tregConfigured()}
        jev={jevConfigured()}
        org={tregOrg()}
        balance={{ usd: null, micro: null }}
        initialRuns={listRuns()}
      />
    </main>
  );
}
