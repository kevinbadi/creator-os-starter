"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { JevGlobe, type GlobePhase } from "./JevGlobe";

type Decision = {
  tool: string;
  toolConfidence: number;
  toolProbabilities: Record<string, number>;
  range: string;
  rangeConfidence: number;
  sort?: string;
  sortConfidence?: number;
  platform?: string;
  platformConfidence?: number;
  status?: string;
  statusConfidence?: number;
  model: string;
  latencyMs: number;
  usage?: { input_tokens: number; output_tokens: number };
};
type ToolResult = { summary: string; columns?: string[]; rows?: Record<string, unknown>[]
  media?: boolean;
};
type JevTurn = {
  role: "jev";
  id: string;
  question: string;
  decision?: Decision;
  result?: ToolResult;
  error?: string;
  pending?: boolean;
  /** What Jev said out loud (Alfred line), once the voice route answers. */
  spoken?: string;
  voice?: "elevenlabs" | "browser";
};
type Turn = { role: "you"; text: string; viaVoice?: boolean } | JevTurn;

// One planet per tool; colors borrowed from the System Brain palette.
const TOOL_PLANETS = [
  { id: "get_comments", label: "Comments", color: "#fb7185" },
  { id: "delete_comment", label: "Delete comment", color: "#ef4444" },
  { id: "reply_comment", label: "Reply", color: "#fb7185" },
  { id: "get_agent_posts", label: "Agent posts", color: "#a78bfa" },
  { id: "get_slots", label: "Slots", color: "#2dd4bf" },
  { id: "get_content_posts", label: "Content", color: "#fb923c" },
  { id: "get_news", label: "AI news", color: "#38bdf8" },
  { id: "get_link_clicks", label: "Link clicks", color: "#fbbf24" },
  { id: "get_followers", label: "Followers", color: "#a3e635" },
  { id: "get_post_analytics", label: "Post analytics", color: "#f472b6" },
  { id: "get_revenue", label: "Revenue", color: "#34d399" },
  { id: "get_automations", label: "Automations", color: "#818cf8" },
  { id: "none", label: "No tool", color: "#6b7280" },
];

const SUGGESTIONS = [
  "what comments did we get today",
  "what is scheduled on agent posts this week",
  "next open slots",
  "link clicks this month",
  "how did followers change in the last 7 days",
  "past 100 posts ranked by views",
  "instagram post analytics this month",
  "tiktok comments this week",
  "comments with no reply today",
  "downloads this month",
  "what automations are running and is anything overdue",
  "what did the news agent find today",
];

const VOICE_KEY = "mos:jev:voice";
const HANDSFREE_KEY = "mos:jev:alwayson"; // 2026-09-19: mic feed stays open by default
const VOICE_INPUT = false; // 2026-09-19 pm: mic removed from the UI for now

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function cell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.length > 160 ? v.slice(0, 157) + "..." : v;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function isCommentRow(r: Record<string, unknown>): boolean {
  return Boolean(r.event_id && r.comment_id && r.account_id);
}

function lastShownComments(turns: Turn[]): { event_id: string }[] {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.role !== "jev" || !t.result?.rows?.length) continue;
    const rows = t.result.rows.filter(isCommentRow);
    if (rows.length) return rows.slice(0, 25).map((r) => ({ event_id: String(r.event_id) }));
  }
  return [];
}

function CommentReplyButton({
  eventId,
  onReplied,
}: {
  eventId: string;
  onReplied: (reply: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="flex min-w-[140px] flex-col items-end gap-1">
      {open ? (
        <form
          className="flex w-[220px] items-center gap-1"
          onSubmit={async (e) => {
            e.preventDefault();
            const message = text.trim();
            if (!message || busy) return;
            setBusy(true);
            setErr("");
            try {
              const res = await fetch("/api/comments/reply", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ event_id: eventId, message }),
              });
              const data = (await res.json()) as { error?: string; reply?: string };
              if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
              onReplied(data.reply || message);
              setOpen(false);
              setText("");
            } catch (e) {
              setErr(e instanceof Error ? e.message : "failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="reply…"
            disabled={busy}
            className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2 py-0.5 text-[11px] outline-none focus:border-[var(--accent)]"
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="rounded-full border border-[var(--accent)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-ink)] disabled:opacity-50"
          >
            {busy ? "…" : "send"}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent-ink)]"
        >
          reply
        </button>
      )}
      {err ? <span className="max-w-[200px] text-right text-[10px] text-red-400">{err}</span> : null}
    </div>
  );
}

