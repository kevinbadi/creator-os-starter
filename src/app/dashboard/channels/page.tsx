import { PageHeader } from "@/components/PageHeader";
import { listChannels } from "@/lib/channels/store";
import { listProfiles } from "@/lib/zernio/client";
import { ChannelManager } from "./ChannelManager";

export const metadata = { title: "Channels · Marketing OS" };

export default async function ChannelsPage() {
  const [channels, profiles] = await Promise.all([
    listChannels(),
    listProfiles().catch(() => []),
  ]);

  const profileOptions = profiles.map((p) => ({
    id: p._id,
    name: p.name,
    accounts: p.accountUsernames?.length ?? 0,
  }));

  return (
    <main className="w-full px-6 py-8">
      <PageHeader
        title="Channels"
        description="Group your Zernio profiles into the channels you switch between. A channel can hold many profiles."
      />
      <ChannelManager channels={channels} profiles={profileOptions} />
    </main>
  );
}
