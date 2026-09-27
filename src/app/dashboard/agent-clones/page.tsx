import { PageHeader } from "@/components/PageHeader";
import { heygenMcpConfigured } from "@/lib/agent-clones/heygen-mcp";
import { listClones } from "@/lib/agent-clones/store";
import { dbConfigured } from "@/lib/insforge/db";
import { CloneDesk } from "./CloneDesk";

export const metadata = { title: "Agent Video Cloning · Marketing OS" };
export const dynamic = "force-dynamic";

export default async function AgentClonesPage() {
  const clones = await listClones();
  return (
    <main className="w-full px-6 pb-6 pt-4">
      <PageHeader
        eyebrow="Intelligence"
        title="Agent Video Cloning"
        description="Two pillars: short-form and long-form. Pick one or more influencers, upload a finished video, and the feed shows the original next to each HeyGen composite."
      />
      <CloneDesk
        initial={clones}
        dbReady={dbConfigured}
        heygenReady={heygenMcpConfigured()}
      />
    </main>
  );
}
