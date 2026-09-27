#!/usr/bin/env node
/**
 * daily-carousel — the full Megan day-in-the-life pipeline, end to end:
 *
 *   plan (template + daily rotation) → carousel-gen → carousel-qa --fix
 *   → carousel-overlay (texted) → carousel-publish (Zernio → IG + TikTok)
 *
 * SAFETY GATE: publish only runs if every slide passes QA (after auto-fix).
 * Anything else aborts with a non-zero exit and the draft stays in the feed.
 *
 * Daily rotation (template mode): hook headline, fictional client names, and
 * outfit color rotate by day-of-year, so each day's post is a fresh variation
 * of the proven structure. Opener/closer/client shots regenerate via FAL.
 *
 * Usage:
 *   node daily-carousel.js                          # template mode (cron path)
 *   node daily-carousel.js --dry-run                # everything except going live
 *   node daily-carousel.js --plan <p> --overlays <o> [--topic "..."]  # explicit plan
 *
 * Cron (installed by setup): runs daily; see SKILL.md.
 * Run with `node --env-file=.env.local` from the creator-os repo root.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SKILLS = path.join(__dirname, "..", "..");
const ROOT = path.join(SKILLS, "..", ".."); // creator-os repo root
const CLAUDE_DIR = path.join(ROOT, ".claude");

function arg(n) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; }
const DRY = process.argv.includes("--dry-run");

// Persona-aware: --persona danny uses templates/day-in-the-life-danny.json and
// the danny brand-content dirs; default stays megan (the original cron path).
const SLUG = arg("--persona") || process.env.PERSONA_SLUG || "megan";
const TEMPLATE = (() => {
  const perPersona = path.join(__dirname, "..", "templates", `day-in-the-life-${SLUG}.json`);
  return fs.existsSync(perPersona)
    ? perPersona
    : path.join(__dirname, "..", "templates", "day-in-the-life.json");
})();

function log(msg) { console.log(`[daily-carousel:${SLUG}] ${msg}`); }

function run(label, script, args) {
  log(`▶ ${label}`);
  execFileSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    // Persona flows down to carousel-gen/qa/publish via PERSONA_SLUG.
    env: { ...process.env, PERSONA_SLUG: SLUG },
    timeout: 20 * 60 * 1000,
  });
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Deterministic per-day pick: same choice all day, rotates daily.
function makePicker() {
  const dayIndex = Math.floor(Date.now() / 86400000);
  return (bank, offset = 0) => bank[(dayIndex + offset) % bank.length];
}

// Build today's plan + overlays from the template banks.
function buildFromTemplate() {
  const t = JSON.parse(fs.readFileSync(TEMPLATE, "utf8"));
  const pick = makePicker();
  const date = new Date().toISOString().slice(0, 10);

  // `bank_vars` in the template maps {{VAR}} → bank name; falls back to the
  // original Megan mapping for templates without it.
  const bankVars = t.bank_vars ?? {
    OUTFIT: "outfits",
    YOGA: "yoga_studios",
    CAFE: "cafes",
    BRUNCH: "brunch_spots",
    GYM: "gyms",
    BAR: "bars",
    HOOK: "hooks",
    HOOK_LINE: "caption_hook_lines",
  };
  const vars = {};
  let offset = 0;
  for (const [name, bank] of Object.entries(bankVars)) {
    // HOOK_LINE shares HOOK's offset so the caption matches the cover headline.
    if (name === "HOOK_LINE" && "HOOK" in vars) offset -= 1;
    vars[name] = pick(t.banks[bank], offset);
    offset += 1;
  }
  const fill = (s) => String(s).replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
  const deepFill = (o) => JSON.parse(fill(JSON.stringify(o)));

  const topic = `${t.topic_prefix} ${date}`;
  const plan = {
    topic,
    content_pillar: t.content_pillar,
    visual_pillar: t.visual_pillar,
    identity_anchor: t.identity_anchor,
    slides: deepFill(t.slides),
    caption: deepFill(t.caption),
    hashtags: t.hashtags,
  };
  const overlays = { note: `auto-generated for ${date}`, slides: deepFill(t.overlays) };

  const planPath = path.join(CLAUDE_DIR, "brand-content", SLUG, "plans", `${date}-daily.json`);
  // brand-content does NOT ship in the Railway image — create the write path
  // (locally a no-op). Without this the cloud run dies with ENOENT before
  // generating anything (the Jul 5-6 "overdue" runs).
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
  return { planPath, overlaysSpec: overlays, topic };
}

function main() {
  let planPath = arg("--plan");
  let overlaysPath = arg("--overlays");
  let topic = arg("--topic");
  let overlaysSpec = null;

  if (!planPath) {
    const built = buildFromTemplate();
    planPath = built.planPath;
    overlaysSpec = built.overlaysSpec;
    topic = built.topic;
    log(`plan built from template → ${path.relative(ROOT, planPath)}`);
  } else {
    topic = topic || JSON.parse(fs.readFileSync(planPath, "utf8")).topic;
  }

  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(CLAUDE_DIR, "brand-content", SLUG, "carousels", `${date}-${slugify(topic)}`);
  const sidecar = path.join(dir, "carousel.json");

  // 1. Render slides (9:16 full-screen vertical for TikTok).
  run("carousel-gen", path.join(SKILLS, "carousel-gen", "scripts", "carousel-gen.js"), ["--plan", planPath, "--aspect", "9:16"]);
  if (!fs.existsSync(sidecar)) throw new Error(`expected sidecar not found: ${sidecar}`);

  // 2. QA with auto-fix — THE PUBLISH GATE.
  run("carousel-qa --fix", path.join(SKILLS, "carousel-qa", "scripts", "carousel-qa.js"),
    ["--carousel", sidecar, "--plan", planPath, "--fix"]);
  const qa = JSON.parse(fs.readFileSync(path.join(dir, "qa.json"), "utf8"));
  if (qa.summary.fail > 0) {
    throw new Error(`QA gate: ${qa.summary.fail} slide(s) still failing after auto-fix — NOT publishing. Draft left in feed for review.`);
  }
  log(`QA gate passed: ${qa.summary.pass}/${qa.slides.length} (${qa.summary.fixed} auto-fixed)`);

  // 3. Burn on-screen text.
  if (!overlaysPath) {
    overlaysPath = path.join(dir, "overlays.json");
    fs.writeFileSync(overlaysPath, JSON.stringify(overlaysSpec, null, 2));
  } else if (path.resolve(overlaysPath) !== path.resolve(path.join(dir, "overlays.json"))) {
    fs.copyFileSync(overlaysPath, path.join(dir, "overlays.json"));
    overlaysPath = path.join(dir, "overlays.json");
  }
  run("carousel-overlay", path.join(SKILLS, "carousel-gen", "scripts", "carousel-overlay.js"),
    ["--carousel", sidecar, "--overlays", overlaysPath, "--aspect", "9:16"]);

  // 4. Point the feed sidecar at the texted slides (raw kept in carousel.raw.json).
  fs.copyFileSync(sidecar, path.join(dir, "carousel.raw.json"));
  const meta = JSON.parse(fs.readFileSync(sidecar, "utf8"));
  const texted = JSON.parse(fs.readFileSync(path.join(dir, "texted", "carousel.json"), "utf8"));
  meta.slides = texted.slides;
  meta.texted = true;
  meta.texted_at = texted.texted_at;
  fs.writeFileSync(sidecar, JSON.stringify(meta, null, 2));
  log("sidecar → texted slides");

  // 5. Publish to TikTok (photo carousel, autoAddMusic → TikTok picks a trending
  //    sound). Dry-run prints the payload only.
  run(DRY ? "carousel-publish-tiktok (DRY RUN)" : "carousel-publish-tiktok --publish",
    path.join(SKILLS, "carousel-publish-tiktok", "scripts", "carousel-publish-tiktok.js"),
    DRY ? ["--carousel", sidecar] : ["--carousel", sidecar, "--publish"]);

  // 6. Publish to Instagram (video-first carousel — our own trending sound from
  //    the favorites rotation baked into slide 1). Sound pool follows persona.
  const soundGender = { megan: "female", danny: "male" }[SLUG] || "any";
  run(DRY ? "carousel-publish-instagram (DRY RUN)" : "carousel-publish-instagram --publish",
    path.join(SKILLS, "carousel-publish-instagram", "scripts", "carousel-publish-instagram.js"),
    DRY
      ? ["--carousel", sidecar, "--sound-gender", soundGender]
      : ["--carousel", sidecar, "--sound-gender", soundGender, "--publish"]);

  log(`✅ done — ${topic}${DRY ? " (dry run, nothing posted)" : " — LIVE on TikTok + Instagram"}`);
}

try {
  main();
} catch (e) {
  console.error(`\n[daily-carousel] ❌ ${e.message}`);
  process.exit(1);
}
