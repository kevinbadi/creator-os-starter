"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { platformLabel } from "@/lib/format";
import { PlatformDot } from "@/components/PlatformBadge";
import {
  agentPostTargetName,
  videoPlatformsForTargets,
  type AgentPost,
  type AgentPostTarget,
} from "@/lib/agent-posts/types";
import { ScheduledPostEditor } from "@/components/ScheduledPostEditor";
import { SlotBoardStrip } from "@/components/SlotBoard";
import type { SlotBoard } from "@/lib/agent-posts/slots";

const PROFILE_STORAGE_KEY = "mos_agent_posts_profiles";
const TITLE_MAX = 100;
const CAPTION_MAX = 2200;

function putFileWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
  extraHeaders?: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    for (const [k, v] of Object.entries(extraHeaders ?? {})) {
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText || "");
        return;
      }
      reject(new Error(`Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Upload failed."));
    xhr.send(file);
  });
}

async function uploadAgentVideo(
  file: File,
  onProgress: (pct: number) => void,
): Promise<string> {
  const slotRes = await fetch("/api/upload/slot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type }),
  });
  const slot = (await slotRes.json()) as {
    uploadUrl?: string;
    publicUrl?: string;
    contentType?: string;
    error?: string;
  };
  if (slotRes.ok && slot.uploadUrl && slot.publicUrl) {
    try {
      await putFileWithProgress(
        slot.uploadUrl,
        file,
        slot.contentType || file.type || "video/mp4",
        onProgress,
      );
      return slot.publicUrl;
    } catch {
      /* R2 CORS or a dropped connection — stream through our API instead. */
    }
  }

  const body = await putFileWithProgress(
    "/api/upload",
    file,
    file.type || "application/octet-stream",
    onProgress,
    { "x-filename": encodeURIComponent(file.name) },
  );
  const data = JSON.parse(body || "{}") as { url?: string; error?: string };
  if (!data.url) throw new Error(data.error || slot.error || "Upload failed");
  return data.url;
}

/** Rotating journey copy while a post is queued/working. */
const JOURNEY_SAYINGS = [
  "Getting transcript",
  "Finding Call to Action",
  "Creating cover photo",
  "Checking next available slot",
  "Writing captions for all socials",
] as const;

const STEP_LABEL: Record<string, string> = {
  queued: "In queue",
  starting: "Starting",
  download: "Fetching video",
  caption: "Getting transcript",
  copy: "Writing captions for all socials",
  thumbnail: "Creating cover photo",
  slot: "Checking next available slot",
  publish: "Scheduling on socials",
  done: "Scheduled",
  published: "Published",
  failed: "Failed",
};

function journeyIndexForStep(step: string | null): number {
  const key = (step || "queued").toLowerCase();
  if (key === "download" || key === "caption" || key === "starting") return 0;
  if (key === "copy") return 1;
  if (key === "thumbnail") return 2;
  if (key === "slot") return 3;
  if (key === "publish") return 4;
  return 0;
}

function AgentPostLoader() {
  return (
    <div className="agent-loader" aria-hidden>
      <span className="agent-loader-core" />
    </div>
  );
}

function ProcessingJourney({ step }: { step: string | null }) {
  const [i, setI] = useState(() => journeyIndexForStep(step));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setI(journeyIndexForStep(step));
    setTick((t) => t + 1);
  }, [step]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setI((prev) => (prev + 1) % JOURNEY_SAYINGS.length);
      setTick((t) => t + 1);
    }, 2600);
    return () => window.clearInterval(id);
  }, []);

  const saying = JOURNEY_SAYINGS[i] || JOURNEY_SAYINGS[0];
  const real = STEP_LABEL[step || "queued"];

  return (
    <div className="min-w-0">
      <p
        key={`${tick}-${saying}`}
        className="agent-say text-sm font-medium text-amber-800 dark:text-amber-200"
      >
        {saying}
        <span className="ml-1 inline-block animate-pulse">…</span>
      </p>
      {real && real !== saying ? (
        <p className="mt-0.5 truncate text-[11px] text-neutral-400 dark:text-[#8e939d]">
          Pipeline · {real}
        </p>
      ) : (
        <p className="mt-0.5 text-[11px] text-neutral-400 dark:text-[#8e939d]">
          Agent is working this cut
        </p>
      )}
    </div>
  );
}

function slotLabel(iso: string | null): string {
  if (!iso) return "next open slot";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d) + " ET"
  );
}

function statusTone(status: AgentPost["status"]): string {
  if (status === "published") return "text-emerald-700 dark:text-emerald-300";
  if (status === "scheduled") return "text-teal-800 dark:text-[#8ff2e2]";
  if (status === "failed") return "text-red-700 dark:text-red-300";
  if (status === "working") return "text-amber-800 dark:text-amber-200";
  return "text-neutral-500";
}

function resourceLinks(raw: string | null): string[] {
  return String(raw || "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

function dmStatusLabel(status: string | null): string | null {
  if (status === "wired") return "live";
  if (status === "pending") return "attaches when the post goes live";
  if (status === "failed") return "failed to attach";
  if (status === "skipped") return "skipped";
  return null;
}

function targetHint(target: AgentPostTarget): string {
  const handles = target.handles.join(" · ");
  const plats = target.platforms.map(platformLabel).filter(Boolean).join(", ");
  if (handles && plats) return `${handles} · ${plats}`;
  return handles || plats || "Connected socials";
}

export function AgentPostsDesk({
  initialJobs,
  initialTargets,
  initialBoards = [],
  initialMonth,
}: {
  initialJobs: AgentPost[];
  initialTargets: AgentPostTarget[];
  initialBoards?: SlotBoard[];
  initialMonth?: string;
}) {
  const [jobs, setJobs] = useState<AgentPost[]>(initialJobs);
  const [boards, setBoards] = useState<SlotBoard[]>(initialBoards);
  const [month, setMonth] = useState<string>(
    () => initialMonth || new Date().toISOString().slice(0, 7),
  );
  const [boardLoading, setBoardLoading] = useState(false);
  const monthRef = useRef(month);
  useEffect(() => {
    monthRef.current = month;
  }, [month]);
  const [targets, setTargets] = useState<AgentPostTarget[]>(initialTargets);
  const [profileIds, setProfileIds] = useState<string[]>(() =>
    initialTargets[0]?.profileId ? [initialTargets[0].profileId] : [],
  );
  const availablePlatforms = useMemo(
    () => videoPlatformsForTargets(targets, profileIds),
    [targets, profileIds],
  );
  const [platforms, setPlatforms] = useState<string[]>(() =>
    videoPlatformsForTargets(
      initialTargets,
      initialTargets[0]?.profileId ? [initialTargets[0].profileId] : undefined,
    ),
  );
  const prevAvailableRef = useRef(availablePlatforms);
  const [videoUrl, setVideoUrl] = useState("");
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [resourceUrl, setResourceUrl] = useState("");
  const [dmNote, setDmNote] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = jobs.some((j) => j.status === "queued" || j.status === "working");
  const cutSheet = useMemo(() => {
    const rank = (s: AgentPost["status"]) =>
      s === "queued" || s === "working" ? 0 : s === "scheduled" ? 1 : 2;
    return [...jobs].sort((a, b) => {
      const dr = rank(a.status) - rank(b.status);
      if (dr !== 0) return dr;
      if (a.status === "scheduled" && b.status === "scheduled") {
        return (a.scheduledFor || "").localeCompare(b.scheduledFor || "");
      }
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
  }, [jobs]);

  // Job list = cheap DB read, polled often. Board = Zernio walk, polled slowly
  // and after every action, so the board never lags an upload / reschedule but
  // the 2.5s busy poll stays in the low milliseconds (Kevin 2026-09-18).
  const refreshJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-posts?boards=0", { cache: "no-store" });
      const data = (await res.json()) as { jobs?: AgentPost[] };
      if (Array.isArray(data.jobs)) setJobs(data.jobs);
    } catch {
      /* keep current list */
    }
  }, []);

  const refresh = useCallback(async () => {
    const wanted = monthRef.current;
    try {
      const res = await fetch(`/api/agent-posts?month=${encodeURIComponent(wanted)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        jobs?: AgentPost[];
        targets?: AgentPostTarget[];
        boards?: SlotBoard[];
        month?: string;
      };
      if (Array.isArray(data.jobs)) setJobs(data.jobs);
      if (Array.isArray(data.targets) && data.targets.length) setTargets(data.targets);
      if (Array.isArray(data.boards) && (data.month ?? wanted) === monthRef.current) {
        const fresh = data.boards;
        setBoards((prev) =>
          fresh.map((b) => {
            if (!b.degraded) return b;
            // Zernio hiccup: keep the last good board for this profile/month.
            const last = prev.find((o) => o.profileId === b.profileId && o.month === b.month);
            return last && !last.degraded ? { ...last, degraded: true } : b;
          }),
        );
      }
    } catch {
      /* keep current list */
    } finally {
      setBoardLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Month nav: refetch the board for the chosen month.
  useEffect(() => {
    void refresh();
  }, [month, refresh]);
  const changeMonth = useCallback((next: string) => {
    setBoardLoading(true);
    setMonth(next);
  }, []);

  // Idle heartbeat so reschedules made outside this tab (scripts, Zernio) land too.
  useEffect(() => {
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "hidden") return;
      void refresh();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(refreshJobs, 2500);
    return () => clearInterval(t);
  }, [busy, refreshJobs]);

  // When a job finishes (busy -> idle) the board changed: pull it once.
  const wasBusyRef = useRef(busy);
  useEffect(() => {
    if (wasBusyRef.current && !busy) void refresh();
    wasBusyRef.current = busy;
  }, [busy, refresh]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      const saved = (Array.isArray(parsed) ? parsed : [parsed])
        .map((id) => String(id ?? "").trim())
        .filter((id) => targets.some((t) => t.profileId === id));
      if (saved.length) setProfileIds(saved);
    } catch {
      /* ignore */
    }
  }, [targets]);

  useEffect(() => {
    setPlatforms((prev) => {
      const previous = prevAvailableRef.current;
      const newly = availablePlatforms.filter((p) => !previous.includes(p));
      const kept = prev.filter((p) => availablePlatforms.includes(p));
      prevAvailableRef.current = availablePlatforms;
      const next = [...new Set([...kept, ...newly])];
      return next.length ? next : availablePlatforms;
    });
  }, [availablePlatforms]);

  function toggleProfile(id: string) {
    setProfileIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((p) => p !== id)
        : [...prev, id];
      try {
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function togglePlatform(id: string) {
    setPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setFileName(file.name);
    setUploading(true);
    setUploadPct(0);
    try {
      const url = await uploadAgentVideo(file, setUploadPct);
      setVideoUrl(url);
    } catch (err) {
      setFileName(null);
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setUploadPct(null);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!videoUrl.trim()) {
      setError("Add a video file or paste a video URL.");
      return;
    }
    if (profileIds.length === 0) {
      setError("Pick which socials to post to.");
      return;
    }
    if (platforms.length === 0) {
      setError("Pick at least one platform.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/agent-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: videoUrl.trim(),
          title: title.trim(),
          caption: caption.trim(),
          resourceUrl: resourceUrl.trim(),
          dmNote: dmNote.trim(),
          profileIds,
          platforms,
        }),
      });
      const data = (await res.json()) as {
        job?: AgentPost;
        jobs?: AgentPost[];
        error?: string;
      };
      const created = data.jobs?.length ? data.jobs : data.job ? [data.job] : [];
      if (!res.ok || created.length === 0) {
        throw new Error(data.error || "Queue failed");
      }
      setJobs((prev) => {
        const keep = prev.filter((j) => !created.some((c) => c.id === j.id));
        return [...created, ...keep];
      });
      setResourceUrl("");
      setDmNote("");
      setTitle("");
      setCaption("");
      setVideoUrl("");
      setFileName(null);
      setPlatforms(availablePlatforms);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Queue failed");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    !uploading &&
    !submitting &&
    profileIds.length > 0 &&
    platforms.length > 0 &&
    Boolean(videoUrl.trim());

  return (
    <div className="mt-6 space-y-6">
      <form
        onSubmit={onSubmit}
        className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.14] dark:bg-[var(--surface-1)]"
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
          Drop a finished video
        </p>
        {targets.some((t) => t.nextSlot) ? (
          <p className="mt-2 text-sm text-neutral-500">
            Next open slot{" "}
            {targets.map((t, i) => (
              <span key={t.profileId}>
                {i > 0 ? " · " : ""}
                <span className="font-medium text-neutral-700 dark:text-neutral-200">
                  {t.name}
                </span>{" "}
                {t.nextSlot ? slotLabel(t.nextSlot) : "tbd"}
              </span>
            ))}
          </p>
        ) : null}
        {targets.length > 0 ? (
          <fieldset className="mt-4">
            <legend className="text-sm font-medium">
              Post to
              <span className="ml-2 font-normal text-neutral-500">
                one or both
              </span>
            </legend>
            <div
              className={`mt-2 grid gap-2 ${
                targets.length > 1 ? "sm:grid-cols-2" : ""
              }`}
            >
              {targets.map((target) => {
                const selected = profileIds.includes(target.profileId);
                return (
                  <button
                    key={target.profileId}
                    type="button"
                    onClick={() => toggleProfile(target.profileId)}
                    aria-pressed={selected}
                    className={`rounded-xl border px-3 py-3 text-left transition ${
                      selected
                        ? "border-teal-600 bg-teal-50/80 dark:border-teal-400/50 dark:bg-teal-950/30"
                        : "border-black/[.12] bg-white hover:border-neutral-400 dark:border-white/[.16] dark:bg-[var(--surface-2)] dark:hover:border-white/[.28]"
                    }`}
                  >
                    <span className="block text-sm font-medium">{target.name}</span>
                    <span className="mt-0.5 block text-xs text-neutral-500">
                      {targetHint(target)}
                    </span>
                    <span className="mt-1.5 block text-[11px] text-neutral-400">
                      Next slot{" "}
                      <span className="font-medium text-neutral-600 dark:text-neutral-300">
                        {target.nextSlot
                          ? slotLabel(target.nextSlot)
                          : "open slot"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}
        {availablePlatforms.length > 0 ? (
          <fieldset className="mt-4">
            <legend className="text-sm font-medium">
              Platforms
              <span className="ml-2 font-normal text-neutral-500">
                all on — tap any you do not want this cut on
              </span>
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {availablePlatforms.map((plat) => {
                const selected = platforms.includes(plat);
                return (
                  <button
                    key={plat}
                    type="button"
                    onClick={() => togglePlatform(plat)}
                    aria-pressed={selected}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
                      selected
                        ? "border-teal-600 bg-teal-50/80 font-medium text-teal-950 dark:border-teal-400/50 dark:bg-teal-950/40 dark:text-teal-100"
                        : "border-black/[.12] bg-white text-neutral-500 hover:border-neutral-400 dark:border-white/[.16] dark:bg-[var(--surface-2)] dark:text-[#8e939d] dark:hover:border-white/[.28]"
                    }`}
                  >
                    <PlatformDot platform={plat} size={14} />
                    {platformLabel(plat)}
                  </button>
                );
              })}
            </div>
            {platforms.length > 0 &&
            platforms.length < availablePlatforms.length ? (
              <button
                type="button"
                onClick={() => setPlatforms(availablePlatforms)}
                className="mt-2 text-xs font-medium text-teal-800 underline decoration-teal-700/30 underline-offset-2 hover:decoration-teal-700 dark:text-[#8ff2e2]"
              >
                All platforms
              </button>
            ) : null}
          </fieldset>
        ) : null}
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div>
            <label
              htmlFor="agent-video-file"
              className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-black/[.18] bg-black/[.015] px-4 py-10 text-center transition hover:border-teal-500/50 hover:bg-teal-500/[.04] dark:border-white/[.18] dark:bg-white/[.02]"
            >
              <span className="text-sm font-medium">
                {uploading
                  ? uploadPct != null
                    ? `Uploading ${uploadPct}%`
                    : "Uploading…"
                  : fileName
                    ? fileName
                    : "Click to add the edited mp4"}
              </span>
              <span className="text-xs text-neutral-500">
                Cover, keyword, and the next open slot land on the cut sheet.
                Kev AI is +1h vs Kev Builds Apps; Megan uses 2am / 2 / 5 / 8pm
                ET. Platforms default to all connected socials — turn any off
                for this cut. Add a caption if you already know the copy. Add
                a title for YouTube. Add a DM link only if you want
                comment-to-DM.
              </span>
            </label>
            <input
              id="agent-video-file"
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/*"
              className="sr-only"
              aria-hidden
              tabIndex={-1}
              onChange={onPickFile}
            />
            <label htmlFor="agent-video-url" className="mt-4 block text-sm font-medium">
              Video URL
            </label>
            <input
              id="agent-video-url"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://…"
              className="mt-1 h-10 w-full rounded-md border border-black/[.12] bg-white px-3 text-sm outline-none ring-neutral-900/10 transition focus:border-neutral-400 focus:ring-2 dark:border-white/[.19] dark:bg-[var(--surface-2)]"
            />
          </div>
          <div>
            <label htmlFor="agent-title" className="block text-sm font-medium">
              Title
              <span className="ml-2 font-normal text-neutral-500">
                optional — YouTube and other title fields
              </span>
            </label>
            <input
              id="agent-title"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
              maxLength={TITLE_MAX}
              placeholder="Title for YouTube Shorts"
              className="mt-1 h-10 w-full rounded-md border border-black/[.12] bg-white px-3 text-sm outline-none ring-neutral-900/10 transition focus:border-neutral-400 focus:ring-2 dark:border-white/[.19] dark:bg-[var(--surface-2)]"
            />
            <div className="mt-1 flex items-center justify-between text-xs text-neutral-500">
              <span>
                Used on platforms that take a title. Leave blank and the agent
                writes one.
              </span>
              <span>
                {title.length}/{TITLE_MAX}
              </span>
            </div>
            <label htmlFor="agent-caption" className="mt-4 block text-sm font-medium">
              Caption
              <span className="ml-2 font-normal text-neutral-500">
                optional — Instagram, TikTok, and the other captions
              </span>
            </label>
            <textarea
              id="agent-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, CAPTION_MAX))}
              rows={5}
              maxLength={CAPTION_MAX}
              placeholder="Paste the caption if the video has no usable transcript — or if you already wrote it."
              className="mt-1 w-full resize-y rounded-md border border-black/[.12] bg-white px-3 py-2 text-sm outline-none ring-neutral-900/10 transition focus:border-neutral-400 focus:ring-2 dark:border-white/[.19] dark:bg-[var(--surface-2)]"
            />
            <div className="mt-1 flex items-center justify-between text-xs text-neutral-500">
              <span>
                Leave blank and the agent drafts from the video. Fill this in
                when there is no speech, or when you want this exact copy.
              </span>
              <span>
                {caption.length}/{CAPTION_MAX}
              </span>
            </div>
            <label htmlFor="agent-resource-url" className="mt-4 block text-sm font-medium">
              DM resource link
              <span className="ml-2 font-normal text-neutral-500">optional</span>
            </label>
            <input
              id="agent-resource-url"
              value={resourceUrl}
              onChange={(e) => setResourceUrl(e.target.value)}
              placeholder="https://… or /go/slug — leave blank if none"
              className="mt-1 h-10 w-full rounded-md border border-black/[.12] bg-white px-3 text-sm outline-none ring-neutral-900/10 transition focus:border-neutral-400 focus:ring-2 dark:border-white/[.19] dark:bg-[var(--surface-2)]"
            />
            <p className="mt-1 text-xs text-neutral-500">
              Leave blank if this post has no comment-to-DM. When set, the
              public caption stays a comment CTA and this link only goes out in
              the DM.
            </p>
            <label htmlFor="agent-dm-note" className="mt-4 block text-sm font-medium">
              DM message
              <span className="ml-2 font-normal text-neutral-500">
                optional — your personal touch
              </span>
            </label>
            <textarea
              id="agent-dm-note"
              value={dmNote}
              onChange={(e) => setDmNote(e.target.value)}
              rows={3}
              maxLength={800}
              placeholder={'e.g. "yo! saw you commented — this setup changed how I post. here you go:"'}
              className="mt-1 w-full resize-y rounded-md border border-black/[.12] bg-white px-3 py-2 text-sm outline-none ring-neutral-900/10 transition focus:border-neutral-400 focus:ring-2 dark:border-white/[.19] dark:bg-[var(--surface-2)]"
            />
            <p className="mt-1 text-xs text-neutral-500">
              What the agent opens the DM with. Leave blank for the default
              copy. The resource link and follow ask are appended
              automatically.
            </p>
            {error ? (
              <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </p>
            ) : null}
            <div className="mt-5 flex items-center justify-end gap-3">
              {uploading ? (
                <span className="text-xs text-neutral-500">
                  {uploadPct != null
                    ? `Uploading video… ${uploadPct}%`
                    : "Uploading video…"}
                </span>
              ) : null}
              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex h-10 items-center justify-center rounded-md bg-neutral-900 px-5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                {submitting ? "Queuing…" : "Do it for me"}
              </button>
            </div>
          </div>
        </div>
      </form>

      <SlotBoardStrip
        boards={boards}
        month={month}
        onMonth={changeMonth}
        loading={boardLoading}
      />

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl italic tracking-tight">Cut sheet</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Cover, title, caption, keyword, comment-to-DM, and the slot for
              every Agent Post. The Pipeline Slots strip above shows what is
              booked; times are ET.
            </p>
          </div>
        </div>
        {jobs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-black/[.10] px-4 py-16 text-center text-sm text-neutral-500 dark:border-white/[.12]">
            Nothing in the engine yet. Drop a video and the cut sheet fills in
            as the skill runs.
          </div>
        ) : (
          <ul className="space-y-4">
            {cutSheet.map((job) => (
              <li key={job.id} id={`agent-post-${job.id}`} className="scroll-mt-24">
                <JobCutSheet
                  job={job}
                  targetName={
                    targets.find((t) => t.profileId === job.profileId)?.name ??
                    agentPostTargetName(job.profileId)
                  }
                  onUpdated={(next) => {
                    setJobs((prev) =>
                      prev.map((j) => (j.id === next.id ? next : j)),
                    );
                    void refresh();
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}



function PlatformPicks({ platforms }: { platforms: string[] | null }) {
  if (!platforms?.length) {
    return (
      <p className="mt-1.5 text-[11px] text-neutral-400 dark:text-[#8e939d]">
        All connected platforms
      </p>
    );
  }
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-400 dark:text-[#8e939d]">
      {platforms.map((p) => (
        <span key={p} className="inline-flex items-center gap-1">
          <PlatformDot platform={p} size={12} />
          {platformLabel(p)}
        </span>
      ))}
    </p>
  );
}

function JobCutSheet({
  job,
  targetName,
  onUpdated,
}: {
  job: AgentPost;
  targetName: string;
  onUpdated?: (job: AgentPost) => void;
}) {
  const resources = resourceLinks(job.resourceUrl);
  const dmHint = dmStatusLabel(job.commentDmStatus);
  const working = job.status === "queued" || job.status === "working";

  return (
    <article
      className={`overflow-hidden rounded-2xl border border-black/[.08] bg-white dark:border-white/[.14] dark:bg-[var(--surface-1)] ${
        working ? "agent-post-working" : ""
      }`}
    >
      <div className="flex flex-col gap-5 p-4 sm:flex-row sm:items-start">
        <div className="shrink-0">
          {job.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={job.thumbnailUrl}
              alt="9:16 cover"
              className="h-[320px] w-[180px] rounded-xl border border-black/[.08] object-cover dark:border-white/[.12]"
            />
          ) : (
            <div className="relative flex h-[320px] w-[180px] flex-col items-center justify-center gap-4 overflow-hidden rounded-xl border border-dashed border-black/[.12] bg-black/[.03] px-3 text-center dark:border-white/[.14] dark:bg-white/[.04]">
              {working ? (
                <>
                  <div
                    className="pointer-events-none absolute inset-0 opacity-70"
                    style={{
                      background:
                        "radial-gradient(120px 160px at 50% 42%, rgba(45,212,191,0.16), transparent 70%)",
                    }}
                  />
                  <AgentPostLoader />
                  <div className="relative px-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-400">
                      9:16 cover
                    </span>
                    <p className="mt-2 text-[11px] leading-snug text-neutral-500 dark:text-[#b6bac2]">
                      Building the cover while the rest of the pipeline runs
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-400">
                    9:16 cover
                  </span>
                  <span className="mt-2 text-xs text-neutral-500">Cover did not land</span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-4">
          <header className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {working ? (
                <div className="flex items-start gap-3">
                  <span className="mt-1.5 live-dot size-2 shrink-0 rounded-full bg-[#2dd4bf]" />
                  <ProcessingJourney step={job.step} />
                </div>
              ) : (
                <p className={`text-xs font-medium ${statusTone(job.status)}`}>
                  {STEP_LABEL[job.step || job.status] || job.step || job.status}
                  <span className="ml-2 font-normal text-neutral-400">
                    · {targetName}
                  </span>
                </p>
              )}
              <p className="mt-2 font-serif text-[22px] italic leading-none tracking-tight">
                {job.scheduledFor
                  ? slotLabel(job.scheduledFor)
                  : working
                    ? "Slot pending"
                    : "No slot yet"}
              </p>
              {working ? (
                <p className="mt-1.5 text-[11px] text-neutral-400 dark:text-[#8e939d]">
                  {targetName}
                </p>
              ) : null}
              <PlatformPicks platforms={job.platforms} />
            </div>
            {job.keyword ? (
              <span className="rounded-full bg-teal-100 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-teal-900 dark:bg-teal-950/60 dark:text-teal-200">
                {job.keyword}
              </span>
            ) : resources.length > 0 && working ? (
              <span className="rounded-full bg-black/[.04] px-2.5 py-1 text-[11px] text-neutral-400 dark:bg-white/[.06]">
                Keyword pending
              </span>
            ) : null}
          </header>

          <section>
            <h3 className="text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-400">
              Title
            </h3>
            {job.youtubeTitle ? (
              <p className="mt-1 text-sm font-medium leading-snug text-neutral-800 dark:text-neutral-200">
                {job.youtubeTitle}
              </p>
            ) : (
              <p className="mt-1 text-sm text-neutral-400">
                {working ? "Drafting the title…" : "No title"}
              </p>
            )}
          </section>

          <section>
            <h3 className="text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-400">
              Caption
            </h3>
            {job.caption ? (
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
                {job.caption}
              </pre>
            ) : (
              <p className="mt-1 text-sm text-neutral-400">
                {working ? "Drafting the caption from the video…" : "No caption"}
              </p>
            )}
          </section>

          <section className="rounded-xl border border-black/[.08] bg-black/[.02] px-3 py-3 dark:border-white/[.12] dark:bg-white/[.04]">
            <h3 className="text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-400">
              Comment to DM
            </h3>
            {resources.length === 0 ? (
              <p className="mt-1.5 text-sm text-neutral-500">
                No DM resource — this post goes out without comment-to-DM.
              </p>
            ) : (
              <>
                <p className="mt-1.5 text-sm text-neutral-800 dark:text-neutral-200">
                  Comment{" "}
                  <span className="rounded bg-teal-100 px-1.5 py-0.5 font-semibold text-teal-900 dark:bg-teal-950/60 dark:text-teal-200">
                    {job.keyword || "—"}
                  </span>{" "}
                  → DM
                  {dmHint ? (
                    <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                      {dmHint}
                    </span>
                  ) : null}
                </p>
                {job.commentReply ? (
                  <p className="mt-2 text-xs text-neutral-500">
                    Public reply: {job.commentReply}
                  </p>
                ) : null}
                {job.dmText ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
                    {job.dmText}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-neutral-400">
                    {working ? "DM copy pending…" : "No DM copy"}
                  </p>
                )}
                {resources.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {resources.map((url) => (
                      <li key={url}>
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="break-all text-xs font-medium text-teal-800 underline decoration-teal-700/30 underline-offset-2 hover:decoration-teal-700 dark:text-[#8ff2e2]"
                        >
                          {url}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </section>

          {job.error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              {job.error}
            </p>
          ) : null}

          {job.status === "scheduled" && job.zernioPostId ? (
            <ScheduledPostEditor
              showDm
              post={{
                zernioPostId: job.zernioPostId,
                agentPostId: job.id,
                title: job.youtubeTitle ?? "",
                caption: job.caption ?? "",
                scheduledFor: job.scheduledFor,
                keyword: job.keyword,
                dmText: job.dmText,
                commentReply: job.commentReply,
                resourceUrl: job.resourceUrl,
                thumbnailUrl: job.thumbnailUrl,
              }}
              onSaved={(saved) => {
                if (saved.job) onUpdated?.(saved.job);
              }}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}
