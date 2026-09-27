#!/usr/bin/env node
/**
 * reaction-ugc — the beat-synced reaction meme, end to end:
 *
 *   1. reaction clip (rotates through .claude/assets/reaction-clips)
 *   2. black card — "as a creator, I can't believe I never knew…"
 *   3. BEFORE analytics screenshot (day-1 numbers)
 *   4. AFTER analytics screenshot (the glow-up)
 *   5. CreatorOS receipts screenshot + link-in-bio label
 *
 * All five pieces are cut into ONE 9:16 video timed to the beat grid of a
 * trending sound from the favorites rotation (same BPM detection as the IG
 * slideshow Reel): the reaction clip is trimmed to a whole number of beats,
 * then each still lands on the beat — fast-paced meme pacing.
 *
 * Distribution: TikTok video post + Instagram Reel (contentType 'reels',
 * shareToFeed). `--ig-carousel` posts IG as a feed carousel instead
 * (reaction video first + the 4 stills).
 *
 * SAFETY: dry-run by default — builds the video for local review. --publish
 * to go live. Sound is only marked used on publish.
 *
 * Usage:
 *   node --env-file=.env.local reaction-ugc.js [--persona danny]
 *        [--clip <name-substring>] [--sound <id>] [--ig-carousel] [--publish]
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { Pool } = require("pg");
const { loadPersona, closePersonaPool } = require("../../../lib/persona");
const { writeSeoCaptions } = require("../../../lib/seo-caption");

const ROOT_DIR = path.join(__dirname, "..", "..", ".."); // creator-os/.claude
const REPO_ROOT = path.join(ROOT_DIR, "..");
const TEMPLATE = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "templates", "reaction.json"), "utf8"));
const ZERNIO_BASE = process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1";
const INSFORGE_BASE = process.env.INSFORGE_API_BASE_URL || "";
const INSFORGE_KEY = process.env.INSFORGE_API_KEY || "";
const BUCKET = "media";

const FONTS_DIR = path.join(ROOT_DIR, "assets", "fonts");
const first = (...c) => c.find((f) => fs.existsSync(f)) || c[c.length - 1];
const BOLD = first("/System/Library/Fonts/Supplemental/Arial Bold.ttf", path.join(FONTS_DIR, "Arimo-Bold.ttf"));

function parseArgs() {
  const a = process.argv.slice(2);
  // Default target is the Creator OS BRANDED socials (@creator_oss /
  // @creator.os) — captions speak as the brand; the on-screen meme text stays
  // creator-voice (that's the meme). Personas megan/danny remain available.
  const o = { persona: "creatoros", clip: null, sound: null, publish: false, igCarousel: false, slot: 0, force: false, hook: null, cards: false, reveal: true, angle: null };
  for (let i = 0; i < a.length; i++) {
    switch (a[i]) {
      case "--persona": o.persona = a[++i]; break;
      case "--clip": o.clip = a[++i]; break;
      case "--sound": o.sound = a[++i]; break;
      // Force a specific feature angle (by id) instead of the seed rotation.
      case "--angle": o.angle = a[++i]; break;
      // Limit distribution, e.g. --platforms instagram (default: all).
      case "--platforms": o.platforms = a[++i].split(",").map((s) => s.trim().toLowerCase()); break;
      case "--publish": o.publish = true; break;
      case "--dry-run": o.publish = false; break;
      case "--ig-carousel": o.igCarousel = true; break;
      case "--slot": o.slot = parseInt(a[++i], 10) || 0; break;
      case "--force": o.force = true; break;
      // Override the on-video hook text (must stay VAGUE — see teaser rule).
      case "--hook": o.hook = a[++i]; break;
      // Legacy answer-cards format (clip + card + before/after/receipts).
      // Kevin 2026-07-06: OFF by default — the video must NOT answer the hook;
      // the caption does the explaining, the vagueness drives the rewatch.
      case "--cards": o.cards = true; break;
      // DEFAULT since 2026-07-07: reaction → wordless app reveal. TikTok data
      // killed the pure-teaser format (asain-girl reveal clip 419+432 views vs
      // ginger 1 / blonde 0). --teaser forces the old pure-reaction A/B.
      case "--reveal": o.reveal = true; break;
      case "--teaser": o.reveal = false; break;
      default: throw new Error(`Unknown arg: ${a[i]}`);
    }
  }
  return o;
}

const dayIndex = Math.floor(Date.now() / 86400000);
const pick = (bank, offset = 0) => bank[(dayIndex + offset) % bank.length];

// ── ffmpeg helpers ───────────────────────────────────────────────────────────
function probeDuration(p) {
  return parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).toString().trim());
}

// Same dependency-free BPM detector as carousel-publish-instagram.
function detectBPM(audioPath) {
  try {
    const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", audioPath, "-ac", "1", "-ar", "11025", "-t", "60", "-f", "s16le", "pipe:1"], { maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
    const hop = 256;
    const frames = Math.floor(pcm.length / 2 / hop);
    if (frames < 200) return null;
    const energy = new Float64Array(frames);
    for (let f = 0; f < frames; f++) {
      let s = 0;
      for (let i = f * hop; i < (f + 1) * hop; i++) { const v = pcm.readInt16LE(i * 2) / 32768; s += v * v; }
      energy[f] = s;
    }
    const onset = new Float64Array(frames);
    for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f] - energy[f - 1]);
    const fps = 11025 / hop;
    let best = { bpm: 0, score: -1 };
    for (let bpm = 70; bpm <= 180; bpm++) {
      const lag = Math.round((fps * 60) / bpm);
      let s = 0;
      for (let f = 0; f < frames - lag; f++) s += onset[f] * onset[f + lag];
      if (s > best.score) best = { bpm, score: s };
    }
    if (!best.bpm) return null;
    let bpm = best.bpm;
    while (bpm < 80) bpm *= 2;
    while (bpm > 160) bpm /= 2;
    return Math.round(bpm);
  } catch { return null; }
}

function wrap(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= maxChars) line += " " + w;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

// drawtext can't render color emoji — strip pictographs before rasterizing.
// Em/en dashes and ---/-- are BANNED from on-screen text (Kevin: "makes it
// obviously AI") — replaced with a plain human-typed hyphen.
const deEmoji = (s) => String(s)
  .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2764}]/gu, "")
  .replace(/\s*[—–]\s*|\s+-{2,}\s+/g, " - ")
  .replace(/\s+/g, " ")
  .trim();

// Black card: white bold text centered on a 1080x1920 black frame.
function buildCard(text, outPath) {
  const lines = wrap(deEmoji(text), 22);
  const size = lines.length > 5 ? 58 : 66;
  const lh = Math.round(size * 1.4);
  const blockH = lines.length * lh;
  const y0 = Math.round((1920 - blockH) / 2);
  const filters = [];
  const tmp = [];
  lines.forEach((l, i) => {
    const tf = path.join(os.tmpdir(), `rcard-${Date.now()}-${i}.txt`);
    fs.writeFileSync(tf, l);
    tmp.push(tf);
    filters.push(`drawtext=fontfile='${BOLD}':textfile='${tf}':fontsize=${size}:fontcolor=white:x=(w-text_w)/2:y=${y0 + i * lh}`);
  });
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:d=1", "-vf", filters.join(","), "-frames:v", "1", outPath], { stdio: "pipe", timeout: 60000 });
  for (const t of tmp) fs.unlinkSync(t);
}

// Screenshot still: cover-fit to 1080x1920 with an optional top label.
function buildStill(srcRel, label, outPath, boxed = false) {
  const src = path.isAbsolute(srcRel) ? srcRel : path.join(REPO_ROOT, srcRel);
  if (!fs.existsSync(src)) throw new Error(`still not found: ${src}`);
  const filters = ["scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1"];
  const tmp = [];
  if (label) {
    const lines = wrap(deEmoji(label), 20);
    lines.forEach((l, i) => {
      const tf = path.join(os.tmpdir(), `rlabel-${Date.now()}-${i}.txt`);
      fs.writeFileSync(tf, l);
      tmp.push(tf);
      // boxed = solid black band behind each line, block dead-centered on
      // screen (Kevin 2026-07-07: solid background + center placement reads
      // best for the reveal explain text); lines overlap their boxes slightly
      // so the band looks continuous.
      const centerY = `(h-text_h)/2+${Math.round((i - (lines.length - 1) / 2) * 78)}`;
      filters.push(boxed
        ? `drawtext=fontfile='${BOLD}':textfile='${tf}':fontsize=52:fontcolor=white:box=1:boxcolor=black:boxborderw=16:x=(w-text_w)/2:y=${centerY}`
        : `drawtext=fontfile='${BOLD}':textfile='${tf}':fontsize=52:fontcolor=white:borderw=3:bordercolor=black@0.85:shadowcolor=black@0.6:shadowx=0:shadowy=3:x=(w-text_w)/2:y=${120 + i * 68}`);
    });
  }
  execFileSync("ffmpeg", ["-y", "-i", src, "-vf", filters.join(","), outPath], { stdio: "pipe", timeout: 60000 });
  for (const t of tmp) fs.unlinkSync(t);
}

// Boxed dead-center text (Kevin 2026-07-07: solid black band + center reads
// best over app footage). Optional enable window time-gates the lines so one
// b-roll segment can carry the reveal text, then swap to the payoff text.
function boxedTextFilters(text, tmpFiles, enable) {
  const lines = wrap(deEmoji(text), 20);
  const en = enable ? `:enable='${enable}'` : "";
  return lines
    .map((l, i) => {
      const tf = path.join(os.tmpdir(), `rbox-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.txt`);
      fs.writeFileSync(tf, l);
      tmpFiles.push(tf);
      const centerY = `(h-text_h)/2+${Math.round((i - (lines.length - 1) / 2) * 78)}`;
      return `drawtext=fontfile='${BOLD}':textfile='${tf}':fontsize=52:fontcolor=white:box=1:boxcolor=black:boxborderw=16:x=(w-text_w)/2:y=${centerY}${en}`;
    })
    .join(",");
}

// ── Reaction window (Kevin 2026-07-10) ──────────────────────────────────────
// Every reaction clip plays in SLO-MO, starts right BEFORE the reaction
// begins (the calm lead-in is trimmed off), and cuts to the b-roll at the
// PEAK of the reaction — never the aftermath. A Claude vision pass finds the
// two timestamps; the result is cached in a sidecar json next to the clip so
// cron runs don't re-analyze the same bank clip.
const WINDOW_SCHEMA = {
  type: "object",
  properties: { start: { type: "number" }, peak: { type: "number" } },
  required: ["start", "peak"],
  additionalProperties: false,
};

async function analyzeReactionWindow(clipPath) {
  const cachePath = clipPath.replace(/\.(mov|mp4)$/i, ".window.json");
  if (fs.existsSync(cachePath)) {
    try {
      const c = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      if (Number.isFinite(c.start) && Number.isFinite(c.peak)) return c;
    } catch {}
  }
  const dur = probeDuration(clipPath);
  const fallback = {
    start: Math.min(0.8, dur * 0.15),
    peak: Math.max(Math.min(0.8, dur * 0.15) + 1.2, dur * 0.65),
    source: "heuristic",
  };
  if (!OLLAMA_KEY) return fallback;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rwin-"));
  try {
    const STEP = 0.4;
    const times = [];
    for (let t = 0.1; t <= dur - 0.1; t += STEP) times.push(Number(t.toFixed(2)));
    const content = [{
      type: "text",
      text:
        `These are ${times.length} frames sampled from a ${dur.toFixed(1)}s selfie reaction video, in order, with their timestamps. The person starts calm/neutral, then something happens (a facial reaction, or an off-frame gag like paint/water/glitter hitting them) and their reaction builds to a peak.\n\nIdentify two timestamps:\n1. "start": the LAST calm moment right before the reaction begins (just before the first visible change — the flinch, the impact, the eyes widening).\n2. "peak": the moment the reaction is at MAXIMUM intensity (most extreme expression, or the gag's most dramatic visible moment — mid-impact, not the settled aftermath).\n\nReply with ONLY JSON: {"start": <seconds>, "peak": <seconds>}`,
    }];
    times.forEach((t, i) => {
      const f = path.join(tmpDir, `f${i}.jpg`);
      execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(t), "-i", clipPath, "-frames:v", "1", "-q:v", "5", "-vf", "scale=360:-1", f], { stdio: "pipe", timeout: 30000 });
      content.push({ type: "text", text: `t=${t}s:` });
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: fs.readFileSync(f).toString("base64") } });
    });
    // Schema-gated: without it Qwen wraps the numbers in prose and the window
    // silently degrades to the heuristic (seen on the 08-11 provider swap).
    const data = await createMessage({
      model: QA_MODEL,
      max_tokens: 400,
      output_config: { format: { type: "json_schema", schema: WINDOW_SCHEMA } },
      messages: [{ role: "user", content }],
    });
    const j = JSON.parse((data.content || []).map((c) => c.text || "").join(""));
    let start = Number(j.start), peak = Number(j.peak);
    if (!Number.isFinite(start) || !Number.isFinite(peak)) throw new Error("non-numeric window");
    start = Math.max(0, Math.min(start, dur - 1));
    // The peak must leave a real span to slow down — floor it at 0.8s past
    // start, cap at the clip end.
    peak = Math.min(dur, Math.max(peak, start + 0.8));
    const win = { start, peak, source: "vision" };
    try { fs.writeFileSync(cachePath, JSON.stringify(win)); } catch {}
    return win;
  } catch (e) {
    console.warn(`  ! reaction-window analysis failed (${e.message}) — heuristic window`);
    return fallback;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Reaction clip (+ optional app B-ROLL segment) (+ stills in legacy cards
// mode) → one beat-cut 9:16 video with the sound across.
// hookText is burned onto the reaction clip, block dead-centered on screen.
// broll = { path, payoffPath?, revealText, payoffText, revealBeats,
//           payoffBeats, minTextSeconds }:
// screen-recorded app footage follows the clip; the reveal text names the
// app, then the payoff text lands the benefit (Kevin 2026-07-08 — 3-beat
// text path: hook → "an app that manages all your socials at once" → "this
// saves me hours every day"). Each text window is floored to minTextSeconds
// (rounded UP to whole beats) — Kevin 2026-07-08 pm: the demo went by too
// fast to read. payoffPath switches to a second demo clip for the payoff
// beat instead of freezing/continuing the first.
function buildVideo(clipPath, stills, audioPath, outPath, hookText, broll, window) {
  const CLIP_MAX = 5; // Kevin: the reaction clip is NEVER longer than 5s
  const SLOMO_TARGET = 2.0; // Kevin 2026-07-10: all reaction clips play slo-mo
  const bpm = detectBPM(audioPath);
  const spb = bpm ? 60 / bpm : 0.5;
  const clipNatural = probeDuration(clipPath);
  // Slo-mo reaction window (Kevin 2026-07-10): play only [just before the
  // reaction starts → the reaction PEAK], stretched ~2x, snapped to whole
  // beats and capped at CLIP_MAX on screen.
  const win = window || { start: 0, peak: Math.min(clipNatural, CLIP_MAX) };
  const inPoint = Math.max(0, win.start - 0.25);
  const outPoint = Math.min(clipNatural, Math.max(win.peak, inPoint + 0.8));
  const srcDur = outPoint - inPoint;
  const maxBeats = Math.max(2, Math.floor(CLIP_MAX / spb));
  const clipBeats = Math.min(maxBeats, Math.max(2, Math.round((srcDur * SLOMO_TARGET) / spb)));
  const clipT = clipBeats * spb;
  const slomo = clipT / srcDur; // actual stretch factor (≈2x after beat-snap)
  // B-roll → one segment per text window, each stays on the beat grid.
  // broll.texts = [{ path, text, beats }] — consecutive windows on the SAME
  // file continue the footage (per-file cursor) instead of restarting it.
  let brollSegs = [];
  if (broll) {
    const beatsFor = (b) => Math.max(b, Math.ceil((broll.minTextSeconds || 0) / spb));
    const cursors = new Map();
    brollSegs = broll.texts.map((t) => {
      const dur = beatsFor(t.beats) * spb;
      const ss = cursors.get(t.path) || 0;
      cursors.set(t.path, ss + dur);
      return { path: t.path, ss, dur, text: t.text };
    });
  }
  const brollT = brollSegs.reduce((a, s) => a + s.dur, 0);
  const durs = stills.map((s) => s.beats * spb);
  const total = clipT + brollT + durs.reduce((a, b) => a + b, 0);

  const args = ["-y", "-ss", inPoint.toFixed(3), "-t", srcDur.toFixed(3), "-i", clipPath];
  brollSegs.forEach((s) => {
    if (s.ss) args.push("-ss", s.ss.toFixed(3));
    args.push("-t", s.dur.toFixed(3), "-i", s.path);
  });
  stills.forEach((s, i) => args.push("-loop", "1", "-t", durs[i].toFixed(3), "-framerate", "30", "-i", s.path));
  args.push("-stream_loop", "-1", "-i", audioPath);

  const n = 1 + brollSegs.length + stills.length;
  // Hook text over the clip: wrapped bold white lines with outline+shadow,
  // block DEAD CENTER of the screen (Kevin 2026-07-08: the first on-screen
  // text was at the top; all reaction UGC hooks now sit mid-screen).
  const tmp = [];
  let hookFilters = "";
  if (hookText) {
    const lines = wrap(deEmoji(hookText), 22);
    const size = lines.length > 3 ? 54 : 60;
    const lh = Math.round(size * 1.32);
    const block = lines.length * lh;
    hookFilters = lines
      .map((l, i) => {
        const tf = path.join(os.tmpdir(), `rhook-${Date.now()}-${i}.txt`);
        fs.writeFileSync(tf, l);
        tmp.push(tf);
        return `drawtext=fontfile='${BOLD}':textfile='${tf}':fontsize=${size}:fontcolor=white:borderw=3:bordercolor=black@0.85:shadowcolor=black@0.6:shadowx=0:shadowy=3:x=(w-text_w)/2:y=(h-${block})/2+${i * lh}`;
      })
      .join(",");
    hookFilters = "," + hookFilters;
  }
  // B-roll normalization: pad by cloning the last frame if the footage is
  // shorter than the beat window, then trim to EXACTLY the window so every
  // cut stays on the grid. Each segment carries its own boxed text.
  const brollChains = brollSegs.map((s, i) =>
    `[${i + 1}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,` +
    `tpad=stop_mode=clone:stop_duration=${s.dur.toFixed(3)},trim=duration=${s.dur.toFixed(3)},setpts=PTS-STARTPTS,` +
    `format=yuv420p,${boxedTextFilters(s.text, tmp, null)}[v${i + 1}]`,
  );
  const stillBase = 1 + brollSegs.length;
  const norm = [
    // setpts BEFORE fps: stretch the source frames (slo-mo), then resample to
    // 30fps (duplicated frames — the standard TikTok slo-mo look), then trim
    // to exactly the beat window.
    `[0:v]setpts=${slomo.toFixed(4)}*PTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,trim=duration=${clipT.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p${hookFilters}[v0]`,
    ...brollChains,
    ...stills.map((_, i) => `[${stillBase + i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p[v${stillBase + i}]`),
  ].join(";");
  const concat = Array.from({ length: n }, (_, i) => `[v${i}]`).join("") + `concat=n=${n}:v=1:a=0[v]`;
  const audio = `[${n}:a]atrim=0:${total.toFixed(3)},afade=t=out:st=${Math.max(0, total - 0.5).toFixed(3)}:d=0.5[a]`;
  args.push(
    "-filter_complex", `${norm};${concat};${audio}`,
    "-map", "[v]", "-map", "[a]",
    "-t", total.toFixed(3),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", "30",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    outPath,
  );
  execFileSync("ffmpeg", args, { stdio: "pipe", timeout: 300000 });
  for (const t of tmp) if (fs.existsSync(t)) fs.unlinkSync(t);
  return { bpm, spb, clipT, total, slomo, window: { in: inPoint, out: outPoint }, segs: brollSegs.map((s) => ({ dur: s.dur, text: s.text })) };
}

// ── QA gate (vision, same pattern as carousel-qa) ───────────────────────────
// Judges frames pulled from the FINAL rendered video, so it catches assembly
// bugs (missing reveal, clipped text) that per-asset checks can't see.
const { createMessage, VISION_MODEL } = require("../../../lib/llm");
const OLLAMA_KEY = process.env.OLLAMA_API_KEY;
// Frames are images → routes to OLLAMA_VISION_MODEL (Qwen); DeepSeek is text-only.
const QA_MODEL = process.env.QA_MODEL || VISION_MODEL;
const REACTION_QA_SCHEMA = {
  type: "object",
  properties: {
    pass: { type: "boolean" },
    failures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          frame: { type: "integer" },
          reason: { type: "string" },
        },
        required: ["frame", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["pass", "failures"],
  additionalProperties: false,
};

function extractFrame(videoPath, t, outPath) {
  execFileSync("ffmpeg", ["-y", "-ss", t.toFixed(2), "-i", videoPath, "-frames:v", "1", outPath], { stdio: "pipe", timeout: 60000 });
}

// brollFrames = [{ t, text, label }] — one entry per b-roll text window
// (reveal / payoff / mega payoff), sampled at its midpoint with the exact
// expected on-screen text. Empty for cards/teaser modes.
async function qaReactionVideo(videoPath, clipT, total, hookText, dir, hasObjectShots, brollFrames) {
  if (!OLLAMA_KEY) throw new Error("OLLAMA_API_KEY not set — the reaction QA gate requires it (add to creator-os/.env.local / Railway)");
  const f1 = path.join(dir, "qa-frame-1.png");
  extractFrame(videoPath, Math.min(0.6, clipT / 2), f1);
  const frames = (brollFrames ?? []).map((bf, i) => {
    const fp = path.join(dir, `qa-frame-${i + 2}.png`);
    extractFrame(videoPath, Math.min(bf.t, total - 0.15), fp);
    return { ...bf, path: fp, n: i + 2 };
  });
  // Cards mode (object shots, no per-window texts) and pure-teaser mode still
  // get a generic second frame.
  if (!frames.length) {
    const fp = path.join(dir, "qa-frame-2.png");
    extractFrame(
      videoPath,
      hasObjectShots ? Math.min(clipT + (total - clipT) / 2, total - 0.15) : Math.max(clipT - 0.4, clipT / 2),
      fp,
    );
    frames.push({ path: fp, n: 2, text: null, label: hasObjectShots ? "an app screenshot card" : null });
  }

  const img = (p) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: fs.readFileSync(p).toString("base64") } });
  const frameBlocks = frames.flatMap((f2) => [
    {
      type: "text",
      text:
        f2.text == null && !hasObjectShots
          ? `FRAME ${f2.n} — later in the same reaction clip (same person, reaction still in frame, hook text still legible):`
          : `FRAME ${f2.n} — ${f2.label ?? "app footage"} (should show real app UI being reacted to — NOT the person again, NOT a black/blank frame — with a readable text line burned on). THIS IS APP DEMO FOOTAGE: a phone or device showing the app is EXPECTED here and is NOT a defect:`,
    },
    img(f2.path),
  ]);
  const frameRules = frames
    .map((f2, i) =>
      f2.text != null
        ? `${4 + i}. Frame ${f2.n} does not show app UI footage, or its text is missing, cut off at the edges, or unreadable. It should read: "${f2.text}"\n`
        : hasObjectShots
          ? `${4 + i}. Frame ${f2.n} does not show an object being reacted to (it is the person again, black, blank, or unrecognizable), or its overlay text is cut off or unreadable.\n`
          : `${4 + i}. Frame ${f2.n} is black, blank, glitched, or shows something other than the same reacting person.\n`,
    )
    .join("");
  const body = {
    model: QA_MODEL,
    max_tokens: 3000,
    output_config: { format: { type: "json_schema", schema: REACTION_QA_SCHEMA } },
    system:
      "You are a strict publish gate for short-form reaction memes. Judge ONLY what is visible. Return pass=false with concrete reasons on any failure.",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "FRAME 1 — mid-reaction (should be a person visibly reacting with shock/surprise, with meme hook text burned on):" },
        img(f1),
        ...frameBlocks,
        {
          type: "text",
          text:
            `The hook text burned on frame 1 should read: "${hookText}"\n\n` +
            "FAIL if any of these hold:\n" +
            "1. Frame 1 has no visible person, or the person is not plausibly reacting.\n" +
            // Kevin 2026-07-10: a phone in the reaction clip is a MASSIVE
            // problem — the clip is selfie-POV (the person films themselves),
            // so a second phone in frame breaks the POV and is usually a
            // warped AI artifact (rear cameras facing the holder). B-roll
            // frames are exempt — the app demo footage deliberately shows a
            // phone.
            // Qwen (2026-08-11 provider swap) read the old parenthetical
            // exemption as advisory and failed every b-roll frame for showing
            // a phone, blocking 100% of publishes. Scope it explicitly.
            "1b. A phone, tablet, or any handheld device is visible in FRAME 1, or in any other frame that shows the REACTING PERSON. The reaction clip is selfie-POV, so no device may appear in the person's hands or in frame. Hands, glasses, cups and props that are not phones/tablets are fine.\n" +
            "    SCOPE — READ CAREFULLY: rule 1b applies ONLY to frames showing the reacting person. The app-footage frames listed above are DEMO FOOTAGE of the product: a phone, tablet, screen or app UI in those frames is INTENDED and MUST NOT be reported as a failure. Never fail an app-footage frame for containing a device.\n" +
            "2. The hook text is missing, cut off at the edges, unreadable, or overlaps the face so badly the reaction is hidden.\n" +
            "3. The hook text ANSWERS the mystery (names an app, a feature, a price, or explains what was discovered) — it must be vague curiosity bait.\n" +
            frameRules +
            `${4 + frames.length}. Any frame has rendering glitches: tofu boxes, warped UI, watermark, half-rendered text.\n\n` +
            "Return the structured verdict.",
        },
      ],
    }],
  };
  const json = await createMessage(body);
  const textBlock = (json.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("QA judge returned no text block");
  return JSON.parse(textBlock.text);
}

// ── Sound rotation ───────────────────────────────────────────────────────────
// Kevin 2026-07-06: each trending sound gets used ONCE until we find a winner
// (winners get pinned via --sound). Queue order (Kevin 2026-07-08): VIP lane
// first — sounds Kevin drops in with an active vip_until window ride the top
// and MAY repeat (LRU among VIPs) while the boost lasts; then fresh favorites
// NEWEST-first (trending boosts decay in days, so oldest-first wasted them);
// dry pool falls back to least-recently-used with a loud warning.
async function pickSound(pool, soundId, gender) {
  const where = soundId
    ? { sql: "id = $1", params: [soundId] }
    : gender === "any"
      ? { sql: "favorite and not hidden", params: [] }
      : { sql: "favorite and not hidden and gender in ($1, 'any')", params: [gender] };
  const vip = await pool.query(
    `select id, title, author, duration, audio_url from sounds
     where ${where.sql} and audio_url is not null and vip_until > now()
     order by last_used_at asc nulls first, created_at desc limit 1`,
    where.params,
  );
  if (vip.rows.length) {
    console.log(`  ★ VIP sound '${vip.rows[0].title}' (window open)`);
    return vip.rows[0];
  }
  const fresh = await pool.query(
    `select id, title, author, duration, audio_url from sounds
     where ${where.sql} and audio_url is not null and coalesce(used_count, 0) = 0
     order by created_at desc limit 1`,
    where.params,
  );
  if (fresh.rows.length) return fresh.rows[0];
  const { rows } = await pool.query(
    `select id, title, author, duration, audio_url from sounds
     where ${where.sql} and audio_url is not null
     order by checked asc, last_used_at asc nulls first, used_count asc limit 1`,
    where.params,
  );
  if (!rows.length) throw new Error("No favorited sound available (favorite some in the Sounds tab)");
  console.warn(`  ! every favorited sound has been used once — reusing LRU '${rows[0].title}'. Favorite fresh sounds (or run trending-sounds) to keep the one-use rule.`);
  return rows[0];
}

async function markSoundUsed(pool, id) {
  await pool.query(`update sounds set checked = true, used_count = coalesce(used_count,0)+1, last_used_at = now() where id = $1`, [id]);
}

// ── Insforge + Zernio (same flows as the other publishers) ──────────────────
async function uploadToInsforge(localPath, contentType) {
  // Insforge storage has intermittent 503 windows (07-25 killed two thread
  // slots mid-publish) — retry the whole strategy→upload→confirm flow.
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) {
      console.warn(`  ! storage upload failed (${lastErr.message}) — retry ${attempt}/2`);
      await new Promise((r) => setTimeout(r, 4000 * attempt));
    }
    try {
      return await uploadToInsforgeOnce(localPath, contentType);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function uploadToInsforgeOnce(localPath, contentType) {
  // Unique per upload — same-named files from concurrent cron jobs raced in
  // Insforge and swapped URLs (megan video on danny tiktok, 2026-07-08).
  const filename = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${path.basename(localPath)}`;
  const buf = fs.readFileSync(localPath);
  const auth = { Authorization: `Bearer ${INSFORGE_KEY}` };
  const s = await (await fetch(`${INSFORGE_BASE}/api/storage/buckets/${BUCKET}/upload-strategy`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType, size: buf.length }),
  })).json();
  if (s.method === "presigned") {
    const fd = new FormData();
    for (const [k, v] of Object.entries(s.fields ?? {})) fd.append(k, v);
    fd.append("file", new Blob([buf], { type: contentType }), filename);
    const up = await fetch(s.uploadUrl, { method: "POST", body: fd });
    if (up.status < 200 || up.status >= 300) throw new Error(`storage upload ${up.status}`);
    const cf = await (await fetch(`${INSFORGE_BASE}${s.confirmUrl}`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ size: buf.length, contentType }),
    })).json();
    return cf.url;
  }
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: contentType }), filename);
  const j = await (await fetch(`${INSFORGE_BASE}${s.uploadUrl}`, { method: "PUT", headers: auth, body: fd })).json();
  return j.url || `${INSFORGE_BASE}/api/storage/buckets/${BUCKET}/objects/${s.key}`;
}

async function publishToZernio(body) {
  const res = await fetch(`${ZERNIO_BASE}/posts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Zernio ${res.status}: ${JSON.stringify(data)}`);
  return data.post?._id || data.post?.id || data._id || data.id || null;
}

async function recordContentPost(pool, slug, id, postId, caption, platform, meta) {
  try {
    await pool.query(
      `insert into content_posts (persona, carousel_id, zernio_post_id, content, media_urls, platforms, status, posted_at, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [slug, id, postId, caption, JSON.stringify([]), JSON.stringify([platform]), "published", new Date().toISOString(), JSON.stringify(meta)],
    );
  } catch (e) { console.error(`  ! content_posts record failed (post is live): ${e.message}`); }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();
  const p = TEMPLATE.personas[opts.persona];
  if (!p) throw new Error(`No reaction template for persona '${opts.persona}'`);
  const persona = await loadPersona(ROOT_DIR, opts.persona);

  // Rotation seed advances once per SLOT: angle cycles fastest, the line
  // within an angle advances once per full angle cycle — all 100 hook/card
  // pairs get used before any repeats. Stride 8 (not runs-per-day) so up to
  // 8 slots/day never collide with the next day's slot 0 (2026-07-10: personas
  // ramped to 6 reaction slots/day, brand to 4 — the old stride of 4 made
  // today's slot 4 reuse tomorrow's slot-0 picks).
  const seed = dayIndex * 8 + opts.slot;
  const seedPick = (bank, offset = 0) => bank[(seed + offset) % bank.length];

  // 1. Pick the reaction clip — slot rotation, or --clip substring match.
  // Personas with their own bank draw from it; creatoros keeps the shared
  // root clips. A persona bank lives locally at clips_dir/<slug>/ (dev) or as
  // template personas.<slug>.clips Insforge URLs (prod — the mp4s are too
  // heavy for the Railway upload, so they're fetched on demand and cached).
  const rootClipsDir = path.join(REPO_ROOT, TEMPLATE.clips_dir);
  const personaClipsDir = path.join(rootClipsDir, opts.persona);
  const localBank = fs.existsSync(personaClipsDir)
    ? fs.readdirSync(personaClipsDir).filter((f) => /\.(mov|mp4)$/i.test(f))
    : [];
  const remoteBank = p.clips || []; // [{name, url}]
  let clipsDir, clips;
  if (localBank.length) {
    clipsDir = personaClipsDir;
    clips = localBank.sort();
  } else if (remoteBank.length) {
    clipsDir = path.join(os.tmpdir(), "reaction-clips-cache", opts.persona);
    fs.mkdirSync(clipsDir, { recursive: true });
    clips = remoteBank.map((c) => c.name).sort();
  } else {
    clipsDir = rootClipsDir;
    clips = fs.readdirSync(clipsDir).filter((f) => /\.(mov|mp4)$/i.test(f)).sort();
  }
  if (!clips.length) throw new Error(`No clips in ${clipsDir}`);
  // LRU rotation (Kevin 2026-07-07: cycle the WHOLE bank before any repeat —
  // the old clips_preferred weighting re-picked "asain girl" ~70% of runs;
  // it existed to favor clips with a built-in reveal beat, obsolete now that
  // the pipeline appends an explain-text reveal to every clip). Usage comes
  // from content_posts metadata.reaction_clip, so it's cross-machine correct;
  // never-used clips sort first, ties break alphabetically.
  let clipName;
  if (opts.clip) {
    clipName = clips.find((c) => c.toLowerCase().includes(opts.clip.toLowerCase()));
  } else {
    const lastUsed = new Map();
    if (process.env.DATABASE_URL) {
      try {
        const lru = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
        const { rows } = await lru.query(
          `select metadata->>'reaction_clip' as clip, max(posted_at) as at
             from content_posts
            where persona = $1 and metadata->>'reaction_clip' is not null
            group by 1`,
          [opts.persona],
        );
        await lru.end();
        for (const r of rows) lastUsed.set(r.clip, new Date(r.at).getTime());
      } catch (e) {
        console.warn(`  ! clip LRU lookup failed (seed-rotation fallback): ${e.message}`);
      }
    }
    clipName = lastUsed.size
      ? [...clips].sort((a, b) => (lastUsed.get(a) ?? 0) - (lastUsed.get(b) ?? 0) || a.localeCompare(b))[0]
      : seedPick(clips);
  }
  if (!clipName) throw new Error(`No clip matching '${opts.clip}'`);
  const clipPath = path.join(clipsDir, clipName);
  if (!fs.existsSync(clipPath)) {
    const remote = (p.clips || []).find((c) => c.name === clipName);
    if (!remote) throw new Error(`Clip ${clipName} missing locally and has no remote URL`);
    console.log(`  ↓ fetching ${clipName} from storage…`);
    const res = await fetch(remote.url);
    if (!res.ok) throw new Error(`clip download ${res.status}: ${remote.url}`);
    fs.writeFileSync(clipPath, Buffer.from(await res.arrayBuffer()));
  }

  // 2. Feature angle + paired hook/card (the OMG reaction stays constant; the
  // ANGLE varies: post-everywhere, time-saved, consistency, clients, …).
  const angle = opts.angle
    ? TEMPLATE.angles.find((x) => x.id === opts.angle) ??
      (() => { throw new Error(`Unknown angle '${opts.angle}' (ids: ${TEMPLATE.angles.map((x) => x.id).join(", ")})`); })()
    : seedPick(TEMPLATE.angles);
  const pair = angle.lines[Math.floor(seed / TEMPLATE.angles.length) % angle.lines.length];
  // Teaser rule (Kevin 2026-07-06): the on-video hook must be VAGUE AND BROAD
  // ("OMG I CANT BELIEVE THIS") — it never answers what was discovered. The
  // caption carries the answer. Angle hooks only appear in legacy --cards mode.
  // Hook bank = shared hooks + the persona's gender-coded ones ("girl…
  // GIRL." landed on Danny's gym clip on 2026-07-08 — female-coded hooks now
  // live in vague_hooks_female). Persona-name offset de-syncs the rotation so
  // same-day slots across personas don't all pick the same hook.
  const genderHooks =
    p.sound_gender === "female" ? TEMPLATE.vague_hooks_female
    : p.sound_gender === "male" ? TEMPLATE.vague_hooks_male
    : null;
  const hookBank = [...(TEMPLATE.vague_hooks || []), ...(genderHooks || [])];
  const personaOffset = [...opts.persona].reduce((s, c) => s + c.charCodeAt(0), 0);
  const hookLine = opts.hook
    ? opts.hook
    : opts.cards
      ? pair.hook
      : seedPick(hookBank.length ? hookBank : [pair.hook], personaOffset);
  const cardLine = pair.card;
  const beforeLabel = pick(TEMPLATE.before_labels, 1);
  const afterLabel = pick(TEMPLATE.after_labels, 1);
  const finalLabel = pick(TEMPLATE.final_labels, 2);
  // Captions: persona override (megan/danny voice) else the ANGLE's brand
  // captions — so the caption always talks about what the video shows.
  const captionBank = p.captions || angle.captions;
  // Bank captions are now the SEED for the SEO caption writer (and the
  // fallback if it errors) — final captions are generated after the video is
  // assembled, when the on-screen text beats are known.
  let igCaption = `${seedPick(captionBank.instagram, 1)}\n\n${TEMPLATE.hashtags.join(" ")}`;
  let ttCaption = `${seedPick(captionBank.tiktok, 1)}\n\n${TEMPLATE.hashtags.join(" ")}`;
  let ttTitle = ttCaption.split("\n")[0].slice(0, 88);

  // ET date — toISOString (UTC) flips to tomorrow at 20:00 ET and would
  // double-book the next day's slot claim on evening catch-up runs.
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const slug = clipName.toLowerCase().replace(/\.(mov|mp4)$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // Output lives under carousels/ so the dashboard content feed picks it up
  // for review (Kevin's rule: ALL generated content goes to the feed).
  const dir = path.join(ROOT_DIR, "brand-content", opts.persona, "carousels", `${date}-s${opts.slot}-reaction-${slug}`);
  fs.mkdirSync(dir, { recursive: true });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
  // Claim bookkeeping lives OUTSIDE the try so the finally can release it:
  // claimKey is set only when THIS run wins the slot claim; wentLive flips
  // the moment any platform post lands (the claim then must stay forever —
  // it's the double-post guard).
  let claimKey = null;
  let wentLive = false;
  try {
    // Idempotency guard: the cron re-arms on deploys/restarts — never
    // double-post the same persona+day+slot (--force overrides). ATOMIC since
    // 2026-07-08: a deploy landed ON the 18:00 slot, old+new containers both
    // fired, and the select-then-post race double-published Danny. A primary-
    // key claim row makes exactly one runner win, no matter how many race.
    // (Claim is slot-level, not clip-level — racing runs could pick clips.)
    if (opts.publish && !opts.force) {
      await pool.query(`create table if not exists publish_claims (claim text primary key, created_at timestamptz not null default now())`);
      const key = `reaction-${opts.persona}-${date}-s${opts.slot}`;
      const { rows } = await pool.query(
        `insert into publish_claims (claim) values ($1) on conflict do nothing returning claim`,
        [key],
      );
      if (!rows.length) {
        console.log(`[reaction-ugc] slot ${opts.slot} already claimed today for '${opts.persona}' — skipping (--force to override).`);
        return;
      }
      claimKey = key;
    }
    // 3. Sound from the favorites rotation.
    const sound = await pickSound(pool, opts.sound, p.sound_gender);
    // pid suffix: the 0:30/4:30/… slots run all three personas at the same
    // minute and they can pick the SAME sound — a shared sound-id tmp path
    // let one process unlink it under another (creatoros 07-10 0:30 ENOENT).
    const tmpAudio = path.join(os.tmpdir(), `rsound-${sound.id}-${process.pid}.m4a`);
    const audioRes = await fetch(sound.audio_url);
    if (!audioRes.ok) throw new Error(`Audio download failed (${audioRes.status})`);
    fs.writeFileSync(tmpAudio, Buffer.from(await audioRes.arrayBuffer()));

    console.log(`\n=== REACTION UGC (${persona.name}) ===`);
    console.log(`Clip:     ${clipName} (${probeDuration(clipPath).toFixed(1)}s)`);
    console.log(`Sound:    ${sound.title} — ${sound.author} (id ${sound.id})`);
    console.log(`Angle:    ${angle.id} (slot ${opts.slot})`);
    console.log(`Hook:     "${hookLine}"${opts.cards ? "" : " (teaser — vague, no answer in the video)"}`);
    if (opts.cards) console.log(`Card:     "${cardLine}"`);
    console.log(`Mode:     ${opts.publish ? "PUBLISH" : "DRY RUN"}${opts.igCarousel ? " (IG as feed carousel)" : " (IG as Reel)"}${opts.cards ? " [legacy cards format]" : " [reaction + app b-roll]"}`);

    // 4. What follows the reaction clip: app B-ROLL (default), a reveal
    //    still (fallback), or the legacy 4-still cards deck.
    let stills = [];
    let broll = null;
    if (opts.cards) {
      const cardPng = path.join(dir, "card.png");
      const beforePng = path.join(dir, "before.png");
      const afterPng = path.join(dir, "after.png");
      const finalPng = path.join(dir, "final.png");
      buildCard(cardLine, cardPng);
      buildStill(p.before, beforeLabel, beforePng);
      buildStill(p.after, afterLabel, afterPng);
      buildStill(p.final, finalLabel, finalPng);
      const B = TEMPLATE.beats;
      stills = [
        { path: cardPng, beats: B.card, overlayText: cardLine, source: "card" },
        { path: beforePng, beats: B.before, overlayText: beforeLabel, source: "screenshot" },
        { path: afterPng, beats: B.after, overlayText: afterLabel, source: "screenshot" },
        { path: finalPng, beats: B.final, overlayText: finalLabel, source: "screenshot" },
      ];
    } else if (opts.reveal) {
      // DEFAULT (Kevin 2026-07-07, supersedes the 07-06 teaser rule): the
      // reaction must be FOLLOWED by app footage showing what it was about —
      // TikTok buries pure reactions (1 and 0 views) while reveal-style runs
      // hit 400+.
      // Kevin 2026-07-08: the reveal is now real screen-recorded app B-ROLL
      // (angle.broll → TEMPLATE.broll), carrying the 3-beat text path: vague
      // hook on the clip → reveal text names the app ("an app that manages
      // all your socials at once") → payoff text lands the benefit ("this
      // saves me hours every day") at the beat boundary, footage continuous.
      const revealText = angle.reveal || cardLine;
      // Resolve a b-roll id → local file, downloading from Insforge if absent.
      const resolveBroll = async (id) => {
        const def = id && TEMPLATE.broll ? TEMPLATE.broll[id] : null;
        if (!def) return null;
        const brollDir = path.join(REPO_ROOT, TEMPLATE.broll_dir || ".claude/assets/broll");
        fs.mkdirSync(brollDir, { recursive: true });
        const p2 = path.join(brollDir, def.file);
        if (!fs.existsSync(p2)) {
          if (!def.url) throw new Error(`b-roll ${def.file} missing locally and has no remote URL`);
          console.log(`  ↓ fetching ${def.file} from storage…`);
          const res = await fetch(def.url);
          if (!res.ok) throw new Error(`b-roll download ${res.status}: ${def.url}`);
          fs.writeFileSync(p2, Buffer.from(await res.arrayBuffer()));
        }
        return p2;
      };
      const brollPath = await resolveBroll(angle.broll);
      if (brollPath) {
        const B = TEMPLATE.beats || {};
        broll = {
          id: angle.broll,
          path: brollPath,
          // Second demo clip for the payoff beat (Kevin 2026-07-08 pm: show
          // more of the app instead of freezing/continuing the first clip).
          payoffPath: (await resolveBroll(angle.payoff_broll)) || null,
          revealText,
          payoffText: angle.payoff || null,
          revealBeats: B.reveal || 2,
          payoffBeats: B.payoff || 2,
          // Floor each text window so it's actually readable — the demo went
          // by too fast at 2 beats on fast sounds.
          minTextSeconds: B.min_text_seconds || 3,
        };
        // MEGA payoff finale (Kevin 2026-07-08 pm): a 4th text beat that
        // names Creator OS and lands the career transformation ("creator os
        // changed my life as a creator"), over the growth/analytics footage.
        // Bank is voice-gendered: megan → female, danny → male, brand → both.
        const megaBank =
          p.sound_gender === "female" ? TEMPLATE.mega_payoffs?.female
          : p.sound_gender === "male" ? TEMPLATE.mega_payoffs?.male
          : [...(TEMPLATE.mega_payoffs?.female ?? []), ...(TEMPLATE.mega_payoffs?.male ?? [])];
        broll.megaText = megaBank?.length ? seedPick(megaBank) : null;
        broll.megaPath = broll.megaText
          ? (await resolveBroll(angle.finale_broll || TEMPLATE.finale_broll)) || broll.payoffPath || broll.path
          : null;
        broll.texts = [
          { path: broll.path, text: revealText, beats: broll.revealBeats },
          ...(broll.payoffText
            ? [{ path: broll.payoffPath || broll.path, text: broll.payoffText, beats: broll.payoffBeats }]
            : []),
          ...(broll.megaText
            ? [{ path: broll.megaPath, text: broll.megaText, beats: B.mega || 4 }]
            : []),
        ];
        console.log(`B-roll:   ${angle.broll}${broll.payoffPath ? ` + ${angle.payoff_broll}` : ""}${broll.megaText ? ` + ${angle.finale_broll || TEMPLATE.finale_broll} (finale)` : ""}`);
        console.log(`Text:     "${revealText}"${broll.payoffText ? ` → "${broll.payoffText}"` : ""}${broll.megaText ? ` → "${broll.megaText}"` : ""}`);
      } else {
        // Fallback (angle without b-roll): single reveal still, old format.
        const revealPng = path.join(dir, "reveal.png");
        buildStill(p.final, revealText, revealPng, true);
        stills = [{ path: revealPng, beats: (TEMPLATE.beats && TEMPLATE.beats.final) || 4, overlayText: revealText, source: "screenshot" }];
      }
    }

    // 5. Beat-cut assembly. The reaction window (start-of-reaction → peak)
    // drives the slo-mo cut — vision-analyzed once per clip, cached.
    const window = await analyzeReactionWindow(clipPath);
    console.log(`Window:   reaction ${window.start.toFixed(2)}s → peak ${window.peak.toFixed(2)}s (${window.source})`);
    const videoPath = path.join(dir, "reaction-reel.mp4");
    const r = buildVideo(clipPath, stills, tmpAudio, videoPath, hookLine, broll, window);
    fs.unlinkSync(tmpAudio);
    console.log(`\nVideo: clip ${r.window.in.toFixed(2)}-${r.window.out.toFixed(2)}s @ ${r.slomo.toFixed(2)}x slo-mo → ${r.clipT.toFixed(2)}s + ${broll ? "b-roll" : "stills"} on the grid → ${r.total.toFixed(1)}s total` +
      ` (${r.bpm ? `${r.bpm} BPM, ${r.spb.toFixed(2)}s/beat` : "no clear pulse, 0.5s/beat fallback"})`);
    console.log(`  → ${videoPath}`);

    // QA GATE (Kevin 2026-07-06: every workflow publishes through a QA agent).
    // Judges frames from the FINAL video; failure exits 2 and the draft stays
    // in the Content feed for review — same contract as carousel-qa.
    console.log(`\n[QA] judging rendered video (${QA_MODEL})…`);
    // One QA frame per b-roll text window (reveal / payoff / mega payoff),
    // sampled mid-window with its exact expected text. The single-still
    // fallback keeps its one expected frame; cards mode judges generically.
    const segLabels = ["the reveal", "the payoff beat", "the mega payoff finale"];
    let cursor = r.clipT;
    const brollFrames = (r.segs ?? []).map((s, i) => {
      const t = cursor + s.dur / 2;
      cursor += s.dur;
      return { t, text: s.text, label: segLabels[Math.min(i, segLabels.length - 1)] };
    });
    if (!broll && !opts.cards && stills.length === 1) {
      brollFrames.push({ t: r.clipT + (r.total - r.clipT) / 2, text: stills[0].overlayText, label: "the reveal still" });
    }
    const verdict = await qaReactionVideo(videoPath, r.clipT, r.total, hookLine, dir,
      stills.length > 0 || Boolean(broll), brollFrames);
    if (!verdict.pass) {
      console.error(`[QA] ❌ BLOCKED — ${verdict.failures.length} failure(s):`);
      for (const f of verdict.failures) console.error(`  frame ${f.frame}: ${f.reason}`);
      console.error(`[QA] draft kept for review: ${videoPath}`);
      process.exitCode = 2;
      return;
    }
    console.log(`[QA] ✓ pass`);

    // SEO captions (Kevin 2026-07-08): keyword-rich descriptions tell the
    // IG/TikTok algorithms who to show this to — generated fresh per post
    // from the actual on-screen beats, bank caption as seed + fallback.
    const seo = await writeSeoCaptions({
      persona: { name: persona.name, voice: persona.voice, niche: persona.niche },
      topic: `reaction meme: a creator discovers Creator OS (the app that posts to every platform at once) — ${angle.id.replace(/-/g, " ")} angle, real app screen-recording b-roll`,
      onScreenTexts: [hookLine, ...(broll ? broll.texts.map((t) => t.text) : stills.map((s) => s.overlayText))],
      seedCaptions: { instagram: igCaption, tiktok: ttCaption },
      hashtags: TEMPLATE.hashtags,
    });
    if (seo.generated) {
      igCaption = seo.instagram;
      ttCaption = seo.tiktok;
      ttTitle = seo.tiktokTitle;
      console.log(`[seo] captions generated (${(seo.instagram.length)} ig / ${seo.tiktok.length} tt chars)`);
    }

    // Feed-compatible sidecar: the video leads the deck, stills follow — the
    // dashboard Carousels feed renders mp4 slides with a <video> player.
    const metaOut = {
      carousel_id: `reaction-${opts.persona}-${date}-s${opts.slot}-${slug}`,
      persona: opts.persona,
      topic: `Reaction meme — ${clipName.replace(/\.(mov|mp4)$/i, "")}`,
      content_pillar: "creatoros",
      visual_pillar: "reaction",
      slide_count: 1 + stills.length,
      slides: [
        { index: 1, source: "video", localPath: videoPath, overlayText: `"${hookLine}" — ${sound.title}${r.bpm ? ` @ ${r.bpm} BPM` : ""}` },
        ...stills.map((s, i) => ({ index: i + 2, source: s.source, localPath: s.path, overlayText: s.overlayText })),
      ],
      caption: { instagram: igCaption, tiktok: ttCaption },
      hashtags: TEMPLATE.hashtags,
      reaction: {
        clip: clipName, angle: angle.id, slot: opts.slot, hook: hookLine,
        broll: broll ? broll.id : null, reveal: broll ? broll.revealText : null, payoff: broll ? broll.payoffText : null,
        mega_payoff: broll ? broll.megaText ?? null : null,
        sound: { id: sound.id, title: sound.title }, bpm: r.bpm, total_seconds: r.total,
        slomo: Number(r.slomo.toFixed(2)), window: { in: Number(r.window.in.toFixed(2)), out: Number(r.window.out.toFixed(2)), source: window.source },
      },
      created_at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(dir, "carousel.json"), JSON.stringify(metaOut, null, 2));

    if (!opts.publish) {
      console.log(`\n[DRY RUN] Review the video, then re-run with --publish.`);
      return;
    }

    // 6. Upload + publish.
    // Branded Reels cover via Zernio's REAL thumbnail field (Kevin
    // 2026-07-14: the old baked-first-frame hack "looks terrible" — a 0.3s
    // static card flashed at the start of every video). thumbnailUrl in the
    // IG platformSpecificData is proven working (top5-danny reel, kai
    // factory), so the video ships untouched and IG gets a proper cover.
    let coverUrl = null;
    try {
      const { buildReelThumbnail } = require("../../../lib/reel-thumbnail");
      const revealWords = deEmoji(angle.reveal || hookLine).split(/\s+/);
      const mid = Math.ceil(revealWords.length * 0.6);
      const coverPng = path.join(dir, "reel-cover.png");
      await buildReelThumbnail({
        persona: opts.persona,
        line1: revealWords.slice(0, mid).join(" "),
        line2: revealWords.slice(mid).join(" ") || "CREATOR OS",
        out: coverPng,
        bgSeed: dayIndex + opts.slot,
      });
      coverUrl = await uploadToInsforge(coverPng, "image/png");
      console.log(`  ✓ branded cover uploaded (IG thumbnailUrl)`);
    } catch (e) {
      console.warn(`  ! cover build failed (${String(e.message).slice(0, 80)}) — posting without`);
    }
    console.log(`\n[1/5] Uploading video…`);
    const videoUrl = await uploadToInsforge(videoPath, "video/mp4");
    console.log(`  ${videoUrl}`);

    // YouTube copyright safety (Kevin 2026-07-15: "youtube shorts cannot
    // include the trending music, they keep getting taken down"). TikTok/IG
    // license trending audio through their own music libraries, but YouTube
    // Content ID flags it → takedown. So YouTube gets its OWN render: the
    // exact same visuals with the trending sound swapped for a royalty-free
    // AI-generated bed (assets/yt-beds/, fal stable-audio, no Content ID
    // match). Video stream is copied (no re-encode) — only the audio changes.
    // --platforms tiktok,instagram limits distribution (default: all).
    const wanted = (pl) => !opts.platforms || opts.platforms.includes(pl);

    let ytVideoUrl = null;
    if (wanted("youtube") && persona.accounts?.youtube) {
      try {
        const beds = fs.readdirSync(path.join(__dirname, "..", "assets", "yt-beds"))
          .filter((f) => f.endsWith(".m4a"));
        if (!beds.length) throw new Error("no yt-beds available");
        const bed = path.join(__dirname, "..", "assets", "yt-beds", beds[(dayIndex + opts.slot) % beds.length]);
        const ytPath = path.join(dir, "reaction-yt-safe.mp4");
        execFileSync("ffmpeg", ["-y", "-v", "error",
          "-i", videoPath, "-stream_loop", "-1", "-i", bed,
          "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
          "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart",
          ytPath], { stdio: "pipe", timeout: 180000 });
        ytVideoUrl = await uploadToInsforge(ytPath, "video/mp4");
        console.log(`  ✓ YouTube-safe render (royalty-free bed) uploaded`);
      } catch (e) {
        console.warn(`  ! YouTube-safe render failed (${String(e.message).slice(0, 80)}) — SKIPPING YouTube to avoid a copyright strike`);
      }
    }

    // Per-platform failures must not abort the rest — a disconnected TikTok
    // token (2026-07-07) killed the IG Reel + YouTube Short that would have
    // posted fine. Collect errors, publish everywhere possible, exit 1 only
    // when NOTHING posted.
    const platformErrors = [];

    console.log(`[2/5] TikTok video post…`);
    const contentId = metaOut.carousel_id;
    if (wanted("tiktok") && persona.accounts?.tiktok) try {
      const postId = await publishToZernio({
        profileId: persona.profileId,
        content: ttTitle,
        mediaItems: [{ type: "video", url: videoUrl }],
        platforms: [{ platform: "tiktok", accountId: persona.accounts.tiktok }],
        tiktokSettings: {
          privacy_level: "PUBLIC_TO_EVERYONE",
          allow_comment: true,
          description: ttCaption.slice(0, 4000),
          content_preview_confirmed: true,
          express_consent_given: true,
          // AIGC disclosure (2026-07-12, after megan's 2nd TikTok ban):
          // TikTok requires realistic AI people to be labeled and detects
          // synthetic media via invisible watermarks regardless of file
          // metadata — UNDISCLOSED AI humans is the ban vector. The YouTube
          // leg already discloses via containsSyntheticMedia.
          is_aigc: true,
        },
        publishNow: true,
      });
      console.log(`  ✓ TikTok Zernio post: ${postId}`);
      metaOut.tiktok_post_id = postId;
      wentLive = true;
      await recordContentPost(pool, opts.persona, contentId, postId, ttCaption, "tiktok", { reaction_clip: clipName, sound: sound.title, bpm: r.bpm });
    } catch (e) {
      platformErrors.push(`tiktok: ${e.message}`);
      console.error(`  ✗ TikTok failed (continuing): ${e.message}`);
    } else console.log(`  · ${wanted("tiktok") ? "no TikTok account" : "tiktok not in --platforms"} — skipped`);

    console.log(`[3/5] Instagram ${opts.igCarousel ? "feed carousel" : "Reel"}…`);
    if (wanted("instagram") && persona.accounts?.instagram) try {
      let mediaItems = [{ type: "video", url: videoUrl }];
      if (opts.igCarousel) {
        for (const s of stills) {
          const u = await uploadToInsforge(s.path, "image/png");
          mediaItems.push({ type: "image", url: u });
        }
      }
      const igPsd = opts.igCarousel
        ? { shareToFeed: true }
        : { contentType: "reels", shareToFeed: true };
      if (!opts.igCarousel && coverUrl) igPsd.thumbnailUrl = coverUrl;
      // Tracked CTA as the auto first comment (not tappable on IG, but the
      // /go slug logs copy-throughs and points at the bio link).
      igPsd.firstComment = `Download Creator OS (link in bio 📲): https://your-app.up.railway.app/go/${opts.persona}-ig`;
      const postId = await publishToZernio({
        profileId: persona.profileId,
        content: igCaption,
        mediaItems,
        platforms: [{
          platform: "instagram",
          accountId: persona.accounts.instagram,
          platformSpecificData: igPsd,
        }],
        publishNow: true,
      });
      console.log(`  ✓ Instagram Zernio post: ${postId}`);
      metaOut.instagram_post_id = postId;
      wentLive = true;
      await recordContentPost(pool, opts.persona, contentId, postId, igCaption, "instagram", { reaction_clip: clipName, sound: sound.title, bpm: r.bpm, reel: !opts.igCarousel });
    } catch (e) {
      platformErrors.push(`instagram: ${e.message}`);
      console.error(`  ✗ Instagram failed (continuing): ${e.message}`);
    } else console.log(`  · ${wanted("instagram") ? "no Instagram account" : "instagram not in --platforms"} — skipped`);

    console.log(`[4/5] YouTube Short…`);
    if (wanted("youtube") && persona.accounts?.youtube && !ytVideoUrl) {
      console.log(`  · no YouTube-safe (royalty-free-audio) render — skipping YouTube so the trending sound can't trigger a copyright takedown`);
    } else if (wanted("youtube") && persona.accounts?.youtube) try {
      // <3 min + 9:16 auto-detects as a Short. containsSyntheticMedia: the
      // reaction person is AI-generated — disclose it. App link rides as the
      // pinned-style first comment (YouTube allows links there). Uses the
      // royalty-free-audio render (ytVideoUrl), NEVER the trending-sound file.
      const postId = await publishToZernio({
        profileId: persona.profileId,
        content: igCaption,
        mediaItems: [{ type: "video", url: ytVideoUrl }],
        platforms: [{
          platform: "youtube",
          accountId: persona.accounts.youtube,
          platformSpecificData: {
            title: ttTitle,
            visibility: "public",
            madeForKids: false,
            containsSyntheticMedia: true,
            // Tracked redirect (302 → App Store, logs to link_clicks) so
            // YouTube comment traffic shows up in the Analytics source table.
            firstComment: `Download Creator OS: https://your-app.up.railway.app/go/${opts.persona}-yt`,
          },
        }],
        publishNow: true,
      });
      console.log(`  ✓ YouTube Zernio post: ${postId}`);
      metaOut.youtube_post_id = postId;
      wentLive = true;
      await recordContentPost(pool, opts.persona, contentId, postId, igCaption, "youtube", { reaction_clip: clipName, sound: sound.title, bpm: r.bpm, short: true });
    } catch (e) {
      platformErrors.push(`youtube: ${e.message}`);
      console.error(`  ✗ YouTube failed (continuing): ${e.message}`);
    } else console.log(`  · no YouTube account — skipped`);

    console.log(`[5/5] Facebook video…`);
    if (wanted("facebook") && persona.accounts?.facebook) try {
      const postId = await publishToZernio({
        profileId: persona.profileId,
        content: igCaption,
        mediaItems: [{ type: "video", url: videoUrl }],
        platforms: [{
          platform: "facebook",
          accountId: persona.accounts.facebook,
          platformSpecificData: {
            // FB supports firstComment on feed + Reels; links are clickable.
            firstComment: `Download Creator OS: https://your-app.up.railway.app/go/${opts.persona}-fb`,
          },
        }],
        publishNow: true,
      });
      console.log(`  ✓ Facebook Zernio post: ${postId}`);
      metaOut.facebook_post_id = postId;
      wentLive = true;
      await recordContentPost(pool, opts.persona, contentId, postId, igCaption, "facebook", { reaction_clip: clipName, sound: sound.title, bpm: r.bpm, reel: true });
    } catch (e) {
      platformErrors.push(`facebook: ${e.message}`);
      console.error(`  ✗ Facebook failed (continuing): ${e.message}`);
    } else console.log(`  · no Facebook account — skipped`);

    const postedAnywhere = Boolean(metaOut.tiktok_post_id || metaOut.instagram_post_id || metaOut.youtube_post_id || metaOut.facebook_post_id);
    if (!postedAnywhere) {
      throw new Error(`all platforms failed — ${platformErrors.join(" | ")}`);
    }

    await markSoundUsed(pool, sound.id);
    metaOut.published_at = new Date().toISOString();
    // Feed badge fields (same names the carousel publishers stamp).
    metaOut.zernio_post_id = metaOut.tiktok_post_id || metaOut.instagram_post_id || metaOut.youtube_post_id || metaOut.facebook_post_id || null;
    metaOut.zernio_platform = ["tiktok", "instagram", "youtube"]
      .filter((p) => metaOut[`${p}_post_id`])
      .join("+");
    fs.writeFileSync(path.join(dir, "carousel.json"), JSON.stringify(metaOut, null, 2));
    if (platformErrors.length) {
      console.error(`\n⚠️  PARTIAL PUBLISH — live on ${metaOut.zernio_platform || "none"}; failed: ${platformErrors.join(" | ")}`);
      console.error(`   Reconnect the account in Zernio, then refresh the persona's account IDs (GET /v1/accounts).`);
    }
    console.log(`\n✅ LIVE — ${contentId}`);
  } finally {
    // Release the slot claim when nothing went live — a failure after the
    // claim (QA-judge outage, render error, storage 503) otherwise eats the
    // slot permanently: every watchdog retry sees "already claimed" and
    // skips. That silent-skip loop cost every reaction slot 07-16 → 07-25
    // during the Anthropic-credit QA outage. The claim stays whenever ANY
    // platform posted — it is the double-post guard.
    if (claimKey && !wentLive) {
      await pool.query(`delete from publish_claims where claim = $1`, [claimKey]).catch(() => {});
      console.warn(`[reaction-ugc] nothing published — released claim ${claimKey} so a retry can re-run this slot`);
    }
    await pool.end().catch(() => {});
    await closePersonaPool().catch(() => {});
  }
}

main().catch((e) => { console.error(`\n✗ ${e.message}`); process.exit(1); });
