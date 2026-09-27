import { PageHeader } from "@/components/PageHeader";
import { jevConfigured } from "@/lib/jev/client";
import { JevChat } from "./JevChat";
import { JevCapacity } from "./JevCapacity";
import { PLATFORMS, RANGES, SORTS, STATUSES, TOOLS } from "@/lib/jev/tools";
import { brandCriteria, mediaIndex } from "@/lib/jev/obsidian";

export const metadata = { title: "Jev · Marketing OS" };
export const dynamic = "force-dynamic";

export default async function JevPage() {
  // Obsidian vault brands are a live Jev choice question (Kevin 2026-09-20)
  const vaultBrands = Object.keys(brandCriteria(await mediaIndex())).length;
  return (
    <main className="flex h-full w-full flex-col px-6 pb-6 pt-4">
      <PageHeader
        title="Jev"
        description="TypeSafe's System One model as the front door. Ask in plain words; Jev picks the tool, time range, sort and platform (each with its confidence), the dashboard runs it and shows the rows, and Jev reads the answer back in his own voice. Talk with the mic or type. Read-only for now."
        actions={
          <JevCapacity
            questions={[
              { label: "tools", used: Object.keys(TOOLS).length },
              { label: "ranges", used: Object.keys(RANGES).length },
              { label: "sorts", used: Object.keys(SORTS).length },
              { label: "platforms", used: Object.keys(PLATFORMS).length },
              { label: "statuses", used: Object.keys(STATUSES).length },
              { label: "vault brands", used: vaultBrands },
            ]}
          />
        }
      />
      <JevChat configured={jevConfigured()} />
    </main>
  );
}
