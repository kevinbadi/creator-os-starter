"use client";

import { useEffect, useRef, useState } from "react";
import type { CopySource } from "@/lib/copywriter/store";
import { skillForSource, skillLabel } from "@/lib/copywriter/skill";

type Props = { initial: CopySource[]; corpora?: CopySource[]; apifyReady: boolean; llmReady: boolean };

function corpusLabel(tag: string): { title: string; skill: string } {
  if (tag === "kevbuildsapps-yt-style") return { title: "@KevBuildsApps YouTube", skill: "copywriter-longform-kevin" };
  if (tag === "kevbuildsapps-style") return { title: "@kevbuildsapps Reels", skill: "copywriter-shortform-kevin" };
  if (tag.endsWith("-yt-style")) return { title: `@${tag.replace(/-yt-style$/, "")} YouTube`, skill: "long-form" };
  if (tag.endsWith("-style")) return { title: `@${tag.replace(/-style$/, "")} Reels`, skill: "short-form" };
  return { title: tag, skill: "" };
}

function urlLabel(url: string): string {
  return url
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
    .replace(/^https?:\/\/(www\.)?youtube\.com\/watch\?v=/, "yt:")
    .replace(/^https?:\/\/youtu\.be\//, "yt:");
}

const STATUS_LABEL: Record<CopySource["status"], string> = {
  queued: "Queued",
  transcribing: "Transcribing",
  analyzing: "Reading topic",
  done: "Done",
  failed: "Failed",
};

function statusTone(s: CopySource["status"]): string {
  if (s === "done") return "text-teal-600 dark:text-[#2dd4bf]";
  if (s === "failed") return "text-red-500";
  return "text-amber-600 dark:text-amber-400";
}

function fmtNum(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtDur(s: number | null): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
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

function engagement(s: CopySource): string | null {
  if (s.viewCount == null || s.viewCount <= 0) return null;
  const n = (s.likeCount ?? 0) + (s.commentCount ?? 0);
  return `${((n / s.viewCount) * 100).toFixed(1)}%`;
}

export function CopywriterDesk({ initial, corpora = [], apifyReady, llmReady }: Props) {
  const [text, setText] = useState("");
  const [sources, setSources] = useState<CopySource[]>(initial);
  const [runId, setRunId] = useState<string | null>(() => {
    const live = initial.find((s) => s.status === "transcribing" || s.status === "analyzing");
    return live?.runId ?? null;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [rejected, setRejected] = useState<string[]>([]);
  const [converting, setConverting] = useState<Set<string>>(() => new Set());
  const [convertError, setConvertError] = useState<Record<string, string>>({});
  const pollRef = useRef<number | null>(null);

  const merge = (incoming: CopySource[]) =>
    setSources((prev) => {
      const map = new Map(prev.map((s) => [s.id, s]));
      for (const s of incoming) map.set(s.id, s);
      return [...map.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    });

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/copywriter/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
        const json = (await res.json()) as { status: string; sources?: CopySource[]; error?: string };
        if (cancelled) return;
        if (json.sources) merge(json.sources);
        if (json.status === "done") {
          setRunId(null);
          return;
        }
      } catch {
        // transient; keep polling
      }
      if (!cancelled) pollRef.current = window.setTimeout(tick, 5000);
    };
    pollRef.current = window.setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [runId]);

  const submit = async () => {
    const urls = text
      .split(/[\s,]+/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (!urls.length) return;
    setSubmitting(true);
    setError("");
    setRejected([]);
    try {
      const res = await fetch("/api/copywriter/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const json = (await res.json()) as {
        runId?: string;
        sources?: CopySource[];
        rejected?: string[];
        error?: string;
      };
      if (!res.ok || !json.runId) {
        setError(json.error || `Request failed (${res.status})`);
        setRejected(json.rejected ?? []);
        return;
      }
      if (json.sources) merge(json.sources);
      setRejected(json.rejected ?? []);
      setRunId(json.runId);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    setSources((prev) => prev.filter((s) => s.id !== id));
    await fetch(`/api/copywriter/sources/${id}`, { method: "DELETE" }).catch(() => undefined);
  };

  const convert = async (id: string) => {
    setConvertError((prev) => {
      const n = { ...prev };
      delete n[id];
      return n;
    });
    setConverting((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/copywriter/sources/${id}/convert`, { method: "POST" });
      const json = (await res.json()) as { source?: CopySource; error?: string };
      if (!res.ok || !json.source) {
        setConvertError((prev) => ({ ...prev, [id]: json.error || `Convert failed (${res.status})` }));
        return;
      }
      merge([json.source]);
    } catch (e) {
      setConvertError((prev) => ({
        ...prev,
        [id]: e instanceof Error ? e.message : "Convert failed",
      }));
    } finally {
      setConverting((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  };

  const live = sources.filter((s) => s.status === "transcribing" || s.status === "analyzing").length;
  const done = sources.filter((s) => s.status === "done").length;

  return (
    <div className="stagger flex flex-col gap-4">
      <section className="card">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="card-title">Drop reels</h2>
          <p className="eyebrow">
            {apifyReady ? "apify ready" : "APIFY_TOKEN missing"}
            {" · "}
            {llmReady ? "topic model ready" : "OLLAMA_API_KEY missing"}
          </p>
        </div>
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder={"Paste Instagram reel links, one per line\nhttps://www.instagram.com/reel/…\nhttps://www.instagram.com/reel/…"}
            className="w-full resize-y rounded-md border border-black/[.12] bg-transparent px-3 py-2 font-mono text-[13px] leading-relaxed text-neutral-700 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none dark:border-white/[.19] dark:text-neutral-200"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={submitting || !text.trim() || !apifyReady}
              className="shrink-0 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {submitting ? "Starting…" : "Transcribe"}
            </button>
            <p className="text-[11px] text-neutral-500 dark:text-[#8e939d]">
              One Apify run per batch · about 1 to 2 min · ⌘↵ to submit
            </p>
            {runId ? (
              <span className="ml-auto inline-flex items-center gap-2 text-[12px] text-amber-600 dark:text-amber-400">
                <span className="live-dot" /> {live} in flight
              </span>
            ) : null}
          </div>
          {error ? <p className="text-sm text-red-500">{error}</p> : null}
          {rejected.length ? (
            <p className="text-[12px] text-neutral-500 dark:text-[#8e939d]">
              Skipped (not Instagram reel/post links): {rejected.join(", ")}
            </p>
          ) : null}
        </form>
      </section>

      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <h2 className="card-title">Feed</h2>
        <p className="eyebrow">
          {sources.length} {sources.length === 1 ? "post" : "posts"} · {done} read
        </p>
      </div>

      {sources.length === 0 ? (
        <section className="card">
          <p className="text-sm text-neutral-500 dark:text-[#8e939d]">
            Nothing yet. Paste reel links above and they land here as thesis, stats, and transcript.
          </p>
        </section>
      ) : (
        <ul className="flex flex-col gap-4">
          {sources.map((s) => (
            <FeedCard
              key={s.id}
              source={s}
              converting={converting.has(s.id)}
              convertError={convertError[s.id] || ""}
              llmReady={llmReady}
              onConvert={() => void convert(s.id)}
              onRemove={() => void remove(s.id)}
            />
          ))}
        </ul>
      )}

      {corpora.length ? <StyleCorpora corpora={corpora} /> : null}
    </div>
  );
}

function FeedCard({
  source: s,
  converting,
  convertError,
  llmReady,
  onConvert,
  onRemove,
}: {
  source: CopySource;
  converting: boolean;
  convertError: string;
  llmReady: boolean;
  onConvert: () => void;
  onRemove: () => void;
}) {
  const busy = s.status === "transcribing" || s.status === "analyzing";
  const skill = skillForSource(s);
  const er = engagement(s);
  const canConvert = s.status === "done" && Boolean(s.transcript) && llmReady && !converting;

  return (
    <li className="card">
      <div className="flex gap-4">
        {s.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.thumbnailUrl} alt="" className="h-28 w-20 shrink-0 rounded-md object-cover" />
        ) : (
          <div className="h-28 w-20 shrink-0 rounded-md bg-black/[.06] dark:bg-white/[.06]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={`text-[11px] font-medium uppercase tracking-wide ${statusTone(s.status)}`}>
              {busy ? <span className="live-dot mr-1.5 inline-block align-middle" /> : null}
              {STATUS_LABEL[s.status]}
            </span>
            {s.username ? (
              <span className="text-[12px] text-neutral-500 dark:text-[#8e939d]">@{s.username}</span>
            ) : null}
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="truncate font-mono text-[11px] text-neutral-500 hover:underline dark:text-[#8e939d]"
            >
              {urlLabel(s.url)}
            </a>
            <span className="ml-auto text-[11px] text-neutral-400">{shortDate(s.createdAt)}</span>
          </div>
          <h3 className="mt-1.5 font-serif text-[22px] italic leading-tight tracking-tight">
            {s.topic || (busy ? "Reading…" : s.status === "failed" ? "No transcript" : "Untitled")}
          </h3>
          {s.format ? (
            <p className="mt-1 text-[12px] text-neutral-500 dark:text-[#8e939d]">{s.format}</p>
          ) : null}
        </div>
      </div>

      {s.summary || s.keyPoints.length ? (
        <div className="mt-4">
          <p className="eyebrow">Thesis</p>
          {s.summary ? (
            <p className="mt-1.5 text-[15px] leading-relaxed text-neutral-800 dark:text-neutral-100">{s.summary}</p>
          ) : null}
          {s.hook ? (
            <p className="mt-2 text-[13px] italic leading-relaxed text-neutral-600 dark:text-[#b6bac2]">
              Hook: “{s.hook}”
            </p>
          ) : null}
          {s.keyPoints.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-200">
              {s.keyPoints.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4">
        <p className="eyebrow">Performance</p>
        <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label="Length" value={fmtDur(s.durationSec)} />
          <Stat label="Views" value={fmtNum(s.viewCount)} />
          <Stat label="Likes" value={fmtNum(s.likeCount)} />
          <Stat label="Comments" value={fmtNum(s.commentCount)} />
          <Stat label="Engage" value={er ?? "—"} />
        </dl>
      </div>

      <div className="mt-4">
        <p className="eyebrow">Transcript</p>
        {s.transcript ? (
          <p className="mt-1.5 max-h-[28rem] overflow-y-auto whitespace-pre-wrap text-[14px] leading-relaxed text-neutral-700 dark:text-neutral-200">
            {s.transcript}
          </p>
        ) : (
          <p className="mt-1.5 text-sm text-neutral-500 dark:text-[#8e939d]">
            {busy ? "Waiting on Apify…" : s.error || "No transcript yet."}
          </p>
        )}
        {s.caption ? (
          <>
            <p className="eyebrow mt-3">Caption</p>
            <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-600 dark:text-[#b6bac2]">
              {s.caption}
            </p>
          </>
        ) : null}
      </div>

      {s.error ? <p className="mt-3 text-[12px] text-red-500">{s.error}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!canConvert}
          onClick={onConvert}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {converting ? "Writing in your tone…" : "Convert to your own tone"}
        </button>
        <p className="text-[11px] text-neutral-500 dark:text-[#8e939d]">
          {skillLabel(skill)} skill
          {skill === "shortform" ? " · 40 to 45s" : " · 10 to 12 min"}
        </p>
        {!busy ? (
          <button type="button" onClick={onRemove} className="ml-auto text-[12px] text-neutral-400 hover:text-red-500">
            Remove
          </button>
        ) : null}
      </div>
      {convertError ? <p className="mt-2 text-sm text-red-500">{convertError}</p> : null}

      {s.rewrite ? (
        <div className="mt-4 rounded-md border border-black/[.08] bg-black/[.03] px-3 py-3 dark:border-white/[.12] dark:bg-white/[.04]">
          <div className="flex items-baseline justify-between gap-3">
            <p className="eyebrow">Your tone</p>
            <p className="text-[11px] text-neutral-400">
              {s.rewriteSkill.replace("copywriter-", "").replace("-kevin", "")}
              {s.rewrittenAt ? ` · ${shortDate(s.rewrittenAt)}` : ""}
            </p>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-neutral-800 dark:text-neutral-100">
            {s.rewrite}
          </p>
        </div>
      ) : null}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-black/[.08] px-2.5 py-2 dark:border-white/[.12]">
      <dt className="eyebrow">{label}</dt>
      <dd className="num mt-1 text-[16px] font-medium tracking-tight">{value}</dd>
    </div>
  );
}

function StyleCorpora({ corpora }: { corpora: CopySource[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const groups = new Map<string, CopySource[]>();
  for (const s of corpora) {
    const k = s.tag || "untagged";
    const list = groups.get(k) ?? [];
    list.push(s);
    groups.set(k, list);
  }
  const toggle = (id: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <details className="card">
      <summary className="cursor-pointer list-none">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="card-title">Style corpora</h2>
          <p className="eyebrow">
            {corpora.length} videos · {groups.size === 1 ? "1 skill" : `${groups.size} skills`}
          </p>
        </div>
        <p className="mt-1 text-[12px] text-neutral-500 dark:text-[#8e939d]">
          Kevin&apos;s own posts that trained the skills. Not part of the conversion feed.
        </p>
      </summary>
      <div className="mt-3 flex flex-col gap-5">
        {[...groups.entries()].map(([tag, rows]) => {
          const meta = corpusLabel(tag);
          return (
            <div key={tag}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[13px] font-medium">{meta.title}</p>
                <p className="eyebrow">
                  {meta.skill ? `${meta.skill} · ` : ""}
                  {rows.length}
                </p>
              </div>
              <ul className="mt-2 flex flex-col divide-y divide-black/[.08] dark:divide-white/[.1]">
                {rows.map((s) => {
                  const isOpen = open.has(s.id);
                  const when = s.postedAt || s.createdAt;
                  return (
                    <li key={s.id} className="py-2.5 first:pt-0 last:pb-0">
                      <div className="flex gap-3">
                        {s.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.thumbnailUrl} alt="" className="h-16 w-11 shrink-0 rounded-md object-cover" />
                        ) : (
                          <div className="h-16 w-11 shrink-0 rounded-md bg-black/[.06] dark:bg-white/[.06]" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-medium leading-snug">{s.title || s.topic || "Untitled"}</p>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-500 dark:text-[#8e939d]">
                            {s.durationSec != null ? <span>{fmtDur(s.durationSec)}</span> : null}
                            {s.viewCount != null ? <span>{fmtNum(s.viewCount)} views</span> : null}
                            {when ? <span>{shortDate(when)}</span> : null}
                            <a href={s.url} target="_blank" rel="noreferrer" className="font-mono hover:underline">
                              {urlLabel(s.url)}
                            </a>
                          </div>
                          {s.transcript ? (
                            <button
                              type="button"
                              onClick={() => toggle(s.id)}
                              className="mt-1.5 text-[12px] text-neutral-600 hover:underline dark:text-[#b6bac2]"
                            >
                              {isOpen ? "Hide transcript" : "Show transcript"}
                            </button>
                          ) : null}
                          {isOpen ? (
                            <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-200">
                              {s.transcript}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </details>
  );
}
