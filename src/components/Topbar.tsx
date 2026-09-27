import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { ChannelSwitcher } from "./ChannelSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import type { Channel } from "@/lib/channels/types";

export function Topbar({
  channels,
  activeChannelId,
}: {
  channels: Channel[];
  activeChannelId: string;
}) {
  const today = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
  return (
    // relative z-40: backdrop-blur creates a stacking context at z-auto, which
    // let the page content paint over the channel dropdown (z-50 inside it).
    <header className="relative z-40 flex h-14 shrink-0 items-center justify-between border-b border-black/[.08] bg-white/80 px-4 backdrop-blur dark:border-white/[.10] dark:bg-[#1f2125cc] md:px-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="font-serif text-lg italic md:hidden">
          Marketing OS
        </Link>
        <ChannelSwitcher channels={channels} activeChannelId={activeChannelId} />
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden font-serif text-[15px] italic text-neutral-500 dark:text-[#b6bac2] sm:block">
          {today}
        </span>
        <ThemeToggle />
        <form action={signOut}>
          <button
            type="submit"
            className="inline-flex h-8 items-center rounded-md border border-black/[.12] px-2.5 text-xs font-medium transition hover:bg-black/[.04] dark:border-white/[.16] dark:hover:bg-white/[.09]"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
