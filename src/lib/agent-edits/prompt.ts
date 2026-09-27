import "server-only";
import fs from "node:fs";
import path from "node:path";
import { SKILL_DIR, SKILL_MD, WORKFLOW_ID } from "./paths";

function resumeSkip(workdir: string): string {
  const has = (rel: string) => fs.existsSync(path.join(workdir, rel));
  const skips: string[] = [];
  if (has("audio/words.json") && has("audio/narration.m4a")) {
    skips.push("- audio/words.json + audio/narration.m4a exist → SKIP Whisper / prep_talking_head.py");
  }
  if (has("renders/talking_band45.mp4")) {
    skips.push("- renders/talking_band45.mp4 exists → SKIP band crop");
  }
  if (has("render.py")) {
    skips.push("- render.py exists → keep it unless it is empty or broken; do not rewrite from scratch");
  }
  const frames = path.join(workdir, "frames", "out5");
  if (fs.existsSync(frames) && fs.readdirSync(frames).some((n) => n.endsWith(".jpg"))) {
    skips.push("- frames/out5 already has jpgs → if the count covers the duration, go straight to ffmpeg encode");
  }
  if (skips.length === 0) return "";
  return `
RESUME (crash / power-loss). Do not redo finished work:
${skips.join("\n")}
Continue from the first missing step. Finish until renders/final.mp4 is 1080x1920.
`;
}

export function buildEditPrompt(opts: {
  workdir: string;
  clipPath: string;
  notes: string;
  sourceUrl: string;
  title: string;
}): string {
  const notes = opts.notes.trim() || "(none)";
  const url = opts.sourceUrl.trim() || "(none — use the talking-head Whisper transcript as the script)";
  return `Run the ${WORKFLOW_ID} skill to completion. This is a Marketing OS Agent Edits job, not a chat. Do not wait for follow-up. Do not stop until renders/final.mp4 exists and ffprobe reports 1080x1920.

Read this skill file first and follow every lock in it:
${SKILL_MD}

Skill directory (templates + scripts):
${SKILL_DIR}

WORKDIR (create/use this project; all outputs land here):
${opts.workdir}

TALKING-HEAD CLIP (required — this footage is the bottom band AND the master audio. Never HeyGen. Never substitute Megan/Danny/Kevin avatars):
${opts.clipPath}

Title / slug hint: ${opts.title}

Kevin's notes / extra script:
${notes}

Optional reference URL (copy/script only — NEVER use its pixels, never download it as the talking head):
${url}

Hard locks (also in SKILL.md — do not drift):
- Final master 1080×1920. If ffprobe is anything else, delete final.mp4 and redo.
- Live band 1056×960 at y=960. Captions at CAP_Y=867. Animation slot AH=770, LAYER_Y=90, PACK_DY=210.
- Graphite look from clone-projects/github-research-agent-animated/render.py; density from clone-projects/china-robots-animated/render.py.
- Topic logo conveyor is required. No em/en dashes in on-screen text. No fal.ai. No 720p.
- Overlay / component type is Oswald Bold (templates/fonts/Oswald-Bold.ttf). Never Arial in the slot. Terminals stay Menlo.
- Intro/hook is a billboard: figure circles 520–620 (or 2-up at 480), numbers counter_card h≥440, standalone logos 360–520. Never 150–220px portrait circles. Body figures ≥280 / ≥320.
- Pipeline: prep_talking_head.py --whisper → script from Whisper/optional URL → fetch_brand_asset / fetch_figure / fetch_giphy → author render.py for THIS script → compose → ffmpeg crf 16 + audio/narration.m4a.
${resumeSkip(opts.workdir)}
When renders/final.mp4 is 1080×1920, print one line: DONE ${opts.workdir}/renders/final.mp4 1080x1920
Then stop.`;
}
