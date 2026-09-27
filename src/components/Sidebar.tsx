"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Grouped nav (2026-09-14 design pass): the flat 14-item list read as a
// checklist. Groups give the eye a rhythm and put the daily-use pages first.
// Routes are unchanged. Accounts + Settings stay unlisted (Kevin 2026-07-12).
const GROUPS: { label: string; items: { href: string; label: string; exact?: boolean }[] }[] = [
  {
    label: "Command",
    items: [
      { href: "/dashboard", label: "Overview", exact: true },
      { href: "/dashboard/progress", label: "Business progress" },
      { href: "/dashboard/analytics", label: "Analytics" },
      { href: "/dashboard/calendar", label: "Calendar" },
    ],
  },
  {
    label: "Publish",
    items: [
      { href: "/dashboard/posts", label: "Posts" },
      { href: "/dashboard/agent-posts", label: "Agent posts" },
      { href: "/dashboard/carousels", label: "Content" },
      { href: "/dashboard/philosophy", label: "Philosophy content" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/dashboard/news", label: "AI news" },
      { href: "/dashboard/copywriter", label: "Copywriter" },
      { href: "/dashboard/script-writer", label: "Script Writer" },
      { href: "/dashboard/agent-edits", label: "Agent edits" },
      { href: "/dashboard/agent-clones", label: "Agent Video Cloning" },
      { href: "/dashboard/agent", label: "Voice agent" },
      { href: "/dashboard/jev", label: "Jev" },
      { href: "/dashboard/treg", label: "Treg" },
      { href: "/dashboard/laya", label: "Laya" },
    ],
  },
  {
    label: "Codebase",
    items: [{ href: "/dashboard/gitnexus", label: "System brain" }],
  },
  {
    label: "Library",
    items: [
      { href: "/dashboard/channels", label: "Channels" },
      { href: "/dashboard/sounds", label: "Sounds" },
      { href: "/dashboard/giphy", label: "GIFs" },
      { href: "/dashboard/screensaver", label: "Screensaver" },
    ],
  },
];

function useEtClock(): string {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    });
    const tick = () => setNow(fmt.format(new Date()));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function Sidebar() {
  const pathname = usePathname();
  const clock = useEtClock();
  return (
    <aside className="hidden w-48 shrink-0 flex-col border-r border-black/[.08] bg-neutral-50/70 px-3 pb-4 pt-5 dark:border-white/[.10] dark:bg-[#1b1d21] md:flex">
      <Link href="/dashboard" className="mb-5 flex items-center gap-2.5 px-2">
        <span
          className="live-dot size-2.5 rounded-full"
          style={{ background: "#2dd4bf", boxShadow: "0 0 10px rgba(45,212,191,0.65)" }}
        />
        <span className="font-serif text-[19px] italic leading-none tracking-tight">
          Marketing OS
        </span>
      </Link>

      <nav className="flex flex-1 flex-col gap-4">
        {GROUPS.map((g) => (
          <div key={g.label}>
            <p className="eyebrow mb-1 px-2 text-[9px]">{g.label}</p>
            <div className="flex flex-col gap-px">
              {g.items.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={false}
                    className={`group relative flex items-center rounded-md px-2 py-[5px] text-[13px] transition ${
                      active
                        ? "bg-[#2dd4bf]/[.12] font-medium text-teal-900 dark:bg-[#2dd4bf]/[.13] dark:text-[#8ff2e2]"
                        : "text-neutral-600 hover:bg-black/[.04] hover:text-neutral-900 dark:text-[#b6bac2] dark:hover:bg-white/[.07] dark:hover:text-white"
                    }`}
                  >
                    {active ? (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-full bg-[#2dd4bf]"
                        style={{ boxShadow: "0 0 8px rgba(45,212,191,0.8)" }}
                      />
                    ) : null}
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-5 px-1">
        <Link
          href="/dashboard/posts/new"
          prefetch={false}
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-neutral-900 text-[13px] font-medium text-white transition hover:bg-neutral-800 dark:bg-[#2dd4bf] dark:text-[#0b1f1c] dark:hover:bg-[#5fe3d2]"
        >
          <span className="text-base leading-none">+</span> New post
        </Link>
        <p className="eyebrow mt-3 flex items-center justify-between px-1 text-[9px]">
          <span>New York</span>
          <span className="num font-mono normal-case tracking-normal text-neutral-500 dark:text-[#8b909a]">
            {clock}
          </span>
        </p>
      </div>
    </aside>
  );
}
