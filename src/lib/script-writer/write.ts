import "server-only";
import fs from "node:fs";
import path from "node:path";
import {
  skillDirName,
  type CopySkill,
} from "@/lib/copywriter/skill";

export type ScriptFormat = CopySkill;

export type ScriptWriterInput = {
  topic: string;
  data?: string;
  format: ScriptFormat;
  ctaWord?: string;
  angle?: string;
};

export type ScriptWriterResult = {
  format: ScriptFormat;
  skillDir: string;
  research: string;
  script: string;
  sources: string[];
};

function loadSkill(skill: CopySkill): string {
  const p = path.join(process.cwd(), ".claude/skills", skillDirName(skill), "SKILL.md");
  if (!fs.existsSync(p)) throw new Error(`Skill file missing: ${skillDirName(skill)}`);
  return fs.readFileSync(p, "utf8");
}

function dash(s: string): string {
  return s.replace(/[–—]/g, "-");
}

function extractUrls(text: string): string[] {
  const re = /https?:\/\/[^\s<>"')\]]+/gi;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.match(re) || []) {
    const u = m.replace(/[.,;:!?)]+$/, "");
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= 6) break;
  }
  return out;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPageText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MarketingOS-ScriptWriter/1.0)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!res.ok) return "";
    const ct = res.headers.get("content-type") || "";
    const raw = await res.text();
    if (/json/i.test(ct)) return raw.slice(0, 8000);
    return stripHtml(raw).slice(0, 8000);
  } catch {
    return "";
  }
}

async function ollamaChat(args: {
  system: string;
  user: string;
  timeoutMs: number;
}): Promise<string> {
  const key = process.env.OLLAMA_API_KEY || process.env.OLLAMA_KEY;
  if (!key) throw new Error("OLLAMA_API_KEY is not set");
  const base = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/$/, "");
  const model = process.env.OLLAMA_TEXT_MODEL || "deepseek-v4-flash:0731";
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(args.timeoutMs),
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ollama ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as { message?: { content?: string } };
  return (data.message?.content || "").trim();
}

async function researchBrief(input: ScriptWriterInput, fetched: { url: string; text: string }[]): Promise<string> {
  const pages = fetched
    .filter((f) => f.text.length > 80)
    .map((f, i) => `SOURCE ${i + 1} (${f.url}):\n${f.text.slice(0, 3500)}`)
    .join("\n\n");

  const user = [
    "Build a tight research brief Kevin can speak from on camera.",
    "Prefer concrete facts, tool names, numbers, dates, and what is new or surprising.",
    "If sources conflict, note it. If something is unknown, say so - do not invent metrics.",
    "Output plain text with short labeled sections:",
    "ANGLE, WHAT IT IS, WHY IT MATTERS, KEY FACTS (bullets), DEMO BEATS, RISKS/CAVEATS, CTA SEED.",
    "No em dashes. No emoji. No script yet.",
    "",
    `TOPIC: ${input.topic}`,
    input.angle ? `KEVIN'S ANGLE HINT: ${input.angle}` : "",
    input.data?.trim() ? `KEVIN'S NOTES / DATA:\n${input.data.trim().slice(0, 6000)}` : "",
    pages ? `\nFETCHED PAGES:\n${pages}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return ollamaChat({
    system:
      "You are Kevin's research producer for @kevbuildsapps / Marketing OS. " +
      "You dig up speakable facts for AI tools, agent workflows, open source, and creator ops. " +
      "Be concrete and skeptical of hype. Prefer primary sources when provided.",
    user,
    timeoutMs: 90_000,
  });
}

async function writeScript(input: ScriptWriterInput, research: string): Promise<string> {
  const skill = input.format;
  const skillMd = loadSkill(skill);
  const cap = skill === "longform" ? 14000 : 6000;
  const timeout = skill === "longform" ? 180_000 : 90_000;

  const user = [
    "Write an ORIGINAL spoken script in Kevin's voice from the brief below. Follow the skill file exactly.",
    "Do not copy sentences from the research brief. Recast as something Kevin found, built, or is showing this week.",
    "Name real tools and real numbers from the brief. No em dashes. No emoji.",
    skill === "shortform"
      ? "This is a Reels / TikTok / Shorts talking-head script."
      : "This is a YouTube long-form script.",
    input.ctaWord?.trim()
      ? `Comment-word CTA (shortform only): use the word "${input.ctaWord.trim()}" in the locked CTA shape.`
      : skill === "shortform"
        ? "Pick a single clear comment-word CTA from the topic."
        : "Use the YouTube CTA pattern from the skill (no comment word).",
    "",
    `TOPIC: ${input.topic}`,
    input.angle ? `ANGLE HINT: ${input.angle}` : "",
    input.data?.trim() ? `RAW NOTES:\n${input.data.trim().slice(0, 3000)}` : "",
    "",
    `RESEARCH BRIEF:\n${research.slice(0, cap)}`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  const script = dash(
    await ollamaChat({
      system: skillMd,
      user,
      timeoutMs: timeout,
    }),
  );
  if (!script) throw new Error("Model returned an empty script");
  return script;
}

export async function writeKevinScript(input: ScriptWriterInput): Promise<ScriptWriterResult> {
  const topic = input.topic.trim();
  if (!topic) throw new Error("Topic is required");
  if (input.format !== "shortform" && input.format !== "longform") {
    throw new Error("Format must be shortform or longform");
  }

  const blob = `${input.data || ""}\n${topic}`;
  const urls = extractUrls(blob);
  const fetched = await Promise.all(
    urls.map(async (url) => ({ url, text: await fetchPageText(url) })),
  );
  const usable = fetched.filter((f) => f.text.length > 80);

  const research = dash(await researchBrief(input, usable));
  if (!research) throw new Error("Research pass returned empty");

  const script = await writeScript(input, research);
  return {
    format: input.format,
    skillDir: skillDirName(input.format),
    research,
    script,
    sources: usable.map((u) => u.url),
  };
}
