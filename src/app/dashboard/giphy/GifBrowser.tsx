"use client";

import { useEffect, useState, useTransition } from "react";
import {
  saveGif,
  removeGif,
  setGifChecked,
  setGifNotes,
} from "@/lib/giphy/actions";
import type { SavedGif } from "@/lib/giphy/store";

type SearchResult = {
  id: string;
  title: string;
  preview: string;
  mp4: string;
};

type Tab = "search" | "favorites";

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function GifBrowser({ favorites }: { favorites: SavedGif[] }) {
  const [, start] = useTransition();
  const [tab, setTab] = useState<Tab>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // The query the current results belong to — stamped onto favorites.
  const [searchedFor, setSearchedFor] = useState("");

  // Local overlays so favoriting feels instant; server actions persist +
  // revalidate in the background (same pattern as SoundsBrowser).
  const [favs, setFavs] = useState<Map<string, SavedGif>>(
    () => new Map(favorites.map((g) => [g.id, g])),
  );
  const [track, setTrack] = useState<
    Record<string, { checked: boolean; usedCount: number; lastUsedAt: string | null }>
  >(() => {
    const m: Record<string, { checked: boolean; usedCount: number; lastUsedAt: string | null }> = {};
    for (const g of favorites)
      m[g.id] = { checked: g.checked, usedCount: g.usedCount, lastUsedAt: g.lastUsedAt };
    return m;
  });

  // `initial` skips the sync setState — loading already starts true, and the
  // lint rule (react-hooks/set-state-in-effect) forbids sync setState in effects.
  const runSearch = async (q: string, initial = false) => {
    if (!initial) {
      setLoading(true);
      setError("");
    }
    try {
      const r = await fetch(`/api/giphy/search?q=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Search failed (${r.status})`);
      setSearchedFor(q);
      setResults(j.results ?? []);
      if (initial) setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  // Trending on first load so the grid isn't empty. setState only fires after
  // the fetch resolves (initial=true skips the sync spinner toggle).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runSearch("", true);
  }, []);

  const onFav = (g: SearchResult) => {
    if (favs.has(g.id)) {
      setFavs((p) => {
        const n = new Map(p);
        n.delete(g.id);
        return n;
      });
      start(() => void removeGif(g.id));
    } else {
      const saved: SavedGif = {
        ...g,
        query: searchedFor,
        checked: false,
        usedCount: 0,
        lastUsedAt: null,
        notes: "",
        createdAt: new Date().toISOString(),
      };
      setFavs((p) => new Map(p).set(g.id, saved));
      setTrack((p) => ({ ...p, [g.id]: { checked: false, usedCount: 0, lastUsedAt: null } }));
      start(() => void saveGif({ ...g, query: searchedFor }));
    }
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
    start(() => void setGifChecked(id, next));
  };

  const favList = Array.from(favs.values());

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <FilterTab active={tab === "search"} onClick={() => setTab("search")}>
          🔍 Search
        </FilterTab>
        <FilterTab active={tab === "favorites"} onClick={() => setTab("favorites")}>
          ★ Favorites <span className="tabular-nums opacity-60">{favList.length}</span>
        </FilterTab>
        <span className="ml-auto text-[11px] text-neutral-400">
          Favorites are the allow-list workflows may use in posts
        </span>
      </div>

      {tab === "search" ? (
        <>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch(query.trim());
            }}
          >
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Giphy — e.g. money rain, side eye, typing fast…"
              className="w-full max-w-md rounded-md border border-black/[.12] bg-transparent px-3 py-1.5 text-sm text-neutral-700 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none dark:border-white/[.19] dark:text-neutral-200"
            />
            <button
              type="submit"
              className="shrink-0 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Search
            </button>
          </form>
          {!query && searchedFor === "" && !loading ? (
            <p className="mt-2 text-[11px] text-neutral-400">Showing trending.</p>
          ) : null}

          {error ? <p className="mt-4 text-sm text-red-500">{error}</p> : null}
          {loading ? (
            <p className="mt-4 text-sm text-neutral-400">Loading…</p>
          ) : (
            <div className="mt-3 columns-2 gap-2 sm:columns-3 lg:columns-4 xl:columns-5 [&>*]:mb-2">
              {results.map((g) => (
                <GifCard
                  key={g.id}
                  gif={g}
                  fav={favs.has(g.id)}
                  onFav={() => onFav(g)}
                />
              ))}
            </div>
          )}
        </>
      ) : favList.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-400">
          No favorites yet — tap the ☆ on a GIF to add it to the workflow allow-list.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-black/[.06] overflow-hidden rounded-xl border border-black/[.08] bg-white dark:divide-white/[.08] dark:border-white/[.14] dark:bg-[var(--surface-1)]">
          {favList.map((g) => {
            const t = track[g.id] ?? { checked: false, usedCount: 0, lastUsedAt: null };
            return (
              <li
                key={g.id}
                className={`flex items-center gap-3 p-3 ${
                  t.checked ? "bg-black/[.02] dark:bg-white/[.06]" : ""
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={g.preview}
                  alt={g.title}
                  className="h-16 w-24 shrink-0 rounded-md object-cover"
                  loading="lazy"
                />
                <label
                  className="flex shrink-0 cursor-pointer items-center"
                  title={t.checked ? "Used — click to un-check" : "Check off (mark used)"}
                >
                  <input
                    type="checkbox"
                    checked={t.checked}
                    onChange={() => onCheck(g.id)}
                    className="size-4 accent-teal-500"
                  />
                </label>
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm font-medium ${
                      t.checked ? "text-neutral-400 line-through" : ""
                    }`}
                    title={g.title}
                  >
                    {g.title}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-neutral-400">
                    {g.query ? `found via “${g.query}”` : "trending"}
                    {" · "}
                    <a
                      href={g.mp4}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-neutral-600 dark:hover:text-neutral-300"
                    >
                      mp4
                    </a>
                  </p>
                  {t.usedCount > 0 ? (
                    <p className="mt-0.5 text-[10px] font-medium text-teal-600 dark:text-teal-400">
                      ✓ used {t.usedCount}×
                      {t.lastUsedAt ? ` · last ${shortDate(t.lastUsedAt)}` : ""}
                    </p>
                  ) : null}
                </div>
                <input
                  type="text"
                  defaultValue={g.notes}
                  onBlur={(e) => {
                    if (e.target.value !== g.notes)
                      start(() => void setGifNotes(g.id, e.target.value));
                  }}
                  placeholder="Notes — what it's for / which persona…"
                  className="hidden w-64 rounded-md border border-black/[.12] bg-transparent px-2.5 py-1 text-xs text-neutral-700 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none sm:block dark:border-white/[.19] dark:text-neutral-200"
                />
                <button
                  type="button"
                  onClick={() => onFav(g)}
                  title="Unfavorite (remove from allow-list)"
                  aria-label="Unfavorite"
                  className="shrink-0 text-lg leading-none text-amber-400 transition hover:text-neutral-300"
                >
                  ★
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function GifCard({
  gif,
  fav,
  onFav,
}: {
  gif: SearchResult;
  fav: boolean;
  onFav: () => void;
}) {
  return (
    <div className="group relative break-inside-avoid overflow-hidden rounded-lg border border-black/[.08] dark:border-white/[.14]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={gif.preview} alt={gif.title} className="w-full" loading="lazy" />
      <button
        type="button"
        onClick={onFav}
        aria-label={fav ? "Unfavorite" : "Favorite"}
        title={fav ? "Unfavorite" : "Favorite (allow in workflows)"}
        className={`absolute right-1.5 top-1.5 rounded-full bg-black/50 px-1.5 py-1 text-base leading-none backdrop-blur-sm transition ${
          fav
            ? "text-amber-400"
            : "text-white/70 opacity-0 hover:text-amber-400 group-hover:opacity-100"
        }`}
      >
        {fav ? "★" : "☆"}
      </button>
    </div>
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
