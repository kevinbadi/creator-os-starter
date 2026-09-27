#!/usr/bin/env node
/**
 * carousel-qa — vision QA gate for a rendered carousel.
 *
 * Flow: load carousel.json → send each slide to Claude (vision) with a strict
 * defect rubric → get a structured pass/fail verdict per slide → write a qa.json
 * sidecar. With --fix, failing slides are auto-regenerated via FAL nano-banana-2
 * (reusing the carousel-gen path + the persona reference face) with a repair hint,
 * then re-QA'd, up to --max-attempts times.
 *
 * Sits between carousel-gen and carousel-publish:
 *   carousel-gen  →  carousel-qa (--fix)  →  carousel-publish
 *
 * Usage:
 *   node carousel-qa.js --carousel <carousel.json>                      # report only
 *   node carousel-qa.js --carousel <carousel.json> --plan <plan.json> --fix
 *   node carousel-qa.js --carousel ... --plan ... --fix --only 3,7 --max-attempts 3
 *
 * Run with `node --env-file=.env.local` so OLLAMA_API_KEY / FAL_KEY / DATABASE_URL load.
 */
const { execFileSync } = require("child_process");
const { assertFal } = require("../../../lib/fal-gate.js");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadPersona, closePersonaPool } = require("../../../lib/persona");

const { createMessage, VISION_MODEL } = require("../../../lib/llm");

const ROOT_DIR = path.join(__dirname, "..", "..", "..");
const FAL_KEY = process.env.FAL_KEY;
// Slides are judged from images → the llm gateway routes to OLLAMA_VISION_MODEL
// (Qwen). DeepSeek v4 Flash is text-only and cannot run this gate.
const MODEL = process.env.QA_MODEL || VISION_MODEL;
const W = 1080;
const H = 1350;

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { carousel: null, plan: null, slug: null, fix: false, maxAttempts: 3, only: null };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--carousel") o.carousel = a[++i];
    else if (a[i] === "--plan") o.plan = a[++i];
    else if (a[i] === "--slug") o.slug = a[++i];
    else if (a[i] === "--fix") o.fix = true;
    else if (a[i] === "--max-attempts") o.maxAttempts = parseInt(a[++i], 10);
    else if (a[i] === "--only") o.only = a[++i].split(",").map((s) => parseInt(s.trim(), 10));
  }
  return o;
}

// ---- Claude vision QA judge -------------------------------------------------

const QA_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "fail"] },
    severity: { type: "string", enum: ["none", "low", "medium", "high"] },
    identity_ok: { type: "boolean" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: [
              "visible_face",
              "hand_or_finger_anatomy",
              "limb_or_body_anatomy",
              "face_integrity",
              "identity_mismatch",
              "object_or_logo_distortion",
              "gibberish_text_or_watermark",
              "scene_physics",
              "duplicate_or_merged_subject",
              "wardrobe_or_accessory",
              "other",
            ],
          },
          detail: { type: "string" },
          region: { type: "string" },
        },
        required: ["category", "detail", "region"],
        additionalProperties: false,
      },
    },
    regen_hint: { type: "string" },
  },
  required: ["verdict", "severity", "identity_ok", "issues", "regen_hint"],
  additionalProperties: false,
};

const SYSTEM = `You are a meticulous QA reviewer for AI-generated Instagram/TikTok carousel images of a brand persona. Your job is to catch generation defects before they are posted.

Inspect the image closely for:
- PERSONA FACE — HARD POLICY, FAIL (high): the PERSONA's face (the person matching the identity anchor) must never be clearly readable anywhere in the frame — including mirrors, windows, and reflections. The persona must be seen from behind, turned away, cropped, hidden behind a phone, or defocused beyond recognition. A readable PERSONA face = automatic fail (category "visible_face"). This policy exists because platform moderation flagged the persona's AI face. OTHER people's faces (friends, staff, clients, bystanders) are ALLOWED and must NOT be flagged — judge them only for anatomy/quality defects like any other subject.
- HANDS & FINGERS: wrong finger count, fused/webbed/melted fingers, extra or missing digits, unnatural grip or bends. This is the most common defect — scrutinize every visible hand.
- LIMBS & BODY: impossible joints, extra/missing limbs, warped proportions.
- IDENTITY: does the person match the described persona (hair color, build, outfit — the face is never shown)? Set identity_ok accordingly.
- OBJECTS & LOGOS: warped brand logos, melted objects, nonsensical structure.
- TEXT/WATERMARK: any on-screen text or watermark (there should be NONE — flag if present).
- SCENE PHYSICS: floating objects, wrong reflections, impossible geometry.
- DUPLICATE/MERGED: duplicated or fused people/limbs.
- WARDROBE & ACCESSORIES: duplicated accessories are a FAIL (medium, category "wardrobe_or_accessory") — a watch on EACH wrist, doubled bracelets/necklaces, two bags, a second pair of sunglasses. One watch max, one wrist. Also flag impossible clothing (merged straps, asymmetric duplicated details).
- COMPOSITION / SUBJECT SCALE (only when the persona is the subject of the shot — skip for POV, flat-lay, and app-screenshot slides): the persona must DOMINATE the frame — head near the top edge, shoulders/torso spanning a large share of the frame width, framed roughly thigh-up or closer. FAIL (medium) if the persona reads as a small or distant figure occupying less than about 60% of the frame height.
- TEXT CLEARANCE (persona slides only): the middle band of the image (roughly 40-65% of frame height) will carry an overlay text stack after QA. FAIL (medium) if the persona's head falls inside that band — the head belongs in the top ~38% of the frame so text lands on the chest/torso, never the head.

Grading: verdict "fail" with severity "high" or "medium" ONLY for clear, visible defects that would embarrass the brand if posted. Minor/uncertain cosmetic issues → verdict may still be "pass" with the issue logged at severity "low". A clean image → verdict "pass", severity "none", empty issues. Always write a concise, actionable regen_hint describing exactly what to fix (empty string if pass).`;

