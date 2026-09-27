"use client";

import { useEffect, useState } from "react";

type Format = "shortform" | "longform";

type Result = {
  format: Format;
  skillDir: string;
  research: string;
  script: string;
  sources: string[];
};

type HistoryItem = {
  id: string;
  at: string;
  topic: string;
  format: Format;
  script: string;
  research: string;
  sources: string[];
};

const HISTORY_KEY = "mos_script_writer_history_v1";

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryItem[];
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 12)));
  } catch {
    /* ignore quota */
  }
}

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
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

export function ScriptWriterDesk({ llmReady }: { llmReady: boolean }) {
  const [topic, setTopic] = useState("");
  const [angle, setAngle] = useState("");
  const [data, setData] = useState("");
  const [format, setFormat] = useState<Format>("shortform");
  const [ctaWord, setCtaWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [copied, setCopied] = useState<"script" | "research" | "">("");
  const [showResearch, setShowResearch] = useState(true);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const submit = async () => {
    if (!topic.trim() || busy) return;
    setBusy(true);
    setError("");
    setPhase("Researching + writing…");
    setResult(null);
    try {
      const res = await fetch("/api/script-writer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          angle: angle.trim() || undefined,
          data: data.trim() || undefined,
          format,
          ctaWord: format === "shortform" ? ctaWord.trim() || undefined : undefined,
        }),
      });
      const json = (await res.json()) as Result & { error?: string };
      if (!res.ok) throw new Error(json.error || "Script writer failed");
      setResult(json);
      setShowResearch(true);
      const item: HistoryItem = {
        id: `${Date.now()}`,
        at: new Date().toISOString(),
        topic: topic.trim(),
        format: json.format,
        script: json.script,
        research: json.research,
        sources: json.sources || [],
      };
      const next = [item, ...history.filter((h) => h.topic !== item.topic || h.format !== item.format)].slice(0, 12);
      setHistory(next);
      saveHistory(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Script writer failed");
    } finally {
      setBusy(false);
      setPhase("");
    }
  };

  const copy = async (kind: "script" | "research", text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    window.setTimeout(() => setCopied(""), 1600);
  };

  return (
    <div className="stagger flex flex-col gap-4">
      <section className="card">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="card-title">Brief</h2>
          <p className="eyebrow">{llmReady ? "ollama ready" : "OLLAMA_API_KEY missing"}</p>
        </div>

        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:text-[#8e939d]">
              Topic
            </span>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Claude Fable 5.1 system prompt leak + running it on Qwen via Ollama"
              className="w-full rounded-md border border-black/[.12] bg-transparent px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none dark:border-white/[.19] dark:text-neutral-100"
              disabled={busy}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:text-[#8e939d]">
              Angle <span className="normal-case tracking-normal opacity-70">(optional)</span>
            </span>
            <input
              value={angle}
              onChange={(e) => setAngle(e.target.value)}
              placeholder="e.g. open-source models can steal frontier vibes if you give them the harness"
              className="w-full rounded-md border border-black/[.12] bg-transparent px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none dark:border-white/[.19] dark:text-neutral-100"
              disabled={busy}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:text-[#8e939d]">
              Notes / data / links
            </span>
            <textarea
              value={data}
              onChange={(e) => setData(e.target.value)}
              rows={8}
              placeholder={
                "Paste bullets, quotes, numbers, changelog notes, or URLs.\nAny http(s) links get fetched into the research pass.\n\nExample:\n- 275k chars / 8k lines leaked\n- https://example.com/writeup\n- demoed on MacBook with Qwen 3.8 via Ollama"
              }
              className="w-full resize-y rounded-md border border-black/[.12] bg-transparent px-3 py-2 font-mono text-[13px] leading-relaxed text-neutral-700 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none dark:border-white/[.19] dark:text-neutral-200"
              disabled={busy}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
              }}
            />
          </label>

          <div className="flex flex-wrap items-end gap-4">
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:text-[#8e939d]">
                Format
              </legend>
              <div className="flex gap-2">
                {(
                  [
                    { id: "shortform", label: "Reels / Shorts" },
                    { id: "longform", label: "YouTube" },
                  ] as const
                ).map((opt) => {
                  const on = format === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={busy}
                      onClick={() => setFormat(opt.id)}
                      className={`rounded-md border px-3 py-1.5 text-sm transition ${
                        on
                          ? "border-teal-500/50 bg-teal-500/10 text-teal-700 dark:border-[#2dd4bf]/60 dark:bg-[#2dd4bf]/10 dark:text-[#2dd4bf]"
                          : "border-black/[.12] text-neutral-600 hover:border-neutral-400 dark:border-white/[.19] dark:text-[#b6bac2]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {format === "shortform" ? (
              <label className="flex min-w-[140px] flex-col gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:text-[#8e939d]">
                  Comment word
                </span>
                <input
                  value={ctaWord}
                  onChange={(e) => setCtaWord(e.target.value)}
                  placeholder="FABLE"
                  className="w-full rounded-md border border-black/[.12] bg-transparent px-3 py-1.5 text-sm uppercase tracking-wide text-neutral-800 placeholder:normal-case placeholder:tracking-normal placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none dark:border-white/[.19] dark:text-neutral-100"
                  disabled={busy}
                />
              </label>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={busy || !topic.trim() || !llmReady}
              className="shrink-0 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {busy ? phase || "Working…" : "Research + write"}
            </button>
            <p className="text-[11px] text-neutral-500 dark:text-[#8e939d]">
              Uses your shortform / longform Kevin skills · ⌘↵ to submit
            </p>
            {busy ? (
              <span className="ml-auto inline-flex items-center gap-2 text-[12px] text-amber-600 dark:text-amber-400">
                <span className="live-dot" /> {phase || "Working…"}
              </span>
            ) : null}
          </div>
          {error ? <p className="text-sm text-red-500">{error}</p> : null}
        </form>
      </section>

      {result ? (
        <section className="card">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="card-title">Script</h2>
            <p className="eyebrow">
              {result.format === "longform" ? "YouTube" : "Reels"} · {wordCount(result.script)} words
              {result.sources.length ? ` · ${result.sources.length} fetched` : ""}
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copy("script", result.script)}
              className="rounded-md border border-black/[.12] px-2.5 py-1 text-[12px] text-neutral-700 hover:border-neutral-400 dark:border-white/[.19] dark:text-neutral-200"
            >
              {copied === "script" ? "Copied" : "Copy script"}
            </button>
            <button
              type="button"
              onClick={() => setShowResearch((v) => !v)}
              className="rounded-md border border-black/[.12] px-2.5 py-1 text-[12px] text-neutral-700 hover:border-neutral-400 dark:border-white/[.19] dark:text-neutral-200"
            >
              {showResearch ? "Hide research" : "Show research"}
            </button>
            {showResearch ? (
              <button
                type="button"
                onClick={() => void copy("research", result.research)}
                className="rounded-md border border-black/[.12] px-2.5 py-1 text-[12px] text-neutral-700 hover:border-neutral-400 dark:border-white/[.19] dark:text-neutral-200"
              >
                {copied === "research" ? "Copied" : "Copy research"}
              </button>
            ) : null}
          </div>

          <pre className="mt-3 whitespace-pre-wrap rounded-md border border-black/[.08] bg-neutral-50/80 px-3 py-3 font-sans text-[14px] leading-relaxed text-neutral-800 dark:border-white/[.10] dark:bg-black/20 dark:text-neutral-100">
            {result.script}
          </pre>

          {showResearch ? (
            <div className="mt-4">
              <p className="eyebrow mb-2">Research brief</p>
              <pre className="whitespace-pre-wrap rounded-md border border-black/[.08] bg-transparent px-3 py-3 font-mono text-[12px] leading-relaxed text-neutral-600 dark:border-white/[.10] dark:text-[#b6bac2]">
                {result.research}
              </pre>
              {result.sources.length ? (
                <ul className="mt-2 space-y-1 text-[11px] text-neutral-500 dark:text-[#8e939d]">
                  {result.sources.map((u) => (
                    <li key={u} className="truncate">
                      <a href={u} target="_blank" rel="noreferrer" className="hover:underline">
                        {u}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {history.length ? (
        <section className="card">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="card-title">Recent</h2>
            <p className="eyebrow">this browser</p>
          </div>
          <ul className="mt-3 divide-y divide-black/[.06] dark:divide-white/[.08]">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    setTopic(h.topic);
                    setFormat(h.format);
                    setResult({
                      format: h.format,
                      skillDir: h.format === "longform" ? "copywriter-longform-kevin" : "copywriter-shortform-kevin",
                      script: h.script,
                      research: h.research,
                      sources: h.sources,
                    });
                    setShowResearch(false);
                  }}
                >
                  <p className="truncate text-sm text-neutral-800 dark:text-neutral-100">{h.topic}</p>
                  <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-[#8e939d]">
                    {h.format === "longform" ? "YouTube" : "Reels"} · {wordCount(h.script)} words · {shortDate(h.at)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void copy("script", h.script)}
                  className="shrink-0 rounded-md border border-black/[.12] px-2 py-1 text-[11px] text-neutral-600 dark:border-white/[.19] dark:text-[#b6bac2]"
                >
                  Copy
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
