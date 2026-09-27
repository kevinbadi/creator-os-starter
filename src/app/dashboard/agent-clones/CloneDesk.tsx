"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CLONE_PERSONAS, PERSONA_IDS } from "@/lib/agent-clones/personas";
import type { AgentClone, CloneFormat, ClonePersonaId, CloneStatus, ProgressEv } from "@/lib/agent-clones/types";

type Props = { initial: AgentClone[]; dbReady: boolean; heygenReady: boolean };

const PILLARS: {
  id: CloneFormat;
  kicker: string;
  title: string;
  aspect: string;
  body: string;
}[] = [
  {
    id: "shortform",
    kicker: "Pillar 1",
    title: "Short-form recreation",
    aspect: "9:16 Reels / Shorts",
    body: "Upload a finished vertical. Transcript is reworded as the influencer, HeyGen speaks it, then that talking layer is cut into the original edit and speed-matched.",
  },
  {
    id: "longform",
    kicker: "Pillar 2",
    title: "Long-form recreation",
    aspect: "16:9 YouTube",
    body: "Same pipeline on a finished horizontal: captions → persona script → HeyGen chunks → overlay on talking-head and PIP, original B-roll kept, avatar audio muxed.",
  },
];

const STATUS_LABEL: Record<CloneStatus, string> = {
  queued: "Queued",
  uploading: "Uploading",
  running: "Cloning",
  done: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
};

function statusTone(s: CloneStatus): string {
  if (s === "done") return "text-teal-600 dark:text-[#2dd4bf]";
  if (s === "failed" || s === "cancelled") return "text-red-500";
  return "text-amber-600 dark:text-amber-400";
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      });
}

function mediaUrl(clone: AgentClone, kind: "final" | "preview" | "poster" | "clip"): string {
  const t = clone.finalMtime ? Math.round(clone.finalMtime) : 0;
  return `/api/agent-clones/${encodeURIComponent(clone.id)}/file?kind=${kind}&t=${t}`;
}

function isListedClone(c: AgentClone): boolean {
  return c.status !== "failed" && c.status !== "queued";
}

function pickInitial(clones: AgentClone[], format: CloneFormat): string | null {
  const inPillar = clones.filter((c) => c.format === format && isListedClone(c));
  const live = inPillar.find((c) => c.status === "running" || c.status === "uploading");
  if (live) return live.id;
  return inPillar[0]?.id ?? null;
}

