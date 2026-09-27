"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  CHANNEL_TYPE_LABEL,
  CHANNEL_TYPE_ORDER,
  type Channel,
  type ChannelType,
} from "@/lib/channels/types";
import { setActiveChannel } from "@/lib/channels/actions";

export function ChannelSwitcher({
  channels,
  activeChannelId,
}: {
  channels: Channel[];
  activeChannelId: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  const active =
    channels.find((c) => c.id === activeChannelId) ?? channels[0] ?? null;

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function select(id: string) {
    setOpen(false);
    if (id === activeChannelId) return;
    startTransition(() => setActiveChannel(id));
  }

  // Empty sections still render (with an "add one" hint) so a freshly added
  // category like YouTube Automation is visible before its first channel.
  const grouped = CHANNEL_TYPE_ORDER.map((type) => ({
    type,
    items: channels.filter((c) => c.type === type),
  }));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex h-9 items-center gap-2 rounded-full border border-black/[.10] bg-white px-3 text-sm font-medium transition hover:bg-black/[.03] dark:border-white/[.12] dark:bg-[var(--surface-2)] dark:hover:bg-[var(--surface-3)] ${
          pending ? "opacity-60" : ""
        }`}
      >
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: active?.color || "#a3a3a3" }}
        />
        <span className="max-w-[180px] truncate">
          {active?.name ?? "Select channel"}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M3.5 5.25 7 8.75l3.5-3.5" />
        </svg>
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 z-50 mt-2 w-72 overflow-hidden rounded-xl border border-black/[.10] bg-white p-1.5 shadow-xl shadow-black/5 dark:border-white/[.14] dark:bg-[var(--surface-1)]"
        >
          {grouped.map((group) => (
            <Group key={group.type} type={group.type}>
              {group.items.length > 0 ? (
                group.items.map((c) => (
                  <ChannelRow
                    key={c.id}
                    channel={c}
                    active={c.id === activeChannelId}
                    onSelect={() => select(c.id)}
                  />
                ))
              ) : (
                <a
                  href="/dashboard/channels"
                  className="block rounded-lg px-2.5 py-2 text-xs text-neutral-500 transition hover:bg-black/[.04] dark:hover:bg-white/[.08]"
                >
                  No channels yet — add one in Channels
                </a>
              )}
            </Group>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Group({
  type,
  children,
}: {
  type: ChannelType;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1 last:mb-0">
      <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
        {CHANNEL_TYPE_LABEL[type]}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function ChannelRow({
  channel,
  active,
  onSelect,
}: {
  channel: Channel;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${
        active
          ? "bg-black/[.06] dark:bg-white/[.11]"
          : "hover:bg-black/[.04] dark:hover:bg-white/[.08]"
      }`}
    >
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ background: channel.color || "#a3a3a3" }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{channel.name}</span>
        {channel.subtitle ? (
          <span className="block truncate text-xs text-neutral-500">
            {channel.subtitle}
          </span>
        ) : null}
      </span>
      {active ? (
        <svg
          width="15"
          height="15"
          viewBox="0 0 15 15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-neutral-700 dark:text-neutral-300"
        >
          <path d="m3.5 8 2.5 2.5 5.5-6" />
        </svg>
      ) : null}
    </button>
  );
}
