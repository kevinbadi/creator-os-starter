"use client";

import { useEffect, useState, useTransition } from "react";
import type { Channel, ChannelType } from "@/lib/channels/types";
import {
  createChannel,
  updateChannel,
  deleteChannel,
  setChannelProfiles,
} from "@/lib/channels/actions";

type ProfileOption = { id: string; name: string; accounts: number };

const TYPE_OPTIONS: { value: ChannelType; label: string }[] = [
  { value: "personal", label: "Personal" },
  { value: "app", label: "App" },
  { value: "ugc", label: "AI UGC" },
  { value: "yt-automation", label: "YouTube Automation" },
];

const COLORS = [
  "#D9F76A",
  "#7AC0FF",
  "#FF9D7A",
  "#C7A3FF",
  "#7AE0B0",
  "#FF8FB1",
  "#FFD166",
  "#A3A3A3",
];

const TYPE_LABEL: Record<ChannelType, string> = {
  personal: "Personal",
  app: "App",
  ugc: "AI UGC",
  "yt-automation": "YouTube Automation",
};

export function ChannelManager({
  channels,
  profiles,
}: {
  channels: Channel[];
  profiles: ProfileOption[];
}) {
  const [pending, startTransition] = useTransition();

  // selected profile ids per channel (source of truth for the picker)
  const [selected, setSelected] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(channels.map((c) => [c.id, c.zernioProfileIds])),
  );
  useEffect(() => {
    setSelected(Object.fromEntries(channels.map((c) => [c.id, c.zernioProfileIds])));
  }, [channels]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  function toggleProfile(channelId: string, profileId: string) {
    const current = new Set(selected[channelId] ?? []);
    if (current.has(profileId)) current.delete(profileId);
    else current.add(profileId);
    const arr = [...current];
    setSelected((s) => ({ ...s, [channelId]: arr }));
    startTransition(() => setChannelProfiles(channelId, arr));
  }

  return (
    <div className={pending ? "opacity-95" : ""}>
      <NewChannelForm
        onCreate={(input) => startTransition(() => void createChannel(input))}
      />

      <div className="mt-6 space-y-3">
        {channels.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-black/[.12] p-8 text-center text-sm text-neutral-500 dark:border-white/[.19]">
            No channels yet. Create your first one above.
          </p>
        ) : null}

        {channels.map((c) => {
          const sel = selected[c.id] ?? [];
          const isEditing = editingId === c.id;
          const isExpanded = expandedId === c.id;
          return (
            <div
              key={c.id}
              className="rounded-2xl border border-black/[.08] bg-white p-4 dark:border-white/[.14] dark:bg-[var(--surface-1)]"
            >
              {isEditing ? (
                <EditChannelForm
                  channel={c}
                  onCancel={() => setEditingId(null)}
                  onSave={(patch) => {
                    startTransition(() => void updateChannel(c.id, patch));
                    setEditingId(null);
                  }}
                />
              ) : (
                <div className="flex items-center gap-3">
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ background: c.color || "#a3a3a3" }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    {c.subtitle ? (
                      <p className="truncate text-xs text-neutral-500">
                        {c.subtitle}
                      </p>
                    ) : null}
                  </div>
                  <span className="rounded-full border border-black/[.08] bg-black/[.03] px-2 py-0.5 text-[11px] font-medium text-neutral-600 dark:border-white/[.14] dark:bg-white/[.08] dark:text-neutral-300">
                    {TYPE_LABEL[c.type]}
                  </span>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : c.id)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-neutral-600 transition hover:bg-black/[.04] dark:text-neutral-300 dark:hover:bg-white/[.09]"
                  >
                    {sel.length} profile{sel.length === 1 ? "" : "s"}
                    <span className="ml-1 text-neutral-400">
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(c.id)}
                    className="rounded-md border border-black/[.12] px-2.5 py-1 text-xs font-medium transition hover:bg-black/[.04] dark:border-white/[.19] dark:hover:bg-white/[.09]"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete channel "${c.name}"?`)) {
                        startTransition(() => void deleteChannel(c.id));
                      }
                    }}
                    className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 dark:border-red-900/40 dark:text-red-300 dark:hover:bg-red-950/30"
                  >
                    Delete
                  </button>
                </div>
              )}

              {isExpanded && !isEditing ? (
                <ProfilePicker
                  profiles={profiles}
                  selected={sel}
                  onToggle={(pid) => toggleProfile(c.id, pid)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NewChannelForm({
  onCreate,
}: {
  onCreate: (input: {
    name: string;
    type: ChannelType;
    color: string;
    subtitle: string;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>("app");
  const [color, setColor] = useState(COLORS[1]);
  const [subtitle, setSubtitle] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onCreate({ name, type, color, subtitle });
        setName("");
        setSubtitle("");
        setColor(COLORS[1]);
        setType("app");
      }}
      className="rounded-2xl border border-black/[.08] bg-white p-4 dark:border-white/[.14] dark:bg-[var(--surface-1)]"
    >
      <p className="text-sm font-medium">New channel</p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Channel name"
          className="h-10 flex-1 rounded-lg border border-black/[.12] bg-white px-3 text-sm text-neutral-900 outline-none transition focus:border-neutral-400 dark:border-white/[.19] dark:bg-[var(--surface-2)] dark:text-neutral-100"
        />
        <input
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          placeholder="Subtitle (optional)"
          className="h-10 flex-1 rounded-lg border border-black/[.12] bg-white px-3 text-sm text-neutral-900 outline-none transition focus:border-neutral-400 dark:border-white/[.19] dark:bg-[var(--surface-2)] dark:text-neutral-100"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ChannelType)}
          className="h-10 rounded-lg border border-black/[.12] bg-white px-2 text-sm text-neutral-900 outline-none dark:border-white/[.19] dark:bg-[var(--surface-2)] dark:text-neutral-100"
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Swatches value={color} onChange={setColor} />
        <button
          type="submit"
          className="inline-flex h-9 items-center rounded-full bg-neutral-900 px-4 text-sm font-medium text-white transition hover:-translate-y-px dark:bg-white dark:text-neutral-900"
        >
          Add channel
        </button>
      </div>
    </form>
  );
}

function EditChannelForm({
  channel,
  onSave,
  onCancel,
}: {
  channel: Channel;
  onSave: (patch: {
    name: string;
    type: ChannelType;
    color: string;
    subtitle: string;
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(channel.name);
  const [type, setType] = useState<ChannelType>(channel.type);
  const [color, setColor] = useState(channel.color || COLORS[0]);
  const [subtitle, setSubtitle] = useState(channel.subtitle || "");

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Channel name"
          className="h-10 flex-1 rounded-lg border border-black/[.12] bg-white px-3 text-sm text-neutral-900 outline-none transition focus:border-neutral-400 dark:border-white/[.19] dark:bg-[var(--surface-2)] dark:text-neutral-100"
        />
        <input
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          placeholder="Subtitle (optional)"
          className="h-10 flex-1 rounded-lg border border-black/[.12] bg-white px-3 text-sm text-neutral-900 outline-none transition focus:border-neutral-400 dark:border-white/[.19] dark:bg-[var(--surface-2)] dark:text-neutral-100"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ChannelType)}
          className="h-10 rounded-lg border border-black/[.12] bg-white px-2 text-sm text-neutral-900 outline-none dark:border-white/[.19] dark:bg-[var(--surface-2)] dark:text-neutral-100"
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Swatches value={color} onChange={setColor} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center rounded-full border border-black/[.12] px-4 text-sm font-medium transition hover:bg-black/[.04] dark:border-white/[.19] dark:hover:bg-white/[.09]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => name.trim() && onSave({ name, type, color, subtitle })}
            className="inline-flex h-9 items-center rounded-full bg-neutral-900 px-4 text-sm font-medium text-white transition hover:-translate-y-px dark:bg-white dark:text-neutral-900"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfilePicker({
  profiles,
  selected,
  onToggle,
}: {
  profiles: ProfileOption[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const set = new Set(selected);
  return (
    <div className="mt-4 border-t border-black/[.06] pt-4 dark:border-white/[.12]">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
        Zernio profiles in this channel
      </p>
      {profiles.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No Zernio profiles found. Check the ZERNIO_API_KEY.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {profiles.map((p) => {
            const on = set.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onToggle(p.id)}
                className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition ${
                  on
                    ? "border-neutral-900 bg-neutral-900/[.04] dark:border-white/70 dark:bg-white/[.09]"
                    : "border-black/[.08] hover:bg-black/[.03] dark:border-white/[.14] dark:hover:bg-white/[.08]"
                }`}
              >
                <span
                  className={`grid size-4 shrink-0 place-items-center rounded border ${
                    on
                      ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                      : "border-black/[.25] dark:border-white/[.3]"
                  }`}
                >
                  {on ? (
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m2.5 6 2.5 2.5 4.5-5" />
                    </svg>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="shrink-0 text-xs text-neutral-400">
                  {p.accounts} acct
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Swatches({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`Color ${c}`}
          className={`size-6 rounded-full transition ${
            value === c
              ? "ring-2 ring-neutral-900 ring-offset-2 dark:ring-white dark:ring-offset-neutral-950"
              : "hover:scale-110"
          }`}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}
