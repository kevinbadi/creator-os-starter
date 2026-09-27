"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Msg =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; tools: ToolEv[]; done: boolean; cost?: number }
  | { id: string; role: "system"; text: string };
type ToolEv = { name: string; summary: string; result?: string };

type Ev =
  | { type: "init"; sessionId: string; model?: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "tool_result"; text: string }
  | { type: "done"; result: string; sessionId: string; cost?: number; turns?: number }
  | { type: "error"; message: string };

const SESSION_KEY = "mos:agent:session";
const HANDSFREE_KEY = "mos:agent:handsfree";

function toolSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const short = (s: unknown, n = 70) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);
  switch (name) {
    case "Read": return short(i.file_path);
    case "Edit": case "Write": return short(i.file_path);
    case "Bash": return short(i.command, 90);
    case "Grep": return `${short(i.pattern, 40)}${i.path ? ` in ${short(i.path, 40)}` : ""}`;
    case "Glob": return short(i.pattern);
    case "WebSearch": return short(i.query);
    case "WebFetch": return short(i.url);
    case "Skill": return short(i.skill);
    case "Task": return short(i.description);
    default: return short(JSON.stringify(i), 80);
  }
}

// Web Speech API types are not in TS lib by default.
type SR = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
function getSR(): (new () => SR) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceAgent() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [handsFree, setHandsFree] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [sessionId, setSessionId] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const srRef = useRef<SR | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const srSupported = Boolean(getSR());

  useEffect(() => {
    try {
      setSessionId(localStorage.getItem(SESSION_KEY) ?? "");
      setHandsFree(localStorage.getItem(HANDSFREE_KEY) === "1");
    } catch { /* private mode */ }
  }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, interim]);

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(async (text: string): Promise<void> => {
    if (!voiceOn || !text.trim()) return;
    stopSpeaking();
    setSpeaking(true);
    try {
      const r = await fetch("/api/agent/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (r.ok) {
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        await new Promise<void>((resolve) => {
          const a = new Audio(url);
          audioRef.current = a;
          a.onended = () => { URL.revokeObjectURL(url); resolve(); };
          a.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          a.play().catch(() => resolve());
        });
        setSpeaking(false);
        return;
      }
    } catch { /* fall through to browser TTS */ }
    await new Promise<void>((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synth.speak(u);
    });
    setSpeaking(false);
  }, [voiceOn, stopSpeaking]);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    stopSpeaking();
    setInput("");
    setInterim("");
    setBusy(true);
    const uid = crypto.randomUUID();
    const aid = crypto.randomUUID();
    setMsgs((m) => [...m, { id: uid, role: "user", text: message }, { id: aid, role: "assistant", text: "", tools: [], done: false }]);
    const patch = (fn: (a: Extract<Msg, { role: "assistant" }>) => Extract<Msg, { role: "assistant" }>) =>
      setMsgs((m) => m.map((x) => (x.id === aid && x.role === "assistant" ? fn(x) : x)));
    const ac = new AbortController();
    abortRef.current = ac;
    let finalText = "";
    try {
      const r = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sessionId: sessionId || undefined }),
        signal: ac.signal,
      });
      if (!r.ok || !r.body) throw new Error(`agent ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: Ev;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === "init") {
            setSessionId(ev.sessionId);
            if (ev.model) setModel(ev.model);
            try { localStorage.setItem(SESSION_KEY, ev.sessionId); } catch { /* ignore */ }
          } else if (ev.type === "text") {
            patch((a) => ({ ...a, text: (a.text ? a.text + "\n\n" : "") + ev.text }));
            finalText = ev.text;
          } else if (ev.type === "tool") {
            patch((a) => ({ ...a, tools: [...a.tools, { name: ev.name, summary: toolSummary(ev.name, ev.input) }] }));
          } else if (ev.type === "tool_result") {
            patch((a) => {
              const tools = a.tools.slice();
              const last = tools.length ? tools[tools.length - 1] : null;
              if (last && last.result === undefined) tools[tools.length - 1] = { ...last, result: ev.text };
              return { ...a, tools };
            });
          } else if (ev.type === "done") {
            if (ev.result && !finalText) finalText = ev.result;
            patch((a) => ({ ...a, done: true, cost: ev.cost, text: a.text || ev.result }));
            setSessionId(ev.sessionId);
            try { localStorage.setItem(SESSION_KEY, ev.sessionId); } catch { /* ignore */ }
          } else if (ev.type === "error") {
            patch((a) => ({ ...a, done: true, text: (a.text ? a.text + "\n\n" : "") + `⚠ ${ev.message}` }));
          }
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        patch((a) => ({ ...a, done: true, text: (a.text ? a.text + "\n\n" : "") + `⚠ ${e instanceof Error ? e.message : String(e)}` }));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
    if (finalText) await speak(finalText);
    if (handsFree && srSupported) startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, sessionId, handsFree, speak, stopSpeaking, srSupported]);

  const startListening = useCallback(() => {
    const Ctor = getSR();
    if (!Ctor || listening) return;
    stopSpeaking();
    const sr = new Ctor();
    sr.lang = "en-US";
    sr.interimResults = true;
    sr.continuous = false;
    sr.maxAlternatives = 1;
    let finalText = "";
    sr.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const t = res[0].transcript;
        if (res.isFinal) finalText += t; else interimText += t;
      }
      setInterim(finalText + interimText);
    };
    sr.onerror = () => { setListening(false); setInterim(""); };
    sr.onend = () => {
      setListening(false);
      const t = finalText.trim();
      setInterim("");
      if (t) void send(t);
    };
    srRef.current = sr;
    setListening(true);
    sr.start();
  }, [listening, send, stopSpeaking]);

  const stopListening = useCallback(() => { srRef.current?.stop(); }, []);

  const newSession = () => {
    abortRef.current?.abort();
    stopSpeaking();
    setSessionId("");
    setMsgs([]);
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  };

  const toggleHandsFree = () => {
    const v = !handsFree;
    setHandsFree(v);
    try { localStorage.setItem(HANDSFREE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
    if (v && !busy && !listening) startListening();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target === document.body && !busy) {
        e.preventDefault();
        if (listening) stopListening(); else startListening();
      }
      if (e.key === "Escape") { abortRef.current?.abort(); stopSpeaking(); stopListening(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, listening, startListening, stopListening, stopSpeaking]);

  const state = listening ? "listening" : busy ? "thinking" : speaking ? "speaking" : "idle";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 pt-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600 dark:text-[#b6bac2]">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
          state === "listening" ? "border-teal-400/60 text-teal-600 dark:text-teal-300"
          : state === "thinking" ? "border-amber-400/60 text-amber-600 dark:text-amber-300"
          : state === "speaking" ? "border-teal-400/60 text-teal-600 dark:text-teal-300"
          : "border-black/[.1] dark:border-white/[.14]"}`}>
          <span className={`size-1.5 rounded-full ${state === "idle" ? "bg-neutral-400" : "bg-current"} ${state !== "idle" ? "animate-pulse" : ""}`} />
          {state}
        </span>
        {model ? <span className="rounded-full border border-black/[.1] px-2.5 py-1 dark:border-white/[.14]">{model}</span> : null}
        <span className="rounded-full border border-black/[.1] px-2.5 py-1 font-mono dark:border-white/[.14]">
          {sessionId ? `session ${sessionId.slice(0, 8)}` : "new session"}
        </span>
        {!srSupported ? <span className="text-amber-600">mic needs Chrome / Safari (Web Speech API)</span> : null}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => { setVoiceOn((v) => !v); if (voiceOn) stopSpeaking(); }} className="rounded-full border border-black/[.1] px-2.5 py-1 hover:bg-black/[.04] dark:border-white/[.14] dark:hover:bg-white/[.06]">
            {voiceOn ? "voice on" : "voice off"}
          </button>
          <button onClick={toggleHandsFree} className={`rounded-full border px-2.5 py-1 ${handsFree ? "border-teal-400/60 text-teal-600 dark:text-teal-300" : "border-black/[.1] dark:border-white/[.14]"} hover:bg-black/[.04] dark:hover:bg-white/[.06]`}>
            hands-free {handsFree ? "on" : "off"}
          </button>
          <button onClick={newSession} className="rounded-full border border-black/[.1] px-2.5 py-1 hover:bg-black/[.04] dark:border-white/[.14] dark:hover:bg-white/[.06]">
            new session
          </button>
        </div>
      </div>

      <div ref={logRef} className="min-h-0 flex-1 overflow-auto rounded-2xl border border-black/[.06] bg-[var(--surface-1)] p-4 dark:border-white/[.1]">
        {msgs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-neutral-500 dark:text-[#b6bac2]">
            <p className="font-serif text-2xl italic text-neutral-800 dark:text-[#f2f3f5]">Hey Kevin.</p>
            <p>Hold space or tap the mic and ask anything: “how did Megan do this week”, “which automations are overdue”, “re-render the LTX hook”, “add a counter to the Kairos video”.</p>
          </div>
        ) : null}
        <div className="flex flex-col gap-4">
          {msgs.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-teal-500/15 px-4 py-2.5 text-[15px] leading-snug dark:bg-teal-400/15">{m.text}</div>
              </div>
            ) : m.role === "assistant" ? (
              <div key={m.id} className="flex flex-col gap-2">
                {m.tools.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {m.tools.map((t, i) => (
                      <span key={i} title={t.result} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-black/[.08] bg-[var(--surface-3)] px-2 py-1 font-mono text-[11px] text-neutral-700 dark:border-white/[.1] dark:text-[#d6d9df]">
                        <span className="text-teal-600 dark:text-teal-300">{t.name}</span>
                        <span className="truncate">{t.summary}</span>
                        <span className={`size-1.5 shrink-0 rounded-full ${t.result === undefined ? "animate-pulse bg-amber-400" : "bg-teal-400"}`} />
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-[var(--surface-2)] px-4 py-2.5 text-[15px] leading-relaxed">
                  {m.text || (m.done ? "(no reply)" : <span className="animate-pulse text-neutral-500">…</span>)}
                  {m.done && typeof m.cost === "number" ? <div className="mt-1 text-[11px] text-neutral-500">${m.cost.toFixed(2)} plan usage</div> : null}
                </div>
              </div>
            ) : (
              <div key={m.id} className="text-center text-xs text-neutral-500">{m.text}</div>
            ),
          )}
          {interim ? <div className="flex justify-end"><div className="max-w-[80%] rounded-2xl rounded-br-sm border border-dashed border-teal-400/50 px-4 py-2.5 text-[15px] text-neutral-500">{interim}</div></div> : null}
        </div>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void send(input); }}
        className="flex items-center gap-2"
      >
        <button
          type="button"
          onClick={listening ? stopListening : startListening}
          disabled={!srSupported || busy}
          aria-label={listening ? "stop listening" : "start listening"}
          className={`flex size-14 shrink-0 items-center justify-center rounded-full border text-2xl transition ${
            listening ? "border-teal-400 bg-teal-400/20 shadow-[0_0_24px_rgba(45,212,191,0.55)]" : "border-black/[.12] bg-[var(--surface-2)] hover:bg-black/[.04] dark:border-white/[.16] dark:hover:bg-white/[.06]"
          } disabled:opacity-40`}
        >
          {listening ? "■" : "🎙"}
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? "listening…" : "or type here (space = push to talk, esc = stop)"}
          className="h-12 min-w-0 flex-1 rounded-xl border border-black/[.1] bg-[var(--surface-2)] px-4 text-[15px] outline-none focus:border-teal-400/70 dark:border-white/[.14]"
        />
        {busy ? (
          <button type="button" onClick={() => abortRef.current?.abort()} className="h-12 rounded-xl border border-black/[.1] px-4 text-sm hover:bg-black/[.04] dark:border-white/[.14] dark:hover:bg-white/[.06]">stop</button>
        ) : (
          <button type="submit" disabled={!input.trim()} className="h-12 rounded-xl bg-teal-500 px-5 text-sm font-medium text-black hover:bg-teal-400 disabled:opacity-40">send</button>
        )}
      </form>
    </div>
  );
}