async function fetchJSON(url, opts, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, opts);
    if (res.ok) return res.json();
    if (attempt < retries && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    throw new Error(`${url.split("/").slice(-1)} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

async function judgeSlide(localPath, context) {
  if (!process.env.OLLAMA_API_KEY) throw new Error("OLLAMA_API_KEY not set — add it to creator-os/.env.local");
  const data = fs.readFileSync(localPath).toString("base64");
  const body = {
    model: MODEL,
    max_tokens: 4000,
    output_config: { format: { type: "json_schema", schema: QA_SCHEMA } },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data } },
          {
            type: "text",
            text:
              `Persona identity anchor: ${context.identity || "(none provided)"}\n` +
              `Intended scene for this slide: ${context.scene || "(none provided)"}\n\n` +
              `QA this slide against the rubric and return the structured verdict.`,
          },
        ],
      },
    ],
  };
  const json = await createMessage(body);
  const textBlock = (json.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("model returned no text block");
  return JSON.parse(textBlock.text);
}

// ---- FAL regeneration (mirrors carousel-gen falGenerate) ---------------------

async function falRegenerate(persona, planSlide, hint, outPath) {
assertFal("carousel-qa-fix");
  if (!FAL_KEY) throw new Error("FAL_KEY not set — required for --fix");
  const usePersona = planSlide.persona !== false;
  const endpoint = usePersona
    ? "https://fal.run/fal-ai/nano-banana-2/edit"
    : "https://fal.run/fal-ai/nano-banana-2";
  const repair =
    ` CRITICAL FIX — a previous render had this defect: "${hint}". ` +
    `Render this version with fully correct human anatomy (hands with exactly five ` +
    `natural fingers, no fused/extra/missing digits), undistorted objects, ` +
    `no on-screen text or watermark, and ABSOLUTELY NO visible human face anywhere ` +
    `in the frame or in reflections — every person seen from behind, turned away, ` +
    `hidden behind a phone, or softly out of focus.`;
  const body = {
    prompt: planSlide.prompt + repair,
    num_images: 1,
    resolution: "1K",
    aspect_ratio: "4:5",
    output_format: "png",
    safety_tolerance: "5",
  };
  if (usePersona) {
    const ref = fs.readFileSync(persona.referenceImagePath);
    body.image_urls = [`data:image/png;base64,${ref.toString("base64")}`];
  }
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`FAL ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const img = (data.images || [])[0];
  if (!img) throw new Error("FAL returned no image");
  const raw = path.join(os.tmpdir(), `qa-regen-${Date.now()}.png`);
  fs.writeFileSync(raw, Buffer.from(await (await fetch(img.url)).arrayBuffer()));
  // Normalize to the pipeline's 1080x1350 (4:5 cover-crop), like carousel-gen.
  execFileSync("ffmpeg", [
    "-y", "-i", raw,
    "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`,
    outPath,
  ], { stdio: "ignore" });
  fs.unlinkSync(raw);
}

/** fal-outage fallback: swap in a fresh LRU image from persona_images (same
 * bank carousel-gen uses) and let the re-judge validate it. Face-hidden shots
 * are preferred so the no-visible-face rule usually passes first try. */
async function bankSwap(persona, outPath) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
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
    const raw = path.join(os.tmpdir(), `qa-bank-${Date.now()}.png`);
    fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    execFileSync("ffmpeg", [
      "-y", "-i", raw,
      "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`,
      outPath,
    ], { stdio: "ignore" });
    fs.unlinkSync(raw);
    await pool.query(`update persona_images set used_count = used_count + 1, last_used_at = now() where id = $1`, [rows[0].id]);
    return true;
  } finally {
    await pool.end();
  }
}

