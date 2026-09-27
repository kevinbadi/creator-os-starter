import { PageHeader } from "@/components/PageHeader";
import { AgentPostsDesk } from "@/components/AgentPostsDesk";
import { MissingCreatorOsKey } from "@/components/MissingCreatorOsKey";
import { listAgentPosts } from "@/lib/agent-posts/store";
import { listAgentPostTargets } from "@/lib/agent-posts/targets";
import { creatorOsForkKeyConfigured } from "@/lib/agent-posts/setup";
import { formatSlotEt, withNextSlots } from "@/lib/agent-posts/slots";

export const metadata = { title: "Agent Posts · Creator OS" };
export const dynamic = "force-dynamic";

export default async function AgentPostsPage() {
  const keyed = creatorOsForkKeyConfigured();
  const [jobs, targets] = keyed
    ? await Promise.all([
        listAgentPosts(40),
        listAgentPostTargets()
          .then(withNextSlots)
          .catch(() => []),
      ])
    : [[], []];

  const nextLine = targets
    .map((t) =>
      t.nextSlot
        ? `${t.name} ${formatSlotEt(new Date(t.nextSlot))}`
        : `${t.name} (no open slot)`,
    )
    .join(" · ");

  return (
    <main className="w-full px-6 pb-6 pt-4">
      <PageHeader
        title="Agent Posts Done for You"
        description={
          keyed
            ? nextLine
              ? `Next open slot: ${nextLine}. Drop a talking-head video; cover, caption, and the next slot land on the cut sheet.`
              : "Pick a socials set, then drop a video. Platforms default to all connected accounts."
            : "Connect your Creator OS API key to schedule posts from this desk."
        }
      />
      {keyed ? null : <MissingCreatorOsKey />}
      <AgentPostsDesk initialJobs={jobs} initialTargets={targets} />
    </main>
  );
}
