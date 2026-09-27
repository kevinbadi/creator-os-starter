#!/usr/bin/env node
/**
 * advice-carousel — the daily "marketing manager advice" pipeline, end to end:
 *
 *   plan (template + daily rotation) → carousel-gen → carousel-qa --fix
 *   → carousel-overlay (texted) → publish TikTok (full deck, autoAddMusic)
 *   → publish Instagram (≤10-slide cut, trending sound baked into slide 1)
 *   → publish Twitter + Threads (one thread, one tip per tweet)
 *
 * Format (see .claude/skills/advice-carousel/SKILL.md): proof-first hook →
 * stakes → reframe → N advice tips (one is the native CreatorOS integration
 * slide) → proof → recap checklist → link-in-bio CTA. TikTok gets the full
 * deck (≤35 photos); Instagram gets a 10-item cut that always keeps hook,
 * integration, recap and CTA and fills the rest with tips in order.
 *
 * SAFETY GATE: publish only runs if every slide passes QA (after auto-fix).
 * QA failure exits 2 and the draft stays in the feed for review.
 *
 * Usage:
 *   node advice-carousel.js [--persona danny]        # cron path (publishes)
 *   node advice-carousel.js --dry-run                # everything except going live
 *   node advice-carousel.js --series ugc-starter     # pin a specific tip series
 *
 * Run with `node --env-file=.env.local` from the creator-os repo root (the
 * Railway cron in src/lib/content/cron.ts spawns it with process env).
 */
const { execFileSync } = require("child_process");
const { assertFal } = require("../../../lib/fal-gate.js");
const fs = require("fs");
const path = require("path");

const SKILLS = path.join(__dirname, "..", "..");
const ROOT = path.join(SKILLS, "..", ".."); // creator-os repo root
const CLAUDE_DIR = path.join(ROOT, ".claude");
const IG_MAX_ITEMS = 10; // Instagram API carousel cap (incl. the sound video slide)

function arg(n) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; }
const etDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const DRY = process.argv.includes("--dry-run");

const SLUG = arg("--persona") || process.env.PERSONA_SLUG || "megan";
// Rotation offset for multi-drop days (advice-thread.js): each slot advances
// the day picks by a 3-day stride so a same-day second thread never
// duplicates the first or the full 2 PM pipeline (which always runs slot 0).
// KNOWN LIMIT (2026-07-26 danny X incident): slot s repeats slot s-1's picks
// VERBATIM 3 days later, and with ~7 picks/day from a 20-hook bank that is
// unavoidable by pigeonhole for ANY stride (stride 7 was tried and is worse:
// 7*3 ≡ 1 mod 20 gives 1-day repeats). X rejects the duplicate text and
// Zernio's server-side retry then spams the root tweet — so the PUBLISHER
// carries a 7-day root-hash guard that skips the X leg on repeats. To get
// full X volume back, grow the hook bank to >= slots*7 (42+) entries.
const SLOT = parseInt(arg("--slot") || "0", 10) || 0;
const TEMPLATE = path.join(__dirname, "..", "templates", `advice-${SLUG}.json`);
if (!fs.existsSync(TEMPLATE)) {
  console.error(`[advice-carousel] no template for persona '${SLUG}': ${TEMPLATE}`);
  process.exit(1);
}

function log(msg) { console.log(`[advice-carousel:${SLUG}] ${msg}`); }