// ---- Main -------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  if (!opts.carousel) throw new Error("--carousel <carousel.json> is required");
  const meta = JSON.parse(fs.readFileSync(opts.carousel, "utf8"));
  const plan = opts.plan ? JSON.parse(fs.readFileSync(opts.plan, "utf8")) : null;
  const persona = opts.fix ? await loadPersona(ROOT_DIR, opts.slug || meta.persona) : null;

  const identity = plan?.identity_anchor || "";
  const slides = meta.slides.filter((s) => !opts.only || opts.only.includes(s.index));

  console.log(`\n=== CAROUSEL QA — ${meta.topic} ===`);
  console.log(`Model:  ${MODEL}   Slides: ${slides.length}   Mode: ${opts.fix ? "FIX" : "REPORT"}\n`);

  const results = [];
  for (const s of slides) {
    const planSlide = plan?.slides?.[s.index - 1] || null;
    const context = { identity, scene: planSlide?.scene || meta.topic };

    let verdict = await judgeSlide(s.localPath, context);
    let attempts = 0;
    let fixed = false;

    const tag = () => `${verdict.verdict.toUpperCase()} (${verdict.severity})`;
    console.log(`slide ${String(s.index).padStart(2)}: ${tag()}${verdict.identity_ok ? "" : " [identity?]"}`);
    for (const i of verdict.issues) console.log(`         - ${i.category} @ ${i.region}: ${i.detail}`);

    while (opts.fix && verdict.verdict === "fail" && attempts < opts.maxAttempts) {
      attempts++;
      if (!planSlide || !planSlide.prompt) {
        console.log(`         ! cannot regenerate (no plan prompt for slide ${s.index})`);
        break;
      }
      console.log(`         → regenerating (attempt ${attempts}/${opts.maxAttempts})…`);
      // Credit efficiency (Kevin 2026-07-09): the FIRST repair attempt swaps
      // in a free bank image; paid fal regeneration only runs if the bank
      // swap didn't produce a passing slide (or the bank is empty).
      let repaired = false;
      if (attempts === 1) {
        repaired = await bankSwap(persona, s.localPath);
        if (repaired) console.log("         → bank swap (free) — re-judging");
      }
      if (!repaired) {
        try {
          await falRegenerate(persona, planSlide, verdict.regen_hint, s.localPath);
        } catch (e) {
          console.error(`         ! fal regen failed (${String(e.message).slice(0, 70)}) — trying bank swap`);
          const ok = await bankSwap(persona, s.localPath);
          if (!ok) { console.error("         ! no bank image available — slide stays FAILED"); break; }
        }
      }
      verdict = await judgeSlide(s.localPath, context);
      console.log(`         re-QA: ${tag()}`);
      if (verdict.verdict === "pass") { fixed = true; break; }
    }

    results.push({
      index: s.index,
      verdict: verdict.verdict,
      severity: verdict.severity,
      identity_ok: verdict.identity_ok,
      issues: verdict.issues,
      regen_hint: verdict.regen_hint,
      attempts,
      fixed,
    });
  }

  const pass = results.filter((r) => r.verdict === "pass").length;
  const fail = results.filter((r) => r.verdict === "fail").length;
  const fixedCount = results.filter((r) => r.fixed).length;

  const qaPath = path.join(path.dirname(opts.carousel), "qa.json");
  fs.writeFileSync(
    qaPath,
    JSON.stringify(
      { carousel_id: meta.carousel_id, model: MODEL, reviewed_at: new Date().toISOString(), summary: { pass, fail, fixed: fixedCount }, slides: results },
      null,
      2,
    ),
  );

  console.log(`\n=== ${pass} pass / ${fail} fail${opts.fix ? ` (${fixedCount} auto-fixed)` : ""} — wrote ${path.basename(qaPath)} ===`);
  if (fail > 0 && !opts.fix) console.log(`Re-run with --plan <plan.json> --fix to auto-regenerate the failures.`);
  if (persona) await closePersonaPool();
  process.exit(fail > 0 && !opts.fix ? 2 : 0);
}

main().catch(async (e) => {
  console.error(`\nError: ${e.message}`);
  await closePersonaPool().catch(() => {});
  process.exit(1);
});
