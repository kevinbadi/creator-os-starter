import "server-only";
import { speakNumbers } from "./speak-numbers";

/**
 * Jev's voice (Kevin 2026-09-18): Alfred energy. A smart, older English
 * gentleman's gentleman who reads the dashboard back to Kevin in a dry,
 * measured way. Jev itself (System One) only routes; this file turns the
 * tool summary into a spoken line and renders it with ElevenLabs.
 */

/**
 * ElevenLabs premade "George - Warm, Captivating Storyteller" (British, male).
 * 2026-09-19: the cloned "Jev - Alfred" voice (PmyzgD79S1p0rdLGPZBg) came out
 * sounding Indian to Kevin; George on the multilingual model keeps the RP
 * accent steady. Override with JEV_TTS_VOICE_ID (Daniel onwK4e9ZLuTAKqWW03F9
 * is the steadier, more clipped alternative).
 */
export const JEV_VOICE_ID = process.env.JEV_TTS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
const TTS_MODEL = process.env.JEV_TTS_MODEL || "eleven_multilingual_v2";
const MAX_SPOKEN_CHARS = 600;

export function jevVoiceConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

const OPENERS = [
  "Very good, sir.",
  "Right away, sir.",
  "As you wish, sir.",
  "Certainly, sir.",
  "Here you are, sir.",
];

const ERROR_LINES = [
  "I'm afraid that one is beyond me for the moment, sir.",
  "Regrettably, sir, that did not go to plan.",
  "My apologies, sir. I could not fetch that just now.",
];

function pick<T>(arr: readonly T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

/** No dashes, no markdown, no URLs read aloud, plain sentences. */
export function scrubForSpeech(text: string): string {
  return String(text || "")
    .replace(/[\u2013\u2014]/g, ", ")
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/[*_`#>|]/g, "")
    .replace(/\s*\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackLine(summary: string, question: string): string {
  const body = scrubForSpeech(summary);
  if (!body) return `${pick(OPENERS, question)} Nothing to report on that front.`;
  return `${pick(OPENERS, question)} ${body}`.slice(0, MAX_SPOKEN_CHARS);
}

async function ollamaAlfred(input: {
  question: string;
  tool: string;
  summary: string;
  rowCount: number;
}): Promise<string | null> {
  const key = process.env.OLLAMA_API_KEY || process.env.OLLAMA_KEY;
  if (!key) return null;
  const base = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/$/, "");
  const model = process.env.OLLAMA_TEXT_MODEL || "deepseek-v4-flash:0731";
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(9_000),
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      messages: [
        {
          role: "system",
          content: [
            "You are Jev, Kevin's butler and marketing analyst: an older, very sharp English gentleman's gentleman in the mould of Bruce Wayne's Alfred.",
            "Rewrite the dashboard summary as ONE short spoken reply to Kevin. Address him as 'sir' once. Dry, courteous, understated wit, impeccable British English (favourite, whilst, rather).",
            "Keep every number and name from the summary exactly. Do not invent facts. Do not mention tools, models, confidence, tables, or that you are an AI.",
            "Maximum 55 words. Plain sentences only. No lists, no markdown, no emoji, no URLs, and never use an em dash or en dash.",
            "If the summary says nothing happened or nothing is connected, say so plainly and briefly.",
            "Return only the spoken line.",
          ].join(" "),
        },
        {
          role: "user",
          content: `KEVIN ASKED: ${input.question}\nTOOL: ${input.tool}\nROWS RETURNED: ${input.rowCount}\nSUMMARY: ${input.summary}`,
        },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ollama ${res.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text) as { message?: { content?: string } };
  const line = scrubForSpeech((data.message?.content || "").replace(/^["']|["']$/g, ""));
  if (!line || line.length < 8 || line.length > MAX_SPOKEN_CHARS + 200) return null;
  return line.slice(0, MAX_SPOKEN_CHARS);
}

/** The line Jev says out loud for a tool result. Never throws. */
export async function alfredLine(input: {
  question: string;
  tool: string;
  summary: string;
  rowCount?: number;
}): Promise<{ text: string; source: "ollama" | "template" }> {
  try {
    const line = await ollamaAlfred({ ...input, rowCount: input.rowCount ?? 0 });
    if (line) return { text: line, source: "ollama" };
  } catch (e) {
    console.warn("[jev-voice] alfred rewrite failed:", e instanceof Error ? e.message : e);
  }
  return { text: fallbackLine(input.summary, input.question), source: "template" };
}

export function alfredErrorLine(question: string): string {
  return pick(ERROR_LINES, question);
}

/** ElevenLabs render of the spoken line as mp3 bytes. */
export async function synthesizeJev(text: string, signal?: AbortSignal): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set.");
  // Numbers are spelled out for the synthesizer only; the caption keeps digits
  // (Kevin 2026-09-19: bigger numbers were being misread).
  const clean = speakNumbers(scrubForSpeech(text).slice(0, MAX_SPOKEN_CHARS));
  if (!clean) throw new Error("Nothing to say.");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${JEV_VOICE_ID}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: clean,
      model_id: TTS_MODEL,
      // Measured, unhurried delivery: steadier than the default, a touch of
      // style so it does not read like a newsreader, slightly slower.
      voice_settings: { stability: 0.62, similarity_boost: 0.85, style: 0.28, use_speaker_boost: true, speed: 0.94 },
    }),
    signal: signal ?? AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`elevenlabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}
