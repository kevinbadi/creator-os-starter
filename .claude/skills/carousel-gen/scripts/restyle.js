#!/usr/bin/env node
/**
 * restyle.js — Re-render an existing carousel's slides from its plan with a
 * new text style, WITHOUT re-picking images or re-writing captions.
 *
 * Re-renders from the clean library source images (per the plan), so it does
 * not stack text on top of already-burned slides.
 *
 * TikTok-"Classic" style:
 *   - Font: Montserrat SemiBold (closest free match to TikTok's Proxima Nova)
 *   - No black scrim box behind the text
 *   - Text in the LOWER THIRD, centered (soft shadow + thin outline for legibility)
 *
 * Usage:
 *   node restyle.js --plan <plan.json> --dir <carouselDir> [--persona megan]
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { loadPersona, closePersonaPool } = require("../../../lib/persona");

const ROOT_DIR = path.join(__dirname, "..", "..", ".."); // creator-os/.claude
const ASSET_FONTS = path.join(ROOT_DIR, "assets", "fonts");

const W = 1080;
const H = 1350;

// TikTok "Classic" ≈ Proxima Nova. Montserrat is the standard free substitute;
// fall back to Poppins, then Arial Bold.
const FONT_CANDIDATES = [
  path.join(ASSET_FONTS, "Montserrat-SemiBold.ttf"),
  path.join(ASSET_FONTS, "Poppins-SemiBold.ttf"),
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
];
const FONT = FONT_CANDIDATES.find((f) => fs.existsSync(f)) || FONT_CANDIDATES[0];

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { plan: null, dir: null, persona: null };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--plan") o.plan = a[++i];
    else if (a[i] === "--dir") o.dir = a[++i];
    else if (a[i] === "--persona") o.persona = a[++i];
  }
  if (!o.plan || !o.dir) throw new Error("Usage: restyle.js --plan <plan.json> --dir <carouselDir>");
  return o;
}

function wrap(text, maxChars = 17) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= maxChars) line += " " + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fontSizeFor(lines) {
  const longest = Math.max(...lines.map((l) => l.length));
  if (longest <= 12) return 86;
  if (longest <= 16) return 74;
  if (longest <= 20) return 64;
  return 56;
}

function resolveLibraryImage(persona, name) {
  const tries = [
    path.join(persona.libraryDir, name),
    path.join(persona.libraryDir, `${name}.png`),
  ];
  const hit = tries.find((p) => fs.existsSync(p));
  if (!hit) throw new Error(`Library image not found: ${name} (in ${persona.libraryDir})`);
  return hit;
}

// Re-render one slide in the new style: cover-crop then lower-third text, no box.
function renderSlide(srcPath, outPath, slide) {
  const focus = slide.focus || "center";
  const focusY = focus === "top" ? "0" : focus === "bottom" ? "(ih-oh)" : "(ih-oh)/2";
  const filters = [
    `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-ow)/2:${focusY},setsar=1`,
  ];
  const tmpFiles = [];

  const overlay = (slide.overlay || "").trim();
  if (overlay) {
    const lines = wrap(overlay);
    const fsz = slide.fontsize || fontSizeFor(lines);
    const lh = Math.round(fsz * 1.2);
    const blockH = lines.length * lh;

    // Lower third: center the block around y ≈ 0.83·H, clamped with a bottom margin.
    const bottomMargin = 130;
    let topY = Math.round(H * 0.83 - blockH / 2);
    topY = Math.max(Math.round(H * 0.66), Math.min(topY, H - bottomMargin - blockH));

    const stamp = `${Date.now()}-${Math.floor(process.hrtime()[1] % 1e6)}`;
    lines.forEach((line, i) => {
      const tf = path.join(os.tmpdir(), `restyle-${stamp}-l${i}.txt`);
      fs.writeFileSync(tf, line);
      tmpFiles.push(tf);
      const y = topY + i * lh;
      // No scrim box. Soft shadow + thin outline keeps white text legible on photos.
      filters.push(
        `drawtext=fontfile='${FONT}':textfile='${tf}':` +
          `fontsize=${fsz}:fontcolor=white:` +
          `borderw=2:bordercolor=black@0.45:` +
          `shadowcolor=black@0.55:shadowx=3:shadowy=3:` +
          `x=(w-text_w)/2:y=${y}`,
      );
    });
  }

  try {
    execFileSync("ffmpeg", ["-y", "-i", srcPath, "-vf", filters.join(","), outPath], {
      stdio: "pipe",
    });
  } finally {
    for (const t of tmpFiles) fs.existsSync(t) && fs.unlinkSync(t);
  }
}

async function main() {
  const opts = parseArgs();
  const persona = await loadPersona(ROOT_DIR, opts.persona);
  const plan = JSON.parse(fs.readFileSync(opts.plan, "utf8"));

  console.log(`\n=== RESTYLE (${persona.name}) → TikTok Classic ===`);
  console.log(`Font: ${path.basename(FONT)}  |  no box  |  lower-third text`);
  console.log(`Dir:  ${opts.dir}\n`);

  const slides = plan.slides || [];
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    if (slide.source !== "library") {
      console.log(`  [${i + 1}] skipped (source=${slide.source}, not library)`);
      continue;
    }
    const src = resolveLibraryImage(persona, slide.image);
    const out = path.join(opts.dir, `slide-${String(i + 1).padStart(2, "0")}.png`);
    renderSlide(src, out, slide);
    console.log(`  [${i + 1}] ${slide.image} → "${slide.overlay || ""}"`);
  }

  console.log(`\n✓ Re-rendered ${slides.length} slides.`);
  await closePersonaPool();
}

main().catch(async (e) => {
  console.error(`\n✗ ${e.message}`);
  await closePersonaPool().catch(() => {});
  process.exit(1);
});