function CommentDeleteButton({ eventId, onDeleted }: { eventId: string; onDeleted: () => void }) {
  const [phase, setPhase] = useState<"idle" | "confirm" | "busy">("idle");
  const [err, setErr] = useState("");
  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        disabled={phase === "busy"}
        onClick={async () => {
          if (phase === "idle") {
            setPhase("confirm");
            return;
          }
          setPhase("busy");
          setErr("");
          try {
            const res = await fetch("/api/comments/delete", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ event_id: eventId }),
            });
            const data = (await res.json()) as { error?: string };
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            onDeleted();
          } catch (e) {
            setErr(e instanceof Error ? e.message : "failed");
            setPhase("confirm");
          }
        }}
        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
          phase === "confirm"
            ? "border-red-500/60 text-red-400 hover:bg-red-500/10"
            : "border-[var(--line)] text-[var(--muted)] hover:border-red-500/40 hover:text-red-300"
        } disabled:opacity-50`}
      >
        {phase === "busy" ? "deleting…" : phase === "confirm" ? "sure?" : "delete"}
      </button>
      {err ? <span className="max-w-[160px] text-right text-[10px] text-red-400">{err}</span> : null}
    </div>
  );
}

// Web Speech API types are not in the TS lib by default.
type SR = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
function getSR(): (new () => SR) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Browser fallback voice: the most Alfred-like en-GB male the OS offers. */
function pickBritishVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  const gb = voices.filter((v) => /^en[-_]GB/i.test(v.lang));
  const preferred = ["Daniel", "Arthur", "Oliver", "George", "Google UK English Male"];
  for (const name of preferred) {
    const hit = gb.find((v) => v.name.includes(name));
    if (hit) return hit;
  }
  return gb[0] ?? voices.find((v) => /^en/i.test(v.lang)) ?? null;
}

const FLAG_EVENT = "mos:jev:flag";
/** localStorage-backed boolean that hydrates to `fallback` on the server. */
function useStoredFlag(key: string, fallback: boolean): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      window.addEventListener(FLAG_EVENT, cb);
      return () => {
        window.removeEventListener("storage", cb);
        window.removeEventListener(FLAG_EVENT, cb);
      };
    },
    () => {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : v === "1";
      } catch {
        return fallback;
      }
    },
    () => fallback,
  );
  const set = useCallback(
    (v: boolean) => {
      try {
        localStorage.setItem(key, v ? "1" : "0");
      } catch {
        /* private mode */
      }
      window.dispatchEvent(new Event(FLAG_EVENT));
    },
    [key],
  );
  return [value, set];
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export type JevChatBrand = {
  configured: boolean;
  decidePath?: string;
  speakPath?: string;
  name?: string;
  tagline?: string;
  missingKeyHint?: string;
  storagePrefix?: string;
  core?: string;
  coreLabel?: string;
};

export function JevChat({
  configured,
  decidePath = "/api/jev",
  speakPath = "/api/jev/speak",
  name = "Jev",
  tagline = "Built for KevBuildsApps on Creator OS",
  missingKeyHint = "TYPESAFE_API_KEY is not set on this server, so Jev cannot decide anything here yet.",
  storagePrefix = "mos:jev",
  core,
  coreLabel,
}: JevChatBrand) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [voiceOn, setVoiceOn] = useStoredFlag(`${storagePrefix}:voice`, true);
  const [handsFree, setHandsFree] = useStoredFlag(`${storagePrefix}:alwayson`, true);
  const endRef = useRef<HTMLDivElement | null>(null);
  const srRef = useRef<SR | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Async speak/listen chains outlive the render they started in; read the
  // latest toggles through refs.
  const voiceOnRef = useRef(true);
  const handsFreeRef = useRef(true);
  // Always-on mic (Kevin 2026-09-19: "the microphone drops too fast, keep my
  // microphone feed to the agent always on"): the recogniser runs continuously,
  // an utterance is committed after a short silence, results are ignored while
  // Jev is thinking or talking, and the session restarts itself whenever the
  // browser ends it.
  const muteUntilRef = useRef(0);
  const busyRef = useRef(false);
  const speakingRef = useRef(false);
  const wantMicRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const startListeningRef = useRef<() => void>(() => {});
  useEffect(() => {
    voiceOnRef.current = voiceOn;
    handsFreeRef.current = handsFree;
  }, [voiceOn, handsFree]);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    speakingRef.current = speaking;
    // trailing audio after Jev stops talking must not be heard as a question
    if (!speaking) muteUntilRef.current = Date.now() + 700;
  }, [speaking]);
  // mp3 per turn so "hear it again" does not re-bill ElevenLabs.
  const audioCache = useRef(new Map<string, string | null>());
  // The recognizer's onend fires long after the closure was built; go through
  // a ref so it always calls the latest askAndSpeak.
  const askAndSpeakRef = useRef<(message: string, viaVoice?: boolean) => Promise<void>>(async () => {});
  // Voice INPUT is off for now (Kevin 2026-09-19: the always-on recogniser was
  // making the macOS mic indicator glitch). Flip VOICE_INPUT to bring back the
  // mic button, the always-on toggle, the space bar, and auto-start. Jev still
  // speaks his answers.
  const srDetected = useSyncExternalStore(
    () => () => {},
    () => Boolean(getSR()),
    () => false,
  );
  const srSupported = VOICE_INPUT && srDetected;

  const lastJev = [...turns].reverse().find((t): t is JevTurn => t.role === "jev");
  const phase: GlobePhase = listening
    ? "listening"
    : busy || lastJev?.pending
      ? "deciding"
      : speaking
        ? "speaking"
        : lastJev?.decision
          ? "decided"
          : "idle";
  // 2026-09-19: the globe keeps its own full-height pane on the left and never
  // shrinks; the chat lives in the right pane.

  useEffect(() => {
    // Safari/Chrome populate voices lazily; warm the list for the fallback.
    window.speechSynthesis?.getVoices?.();
  }, []);

  // Newest exchange reads top-down (Kevin 2026-09-19): scroll so the latest
  // question sits at the top of the pane, not the end of the answer.
  useEffect(() => {
    const el = endRef.current?.parentElement;
    if (!el) return;
    const starts = el.querySelectorAll<HTMLElement>("[data-turn-start]");
    const last = starts[starts.length - 1];
    if (last) el.scrollTo({ top: last.offsetTop - el.offsetTop - 8, behavior: "smooth" });
    else el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns.length, interim]);

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  const patchTurn = useCallback((id: string, patch: Partial<JevTurn>) => {
    setTurns((t) => t.map((x) => (x.role === "jev" && x.id === id ? { ...x, ...patch } : x)));
  }, []);

  /** Play an already-rendered line (ElevenLabs mp3, else the browser's British voice). */
  const playLine = useCallback(
    async (line: string, audioB64?: string): Promise<void> => {
      stopSpeaking();
      setSpeaking(true);
      try {
        if (audioB64) {
          const url = URL.createObjectURL(base64ToBlob(audioB64, "audio/mpeg"));
          await new Promise<void>((resolve) => {
            const a = new Audio(url);
            audioRef.current = a;
            a.onended = () => {
              URL.revokeObjectURL(url);
              resolve();
            };
            a.onerror = () => {
              URL.revokeObjectURL(url);
              resolve();
            };
            a.play().catch(() => resolve());
          });
          return;
        }
        await new Promise<void>((resolve) => {
          const synth = window.speechSynthesis;
          if (!synth) return resolve();
          const u = new SpeechSynthesisUtterance(line);
          const v = pickBritishVoice();
          if (v) u.voice = v;
          u.lang = v?.lang || "en-GB";
          u.rate = 0.92;
          u.pitch = 0.85;
          u.onend = () => resolve();
          u.onerror = () => resolve();
          synth.speak(u);
        });
      } finally {
        setSpeaking(false);
      }
    },
    [stopSpeaking],
  );

  /** Ask the server for Jev's spoken line + audio for a finished turn, then play it. */
  const speakTurn = useCallback(
    async (turn: JevTurn): Promise<void> => {
      if (!voiceOnRef.current) return;
      try {
        const res = await fetch(speakPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question: turn.question,
            tool: turn.decision?.tool ?? "",
            summary: turn.result?.summary ?? turn.error ?? "",
            rowCount: turn.result?.rows?.length ?? 0,
            failed: Boolean(turn.error) || !turn.result,
          }),
        });
        if (!res.ok) throw new Error(`speak ${res.status}`);
        const data = (await res.json()) as { text: string; audio?: string; voice: "elevenlabs" | "browser" };
        patchTurn(turn.id, { spoken: data.text, voice: data.voice });
        audioCache.current.set(turn.id, data.audio ?? null);
        if (!voiceOnRef.current) return;
        await playLine(data.text, data.audio);
      } catch {
        const fallback = turn.result?.summary || "I'm afraid that one is beyond me for the moment, sir.";
        patchTurn(turn.id, { spoken: fallback, voice: "browser" });
        if (voiceOnRef.current) await playLine(fallback);
      }
    },
    [patchTurn, playLine, speakPath],
  );

  const ask = useCallback(
    async (message: string, viaVoice = false): Promise<JevTurn | null> => {
      const m = message.trim();
      if (!m || busy) return null;
      stopSpeaking();
      setText("");
      setInterim("");
      setBusy(true);
      busyRef.current = true;
      const id = crypto.randomUUID();
      setTurns((t) => [...t, { role: "you", text: m, viaVoice }, { role: "jev", id, question: m, pending: true }]);
      let finished: JevTurn;
      try {
        const res = await fetch(decidePath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: m, priorComments: lastShownComments(turnsRef.current) }),
        });
        const data = (await res.json()) as { decision?: Decision; result?: ToolResult; error?: string };
        finished = {
          role: "jev",
          id,
          question: m,
          decision: data.decision,
          result: data.result,
          error: res.ok ? undefined : data.error || `HTTP ${res.status}`,
        };
      } catch (e) {
        finished = { role: "jev", id, question: m, error: e instanceof Error ? e.message : "Request failed" };
      }
      setTurns((t) => t.map((x) => (x.role === "jev" && x.id === id ? finished : x)));
      setBusy(false);
      busyRef.current = false;
      return finished;
    },
    [busy, stopSpeaking, decidePath],
  );

  const SILENCE_MS = 1400;
  const startListening = useCallback(() => {
    const Ctor = getSR();
    if (!Ctor || srRef.current) return;
    wantMicRef.current = true;
    const sr = new Ctor();
    sr.lang = "en-US";
    sr.interimResults = true;
    sr.continuous = true;
    sr.maxAlternatives = 1;
    let finalText = "";
    let interimText = "";
    let silenceTimer: number | null = null;
    const muted = () => busyRef.current || speakingRef.current || Date.now() < muteUntilRef.current;
    const commit = () => {
      silenceTimer = null;
      const t = (finalText + " " + interimText).replace(/\s+/g, " ").trim();
      finalText = "";
      interimText = "";
      setInterim("");
      if (t && !muted()) void askAndSpeakRef.current(t, true);
    };
    sr.onresult = (e) => {
      if (muted()) {
        // Jev's own voice or a stale tail: drop it and keep the session open.
        finalText = "";
        interimText = "";
        setInterim("");
        return;
      }
      interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const t = res[0].transcript;
        if (res.isFinal) finalText += t;
        else interimText += t;
      }
      setInterim((finalText + interimText).trim());
      if (silenceTimer) window.clearTimeout(silenceTimer);
      silenceTimer = window.setTimeout(commit, SILENCE_MS);
    };
    sr.onerror = (e) => {
      // Permission problems end always-on; everything else ("no-speech",
      // "network", "aborted") is a normal session end and restarts below.
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantMicRef.current = false;
        handsFreeRef.current = false;
        setHandsFree(false);
      }
    };
    sr.onend = () => {
      if (silenceTimer) {
        window.clearTimeout(silenceTimer);
        commit();
      }
      srRef.current = null;
      setListening(false);
      setInterim("");
      if (wantMicRef.current && handsFreeRef.current) {
        restartTimerRef.current = window.setTimeout(() => {
          restartTimerRef.current = null;
          if (wantMicRef.current && !srRef.current) startListeningRef.current();
        }, 250);
      }
    };
    srRef.current = sr;
    setListening(true);
    try {
      sr.start();
    } catch {
      srRef.current = null;
      setListening(false);
    }
  }, [setHandsFree]);
  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  const stopListening = useCallback(() => {
    wantMicRef.current = false;
    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    srRef.current?.stop();
  }, []);

  // Open the mic on load when always-on is set (permission already granted
  // sessions start silently; otherwise the first tap on the mic asks).
  useEffect(() => {
    if (configured && srSupported && handsFree && !srRef.current) startListening();
    return () => {
      wantMicRef.current = false;
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      srRef.current?.abort();
      srRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, srSupported]);

  const askAndSpeak = useCallback(
    async (message: string, viaVoice = false) => {
      const turn = await ask(message, viaVoice);
      if (!turn) return;
      await speakTurn(turn);
      if (handsFreeRef.current && srSupported && !srRef.current) startListening();
    },
    [ask, speakTurn, srSupported, startListening],
  );
  useEffect(() => {
    askAndSpeakRef.current = askAndSpeak;
  }, [askAndSpeak]);

  const replay = useCallback(
    async (turn: JevTurn) => {
      if (!turn.spoken) {
        voiceOnRef.current = true;
        await speakTurn(turn);
        voiceOnRef.current = voiceOn;
        return;
      }
      await playLine(turn.spoken, audioCache.current.get(turn.id) ?? undefined);
    },
    [speakTurn, playLine, voiceOn],
  );

  const toggleVoice = () => {
    const v = !voiceOn;
    setVoiceOn(v);
    voiceOnRef.current = v;
    if (!v) stopSpeaking();
  };

  const toggleHandsFree = () => {
    const v = !handsFree;
    setHandsFree(v);
    handsFreeRef.current = v;
    if (v) startListening();
    else stopListening();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target === document.body && !busy && configured && srSupported) {
        e.preventDefault();
        if (listening) stopListening();
        else startListening();
      }
      if (e.key === "Escape") {
        stopSpeaking();
        stopListening();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, configured, listening, srSupported, startListening, stopListening, stopSpeaking]);

  const micDisabled = !configured || !srSupported || busy;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {!configured ? (
        <div className="card px-4 py-3 text-sm text-[var(--muted)]">
          {missingKeyHint}
        </div>
      ) : null}

      {/* Globe left (most of the screen), chat right (Kevin 2026-09-19). */}
      <div className="card relative h-[calc(100vh-240px)] min-h-[540px] overflow-hidden p-0!">
        {/* One starfield behind both panes so the chat sits in the same space as Jev. */}
        <div className="absolute inset-0">
          <JevGlobe
            phase={phase}
            tools={TOOL_PLANETS}
            chosen={lastJev?.decision?.tool ?? null}
            probabilities={lastJev?.decision?.toolProbabilities ?? null}
            compact={false}
            center={0.34}
            core={core}
            coreLabel={coreLabel}
          />
        </div>
        <div className="relative grid h-full grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(380px,32%)]">
        <div className="relative min-h-[320px]">
          <div className="pointer-events-none absolute inset-x-0 bottom-7 text-center">
            <div className="font-serif text-[clamp(24px,2.4vw,38px)] italic tracking-tight text-[#111827] dark:text-[clamp(20px,2.1vw,34px)] dark:text-[#e6e9ef]/90">{name} AI</div>
            <div className="mt-1.5 text-[clamp(15px,1.4vw,23px)] font-black uppercase tracking-[0.18em] text-[#111827] dark:text-[clamp(14px,1.25vw,21px)] dark:text-[#e6e9ef]">{tagline}</div>
          </div>
          <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={toggleVoice}
              className={`pointer-events-auto rounded-full border px-2.5 py-1 backdrop-blur ${
                voiceOn ? "border-[var(--accent)] text-[var(--accent-ink)]" : "border-[var(--line)] text-[var(--muted-2)]"
              }`}
              title={`${name} reads every answer aloud`}
            >
              voice {voiceOn ? "on" : "off"}
            </button>
            {srSupported ? (
            <button
              type="button"
              onClick={toggleHandsFree}
              disabled={!srSupported}
              className={`pointer-events-auto rounded-full border px-2.5 py-1 backdrop-blur disabled:opacity-40 ${
                handsFree ? "border-[var(--accent)] text-[var(--accent-ink)]" : "border-[var(--line)] text-[var(--muted-2)]"
              }`}
              title={`Mic stays open; ${name} listens between answers and ignores their own voice`}
            >
              mic always on: {handsFree ? "yes" : "no"}
            </button>
            ) : null}
            {speaking ? (
              <button
                type="button"
                onClick={stopSpeaking}
                className="pointer-events-auto rounded-full border border-[var(--line)] px-2.5 py-1 text-[var(--muted-2)] backdrop-blur"
              >
                hush
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden border-t border-[var(--line)] lg:border-l lg:border-t-0">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {turns.length === 0 ? (
            <div className="space-y-3">
              <p className="text-[15px] font-medium text-[#374151] dark:text-sm dark:font-normal dark:text-[var(--muted)]">
                {srSupported ? "Tap the mic or hold space and ask, or try one of these." : "Ask anything, or try one of these."} Every
                answer shows which tool {name} chose and how sure it was, and it reads it back to you.
              </p>
              <div className="flex flex-col items-start gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void askAndSpeak(s)}
                    className="rounded-full border border-[var(--line-strong)] px-3 py-1.5 text-[13px] font-semibold text-[#111827] hover:border-[#111827]/40 dark:border-[var(--line)] dark:py-1 dark:text-xs dark:font-normal dark:text-inherit dark:hover:border-[var(--line-strong)]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {turns.map((t, i) =>
            t.role === "you" ? (
              <div key={i} data-turn-start className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl bg-[var(--surface-3)] px-4 py-2 text-sm">
                  {t.viaVoice ? <span className="mr-1.5 text-[var(--muted-2)]" aria-label="spoken">🎙</span> : null}
                  {t.text}
                </div>
              </div>
            ) : (
              <div key={t.id} className="space-y-2">
                {t.pending ? <div className="text-xs text-[var(--muted-2)]">{name} is deciding...</div> : null}
                {t.decision ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="eyebrow">{name} chose</span>
                    <span
                      className="rounded-full border border-[var(--accent)] px-2.5 py-0.5 font-medium text-[var(--accent-ink)]"
                      title={Object.entries(t.decision.toolProbabilities)
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => `${k} ${pct(v)}`)
                        .join("\n")}
                    >
                      {t.decision.tool} · {pct(t.decision.toolConfidence)}
                    </span>
                    <span className="rounded-full border border-[var(--line)] px-2.5 py-0.5">
                      {t.decision.range.replace(/_/g, " ")} · {pct(t.decision.rangeConfidence)}
                    </span>
                    {t.decision.platform && t.decision.platform !== "any" ? (
                      <span className="rounded-full border border-[var(--line)] px-2.5 py-0.5">
                        {t.decision.platform === "twitter" ? "x" : t.decision.platform} · {pct(t.decision.platformConfidence ?? 0)}
                      </span>
                    ) : null}
                    {t.decision.status && t.decision.status !== "any" ? (
                      <span className="rounded-full border border-[var(--line)] px-2.5 py-0.5">
                        {t.decision.status.replace(/_/g, " ")} · {pct(t.decision.statusConfidence ?? 0)}
                      </span>
                    ) : null}
                    {t.decision.sort && t.decision.sort !== "not_applicable" ? (
                      <span className="rounded-full border border-[var(--line)] px-2.5 py-0.5">
                        {t.decision.sort.replace(/_/g, " ")} · {pct(t.decision.sortConfidence ?? 0)}
                      </span>
                    ) : null}
                    <span className="text-[var(--muted-2)]">
                      {t.decision.model} · {t.decision.latencyMs} ms
                      {t.decision.usage ? ` · ${t.decision.usage.input_tokens} tokens` : ""}
                    </span>
                  </div>
                ) : null}
                {t.error ? (
                  <div className="rounded-xl border border-red-400/40 px-3 py-2 text-sm text-red-400">{t.error}</div>
                ) : null}
                {!t.pending && (t.spoken || t.result || t.error) ? (
                  <div className="flex items-start gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
                    <button
                      type="button"
                      onClick={() => void replay(t)}
                      disabled={speaking}
                      className="mt-0.5 shrink-0 rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] hover:border-[var(--line-strong)] disabled:opacity-40"
                      title="Hear it again"
                    >
                      ▶
                    </button>
                    <p className="font-serif text-sm italic leading-relaxed text-[var(--muted)]">
                      {t.spoken ?? (voiceOn ? `${name} is composing...` : `Voice is off. Press play to hear ${name}.`)}
                    </p>
                  </div>
                ) : null}
                {t.result ? (
                  <div className={`space-y-2 ${t.result.media ? "text-[#39dcff]" : ""}`}>
                    {t.result.media ? (
                      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#39dcff]/80">
                        <span className="inline-block size-2 rounded-full bg-[#39dcff] shadow-[0_0_10px_#39dcff]" />
                        Obsidian · Marketing OS Broll
                      </div>
                    ) : null}
                    <p className={`text-sm ${t.result.media ? "font-medium text-[#39dcff] drop-shadow-[0_0_6px_rgba(57,220,255,0.55)]" : ""}`}>{t.result.summary}</p>
                    {t.result.media && t.result.rows?.length ? (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {t.result.rows.slice(0, 24).map((r, ri) => (
                          <a
                            key={ri}
                            href={`obsidian://open?vault=${encodeURIComponent(String(r.vault || "Marketing OS Broll"))}&file=${encodeURIComponent(String(r.note || r.file || "").replace(/\.md$/, ""))}`}
                            className="group rounded-xl border border-[#39dcff]/30 bg-[#0b1a22]/70 p-1.5 hover:border-[#39dcff]"
                            title={String(r.file || "")}
                          >
                            {r.thumb ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={String(r.thumb)} alt={String(r.name || "")} className="aspect-square w-full rounded-lg object-contain" />
                            ) : (
                              <div className="aspect-square w-full rounded-lg bg-[#0b1a22]" />
                            )}
                            <div className="mt-1 truncate text-[11px] text-[#39dcff]">{String(r.name || "")}</div>
                            <div className="truncate text-[10px] text-[#39dcff]/60">
                              {String(r.brand || "")} · {String(r.kind || "")}{r.duration ? ` · ${String(r.duration)}` : ""}{r.video ? " · ▶ video" : ""}
                            </div>
                          </a>
                        ))}
                      </div>
                    ) : null}
                    {t.result.media && t.result.rows?.some((r) => r.path) ? (
                      <div className="rounded-xl border border-[#39dcff]/25 bg-[#0b1a22]/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-[#39dcff]/80">
                        <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-[#39dcff]/60">on disk (click to copy)</div>
                        {t.result.rows.slice(0, 16).map((r, ri) => (
                          <button
                            key={ri}
                            type="button"
                            onClick={() => void navigator.clipboard?.writeText(String(r.path || ""))}
                            className="block w-full truncate text-left hover:text-[#39dcff]"
                            title="copy path"
                          >
                            {String(r.path || "")}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {!t.result.media && t.result.columns && t.result.rows?.length ? (
                      <div className="overflow-x-auto rounded-xl border border-[var(--line)]">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-[var(--surface-2)] text-[var(--muted-2)]">
                            <tr>
                              {t.result.columns.map((c) => (
                                <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">
                                  {c.replace(/_/g, " ")}
                                </th>
                              ))}
                              {t.result.rows.some(isCommentRow) ? (
                                <th className="whitespace-nowrap px-3 py-2 font-medium"> </th>
                              ) : null}
                            </tr>
                          </thead>
                          <tbody>
                            {t.result.rows.slice(0, 100).map((r, ri) => (
                              <tr key={String(r.event_id ?? ri)} className="border-t border-[var(--line)] align-top">
                                {t.result!.columns!.map((c) => (
                                  <td key={c} className="max-w-[420px] px-3 py-1.5">
                                    {typeof r[c] === "string" && /^https?:\/\//.test(r[c] as string) ? (
                                      <a href={r[c] as string} target="_blank" rel="noreferrer" className="underline">
                                        {cell(r[c])}
                                      </a>
                                    ) : (
                                      cell(r[c])
                                    )}
                                  </td>
                                ))}
                                {t.result!.rows!.some(isCommentRow) ? (
                                  <td className="px-2 py-1.5">
                                    {isCommentRow(r) ? (
                                      <div className="flex flex-col items-end gap-1">
                                        <CommentReplyButton
                                          eventId={String(r.event_id)}
                                          onReplied={(reply) => {
                                            patchTurn(t.id, {
                                              result: {
                                                ...t.result!,
                                                rows: (t.result!.rows ?? []).map((x) =>
                                                  x.event_id === r.event_id ? { ...x, status: "replied" } : x,
                                                ),
                                                summary: `Replied to @${String(r.author_username ?? "someone").replace(/^@/, "")}: "${reply}"`,
                                              },
                                            });
                                          }}
                                        />
                                        <CommentDeleteButton
                                          eventId={String(r.event_id)}
                                          onDeleted={() => {
                                            patchTurn(t.id, {
                                              result: {
                                                ...t.result!,
                                                rows: (t.result!.rows ?? []).filter((x) => x.event_id !== r.event_id),
                                                summary: `Deleted @${String(r.author_username ?? "someone").replace(/^@/, "")}: "${String(r.comment_text ?? "").replace(/\s+/g, " ").trim()}"`,
                                              },
                                            });
                                          }}
                                        />
                                      </div>
                                    ) : null}
                                  </td>
                                ) : null}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {t.result.rows.length > 100 ? (
                          <div className="px-3 py-1.5 text-[11px] text-[var(--muted-2)]">
                            showing 100 of {t.result.rows.length}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ),
          )}
          {interim ? (
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl border border-dashed border-[var(--accent)] px-4 py-2 text-sm text-[var(--muted)]">
                {interim}
              </div>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void askAndSpeak(text);
          }}
          className="flex items-center gap-2 border-t border-[var(--line)] px-3 py-3"
        >
          {srSupported ? (
          <button
            type="button"
            onClick={listening ? stopListening : startListening}
            disabled={micDisabled}
            aria-label={listening ? "stop listening" : `talk to ${name}`}
            title={srSupported ? `Talk to ${name} (space)` : "Voice input needs Chrome or Safari"}
            className={`flex size-10 shrink-0 items-center justify-center rounded-full border text-lg transition ${
              listening
                ? "border-[var(--accent)] bg-[var(--accent)]/20 shadow-[0_0_20px_rgba(45,212,191,0.5)]"
                : "border-[var(--line)] bg-[var(--surface-2)] hover:border-[var(--line-strong)]"
            } disabled:opacity-40`}
          >
            {listening ? "■" : "🎙"}
          </button>
          ) : null}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={!configured ? `Start ${name} first` : listening ? "listening..." : srSupported ? `Ask ${name}... (space = talk, esc = hush)` : `Ask ${name}... (esc = hush)`}
            disabled={!configured || busy}
            className="flex-1 rounded-xl border border-[var(--line-strong)] bg-[var(--surface-2)] px-3 py-2 text-[15px] font-medium outline-none placeholder:text-[#6b7280] focus:border-[#111827]/40 dark:border-[var(--line)] dark:text-sm dark:font-normal dark:placeholder:text-[var(--muted-2)] dark:focus:border-[var(--line-strong)]"
          />
          <button
            type="submit"
            disabled={!configured || busy || !text.trim()}
            className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[#0a0b0e] disabled:opacity-50"
          >
            {busy ? "..." : "Ask"}
          </button>
        </form>
        </div>
        </div>
      </div>
    </div>
  );
}
