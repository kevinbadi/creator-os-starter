export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ElevenLabs text-to-speech for the voice agent. The client falls back to the
// browser's speechSynthesis when this returns non-200 (no key, quota, outage).
const KEY = process.env.ELEVENLABS_API_KEY ?? "";
const VOICE = process.env.AGENT_TTS_VOICE_ID || "pNInz6obpgDQGcFmaJgB"; // "Adam" default voice
const MODEL = process.env.AGENT_TTS_MODEL || "eleven_turbo_v2_5";

export async function POST(req: Request) {
  if (!KEY) return new Response("ELEVENLABS_API_KEY not set", { status: 503 });
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const clean = (text ?? "").replace(/[*_`#>]/g, "").trim().slice(0, 2500);
  if (!clean) return new Response("text required", { status: 400 });

  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/stream?optimize_streaming_latency=3`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: clean,
      model_id: MODEL,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
    }),
    signal: req.signal,
  });
  if (!r.ok || !r.body) return new Response(`tts ${r.status}`, { status: 502 });
  return new Response(r.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
