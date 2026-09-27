#!/usr/bin/env node
/**
 * qa-reaction-clips — vision QA for the persona reaction clip banks.
 *
 * Same judge as carousel-qa / qaReactionVideo (Claude vision), adapted for
 * motion: 3 frames per clip (start / mid / end) judged together, plus the
 * persona reference image for identity comparison.
 *
 *   node --env-file=.env.local scripts/qa-reaction-clips.mjs [slug…]
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import llm from "../.claude/lib/llm.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = process.env.OLLAMA_API_KEY;
if (!KEY) throw new Error("OLLAMA_API_KEY not set");
// Images → the llm gateway routes to OLLAMA_VISION_MODEL (Qwen); DeepSeek is text-only.
const MODEL = llm.VISION_MODEL;
const BANKS = path.join(ROOT, ".claude/assets/reaction-clips");
const REFS = {
  megan: path.join(ROOT, ".claude/assets/brand/megan/reference-hero.png"),
  danny: path.join(ROOT, ".claude/assets/brand/danny/reference-hero.png"),
};

const b64 = (p) => fs.readFileSync(p).toString("base64");
const imgBlock = (p, mt = "image/jpeg") => ({
  type: "image",
  source: { type: "base64", media_type: mt, data: b64(p) },
});

function frames(clip, dur) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rqa-"));
  const ts = [0.2, dur / 2, Math.max(dur - 0.3, dur * 0.9)];
  return ts.map((t, i) => {
    const out = path.join(dir, `f${i}.jpg`);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", t.toFixed(2), "-i", clip, "-frames:v", "1", "-q:v", "3", out]);
    return out;
  });
}

async function judge(persona, name, clipPath) {
  const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", clipPath]).toString());
  const [f0, f1, f2] = frames(clipPath, dur);
  const data = await llm.createMessage({
      model: MODEL,
      max_tokens: 500,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "REFERENCE — the persona's canonical face:" },
          imgBlock(REFS[persona], "image/png"),
          { type: "text", text: `Three frames (start / middle / end) from a 5s AI-generated selfie reaction video ("${name}") that will be published on the persona's social accounts:` },
          imgBlock(f0), imgBlock(f1), imgBlock(f2),
          { type: "text", text:
`QA this clip for publishability. FAIL on any of:
- hand/finger defects (wrong count, fused, warped) in ANY frame
- facial deformity, melting/morphing between frames, teeth/eye artifacts
- identity drift: person stops resembling the REFERENCE face, or looks like a DIFFERENT person across the three frames
- warped/impossible objects (cup, shaker, steering wheel, jewelry)
- a physical phone visible ANYWHERE in ANY frame (in hand, on a surface, in a mirror) — the clip is shot FROM the phone's own front camera, so any visible phone breaks the POV
- stray text, captions, watermarks, or logos burned into the video
- anything uncanny enough that a viewer would clock it as AI within 2 seconds

Minor softness, grain, or slight limb blur from motion is FINE (it is meant to look like amateur iPhone footage).

Reply with ONLY JSON: {"pass": bool, "confidence": "high"|"medium"|"low", "issues": ["…"]}` },
        ],
      }],
  });
  const text = (data.content || []).map((c) => c.text || "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : { pass: false, confidence: "low", issues: ["unparseable judge reply: " + text.slice(0, 120)] };
}

const only = process.argv.slice(2);
let fail = 0;
const report = [];
for (const persona of ["megan", "danny"]) {
  const dir = path.join(BANKS, persona);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".mp4")).sort()) {
    if (only.length && !only.some((o) => f.includes(o))) continue;
    const v = await judge(persona, f, path.join(dir, f));
    report.push({ persona, clip: f, ...v });
    const mark = v.pass ? "✓" : "✗";
    console.log(`${mark} ${persona}/${f} [${v.confidence}]${v.issues?.length ? " — " + v.issues.join("; ") : ""}`);
    if (!v.pass) fail++;
  }
}
fs.writeFileSync(path.join(BANKS, "qa-report.json"), JSON.stringify({ model: MODEL, at: new Date().toISOString(), report }, null, 2));
console.log(`\n${report.length - fail} pass / ${fail} fail — wrote ${path.relative(ROOT, path.join(BANKS, "qa-report.json"))}`);
process.exit(fail ? 1 : 0);
