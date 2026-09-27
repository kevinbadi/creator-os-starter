"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentEdit, EditStatus, ProgressEv } from "@/lib/agent-edits/types";

type Props = { initial: AgentEdit[]; dbReady: boolean };

const STATUS_LABEL: Record<EditStatus, string> = {
  queued: "Queued",
  uploading: "Uploading clip",
  running: "Cutting",
  done: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
};

function statusTone(s: EditStatus): string {
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

function mediaUrl(edit: AgentEdit, kind: "final" | "band" | "poster" | "clip"): string {
  const t = edit.finalMtime ? Math.round(edit.finalMtime) : 0;
  return `/api/agent-edits/${encodeURIComponent(edit.id)}/file?kind=${kind}&t=${t}`;
}

function pickInitial(edits: AgentEdit[]): string | null {
  const live = edits.find((e) => e.status === "running" || e.status === "uploading");
  if (live) return live.id;
  const ready = edits.find((e) => e.hasFinal);
  return ready?.id ?? edits[0]?.id ?? null;
}

export function AgentEditsDesk({ initial, dbReady }: Props) {
  const [edits, setEdits] = useState<AgentEdit[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(() => pickInitial(initial));
  const [events, setEvents] = useState<ProgressEv[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(
    () => edits.find((e) => e.id === selectedId) ?? null,
    [edits, selectedId],
  );

  const merge = useCallback((incoming: AgentEdit) => {
    setEdits((prev) => {
      const map = new Map(prev.map((e) => [e.id, e]));
      map.set(incoming.id, incoming);
      return [...map.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    });
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      try {
        const res = await fetch(`/api/agent-edits/${encodeURIComponent(selectedId)}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { edit: AgentEdit; events: ProgressEv[] };
        if (cancelled) return;
        merge(json.edit);
        setEvents(json.events ?? []);
        if (json.edit.status === "running" || json.edit.status === "uploading") {
          timer = window.setTimeout(tick, 2000);
        }
      } catch {
        if (!cancelled) timer = window.setTimeout(tick, 4000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [selectedId, merge, selected?.status]);

  const onFile = (f: File | null) => {
    setFile(f);
    setError("");
    if (f && !title.trim()) {
      setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
    }
  };

  const start = async () => {
    if (!file || busy) return;
    if (!dbReady) {
      setError("Postgres is not configured — cannot start a new edit.");
      return;
    }
    setBusy(true);
    setError("");
    setUploadPct(0);
    try {
      const created = await fetch("/api/agent-edits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow: "split-animated-talking-head",
          title: title.trim(),
          notes: notes.trim(),
          sourceUrl: sourceUrl.trim(),
          filename: file.name,
        }),
      });
      const createdJson = (await created.json()) as { edit?: AgentEdit; error?: string };
      if (!created.ok || !createdJson.edit) throw new Error(createdJson.error || "Could not create edit");
      const job = createdJson.edit;
      merge(job);
      setSelectedId(job.id);
      setEvents([]);

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", `/api/agent-edits/${encodeURIComponent(job.id)}/clip`);
        xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
        xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          try {
            const json = JSON.parse(xhr.responseText) as { edit?: AgentEdit; error?: string };
            if (xhr.status >= 400) throw new Error(json.error || `Upload ${xhr.status}`);
            if (json.edit) merge(json.edit);
            resolve();
          } catch (err) {
            reject(err);
          }
        };
        xhr.onerror = () => reject(new Error("Clip upload failed"));
        xhr.send(file);
      });
      setFile(null);
      setNotes("");
      setSourceUrl("");
      setTitle("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start edit");
    } finally {
      setBusy(false);
      setUploadPct(null);
    }
  };

  const cancel = async () => {
    if (!selected) return;
    await fetch(`/api/agent-edits/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
  };

  const retry = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/agent-edits/${encodeURIComponent(selected.id)}/clip`, { method: "POST" });
      const json = (await res.json()) as { edit?: AgentEdit; error?: string };
      if (!res.ok || !json.edit) throw new Error(json.error || "Could not retry edit");
      merge(json.edit);
      setEvents([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not retry edit");
    } finally {
      setBusy(false);
    }
  };

  const live = selected && (selected.status === "running" || selected.status === "uploading");
  const playKind: "final" | "band" | "clip" | null = selected
    ? selected.hasFinal
      ? "final"
      : selected.hasBand
        ? "band"
        : selected.hasClip
          ? "clip"
          : null
    : null;

  return (
    <div className="stagger space-y-8">
      <section className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <form
          className="rounded-[18px] border border-black/[.08] bg-[var(--surface-1)] p-5 dark:border-white/[.12]"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <p className="eyebrow">Workflow</p>
          <h2 className="card-title mt-1">Split animated talking head</h2>
          <p className="mt-2 max-w-xl text-sm text-neutral-600 dark:text-[#b6bac2]">
            Custom animation in the top half, your clip cropped into the live band, kinetic captions on your voice.
            Runs the same skill as the last few weeks of cuts.
          </p>

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
            className={`mt-5 flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-10 text-center transition ${
              drag
                ? "border-teal-400 bg-teal-500/[.08]"
                : "border-black/[.18] bg-black/[.015] hover:border-teal-500/50 hover:bg-teal-500/[.04] dark:border-white/[.18] dark:bg-white/[.02]"
            }`}
          >
            <span className="font-serif text-[22px] italic tracking-tight">Drop the talking head</span>
            <span className="mt-1 text-xs text-neutral-500 dark:text-[#8b909a]">
              mp4 / mov · 9:16 preferred · webcam is fine
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

          <label className="mt-4 block">
            <span className="eyebrow">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ios farms"
              className="mt-1 h-10 w-full rounded-lg border border-black/[.1] bg-[var(--surface-2)] px-3 text-sm outline-none focus:border-teal-400/70 dark:border-white/[.14]"
            />
          </label>
          <label className="mt-3 block">
            <span className="eyebrow">Notes / extra script</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Optional. Whisper from the clip is the default script."
              className="mt-1 w-full resize-y rounded-lg border border-black/[.1] bg-[var(--surface-2)] px-3 py-2 text-sm outline-none focus:border-teal-400/70 dark:border-white/[.14]"
            />
          </label>
          <label className="mt-3 block">
            <span className="eyebrow">Reference URL</span>
            <input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="Optional IG / YT / TikTok — copy only, never pixels"
              className="mt-1 h-10 w-full rounded-lg border border-black/[.1] bg-[var(--surface-2)] px-3 text-sm outline-none focus:border-teal-400/70 dark:border-white/[.14]"
            />
          </label>

          {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}
          {!dbReady ? (
            <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">
              DATABASE_URL is missing. Past cuts still play; new runs need Postgres.
            </p>
          ) : null}

          <div className="mt-4 flex items-center gap-3">
            <button
              type="submit"
              disabled={!file || busy || !dbReady}
              className="inline-flex h-10 items-center rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-40 dark:bg-[#2dd4bf] dark:text-[#0b1f1c]"
            >
              {busy
                ? uploadPct != null
                  ? `Uploading ${uploadPct}%`
                  : "Starting…"
                : "Run edit"}
            </button>
            {busy && uploadPct != null ? (
              <span className="num text-xs text-neutral-500">{uploadPct}%</span>
            ) : null}
          </div>
        </form>

        <aside className="lg:sticky lg:top-4">
          <div className="overflow-hidden rounded-[22px] border border-black/[.1] bg-[#121417] shadow-[0_24px_50px_-28px_rgba(0,0,0,0.85)] dark:border-white/[.08]">
            <div className="flex items-center justify-between px-4 py-2.5">
              <p className="eyebrow text-[#8b909a]">Monitor</p>
              {selected ? (
                <span className={`text-[11px] font-medium ${statusTone(selected.status)}`}>
                  {STATUS_LABEL[selected.status]}
                  {live ? <span className="ml-2 inline-block size-1.5 animate-pulse rounded-full bg-[#2dd4bf]" /> : null}
                </span>
              ) : null}
            </div>
            <div className="relative mx-auto aspect-[9/16] w-full max-w-[340px] bg-black">
              {selected && playKind ? (
                <video
                  key={`${selected.id}-${playKind}-${selected.finalMtime ?? 0}`}
                  src={mediaUrl(selected, playKind)}
                  poster={selected.hasPoster ? mediaUrl(selected, "poster") : undefined}
                  controls
                  playsInline
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <p className="font-serif text-[28px] italic text-white/80">Waiting on a cut</p>
                  <p className="mt-2 text-xs text-white/40">
                    {selected?.hasPoster
                      ? "Band and frames will land here as the skill runs."
                      : "Drop a clip, or pick a past edit from the bay."}
                  </p>
                </div>
              )}
              {selected && playKind && playKind !== "final" ? (
                <p className="absolute bottom-3 left-3 rounded-full bg-black/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-teal-200">
                  {playKind === "band" ? "Live band" : "Source clip"}
                </p>
              ) : null}
            </div>
            <div className="border-t border-white/[.08] px-4 py-3">
              <p className="font-serif text-[18px] italic text-white">
                {selected?.title || "No edit selected"}
              </p>
              {selected ? (
                <p className="mt-0.5 font-mono text-[11px] text-white/40">{selected.slug}</p>
              ) : null}
              {selected?.status === "failed" && selected.error ? (
                <p className="mt-2 text-[12px] leading-snug text-red-300/90">{selected.error}</p>
              ) : null}
              {live && selected ? (
                <button
                  type="button"
                  onClick={() => void cancel()}
                  className="mt-3 text-xs text-white/50 underline decoration-white/20 underline-offset-2 hover:text-white"
                >
                  Cancel run
                </button>
              ) : null}
              {selected && (selected.status === "failed" || selected.status === "cancelled") && selected.hasClip ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void retry()}
                  className="mt-3 text-xs text-teal-200/80 underline decoration-teal-200/30 underline-offset-2 hover:text-teal-100 disabled:opacity-40"
                >
                  {busy ? "Starting…" : "Retry run"}
                </button>
              ) : null}
            </div>
          </div>
        </aside>
      </section>

      {selected && (events.length > 0 || live) ? (
        <section>
          <p className="eyebrow mb-2">Agent</p>
          <div
            ref={logRef}
            className="max-h-56 overflow-auto rounded-xl border border-black/[.08] bg-black/[.03] px-3 py-2 font-mono text-[11px] leading-relaxed text-neutral-600 dark:border-white/[.12] dark:bg-black/30 dark:text-[#b6bac2]"
          >
            {selected.lastTool ? (
              <p className="mb-2 text-teal-700 dark:text-[#2dd4bf]">now {selected.lastTool}</p>
            ) : null}
            {events.map((ev, i) => (
              <p key={`${ev.ts}-${i}`} className={ev.type === "error" ? "text-red-400" : ev.type === "tool" ? "text-neutral-400" : ""}>
                {ev.type === "tool" ? `▸ ${ev.name} ${ev.summary ?? ""}` : ev.text}
              </p>
            ))}
            {live && events.length === 0 ? (
              <p className="text-neutral-400">
                Waiting on{" "}
                {selected.engine === "cursor"
                  ? "Cursor agent"
                  : selected.engine === "claude"
                    ? "Claude Code"
                    : selected.model || "the edit agent"}
                …
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="eyebrow">Edit bay</p>
            <h2 className="card-title mt-1">Past cuts</h2>
          </div>
          <p className="num text-xs text-neutral-500">{edits.length}</p>
        </div>
        {edits.length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/[.12] px-4 py-8 text-sm text-neutral-500 dark:border-white/[.14]">
            No clone-projects yet. The first run will land here as a 9:16 cut.
          </p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {edits.map((e) => {
              const active = e.id === selectedId;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(e.id);
                    setEvents([]);
                  }}
                  className={`w-[132px] shrink-0 text-left ${active ? "" : "opacity-80 hover:opacity-100"}`}
                >
                  <div
                    className={`relative aspect-[9/16] overflow-hidden rounded-xl border bg-neutral-900 ${
                      active
                        ? "border-teal-400 shadow-[0_0_0_1px_rgba(45,212,191,0.45)]"
                        : "border-black/[.1] dark:border-white/[.12]"
                    }`}
                  >
                    {e.hasPoster ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mediaUrl(e, "poster")} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center px-2 text-center text-[11px] text-white/50">
                        {STATUS_LABEL[e.status]}
                      </div>
                    )}
                    <span
                      className={`absolute left-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] ${statusTone(e.status)}`}
                    >
                      {STATUS_LABEL[e.status]}
                    </span>
                  </div>
                  <p className="mt-1.5 truncate font-serif text-[15px] italic leading-tight">{e.title}</p>
                  <p className="num text-[10px] text-neutral-500">{shortDate(e.updatedAt)}</p>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
