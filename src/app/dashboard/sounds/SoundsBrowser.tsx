"use client";

import { useMemo, useState, useTransition } from "react";
import {
  toggleFavorite,
  deleteSound,
  setChecked,
  setGender,
  setNotes,
} from "@/lib/sounds/actions";
import type { Gender, SoundSet } from "@/lib/sounds/store";

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function prettyDate(folder: string): string {
  const [date, region] = folder.split("_");
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return folder;
  const label = new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return region ? `${label} · ${region}` : label;
}

type Filter = "music" | "sounds" | "favorites";
type GenderFilter = Gender | "all";

const GENDER_META: Record<Gender, { icon: string; label: string; cls: string }> = {
  female: { icon: "♀", label: "Female", cls: "bg-pink-500 text-white border-pink-500" },
  male: { icon: "♂", label: "Male", cls: "bg-sky-500 text-white border-sky-500" },
  any: { icon: "⚥", label: "Any", cls: "bg-neutral-700 text-white border-neutral-700" },
};

export function SoundsBrowser({ sets }: { sets: SoundSet[] }) {
  const [, start] = useTransition();
  const [filter, setFilter] = useState<Filter>("music");
  const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");

  // Local overlays so favoriting/deleting feels instant; the server action
  // persists + revalidates in the background.
  const [favs, setFavs] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const s of sets) for (const x of s.sounds) m[x.id] = x.favorite;
    return m;
  });
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  // Per-sound curation: which gender it suits + your free-text notes.
  const [genders, setGenders] = useState<Record<string, Gender>>(() => {
    const m: Record<string, Gender> = {};
    for (const s of sets) for (const x of s.sounds) m[x.id] = x.gender;
    return m;
  });
  const [notes, setNotesState] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const s of sets) for (const x of s.sounds) m[x.id] = x.notes;
    return m;
  });
  // Check-off + usage tracking, seeded from the DB, updated optimistically.
  const [track, setTrack] = useState<
    Record<string, { checked: boolean; usedCount: number; lastUsedAt: string | null }>
  >(() => {
    const m: Record<string, { checked: boolean; usedCount: number; lastUsedAt: string | null }> = {};
    for (const s of sets)
      for (const x of s.sounds)
        m[x.id] = { checked: x.checked, usedCount: x.usedCount, lastUsedAt: x.lastUsedAt };
    return m;
  });

  const onFav = (id: string) => {
    const next = !favs[id];
    setFavs((p) => ({ ...p, [id]: next }));
    start(() => void toggleFavorite(id, next));
  };
  const onDel = (id: string) => {
    setRemoved((p) => new Set(p).add(id));
    start(() => void deleteSound(id));
  };
  const onCheck = (id: string) => {
    const cur = track[id] ?? { checked: false, usedCount: 0, lastUsedAt: null };
    const next = !cur.checked;
    setTrack((p) => ({
      ...p,
      [id]: {
        checked: next,
        usedCount: next ? cur.usedCount + 1 : cur.usedCount,
        lastUsedAt: next ? new Date().toISOString() : cur.lastUsedAt,
      },
    }));
    start(() => void setChecked(id, next));
  };
  const onGender = (id: string, g: Gender) => {
    setGenders((p) => ({ ...p, [id]: g }));
    start(() => void setGender(id, g));
  };
  // Save notes on blur only (not per keystroke) to avoid a write per character.
  const onNotesSave = (id: string, value: string) => {
    start(() => void setNotes(id, value));
  };

  const { musicCount, soundsCount, favCount, favChecked } = useMemo(() => {
    let music = 0;
    let sounds = 0;
    let fav = 0;
    let checked = 0;
    for (const s of sets)
      for (const x of s.sounds) {
        if (removed.has(x.id)) continue;
        if (x.chart === "sounds") sounds++;
        else music++;
        if (favs[x.id]) {
          fav++;
          if (track[x.id]?.checked) checked++;
        }
      }
    return { musicCount: music, soundsCount: sounds, favCount: fav, favChecked: checked };
  }, [sets, favs, removed, track]);

  const matches = (s: (typeof sets)[number]["sounds"][number]) => {
    if (removed.has(s.id)) return false;
    if (genderFilter !== "all" && (genders[s.id] ?? "any") !== genderFilter) return false;
    if (filter === "favorites") return favs[s.id];
    return s.chart === filter;
  };

  const visibleSets = sets
    .map((set) => ({ date: set.date, sounds: set.sounds.filter(matches) }))
    .filter((set) => set.sounds.length > 0);

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <FilterTab active={filter === "music"} onClick={() => setFilter("music")}>
          🎵 Music <span className="tabular-nums opacity-60">{musicCount}</span>
        </FilterTab>
        <FilterTab active={filter === "sounds"} onClick={() => setFilter("sounds")}>
          🔊 Sounds <span className="tabular-nums opacity-60">{soundsCount}</span>
        </FilterTab>
        <FilterTab active={filter === "favorites"} onClick={() => setFilter("favorites")}>
          ★ Favorites <span className="tabular-nums opacity-60">{favCount}</span>
        </FilterTab>
        <span className="ml-auto text-[11px] text-neutral-400">
          {filter === "favorites"
            ? `${favChecked}/${favCount} checked off (used)`
            : "Favorites are the allow-list workflows may use in carousels"}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-medium text-neutral-400">For creator:</span>
        {(["all", "female", "male", "any"] as GenderFilter[]).map((g) => (
          <GenderChip
            key={g}
            active={genderFilter === g}
            onClick={() => setGenderFilter(g)}
          >
            {g === "all"
              ? "All"
              : `${GENDER_META[g].icon} ${GENDER_META[g].label}`}
          </GenderChip>
        ))}
      </div>

      {visibleSets.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-400">
          {filter === "favorites"
            ? "No favorites yet — tap the ☆ on a sound to add it to the workflow allow-list."
            : filter === "sounds"
              ? "No general sounds yet — run the sounds chart pull."
              : "No music yet — run the music chart pull."}
        </p>
      ) : (
        <div className="mt-3 space-y-6">
          {visibleSets.map((set) => (
            <section key={set.date}>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">{prettyDate(set.date)}</h2>
                <span className="text-xs text-neutral-400">
                  {set.sounds.length} sound{set.sounds.length === 1 ? "" : "s"}
                </span>
              </div>

              <ul className="divide-y divide-black/[.06] overflow-hidden rounded-xl border border-black/[.08] bg-white dark:divide-white/[.08] dark:border-white/[.14] dark:bg-[var(--surface-1)]">
                {set.sounds.map((s) => {
                  const fav = favs[s.id];
                  const t = track[s.id] ?? { checked: false, usedCount: 0, lastUsedAt: null };
                  const proxy = `/api/sounds/file?u=${encodeURIComponent(s.audioUrl)}`;
                  return (
                    <li
                      key={s.id}
                      className={`flex flex-col gap-2 p-3 ${
                        t.checked ? "bg-black/[.02] dark:bg-white/[.06]" : ""
                      }`}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                      <button
                        type="button"
                        onClick={() => onFav(s.id)}
                        aria-label={fav ? "Unfavorite" : "Favorite"}
                        title={fav ? "Unfavorite" : "Favorite (allow in workflows)"}
                        className={`shrink-0 text-lg leading-none transition ${
                          fav
                            ? "text-amber-400"
                            : "text-neutral-300 hover:text-amber-400 dark:text-neutral-600"
                        }`}
                      >
                        {fav ? "★" : "☆"}
                      </button>

                      {fav ? (
                        <label
                          className="flex shrink-0 cursor-pointer items-center"
                          title={t.checked ? "Used — click to un-check" : "Check off (mark used)"}
                        >
                          <input
                            type="checkbox"
                            checked={t.checked}
                            onChange={() => onCheck(s.id)}
                            className="size-4 accent-teal-500"
                          />
                        </label>
                      ) : (
                        <span className="w-4 shrink-0" aria-hidden />
                      )}

                      <div className="min-w-0 sm:w-2/5">
                        <p
                          className={`truncate text-sm font-medium ${
                            t.checked ? "text-neutral-400 line-through" : ""
                          }`}
                          title={s.title}
                        >
                          {s.title}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-neutral-400">
                          {[s.author, s.duration].filter(Boolean).join(" · ") || "—"}
                          {s.sourceUrl ? (
                            <>
                              {" · "}
                              <a
                                href={s.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="underline hover:text-neutral-600 dark:hover:text-neutral-300"
                              >
                                source
                              </a>
                            </>
                          ) : null}
                        </p>
                        {t.usedCount > 0 ? (
                          <p className="mt-0.5 text-[10px] font-medium text-teal-600 dark:text-teal-400">
                            ✓ used {t.usedCount}×
                            {t.lastUsedAt ? ` · last ${shortDate(t.lastUsedAt)}` : ""}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2 sm:flex-1">
                        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                        <audio controls preload="none" src={proxy} className="h-9 w-full" />
                        <a
                          href={proxy}
                          download
                          title="Download audio"
                          className="shrink-0 rounded-md border border-black/[.12] px-2 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-black/[.04] dark:border-white/[.19] dark:text-neutral-300 dark:hover:bg-white/[.09]"
                        >
                          ↓
                        </a>
                        <button
                          type="button"
                          onClick={() => onDel(s.id)}
                          title="Delete (remove from library)"
                          aria-label="Delete"
                          className="shrink-0 rounded-md border border-black/[.12] px-2 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:border-white/[.19] dark:text-red-400 dark:hover:bg-red-950/30"
                        >
                          ✕
                        </button>
                      </div>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 sm:pl-9">
                        <div className="flex shrink-0 items-center gap-1">
                          {(["female", "male", "any"] as Gender[]).map((g) => {
                            const active = (genders[s.id] ?? "any") === g;
                            return (
                              <button
                                key={g}
                                type="button"
                                onClick={() => onGender(s.id, g)}
                                title={`Suits ${GENDER_META[g].label.toLowerCase()} creators`}
                                className={`rounded-md border px-2 py-1 text-xs font-medium transition ${
                                  active
                                    ? GENDER_META[g].cls
                                    : "border-black/[.12] text-neutral-500 hover:bg-black/[.04] dark:border-white/[.19] dark:text-[#b6bac2] dark:hover:bg-white/[.09]"
                                }`}
                              >
                                {GENDER_META[g].icon} {GENDER_META[g].label}
                              </button>
                            );
                          })}
                        </div>
                        <input
                          type="text"
                          defaultValue={notes[s.id] ?? ""}
                          onBlur={(e) => {
                            const v = e.target.value;
                            if (v !== (notes[s.id] ?? "")) {
                              setNotesState((p) => ({ ...p, [s.id]: v }));
                              onNotesSave(s.id, v);
                            }
                          }}
                          placeholder="Notes — your take / what it's for…"
                          className="w-full flex-1 rounded-md border border-black/[.12] bg-transparent px-2.5 py-1 text-xs text-neutral-700 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none dark:border-white/[.19] dark:text-neutral-200"
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
          : "border border-black/[.12] text-neutral-600 hover:bg-black/[.04] dark:border-white/[.19] dark:text-neutral-300 dark:hover:bg-white/[.09]"
      }`}
    >
      {children}
    </button>
  );
}

function GenderChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
        active
          ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
          : "border border-black/[.12] text-neutral-500 hover:bg-black/[.04] dark:border-white/[.19] dark:text-[#b6bac2] dark:hover:bg-white/[.09]"
      }`}
    >
      {children}
    </button>
  );
}
