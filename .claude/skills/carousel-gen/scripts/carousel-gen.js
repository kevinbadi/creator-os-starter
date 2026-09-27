#!/usr/bin/env node
/**
 * carousel-gen — plan-driven carousel renderer for a persona brand pack.
 *
 * Input: a plan JSON (authored by Claude in the persona's voice, or later by an
 * LLM). Each slide pulls from the persona's curated library OR is generated with
 * FAL nano-banana-2 using the persona's reference face for consistency. Slide
 * text is burned on with ffmpeg. Output = slide-01.png…slide-NN.png + a
 * carousel.json sidecar that carousel-publish consumes.
 *
 * Usage:
 *   node carousel-gen.js --plan path/to/plan.json [--slug megan] [--dry-run]
 *
 * Plan shape:
 * {
 *   "topic": "...",
 *   "content_pillar": "creatoros",
 *   "visual_pillar": "business",
 *   "slides": [
 *     { "source": "library", "image": "megan-fancy-work-laptop", "overlay": "How I run my agency from ONE app", "position": "top" },
 *     { "source": "fal", "prompt": "...", "persona": true, "overlay": "..." }
 *   ],
 *   "caption": { "instagram": "...", "tiktok": "..." },
 *   "hashtags": ["#agencyowner", ...]
 * }
 */
const { execFileSync } = require("child_process");
const { assertFal } = require("../../../lib/fal-gate.js");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  loadPersona,
  getOutputDir,
  closePersonaPool,
} = require("../../../lib/persona");

const ROOT_DIR = path.join(__dirname, "..", "..", "..");
const FAL_KEY = process.env.FAL_KEY;

// Slide canvas — 4:5 (IG feed) by default; pass `--aspect 9:16` for full-screen
// vertical TikTok (1080x1920). FAL generates natively at the chosen ratio.
const ASPECT = (() => { const i = process.argv.indexOf("--aspect"); return i >= 0 ? process.argv[i + 1] : "4:5"; })();
const { W, H, FAL_AR } = ASPECT === "9:16"
  ? { W: 1080, H: 1920, FAL_AR: "9:16" }
  : { W: 1080, H: 1350, FAL_AR: "4:5" };

const FONT_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial Bold.ttf",
  // Bundled fallback (Linux/Railway) — Arimo is metric-compatible with Arial.
  path.join(ROOT_DIR, "assets", "fonts", "Arimo-Bold.ttf"),
];
const FONT = FONT_CANDIDATES.find((f) => fs.existsSync(f)) || FONT_CANDIDATES[0];

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { plan: null, slug: null, dryRun: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--plan") o.plan = a[++i];
    else if (a[i] === "--slug") o.slug = a[++i];
    else if (a[i] === "--dry-run") o.dryRun = true;
  }
  return o;
}

// Wrap text to ~maxChars per line on word boundaries.
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

// Resolve a library image name (with or without .png) to an absolute path.
function resolveLibraryImage(persona, name) {
  const tries = [
    path.join(persona.libraryDir, name),
    path.join(persona.libraryDir, `${name}.png`),
  ];
  const hit = tries.find((p) => fs.existsSync(p));
  if (!hit) throw new Error(`Library image not found: ${name} (in ${persona.libraryDir})`);
  return hit;
}

// FAL nano-banana-2 — generate a slide image, optionally using the persona face.
/**
 * Emergency fallback when FAL generation fails (exhausted balance, outage):
 * pull a least-recently-used image from the persona's `persona_images` bank
 * (harvested fal generations stored in Insforge — scripts/harvest-fal-images.mjs).
 * Face-hidden shots are preferred so the QA gate's persona-face rule still
 * passes. Rotation is tracked via used_count/last_used_at.
 */
async function bankFallback(persona, outPath) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
  try {
    const { rows } = await pool.query(
      `select id, storage_url from persona_images
        where persona = $1
        order by (prompt !~* 'from behind|face is never visible|fully covers|hidden by her hair|phone raised') asc,
                 last_used_at asc nulls first, used_count asc, random()
        limit 1`,
      [persona.slug],
    );
    if (!rows.length) return false;
    const res = await fetch(rows[0].storage_url);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return false;
    fs.writeFileSync(outPath, buf);
    await pool.query(
      `update persona_images set used_count = used_count + 1, last_used_at = now() where id = $1`,
      [rows[0].id],
    );
    return true;
  } finally {
    await pool.end();
  }
}