function run(label, script, args) {
  log(`▶ ${label}`);
  execFileSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, PERSONA_SLUG: SLUG },
    timeout: 20 * 60 * 1000,
  });
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Generate the hook's proof inset (the venue's fake Instagram profile page)
// via FAL nano-banana-2 — same call carousel-gen makes, but portrait 4:5 and
// standalone because the inset is composited by carousel-overlay, not a slide.
async function generateInset(prompt, outPath) {
  assertFal("advice-inset"); // hard stop 2026-09-05: no fal images of Megan/Danny
  const FAL_KEY = process.env.FAL_KEY;
  if (!FAL_KEY) throw new Error("FAL_KEY not set");
  const res = await fetch("https://fal.run/fal-ai/nano-banana-2", {
    method: "POST",
    headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      num_images: 1,
      resolution: "1K",
      aspect_ratio: "4:5",
      output_format: "png",
      safety_tolerance: "5",
    }),
  });
  if (!res.ok) throw new Error(`FAL ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const img = ((await res.json()).images || [])[0];
  if (!img) throw new Error("FAL returned no image for inset");
  fs.writeFileSync(outPath, Buffer.from(await (await fetch(img.url)).arrayBuffer()));
}

// Build today's plan, overlays, IG cut and thread from the template banks.
// Every pick rotates by day-of-year so each day is a fresh combination.
function buildFromTemplate() {
  const t = JSON.parse(fs.readFileSync(TEMPLATE, "utf8"));
  // ET date — toISOString/Date.now (UTC) flip to tomorrow at 20:00 ET and
  // would mislabel evening catch-up runs as the next day's.
  const date = etDate();
  const dayIndex = Math.floor(Date.parse(date) / 86400000) + SLOT * 3;
  const pick = (bank, offset = 0) => bank[(dayIndex + offset) % bank.length];

  const seriesId = arg("--series");
  const series = seriesId
    ? t.series.find((s) => s.id === seriesId)
    : pick(t.series);
  if (!series) throw new Error(`series '${seriesId}' not found in ${path.basename(TEMPLATE)}`);

  // --hook <index> forces a specific hook (e.g. firing a fresh real-receipts
  // intro immediately instead of waiting for the rotation to reach it).
  const hookArg = arg("--hook");
  const hook = hookArg != null && hookArg !== ""
    ? t.banks.hooks[Number(hookArg)] ??
      (() => { throw new Error(`--hook ${hookArg} out of range (0-${t.banks.hooks.length - 1})`); })()
    : pick(t.banks.hooks);
  const scene = pick(t.banks.hook_scenes, 1);
  // CTA + integration extra slot offset so same-day slots never share a
  // variant (X rejects duplicate tweets, 2026-07-08 failure). +SLOT*2, NOT
  // +SLOT (2026-07-26 fix): with the 3-day stride the total slot coefficient
  // is 3+multiplier — it must be coprime with the length-8 banks. The old
  // +SLOT gave coefficient 4, so slots two apart shared the SAME cta/integ
  // text every day (4s mod 8 cycles 0,4). Coefficient 5 → all slots distinct.
  const cta = pick(t.banks.ctas, 2 + SLOT * 2);
  const integ = pick(t.integration.variants, 3 + SLOT * 2);
  // Global constants appended to every fal PHOTO prompt (not UI-screenshot
  // insets) — e.g. the one-watch-one-wrist rule after Kevin caught a render
  // with a watch on each hand.
  const suffix = t.prompt_suffix ? ` ${t.prompt_suffix}` : "";

  // Background pool: one entry per non-hook, non-screenshot slide, offset so
  // consecutive slides never share a background even when the pool wraps.
  let bgCursor = 0;
  const bgSlide = (sceneLabel) => {
    const entry = t.backgrounds[(dayIndex + bgCursor++) % t.backgrounds.length];
    if (entry.library) return { source: "library", image: entry.library, scene: sceneLabel, overlay: "" };
    if (entry.file) return { source: "file", file: entry.file, scene: sceneLabel, overlay: "" };
    return { source: "fal", persona: false, focus: "center", scene: sceneLabel, overlay: "", prompt: entry.prompt + suffix };
  };

  const slides = [];
  const overlays = [];
  const roles = [];
  const push = (slide, overlay, role) => { slides.push(slide); overlays.push(overlay); roles.push(role); };

  // 1. Hook — rich-lifestyle thumbnail, proof-first headline.
  push(
    { source: "fal", persona: false, focus: "center", scene: "Advice hook — rich lifestyle thumbnail", overlay: "", prompt: scene + suffix },
    { kind: "hook", headline: hook.headline },
    "hook",
  );

  // 2-3. Stakes + reframe (optional per series).
  if (series.stakes) {
    push(bgSlide("Stakes call-out"), { kind: "tip", position: "center", ...series.stakes }, "stakes");
  }
  if (series.reframe) {
    push(bgSlide("Reframe"), { kind: "tip", position: "center", ...series.reframe }, "reframe");
  }

  // 4+. The tips — one per slide; the `integration:true` entry becomes the
  // native CreatorOS slide (real app screenshot + testimonial copy).
  const total = series.tips.length;
  const threadItems = [];
  let integThreadIdx = -1;
  const recapItems = [];
  series.tips.forEach((tip, i) => {
    const n = i + 1;
    const eyebrow = `TIP ${n}/${total}`;
    if (tip.integration) {
      push(
        { source: "screenshot", file: t.integration.screenshot, scene: "CreatorOS integration — the native ad", overlay: "" },
        { kind: "tip", eyebrow, headline: integ.headline, support: integ.support },
        "integration",
      );
      integThreadIdx = threadItems.length;
      threadItems.push(integ.thread);
      recapItems.push(integ.recap || "one app for every platform");
    } else {
      push(
        bgSlide(`Tip ${n} — ${tip.headline}`),
        { kind: "tip", position: "center", eyebrow, headline: tip.headline, support: tip.support },
        "tip",
      );
      threadItems.push(tip.thread);
      recapItems.push(tip.short || tip.headline);
    }
  });

  // Proof (optional): a receipts screenshot or a text slide.
  if (series.proof) {
    const overlay = series.proof.overlay || { kind: "caption", text: "the receipts" };
    if (series.proof.screenshot) {
      push({ source: "screenshot", file: series.proof.screenshot, scene: "Proof — the receipts", overlay: "" }, overlay, "proof");
    } else {
      push(bgSlide("Proof"), overlay, "proof");
    }
  }

  // Recap — the save trigger: every tip on one slide.
  push(
    bgSlide("Recap checklist"),
    { kind: "bullets", position: "center", title: series.recap_title || "The playbook:", items: recapItems },
    "recap",
  );

  // CTA — ONE action: link in bio.
  push(bgSlide("CTA"), { kind: "caption", text: cta.overlay }, "cta");

  // {{VAR}} fill across everything (OUTFIT etc. + the hook's caption line).
  const vars = { HOOK_LINE: hook.caption_line };
  for (const [name, bank] of Object.entries(t.bank_vars || {})) {
    vars[name] = pick(t.banks[bank], 4);
  }
  const fill = (s) => String(s).replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
  const deepFill = (o) => JSON.parse(fill(JSON.stringify(o)));

  const topic = `${t.topic_prefix} ${date}`;
  const plan = {
    topic,
    content_pillar: t.content_pillar,
    visual_pillar: t.visual_pillar,
    identity_anchor: t.identity_anchor,
    slides: deepFill(slides),
    caption: deepFill(series.caption),
    hashtags: t.hashtags,
  };

  // Instagram cut: hook, integration, recap, CTA always survive; remaining
  // slots fill with tips in order (stakes/reframe/proof are the first drops).
  const mustKeep = new Set(["hook", "integration", "recap", "cta"]);
  const igIndices = new Set(roles.map((r, i) => (mustKeep.has(r) ? i : -1)).filter((i) => i >= 0));
  for (let i = 0; i < roles.length && igIndices.size < IG_MAX_ITEMS; i++) {
    if (roles[i] === "tip") igIndices.add(i);
  }
  const igCut = [...igIndices].sort((a, b) => a - b);

  const thread = deepFill({
    intro: hook.thread_intro,
    items: threadItems,
    cta: cta.thread,
    media: { integrationItemIndex: integThreadIdx, integrationScreenshot: t.integration.screenshot },
  });

  const plansDir = path.join(CLAUDE_DIR, "brand-content", SLUG, "plans");
  fs.mkdirSync(plansDir, { recursive: true });
  const planPath = path.join(plansDir, `${date}-advice${SLOT ? `-s${SLOT}` : ""}.json`);
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

  // Hook proof inset: a hook may carry `insets` (array of venue variants — a
  // DIFFERENT fake business each run, rotated on its own day offset so the
  // combo of hook × venue changes daily) or a single legacy `inset`.
  const hookInset = Array.isArray(hook.insets) && hook.insets.length ? pick(hook.insets, 4) : hook.inset || null;

  return { planPath, overlaysSpec: { note: `advice ${series.id} for ${date}`, slides: deepFill(overlays) }, topic, igCut, thread, seriesUsed: series.id, hookInset };
}

// Least-recently-used tip rotation over the FULL Jun Yuh bank (thread drops
// only). Never-used tips go first, then oldest last_used_at; a category
// round-robin keeps one thread from being 9 mindset tips in a row. Usage is
// tracked per persona in advice_tip_usage so megan and danny rotate
// independently, and the cycle length grows automatically as the harvest
// adds tips to data/jun-yuh-tips.json.
async function cycledThreadTips(count) {
  const bankPath = path.join(__dirname, "..", "data", "jun-yuh-tips.json");
  const bank = JSON.parse(fs.readFileSync(bankPath, "utf8")).tips.filter(
    (t) => t.audience === "creator_growth" || t.audience === "general_productivity",
  );
  if (bank.length < count) throw new Error(`bank too small (${bank.length})`);
  const key = (t) => t.headline.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    await pool.query(`create table if not exists advice_tip_usage (
      persona text not null,
      tip_key text not null,
      uses int not null default 0,
      last_used_at timestamptz not null default now(),
      primary key (persona, tip_key))`);
    const { rows } = await pool.query(
      `select tip_key, last_used_at from advice_tip_usage where persona = $1`,
      [SLUG],
    );
    const usage = new Map(rows.map((r) => [r.tip_key, new Date(r.last_used_at).getTime()]));
    const stamp = (t) => usage.get(key(t)) ?? 0;
    const sorted = [...bank].sort((a, b) => stamp(a) - stamp(b));

    const byCat = new Map();
    for (const t of sorted) {
      const c = t.category || "misc";
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(t);
    }
    // Freshest-headed categories first so the round-robin start rotates too.
    const cats = [...byCat.keys()].sort((a, b) => stamp(byCat.get(a)[0]) - stamp(byCat.get(b)[0]));
    const picked = [];
    // One tip per variant GROUP per thread — a style rewrite (variant_of)
    // teaches the same advice as its original, so pairing them reads as a
    // duplicate tip to the reader.
    const groups = new Set();
    for (let i = 0, idle = 0; picked.length < count && idle < cats.length; i++) {
      const list = byCat.get(cats[i % cats.length]);
      if (!list.length) { idle++; continue; }
      const t = list.shift();
      const group = t.variant_of || key(t);
      if (groups.has(group)) { i--; continue; } // retry same category's next tip
      groups.add(group);
      picked.push(t);
      idle = 0;
    }
    for (const t of picked) {
      await pool.query(
        `insert into advice_tip_usage (persona, tip_key, uses) values ($1, $2, 1)
         on conflict (persona, tip_key)
         do update set uses = advice_tip_usage.uses + 1, last_used_at = now()`,
        [SLUG, key(t)],
      );
    }
    return picked;
  } finally {
    await pool.end();
  }
}

async function main() {
  const { planPath, overlaysSpec, topic, igCut, thread, seriesUsed, hookInset } = buildFromTemplate();
  log(`plan built (series=${seriesUsed}) → ${path.relative(ROOT, planPath)}`);

  // --plan-only: print the day's build without generating anything (free).
  if (process.argv.includes("--plan-only")) {
    const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
    plan.slides.forEach((s, i) => {
      const ov = overlaysSpec.slides[i];
      const igMark = igCut.includes(i) ? "IG+TT" : "TT   ";
      const text = ov.headline || ov.text || ov.title || "";
      console.log(`  ${String(i + 1).padStart(2)}. [${igMark}] [${s.source}] ${ov.kind}${ov.eyebrow ? ` ${ov.eyebrow}` : ""} — ${text.slice(0, 60)}`);
    });
    console.log(`\n  thread: intro (${thread.intro.length}ch) + ${thread.items.length} tips + CTA (${thread.cta.length}ch)`);
    thread.items.forEach((it, i) => console.log(`    ${String(i + 1).padStart(2)}. (${it.length}ch) ${it.split("\n")[0].slice(0, 70)}`));
    console.log(`\n  hook inset: ${hookInset ? `yes — ${hookInset.prompt.slice(0, 70)}…` : "none"}`);
    return;
  }

  // --thread-only: write today's thread.json (same deterministic day picks as
  // the full pipeline) and exit — for re-posting the written version to a
  // newly connected platform without regenerating the deck.
  if (process.argv.includes("--thread-only")) {
    // Thread drops CYCLE tips from the full Jun Yuh bank (per-persona LRU)
    // instead of reusing the series' fixed 10 — at 4-6 drops/day the series
    // repeated the same tips within a day (Kevin 2026-07-10: "make sure the
    // threads tips are cycling with new ones from the jun yuh research").
    // The full deck pipeline keeps curated series tips (captions/slides are
    // tuned to them); only the written thread items rotate.
    if (process.env.DATABASE_URL) {
      try {
        const integIdx = thread.media?.integrationItemIndex ?? 5;
        const fresh = await cycledThreadTips(thread.items.length - 1);
        thread.items = thread.items.map((orig, i) => {
          if (i === integIdx) return orig; // CreatorOS integration item stays
          const t = fresh.shift();
          return `${i + 1}. ${String(t.thread).replace(/^\d+\.\s*/, "")}`;
        });
        console.log(`[advice-carousel:${SLUG}] thread tips cycled from bank (LRU)`);
      } catch (e) {
        console.error(`[advice-carousel:${SLUG}] tip cycling failed (${e.message}) — using series tips`);
      }
    }
    const threadPath = path.join(path.dirname(planPath), `${etDate()}${SLOT ? `-s${SLOT}` : ""}-thread.json`);
    fs.writeFileSync(threadPath, JSON.stringify(thread, null, 2));
    console.log(`thread written → ${threadPath}`);
    return;
  }

  const date = etDate();
  const dir = path.join(CLAUDE_DIR, "brand-content", SLUG, "carousels", `${date}-${slugify(topic)}`);
  const sidecar = path.join(dir, "carousel.json");

  // Idempotency guard: manual runs and the cron coexist, so if an advice post
  // for this persona already went out today, skip instead of double-posting.
  // DB-backed (content_posts) because the cron box has its own filesystem.
  // Override with --force.
  if (!DRY && !process.argv.includes("--force") && process.env.DATABASE_URL) {
    try {
      const { Pool } = require("pg");
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
      const { rows } = await pool.query(
        `select 1 from content_posts
          where persona = $1 and status = 'published'
            -- ET day, NOT UTC: the 19 ET run publishes past 00:00 UTC, so a
            -- UTC comparison made yesterday's late run block today's slot
            -- (megan-advice silently skipped 2026-07-09).
            and (posted_at at time zone 'America/New_York')::date
                = (now() at time zone 'America/New_York')::date
            and metadata->>'topic' like 'Creator growth advice%'
          limit 1`,
        [SLUG],
      );
      await pool.end();
      if (rows.length) {
        log(`advice post already published today for '${SLUG}' — skipping (use --force to post anyway)`);
        return;
      }
    } catch (e) {
      console.warn(`[advice-carousel] ! already-posted check failed (continuing): ${e.message}`);
    }
  }

  // 1. Render slides (9:16 full-screen vertical).
  run("carousel-gen", path.join(SKILLS, "carousel-gen", "scripts", "carousel-gen.js"), ["--plan", planPath, "--aspect", "9:16"]);
  if (!fs.existsSync(sidecar)) throw new Error(`expected sidecar not found: ${sidecar}`);

  // 2. QA with auto-fix — THE PUBLISH GATE.
  run("carousel-qa --fix", path.join(SKILLS, "carousel-qa", "scripts", "carousel-qa.js"),
    ["--carousel", sidecar, "--plan", planPath, "--fix"]);
  const qa = JSON.parse(fs.readFileSync(path.join(dir, "qa.json"), "utf8"));
  if (qa.summary.fail > 0) {
    console.error(`[advice-carousel] ❌ QA gate: ${qa.summary.fail} slide(s) still failing after auto-fix — NOT publishing. Draft left in feed for review.`);
    process.exit(2);
  }
  log(`QA gate passed: ${qa.summary.pass}/${qa.slides.length} (${qa.summary.fixed} auto-fixed)`);

  // 3. Hook proof inset — the venue's fake Instagram profile page, superimposed
  //    small on slide 1 so the hook's claim has a visible referent. Composited
  //    by carousel-overlay's inset support; a FAL failure here is non-fatal
  //    (the hook still works without the receipt).
  if (hookInset) {
    const insetPath = path.join(dir, "inset-hook.png");
    try {
      log("generating hook proof inset (venue IG profile)…");
      await generateInset(hookInset.prompt, insetPath);
      overlaysSpec.slides[0].inset = {
        image: insetPath,
        widthFrac: hookInset.widthFrac || 0.3,
        pos: hookInset.pos || "top-right",
        margin: hookInset.margin ?? 40,
      };
    } catch (e) {
      console.warn(`[advice-carousel] ! inset generation failed (continuing without): ${e.message}`);
    }
  }

  // 4. Burn on-screen text.
  const overlaysPath = path.join(dir, "overlays.json");
  fs.writeFileSync(overlaysPath, JSON.stringify(overlaysSpec, null, 2));
  run("carousel-overlay", path.join(SKILLS, "carousel-gen", "scripts", "carousel-overlay.js"),
    ["--carousel", sidecar, "--overlays", overlaysPath, "--aspect", "9:16"]);

  // 5. Point the feed sidecar at the texted slides (raw kept in carousel.raw.json).
  fs.copyFileSync(sidecar, path.join(dir, "carousel.raw.json"));
  const meta = JSON.parse(fs.readFileSync(sidecar, "utf8"));
  const texted = JSON.parse(fs.readFileSync(path.join(dir, "texted", "carousel.json"), "utf8"));
  meta.slides = texted.slides;
  meta.texted = true;
  meta.texted_at = texted.texted_at;
  fs.writeFileSync(sidecar, JSON.stringify(meta, null, 2));
  log("sidecar → texted slides");

  // Publish steps are independent — one platform failing must not stop the
  // rest (2026-07-07: an IG ffmpeg crash silently killed the Twitter/Threads
  // threads for the day). Failures are collected and the run still exits 1.
  const publishFailures = [];
  const tryStep = (label, fn) => {
    try { fn(); } catch (e) {
      publishFailures.push(label);
      console.error(`[advice-carousel] ✗ ${label} publish failed (continuing): ${e.message}`);
    }
  };

  // 6. TikTok — the FULL deck (photo carousel, autoAddMusic). Skipped with
  //    --no-tiktok (Kevin 2026-07-08: carousels underperform reaction UGC on
  //    TikTok — those keep the upload slots there).
  if (process.argv.includes("--no-tiktok")) {
    log("TikTok publish skipped (--no-tiktok)");
  } else {
    tryStep("tiktok", () => run(DRY ? "carousel-publish-tiktok (DRY RUN)" : "carousel-publish-tiktok --publish",
      path.join(SKILLS, "carousel-publish-tiktok", "scripts", "carousel-publish-tiktok.js"),
      DRY ? ["--carousel", sidecar] : ["--carousel", sidecar, "--publish"]));
  }

  // 7. Instagram — the FULL deck as one slideshow video, posted as a Reel
  //    with the trending sound across it (Kevin 2026-07-06: Reels reach beats
  //    the feed-carousel surface, and the 10-item cap stops applying). The
  //    ≤10-item cut path stays available via --ig-carousel for A/B runs.
  const soundGender = { megan: "female", danny: "male" }[SLUG] || "any";
  if (process.argv.includes("--ig-carousel")) {
    const igDir = path.join(dir, "ig");
    fs.mkdirSync(igDir, { recursive: true });
    const igSidecar = path.join(igDir, "carousel.json");
    fs.writeFileSync(igSidecar, JSON.stringify({
      ...meta,
      carousel_id: `${meta.carousel_id}-ig`,
      slides: igCut.map((slideIdx, i) => ({ ...meta.slides[slideIdx], index: i + 1 })),
      slide_count: igCut.length,
    }, null, 2));
    log(`IG cut: ${igCut.length}/${meta.slides.length} slides (kept hook/integration/recap/CTA + tips in order)`);
    tryStep("instagram", () => run(DRY ? "carousel-publish-instagram (DRY RUN)" : "carousel-publish-instagram --publish",
      path.join(SKILLS, "carousel-publish-instagram", "scripts", "carousel-publish-instagram.js"),
      DRY
        ? ["--carousel", igSidecar, "--sound-gender", soundGender]
        : ["--carousel", igSidecar, "--sound-gender", soundGender, "--publish"]));
  } else {
    log(`IG slideshow Reel: all ${meta.slides.length} slides → one 9:16 video`);
    tryStep("instagram", () => run(DRY ? "carousel-publish-instagram --slideshow (DRY RUN)" : "carousel-publish-instagram --slideshow --publish",
      path.join(SKILLS, "carousel-publish-instagram", "scripts", "carousel-publish-instagram.js"),
      DRY
        ? ["--carousel", sidecar, "--sound-gender", soundGender, "--slideshow"]
        : ["--carousel", sidecar, "--sound-gender", soundGender, "--slideshow", "--publish"]));
  }

  // 8. Twitter + Threads — the written version, one tip per thread item.
  const threadPath = path.join(dir, "thread.json");
  fs.writeFileSync(threadPath, JSON.stringify(thread, null, 2));
  tryStep("twitter/threads", () => run(DRY ? "advice-publish-thread (DRY RUN)" : "advice-publish-thread --publish",
    path.join(__dirname, "advice-publish-thread.js"),
    DRY
      ? ["--carousel", sidecar, "--thread", threadPath]
      : ["--carousel", sidecar, "--thread", threadPath, "--publish"]));

  if (publishFailures.length) {
    console.error(`[advice-carousel] ❌ published with failures: ${publishFailures.join(", ")}`);
    process.exit(1);
  }
  log(`✅ done — ${topic}${DRY ? " (dry run, nothing posted)" : process.argv.includes("--no-tiktok") ? " — LIVE on Instagram + Twitter/Threads" : " — LIVE on TikTok + Instagram + Twitter/Threads"}`);
}

main().catch((e) => {
  console.error(`\n[advice-carousel] ❌ ${e.message}`);
  process.exit(1);
});
