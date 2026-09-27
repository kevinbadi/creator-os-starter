#!/usr/bin/env node
/**
 * carousel-overlay — apply the on-screen TEXT flow to an already-rendered
 * (text-free) carousel. Keeps raw slides clean (those go to MegOS); this
 * produces the texted version for publishing.
 *
 * Layouts (per slide `kind`):
 *   hook    — cover: small time eyebrow + big bold headline (the 100-variation hook)
 *   bullets — OOTD/on-the-move: "Today's list:" + checklist of the day + time
 *   label   — client stop: WORKPLACE NAME + what she's filming + timestamp
 *   caption — simple line (+ optional time): editing / CreatorOS / done
 *   tip     — advice slide: small eyebrow ("TIP 03/10") + big headline + support lines
 *
 * Any kind accepts `"position": "center"` to center the text block vertically
 * (text-first advice slides) instead of the default lower-third placement.
 *
 * Usage:
 *   node carousel-overlay.js --carousel <carousel.json> --overlays <overlays.json> [--out <dir>]
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// 4:5 by default; `--aspect 9:16` for full-screen vertical TikTok (1080x1920).
const ASPECT = (() => { const i = process.argv.indexOf("--aspect"); return i >= 0 ? process.argv[i + 1] : "4:5"; })();
const [W, H] = ASPECT === "9:16" ? [1080, 1920] : [1080, 1350];
// Body fonts: macOS Arial when present, bundled Arimo (metric-compatible,
// OFL) everywhere else — keeps renders identical between laptop and Railway.
const FONTS_DIR = path.join(__dirname, "..", "..", "..", "assets", "fonts");
const firstExisting = (...cands) => cands.find((f) => fs.existsSync(f)) || cands[cands.length - 1];
const BOLD = firstExisting(
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  path.join(FONTS_DIR, "Arimo-Bold.ttf"),
);
const REG = firstExisting(
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  path.join(FONTS_DIR, "Arimo-Regular.ttf"),
);
// Elegant script for the timestamp — prefer the thick Black weight (extracted
// from the system .ttc via fontTools; regenerate with .claude/assets/fonts note).
const FANCY_CANDIDATES = [
  path.join(__dirname, "..", "..", "..", "assets", "fonts", "SnellRoundhand-Black.ttf"),
  "/System/Library/Fonts/Supplemental/SnellRoundhand.ttc",
];
const FANCY = FANCY_CANDIDATES.find((f) => fs.existsSync(f)) || FANCY_CANDIDATES[1];
const SHADOW = "shadowcolor=black@0.6:shadowx=0:shadowy=3"; // soft drop shadow; time stays shadow-only
const BODY_OUTLINE = "borderw=3:bordercolor=black@0.85"; // thin black outline on body text for readability
const TIME_SIZE = 112;
// Platform-UI safe zone: IG/TikTok captions + action bars eat the bottom of the
// frame, so the whole text stack rides higher. Timestamp centers at 44% height;
// nothing may render below H - SAFE_BOTTOM.
const TIME_CENTER_Y = Math.round(H * 0.44);
// TikTok's caption/action-bar eats more of a 9:16 frame than IG's 4:5 crop.
const SAFE_BOTTOM = ASPECT === "9:16" ? Math.round(H * 0.2) : 240;
// Per-run style overrides from overlays.json `style` block (all optional):
//   { "style": { "timeFont": ".claude/assets/fonts/Manrope-ExtraBold.ttf", "timeSize": 84, "timeCase": "upper" } }
// Defaults keep the Snell script timestamp (Megan's look). A sans timestamp
// (e.g. Manrope) renders visually larger than the script at the same nominal
// size, so pair a custom font with a smaller timeSize.
const STYLE = { timeFont: FANCY, timeSize: TIME_SIZE, timeCase: "lower", timeGap: 0.72 };

function arg(n) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; }

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

// Em/en dashes and ---/-- are BANNED from on-screen text (they read as
// AI-generated) — normalized to a plain hyphen before rasterizing.
const noDash = (s) => String(s).replace(/\s*[—–]\s*|\s+-{2,}\s+/g, " - ");

// Split a spec into: the timestamp (centered, fancy script) + the body lines
// (bold, centered, lower third). No background box on either.
function specToParts(rawSpec) {
  const spec = { ...rawSpec };
  for (const k of ["headline", "title", "name", "subtitle", "text", "eyebrow"]) {
    if (typeof spec[k] === "string") spec[k] = noDash(spec[k]);
  }
  for (const k of ["items", "support"]) {
    if (Array.isArray(spec[k])) spec[k] = spec[k].map(noDash);
  }
  const body = [];
  if (spec.kind === "hook") {
    const size = spec.headline.length > 42 ? 60 : spec.headline.length > 30 ? 68 : 78;
    for (const l of wrap(spec.headline, size >= 72 ? 18 : 22)) body.push({ text: l, size, font: BOLD });
  } else if (spec.kind === "bullets") {
    body.push({ text: spec.title || "Today's list:", size: 50, font: BOLD });
    for (const it of spec.items || []) body.push({ text: "•  " + it, size: 40, font: REG });
  } else if (spec.kind === "label") {
    body.push({ text: spec.name, size: 58, font: BOLD });
    if (spec.subtitle) body.push({ text: spec.subtitle, size: 42, font: REG });
  } else if (spec.kind === "caption") {
    for (const l of wrap(spec.text, 24)) body.push({ text: l, size: 56, font: BOLD });
  } else if (spec.kind === "tip") {
    if (spec.eyebrow) body.push({ text: spec.eyebrow, size: 38, font: BOLD });
    const hs = spec.headline.length > 36 ? 56 : 64;
    for (const l of wrap(spec.headline, hs >= 64 ? 20 : 24)) body.push({ text: l, size: hs, font: BOLD });
    for (const s of spec.support || []) for (const l of wrap(s, 34)) body.push({ text: l, size: 40, font: REG });
  }
  return { time: spec.time || null, body };
}

function renderOverlay(srcPath, outPath, spec) {
  const { time, body } = specToParts(spec);
  const inset = spec.inset || null;
  if (!time && !body.length && !inset) { fs.copyFileSync(srcPath, outPath); return; }

  const filters = [`scale=${W}:${H},setsar=1`];
  const tmp = [];
  const stamp = `${Date.now()}-${Math.floor(process.hrtime()[1] % 1e6)}`;
  const tmpFor = (i, text) => {
    const tf = path.join(os.tmpdir(), `ov-${stamp}-${i}.txt`);
    fs.writeFileSync(tf, text);
    tmp.push(tf);
    return tf;
  };

  // Body: centered block with a black outline. With a time on the slide it
  // sits right under the mid-frame timestamp; otherwise lower third.
  if (body.length) {
    const lh = (l) => Math.round(l.size * 1.28);
    const blockH = body.reduce((a, l) => a + lh(l), 0);
    // Tight against the timestamp: script glyphs reach ~0.72·size below its
    // center; sans faces sit shallower (~0.45) — styleable per run.
    const underTime = Math.round(TIME_CENTER_Y + STYLE.timeSize * STYLE.timeGap + 16);
    let y = time
      ? Math.min(underTime, H - SAFE_BOTTOM - blockH) // never sink into platform UI
      : spec.position === "center"
        ? Math.max(120, Math.min(Math.round((H - blockH) / 2), H - SAFE_BOTTOM - blockH))
        : H - SAFE_BOTTOM - blockH;
    body.forEach((l, i) => {
      const tf = tmpFor(i, l.text);
      filters.push(
        `drawtext=fontfile='${l.font}':textfile='${tf}':fontsize=${l.size}:` +
        `fontcolor=white:${BODY_OUTLINE}:${SHADOW}:x=(w-text_w)/2:y=${y}`,
      );
      y += lh(l);
    });
  }

  // Timestamp: centered on the screen. Default fancy script + lowercase
  // ("5:45 am"); font/size/case overridable via the overlays.json style block.
  if (time) {
    const t = String(time).trim();
    const cased = STYLE.timeCase === "upper" ? t.toUpperCase() : STYLE.timeCase === "as-is" ? t : t.toLowerCase();
    const tf = tmpFor("time", cased);
    filters.push(
      `drawtext=fontfile='${STYLE.timeFont}':textfile='${tf}':fontsize=${STYLE.timeSize}:` +
      `fontcolor=white:borderw=2:bordercolor=black@0.45:${SHADOW}:x=(w-text_w)/2:y=${TIME_CENTER_Y}-text_h/2`,
    );
  }

  // Inset PIP (e.g. a minimized CreatorOS screenshot floating over the photo):
  //   "inset": { "image": "<path>", "widthFrac": 0.32, "pos": "top-left", "margin": 32 }
  // Composited before the text so the timestamp/body always stay on top.
  if (inset) {
    const insPath = path.isAbsolute(inset.image) ? inset.image : path.resolve(process.cwd(), inset.image);
    if (!fs.existsSync(insPath)) throw new Error(`inset.image not found: ${insPath}`);
    const iw = Math.round(W * (inset.widthFrac || 0.32));
    const margin = inset.margin ?? 32;
    const pos = inset.pos || "top-left";
    const x = pos.endsWith("right") ? `${W - iw - margin}` : `${margin}`;
    const y = pos.startsWith("bottom") ? `main_h-overlay_h-${margin}` : `${margin}`;
    // Thin white keyline via pad so the card reads against a busy photo.
    // Order: scale base → composite inset → draw text, so text stays on top.
    const [scaleF, ...textF] = filters;
    const chain =
      `[1:v]scale=${iw - 8}:-1,pad=iw+8:ih+8:4:4:white[ins];` +
      `[0:v]${scaleF}[b0];` +
      `[b0][ins]overlay=${x}:${y}` +
      (textF.length ? `[b1];[b1]${textF.join(",")}` : "");
    execFileSync("ffmpeg", ["-y", "-i", srcPath, "-i", insPath, "-filter_complex", chain, outPath], { stdio: "pipe", timeout: 60000 });
    for (const t of tmp) if (fs.existsSync(t)) fs.unlinkSync(t);
    return;
  }

  execFileSync("ffmpeg", ["-y", "-i", srcPath, "-vf", filters.join(","), outPath], { stdio: "pipe", timeout: 60000 });
  for (const t of tmp) if (fs.existsSync(t)) fs.unlinkSync(t);
}

function main() {
  const carouselPath = arg("--carousel"), overlaysPath = arg("--overlays");
  if (!carouselPath || !overlaysPath) throw new Error("--carousel and --overlays required");
  const meta = JSON.parse(fs.readFileSync(carouselPath, "utf8"));
  const overlaysDoc = JSON.parse(fs.readFileSync(overlaysPath, "utf8"));
  const overlays = overlaysDoc.slides;
  if (overlaysDoc.style) {
    const s = overlaysDoc.style;
    if (s.timeFont) {
      const resolved = path.isAbsolute(s.timeFont) ? s.timeFont : path.resolve(process.cwd(), s.timeFont);
      if (!fs.existsSync(resolved)) throw new Error(`style.timeFont not found: ${resolved}`);
      STYLE.timeFont = resolved;
    }
    if (s.timeSize) STYLE.timeSize = Number(s.timeSize);
    if (s.timeCase) STYLE.timeCase = s.timeCase;
    if (s.timeGap) STYLE.timeGap = Number(s.timeGap);
  }
  const dir = path.dirname(carouselPath);
  const outDir = arg("--out") || path.join(dir, "texted");
  fs.mkdirSync(outDir, { recursive: true });

  const texted = [];
  meta.slides.forEach((slide, i) => {
    const spec = overlays[i] || { kind: "none" };
    const out = path.join(outDir, `slide-${String(slide.index).padStart(2, "0")}.png`);
    renderOverlay(slide.localPath, out, spec);
    console.log(`  [${slide.index}] ${spec.kind}${spec.name ? ` — ${spec.name}` : spec.headline ? ` — "${spec.headline.slice(0, 40)}…"` : spec.text ? ` — ${spec.text.slice(0, 40)}` : ""}`);
    texted.push({ ...slide, localPath: out });
  });

  const sidecar = { ...meta, slides: texted, texted: true, texted_at: new Date().toISOString() };
  fs.writeFileSync(path.join(outDir, "carousel.json"), JSON.stringify(sidecar, null, 2));
  console.log(`\n✓ texted ${texted.length} slides → ${outDir}`);
}

main();