async function falGenerate(persona, slide, outPath) {
  assertFal("carousel-gen");
  if (!FAL_KEY) {
    throw new Error(
      `Slide needs FAL generation but FAL_KEY is not set. ` +
        `Add FAL_KEY to creator-os/.env.local, or use "source":"library" slides.`,
    );
  }
  // Build reference images: persona face (for consistency) + any per-slide
  // style refs (a fed image whose pose/composition/mood the shot should copy).
  const toDataURI = (p) => {
    const ext = path.extname(p).toLowerCase();
    const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
    return `data:${mime};base64,${fs.readFileSync(p).toString("base64")}`;
  };
  const refs = [];
  if (slide.persona !== false) refs.push(toDataURI(persona.referenceImagePath));
  for (const sr of slide.styleRefs || []) {
    const p = path.isAbsolute(sr) ? sr : path.resolve(ROOT_DIR, "..", sr);
    if (!fs.existsSync(p)) throw new Error(`styleRef not found: ${p}`);
    refs.push(toDataURI(p));
  }
  // Edit endpoint whenever we have any reference image; else pure text-to-image.
  const endpoint = refs.length
    ? "https://fal.run/fal-ai/nano-banana-2/edit"
    : "https://fal.run/fal-ai/nano-banana-2";
  const body = {
    prompt: slide.prompt,
    num_images: 1,
    resolution: "1K",
    aspect_ratio: FAL_AR,
    output_format: "png",
    safety_tolerance: "5",
  };
  if (refs.length) body.image_urls = refs;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`FAL ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const img = (data.images || [])[0];
  if (!img) throw new Error("FAL returned no image");
  const buf = Buffer.from(await (await fetch(img.url)).arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

// Render one slide: normalize to 1080x1350 (cover-crop) + burn overlay text.
// Each line is its own single-line textfile drawtext — avoids this ffmpeg
// build rendering a textfile "\n" as a tofu glyph, and sidesteps all escaping.
function renderSlide(srcPath, outPath, slide) {
  const focus = slide.focus || "center"; // top | center | bottom
  const focusY = focus === "top" ? "0" : focus === "bottom" ? "(ih-oh)" : "(ih-oh)/2";
  const cover = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-ow)/2:${focusY},setsar=1`;

  const filters = [cover];
  const tmpFiles = [];

  // Em/en dashes and ---/-- are banned from on-screen text (AI tell).
  const overlay = (slide.overlay || "").replace(/\s*[—–]\s*|\s+-{2,}\s+/g, " - ").trim();
  if (overlay) {
    const lines = wrap(overlay);
    const fs_ = slide.fontsize || fontSizeFor(lines);
    const lh = Math.round(fs_ * 1.2);
    const pad = 40;
    const blockH = lines.length * lh;
    const maxChars = Math.max(...lines.map((l) => l.length));
    const boxW = Math.min(W - 40, Math.round(maxChars * fs_ * 0.56) + pad * 2);
    const boxH = blockH + pad * 2;
    const boxX = Math.round((W - boxW) / 2);
    const pos = slide.position || "top";
    const boxY = pos === "center" ? Math.round((H - boxH) / 2) : pos === "bottom" ? H - boxH - 110 : 110;

    // Scrim behind the whole text block.
    filters.push(`drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=black@0.42:t=fill`);

    // One drawtext per line, individually centered.
    const stamp = `${Date.now()}-${Math.floor(process.hrtime()[1] % 1e6)}`;
    lines.forEach((line, i) => {
      const tf = path.join(os.tmpdir(), `slide-${stamp}-l${i}.txt`);
      fs.writeFileSync(tf, line); // single line, no trailing newline
      tmpFiles.push(tf);
      const y = boxY + pad + i * lh;
      filters.push(
        `drawtext=fontfile='${FONT}':textfile='${tf}':` +
          `fontsize=${fs_}:fontcolor=white:borderw=3:bordercolor=black@0.9:` +
          `x=(w-text_w)/2:y=${y}`,
      );
    });
  }

  execFileSync("ffmpeg", ["-y", "-i", srcPath, "-vf", filters.join(","), outPath], {
    stdio: "pipe",
    timeout: 60000,
  });

  for (const tf of tmpFiles) if (fs.existsSync(tf)) fs.unlinkSync(tf);
}

// Place an app screenshot on the 1080x1350 canvas: whole screenshot visible
// (contain-fit) over a blurred-cover background of itself, or a solid slide.bg.
function renderScreenshot(srcPath, outPath, slide) {
  const fc = slide.bg
    ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];` +
      `color=c=${slide.bg}:s=${W}x${H}[bg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1`
    : `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=26:3[bg];` +
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1`;
  execFileSync("ffmpeg", ["-y", "-i", srcPath, "-filter_complex", fc, outPath], {
    stdio: "pipe",
    timeout: 60000,
  });
}

