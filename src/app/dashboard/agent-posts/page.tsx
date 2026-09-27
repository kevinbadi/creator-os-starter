import { PageHeader } from "@/components/PageHeader";
import { AgentPostsDesk } from "@/components/AgentPostsDesk";
import { MissingCreatorOsKey } from "@/components/MissingCreatorOsKey";
import { listAgentPosts } from "@/lib/agent-posts/store";
import { boardTargetsForChannel, listAgentPostTargets } from "@/lib/agent-posts/targets";
import { getActiveChannel } from "@/lib/channels/store";
import { creatorOsPublishKeyConfigured } from "@/lib/agent-posts/setup";
import {
  currentEtMonth,
  formatSlotEt,
  slotBoardsForTargets,
  type SlotBoard,
} from "@/lib/agent-posts/slots";

export const metadata = { title: "Agent Posts Done for You · Marketing OS" };
export const dynamic = "force-dynamic";

export default async function AgentPostsPage() {
  const keyed = creatorOsPublishKeyConfigured();
  const month = currentEtMonth();
  const [jobs, slotted] = keyed
    ? await Promise.all([
        listAgentPosts(80),
        listAgentPostTargets()
          .then((t) => slotBoardsForTargets(t, month))
          .catch(() => ({ targets: [], boards: [] as SlotBoard[] })),
      ])
    : [[], { targets: [], boards: [] as SlotBoard[] }];
  const targets = slotted.targets;
  const channelId = await getActiveChannel().then((c) => c?.id ?? null).catch(() => null);
  const boards = boardTargetsForChannel(slotted.boards, channelId);

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
          nextLine
            ? `Next open slot: ${nextLine}. Kev AI is +1h vs Kev Builds Apps; Megan has her own 2am / 2 / 5 / 8pm ET grid. Title, caption, and DM resource link are optional.`
            : "Pick Kev Builds Apps, Kev AI, and/or Megan, then drop a video. Platforms default to all connected accounts. With a resource URL, the spoken comment keyword becomes the comment-to-DM funnel. Cover and the next slot land on the cut sheet."
        }
      />
      {keyed ? null : <MissingCreatorOsKey />}
      <AgentPostsDesk
        initialJobs={jobs}
        initialTargets={targets}
        initialBoards={boards}
        initialMonth={month}
      />
    </main>
  );
}
