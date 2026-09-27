import "server-only";

// Topic read of a transcript via the Ollama gateway (same provider as the
// rest of the automations, see agent-posts/copy.ts). Returns what the video
// is about in a shape the later copywriting steps can build on.

export type TopicRead = {
  topic: string;
  summary: string;
  hook: string;
  keyPoints: string[];
  format: string;
  cta: string;
};

function extractJson(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("no JSON in model reply");
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.replace(/[–—]/g, "-").trim() : "";
}

export async function analyzeTranscript(transcript: string, caption = ""): Promise<TopicRead> {
  const key = process.env.OLLAMA_API_KEY || process.env.OLLAMA_KEY;
  if (!key) throw new Error("OLLAMA_API_KEY is not set");
  const base = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/$/, "");
  const model = process.env.OLLAMA_TEXT_MODEL || "deepseek-v4-flash:0731";
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: {
        type: "object",
        properties: {
          topic: { type: "string" },
          summary: { type: "string" },
          hook: { type: "string" },
          keyPoints: { type: "array", items: { type: "string" } },
          format: { type: "string" },
          cta: { type: "string" },
        },
        required: ["topic", "summary", "hook", "keyPoints", "format", "cta"],
      },
      messages: [
        {
          role: "system",
          content: [
            "You analyze short-form video transcripts for a copywriter. Output ONLY JSON.",
            "topic: 4 to 10 words naming what the video is about.",
            "summary: 2 to 3 plain sentences on what it says and the angle it takes.",
            "hook: the opening line or claim used to grab attention, quoted close to verbatim.",
            "keyPoints: 3 to 6 short bullets, the actual claims or steps, no fluff.",
            "format: the content format (talking head tutorial, listicle, story, rant, demo, etc).",
            "cta: what the viewer is asked to do at the end, or empty string if none.",
            "No em dashes. No emoji.",
          ].join(" "),
        },
        {
          role: "user",
          content: `${caption ? `CAPTION:\n${caption.slice(0, 1500)}\n\n` : ""}TRANSCRIPT:\n${transcript.slice(0, 6000)}`,
        },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ollama ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as { message?: { content?: string } };
  const j = extractJson(data.message?.content || text);
  const points = Array.isArray(j.keyPoints) ? j.keyPoints.map(str).filter(Boolean) : [];
  return {
    topic: str(j.topic),
    summary: str(j.summary),
    hook: str(j.hook),
    keyPoints: points,
    format: str(j.format),
    cta: str(j.cta),
  };
}