async function main() {
  const opts = parseArgs();
  if (!opts.plan) throw new Error("--plan <path> is required");
  const plan = JSON.parse(fs.readFileSync(opts.plan, "utf8"));
  const persona = await loadPersona(ROOT_DIR, opts.slug);

  const OUT_BASE = getOutputDir("carousels", ROOT_DIR, persona.slug);
  const dateStr = new Date().toISOString().slice(0, 10);
  const slug = (plan.topic || "carousel")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const carouselDir = path.join(OUT_BASE, `${dateStr}-${slug}`);

  console.log(`\n=== CAROUSEL GEN — ${persona.name} ===`);
  console.log(`Topic:   ${plan.topic}`);
  console.log(`Pillars: content=${plan.content_pillar} / visual=${plan.visual_pillar}`);
  console.log(`Slides:  ${plan.slides.length}`);
  console.log(`Output:  ${carouselDir}`);

  if (opts.dryRun) {
    console.log("\n[DRY RUN] plan slides:");
    plan.slides.forEach((s, i) =>
      console.log(`  ${i + 1}. [${s.source}] ${s.source === "library" ? s.image : "(FAL) " + (s.prompt || "").slice(0, 50)} — "${s.overlay || ""}"`),
    );
    await closePersonaPool();
    return;
  }

  fs.mkdirSync(carouselDir, { recursive: true });
  const slideOut = [];

  for (let i = 0; i < plan.slides.length; i++) {
    const slide = plan.slides[i];
    const idx = String(i + 1).padStart(2, "0");
    const finalPath = path.join(carouselDir, `slide-${idx}.png`);

    let srcPath;
    let isScreenshot = false;
    if (slide.source === "fal") {
      srcPath = path.join(carouselDir, `slide-${idx}-raw.png`);
      console.log(`  [${idx}] FAL generating…`);
      try {
        await falGenerate(persona, slide, srcPath);
      } catch (e) {
        console.error(`  [${idx}] ⚠ FAL failed (${String(e.message).slice(0, 90)}) — trying image bank fallback`);
        const ok = await bankFallback(persona, srcPath);
        if (!ok) throw e; // no bank image available — surface the original error
        console.log(`  [${idx}] ✓ bank fallback used (persona_images rotation)`);
      }
    } else if (slide.source === "file") {
      // Reuse an existing render (path relative to repo root or absolute).
      srcPath = path.isAbsolute(slide.file) ? slide.file : path.resolve(ROOT_DIR, "..", slide.file);
      if (!fs.existsSync(srcPath)) {
        // Missing on this box (deploy filter gaps) — bank image beats a crash.
        console.error(`  [${idx}] ⚠ file slide missing (${slide.file}) — trying image bank fallback`);
        srcPath = path.join(carouselDir, `slide-${idx}-raw.png`);
        if (!(await bankFallback(persona, srcPath))) throw new Error(`file slide not found: ${slide.file}`);
      }
    } else if (slide.source === "screenshot") {
      // A real app screenshot (path relative to repo root or absolute).
      srcPath = path.isAbsolute(slide.file) ? slide.file : path.resolve(ROOT_DIR, "..", slide.file);
      if (!fs.existsSync(srcPath)) {
        console.error(`  [${idx}] ⚠ screenshot missing (${slide.file}) — trying image bank fallback`);
        srcPath = path.join(carouselDir, `slide-${idx}-raw.png`);
        if (!(await bankFallback(persona, srcPath))) throw new Error(`screenshot not found: ${slide.file}`);
      }
      isScreenshot = true;
    } else {
      srcPath = resolveLibraryImage(persona, slide.image);
    }

    if (isScreenshot) renderScreenshot(srcPath, finalPath, slide);
    else renderSlide(srcPath, finalPath, slide);
    const label = slide.source === "fal" ? "generated" : slide.source === "file" ? `reused ${path.basename(srcPath)}` : slide.source === "screenshot" ? `screenshot ${path.basename(srcPath)}` : slide.image;
    console.log(`  [${idx}] ${label} → "${slide.overlay || slide.scene || ""}"`);

    if (slide.source === "fal" && fs.existsSync(srcPath)) fs.unlinkSync(srcPath);
    slideOut.push({ index: i + 1, overlayText: slide.overlay || "", source: slide.source, localPath: finalPath });
  }

  const sidecar = {
    carousel_id: `carousel-${persona.slug}-${dateStr}-${slug}`,
    persona: persona.slug,
    topic: plan.topic,
    content_pillar: plan.content_pillar,
    visual_pillar: plan.visual_pillar,
    slide_count: slideOut.length,
    slides: slideOut,
    caption: plan.caption || {},
    hashtags: plan.hashtags || persona.hashtagBank,
    created_at: new Date().toISOString(),
  };
  const sidecarPath = path.join(carouselDir, "carousel.json");
  fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));

  console.log(`\n=== DONE — ${slideOut.length} slides ===`);
  console.log(`Sidecar: ${sidecarPath}`);
  console.log(`Next:    node .claude/skills/carousel-publish/scripts/carousel-publish.js --carousel "${sidecarPath}" --dry-run`);
  await closePersonaPool();
}

main().catch(async (e) => {
  console.error(`\nError: ${e.message}`);
  await closePersonaPool();
  process.exit(1);
});
