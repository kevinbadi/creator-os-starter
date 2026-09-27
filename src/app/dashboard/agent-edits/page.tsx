import { PageHeader } from "@/components/PageHeader";
import { listEdits } from "@/lib/agent-edits/store";
import { dbConfigured } from "@/lib/insforge/db";
import { AgentEditsDesk } from "./AgentEditsDesk";

export const metadata = { title: "Agent edits · Marketing OS" };
export const dynamic = "force-dynamic";

export default async function AgentEditsPage() {
  const edits = await listEdits();
  return (
    <main className="w-full px-6 pb-6 pt-4">
      <PageHeader
        eyebrow="Intelligence"
        title="Agent edits"
        description="Drop a talking-head clip. The split-animated skill runs on this machine and the 9:16 cut plays here — no waiting in chat."
      />
      <AgentEditsDesk initial={edits} dbReady={dbConfigured} />
    </main>
  );
}