function Player({
  src,
  poster,
  label,
  empty,
  aspect,
}: {
  src: string | null;
  poster?: string;
  label: string;
  empty: string;
  aspect: string;
}) {
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-1.5">{label}</p>
      <div className={`relative overflow-hidden rounded-xl bg-[#121417] ${aspect}`}>
        {src ? (
          <video
            key={src}
            src={src}
            poster={poster}
            controls
            playsInline
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <p className="text-[12px] leading-snug text-white/45">{empty}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function CloneDesk({ initial, dbReady, heygenReady }: Props) {
  const [clones, setClones] = useState<AgentClone[]>(initial);
  const [format, setFormat] = useState<CloneFormat>("shortform");
  const [personas, setPersonas] = useState<ClonePersonaId[]>(["megan"]);
  const [selectedId, setSelectedId] = useState<string | null>(() => pickInitial(initial, "shortform"));
  const [events, setEvents] = useState<ProgressEv[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const faces = personas.map((id) => CLONE_PERSONAS[id]);
  const names = faces.map((f) => f.spokenName);
  const namesLabel =
    names.length === 0
      ? "an influencer"
      : names.length === 1
        ? names[0]
        : names.length === 2
          ? `${names[0]} and ${names[1]}`
          : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  const pillar = PILLARS.find((p) => p.id === format)!;
  const feed = useMemo(
    () => clones.filter((c) => c.format === format && isListedClone(c)),
    [clones, format],
  );
  const selected = useMemo(
    () => feed.find((c) => c.id === selectedId) ?? feed[0] ?? null,
    [feed, selectedId],
  );
  const anyLive = clones.some((c) => c.status === "running" || c.status === "uploading");
  const aspect = format === "longform" ? "aspect-video" : "aspect-[9/16]";

  const merge = useCallback((incoming: AgentClone) => {
    setClones((prev) => {
      const map = new Map(prev.map((c) => [c.id, c]));
      map.set(incoming.id, incoming);
      return [...map.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    });
  }, []);

  useEffect(() => {
    const next = pickInitial(clones, format);
    setSelectedId((cur) => {
      if (cur && clones.some((c) => c.id === cur && c.format === format && isListedClone(c))) {
        return cur;
      }
      return next;
    });
    setEvents([]);
    // only when the pillar changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format]);

  useEffect(() => {
    if (!selectedId) return;
    const cur = clones.find((c) => c.id === selectedId);
    if (cur && !isListedClone(cur)) {
      setSelectedId(pickInitial(clones, format));
      setEvents([]);
    }
  }, [clones, selectedId, format]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  useEffect(() => {
    if (!anyLive && !selectedId) return;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      try {
        const listRes = await fetch("/api/agent-clones", { cache: "no-store" });
        if (listRes.ok && !cancelled) {
          const json = (await listRes.json()) as { clones: AgentClone[] };
          setClones(json.clones);
        }
        if (selectedId) {
          const res = await fetch(`/api/agent-clones/${encodeURIComponent(selectedId)}`, {
            cache: "no-store",
          });
          if (res.ok && !cancelled) {
            const json = (await res.json()) as { clone: AgentClone; events: ProgressEv[] };
            merge(json.clone);
            setEvents(json.events ?? []);
          }
        }
      } catch {
        /* retry */
      }
      if (!cancelled && anyLive) timer = window.setTimeout(tick, 2500);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [selectedId, anyLive, merge]);

  const onFile = (f: File | null) => {
    setFile(f);
    setError("");
  };

  const start = async () => {
    if (busy || !file) {
      if (!file) setError("Upload the finished video you want recreated.");
      return;
    }
    if (!personas.length) {
      setError("Pick at least one influencer.");
      return;
    }
    if (!dbReady) {
      setError("Postgres is not configured — cannot start a new clone.");
      return;
    }
    setBusy(true);
    setError("");
    setUploadPct(0);
    try {
      const created = await fetch("/api/agent-clones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personas,
          format,
          title: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
          filename: file.name,
        }),
      });
      const createdJson = (await created.json()) as {
        clone?: AgentClone;
        clones?: AgentClone[];
        error?: string;
      };
      const jobs = createdJson.clones?.length ? createdJson.clones : createdJson.clone ? [createdJson.clone] : [];
      if (!created.ok || !jobs[0]) throw new Error(createdJson.error || "Could not create clone");
      for (const job of jobs) merge(job);
      setSelectedId(jobs[0].id);
      setEvents([]);

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", `/api/agent-clones/${encodeURIComponent(jobs[0].id)}/clip`);
        xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
        xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
        if (jobs.length > 1) {
          xhr.setRequestHeader("x-sibling-ids", jobs.slice(1).map((j) => j.id).join(","));
        }
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          try {
            const json = JSON.parse(xhr.responseText) as {
              clone?: AgentClone;
              clones?: AgentClone[];
              error?: string;
            };
            if (xhr.status >= 400) throw new Error(json.error || `Upload ${xhr.status}`);
            for (const job of json.clones ?? (json.clone ? [json.clone] : [])) merge(job);
            resolve();
          } catch (err) {
            reject(err);
          }
        };
        xhr.onerror = () => reject(new Error("Video upload failed"));
        xhr.send(file);
      });
      setFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start clone");
    } finally {
      setBusy(false);
      setUploadPct(null);
    }
  };

  const cancel = async () => {
    if (!selected) return;
    await fetch(`/api/agent-clones/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
  };

  return (
    <div className="stagger space-y-8">
      <section className="grid gap-3 md:grid-cols-2">
        {PILLARS.map((p) => {
          const active = format === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setFormat(p.id)}
              className={`rounded-[18px] border px-5 py-4 text-left transition ${
                active
                  ? "border-teal-400 bg-teal-500/[.07] shadow-[0_0_0_1px_rgba(45,212,191,0.35)]"
                  : "border-black/[.08] bg-[var(--surface-1)] hover:border-teal-500/40 dark:border-white/[.12]"
              }`}
            >
              <p className="eyebrow">{p.kicker}</p>
              <h2 className="card-title mt-1">{p.title}</h2>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                {p.aspect}
              </p>
              <p className="mt-2 text-sm leading-snug text-neutral-600 dark:text-[#b6bac2]">{p.body}</p>
            </button>
          );
        })}
      </section>

      <form
        className="rounded-[18px] border border-black/[.08] bg-[var(--surface-1)] p-5 dark:border-white/[.12]"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <p className="eyebrow">New {pillar.title.toLowerCase()}</p>
        <h2 className="card-title mt-1">Upload the finished cut</h2>
        <p className="mt-2 max-w-2xl text-sm text-neutral-600 dark:text-[#b6bac2]">
          Always a completed video. Select one influencer or several — the same original is copied to each job. The
          skill rewords the transcript as {namesLabel}, sends it to HeyGen, then lays that talking layer onto your
          original edit and speed-matches so it times up.
        </p>

        <p className="eyebrow mt-5">Influencers · tap to add or remove</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {PERSONA_IDS.map((id) => {
            const p = CLONE_PERSONAS[id];
            const active = personas.includes(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() =>
                  setPersonas((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
                }
                className={`flex items-center gap-2.5 overflow-hidden rounded-xl border px-2 py-2 text-left transition ${
                  active
                    ? "border-teal-400 shadow-[0_0_0_1px_rgba(45,212,191,0.4)]"
                    : "border-black/[.08] hover:border-teal-500/40 dark:border-white/[.12]"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/agent-clones/portrait/${id}`}
                  alt=""
                  className="size-11 shrink-0 rounded-lg object-cover object-[50%_18%]"
                />
                <span>
                  <span className="block font-serif text-[17px] italic leading-none">{p.label}</span>
                  <span className="mt-1 block font-mono text-[9px] text-neutral-500">
                    {active ? "selected" : p.handle}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            onFile(e.dataTransfer.files[0] ?? null);
          }}
          className={`mt-5 flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-12 text-center transition ${
            drag
              ? "border-teal-400 bg-teal-500/[.08]"
              : "border-black/[.18] bg-black/[.015] hover:border-teal-500/50 hover:bg-teal-500/[.04] dark:border-white/[.18] dark:bg-white/[.02]"
          }`}
        >
          <span className="font-serif text-[24px] italic tracking-tight">Drop the original video</span>
          <span className="mt-1 text-xs text-neutral-500 dark:text-[#8b909a]">
            mp4 / mov · {pillar.aspect} · this is the edit the clone gets composited into
          </span>
          {file ? (
            <span className="mt-3 rounded-full bg-neutral-900 px-3 py-1 text-xs text-white dark:bg-[#2dd4bf] dark:text-[#0b1f1c]">
              {file.name}
            </span>
          ) : null}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />

        {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}
        {!dbReady ? (
          <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">
            DATABASE_URL is missing. Past clones still play; new runs need Postgres.
          </p>
        ) : null}
        {!heygenReady ? (
          <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">
            HeyGen MCP is not configured. Avatar submits use the HeyGen connector (OAuth / plan credits), not an API key.
          </p>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={!file || busy || !dbReady || personas.length === 0}
            className="inline-flex h-10 items-center rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-40 dark:bg-[#2dd4bf] dark:text-[#0b1f1c]"
          >
            {busy
              ? uploadPct != null
                ? `Uploading ${uploadPct}%`
                : "Starting…"
              : `Recreate as ${namesLabel}`}
          </button>
          {busy && uploadPct != null ? <span className="num text-xs text-neutral-500">{uploadPct}%</span> : null}
        </div>
      </form>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="eyebrow">{pillar.title} feed</p>
            <h2 className="card-title mt-1">Original and clone</h2>
          </div>
          <p className="num text-xs text-neutral-500">{feed.length}</p>
        </div>

        {feed.length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/[.12] px-4 py-10 text-sm text-neutral-500 dark:border-white/[.14]">
            Nothing in this pillar yet. Upload a finished video above and the original + clone will land here.
          </p>
        ) : (
          <div className="space-y-4">
            {feed.map((c) => {
              const open = selected?.id === c.id;
              const cloneSrc = c.hasFinal
                ? mediaUrl(c, "final")
                : c.hasPreview
                  ? mediaUrl(c, "preview")
                  : null;
              const origSrc = c.hasClip ? mediaUrl(c, "clip") : null;
              const rowLive = c.status === "running" || c.status === "uploading";
              return (
                <article
                  key={c.id}
                  className={`overflow-hidden rounded-[18px] border bg-[var(--surface-1)] ${
                    open
                      ? "border-teal-400/70 shadow-[0_0_0_1px_rgba(45,212,191,0.28)]"
                      : "border-black/[.08] dark:border-white/[.12]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(c.id);
                      if (c.id !== selectedId) setEvents([]);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/agent-clones/portrait/${c.persona}`}
                      alt=""
                      className="size-9 shrink-0 rounded-md object-cover object-[50%_18%]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-serif text-[18px] italic leading-tight">{c.title}</span>
                      <span className="num mt-0.5 block text-[11px] text-neutral-500">
                        {CLONE_PERSONAS[c.persona].label} · {shortDate(c.updatedAt)}
                      </span>
                    </span>
                    <span className={`shrink-0 text-[11px] font-medium ${statusTone(c.status)}`}>
                      {STATUS_LABEL[c.status]}
                      {rowLive ? (
                        <span className="ml-2 inline-block size-1.5 animate-pulse rounded-full bg-[#2dd4bf]" />
                      ) : null}
                    </span>
                  </button>

                  {open ? (
                    <div className="border-t border-black/[.06] px-4 py-4 dark:border-white/[.08]">
                      <div
                        className={`grid gap-4 ${
                          format === "longform"
                            ? "lg:grid-cols-2"
                            : "sm:grid-cols-2 lg:max-w-[640px]"
                        }`}
                      >
                        <Player
                          src={origSrc}
                          label="Original"
                          empty="Original file not on disk yet."
                          aspect={aspect}
                        />
                        <Player
                          src={cloneSrc}
                          poster={c.hasPoster ? mediaUrl(c, "poster") : undefined}
                          label={`${CLONE_PERSONAS[c.persona].spokenName} clone`}
                          empty={
                            rowLive
                              ? "HeyGen layer is rendering onto the original…"
                              : c.status === "failed"
                                ? c.error || "Clone failed."
                                : "Clone will appear here when the composite is ready."
                          }
                          aspect={aspect}
                        />
                      </div>

                      {rowLive || events.length > 0 ? (
                        <div
                          ref={logRef}
                          className="mt-4 max-h-40 overflow-auto rounded-xl border border-black/[.08] bg-black/[.03] px-3 py-2 font-mono text-[11px] leading-relaxed text-neutral-600 dark:border-white/[.12] dark:bg-black/30 dark:text-[#b6bac2]"
                        >
                          {c.lastTool ? (
                            <p className="mb-2 text-teal-700 dark:text-[#2dd4bf]">now {c.lastTool}</p>
                          ) : null}
                          {events.map((ev, i) => (
                            <p
                              key={`${ev.ts}-${i}`}
                              className={
                                ev.type === "error"
                                  ? "text-red-400"
                                  : ev.type === "tool"
                                    ? "text-neutral-400"
                                    : ""
                              }
                            >
                              {ev.type === "tool" ? `▸ ${ev.name} ${ev.summary ?? ""}` : ev.text}
                            </p>
                          ))}
                          {rowLive && events.length === 0 ? (
                            <p className="text-neutral-400">
                              Waiting on {c.model ? c.model : "the clone agent"}…
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {rowLive ? (
                        <button
                          type="button"
                          onClick={() => void cancel()}
                          className="mt-3 text-xs text-neutral-500 underline decoration-black/20 underline-offset-2 hover:text-neutral-800 dark:hover:text-white"
                        >
                          Cancel run
                        </button>
                      ) : null}
                      {c.status === "failed" && c.error ? (
                        <p className="mt-3 text-sm text-red-500">{c.error}</p>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
