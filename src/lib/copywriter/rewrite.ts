import "server-only";
import fs from "node:fs";
import path from "node:path";
import { skillDirName, skillForSource, type CopySkill } from "./skill";
import type { CopySource } from "./store";

export type RewriteResult = {
  skill: CopySkill;
  skillDir: string;
  script: string;
};

function skillPath(skill: CopySkill): string {
  return path.join(process.cwd(), ".claude/skills", skillDirName(skill), "SKILL.md");
}

function loadSkill(skill: CopySkill): string {
  const p = skillPath(skill);
  if (!fs.existsSync(p)) throw new Error(`Skill file missing: ${skillDirName(skill)}`);
  return fs.readFileSync(p, "utf8");
}

function dash(s: string): string {
  return s.replace(/[–—]/g, "-");
}

export async function rewriteInKevinTone(source: CopySource): Promise<RewriteResult> {
  const skill = skillForSource(source);
  if (!source.transcript.trim()) throw new Error("No transcript to convert");
  const key = process.env.OLLAMA_API_KEY || process.env.OLLAMA_KEY;
  if (!key) throw new Error("OLLAMA_API_KEY is not set");
  const skillMd = loadSkill(skill);
  const base = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/$/, "");
  const model = process.env.OLLAMA_TEXT_MODEL || "deepseek-v4-flash:0731";
  const cap = skill === "longform" ? 14000 : 6000;
  const timeout = skill === "longform" ? 180000 : 90000;

  const user = [
    "Rewrite this video into a spoken script in Kevin's voice. Follow the skill file exactly.",
    "Keep the same thesis and the useful claims. Do not copy sentences from the original.",
    "Recast it as something Kevin found, built, or is showing this week. Name real tools and real numbers.",
    "Correct Whisper mishears (Claude Code, Anthropic, GPT Astra, slop, OpenClaw, Ollama, agentic).",
    "No em dashes. No emoji.",
    "",
    `THESIS: ${source.topic || source.title || "(untitled)"}`,
    source.summary ? `ANGLE: ${source.summary}` : "",
    source.hook ? `THEIR HOOK: ${source.hook}` : "",
    source.keyPoints.length ? `KEY POINTS:\n${source.keyPoints.map((k) => `- ${k}`).join("\n")}` : "",
    source.cta ? `THEIR CTA: ${source.cta}` : "",
    source.caption ? `CAPTION:\n${source.caption.slice(0, 1500)}` : "",
    "",
    `TRANSCRIPT:\n${source.transcript.slice(0, cap)}`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeout),
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      messages: [
        { role: "system", content: skillMd },
        { role: "user", content: user },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ollama ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as { message?: { content?: string } };
  const script = dash((data.message?.content || "").trim());
  if (!script) throw new Error("Model returned an empty script");
  return { skill, skillDir: skillDirName(skill), script };
}
