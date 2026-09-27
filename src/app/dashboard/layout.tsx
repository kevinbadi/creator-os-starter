import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { listChannels, getActiveChannel } from "@/lib/channels/store";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [channels, active] = await Promise.all([
    listChannels(),
    getActiveChannel(),
  ]);

  return (
    <div className="flex flex-1 overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar channels={channels} activeChannelId={active?.id ?? ""} />
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}
