#!/usr/bin/env node
/**
 * danny-daily-carousel — end-to-end "day in the life" for Danny, twice daily.
 *
 *   plan (rotated hook + face-hidden scene pools + full caption)
 *     → carousel-gen (clean slides)
 *     → carousel-qa (gate; swap pool alternates + retry on fail)
 *     → carousel-overlay (Manrope text system)
 *     → carousel-publish-tiktok --publish (autoAddMusic native trending sound)
 *     → carousel-publish-instagram --publish (male/any trending sound baked
 *       into the first-slide video)
 *
 * FACE POLICY: every persona image is face-hidden (from-behind / phone-over-
 * face / POV) — carousel-qa hard-fails visible faces.
 *
 * Runtime assets live in .claude/assets/brand/danny (this path SHIPS in the
 * Railway image — .claude/brand-content is gitignored and does NOT deploy;
 * that bug silently killed the Jul 2–4 runs with ENOENT on hook-headers).
 *
 * DRY RUN by default — add --publish to post. --slot <n> differentiates the
 * same day's runs (hook/caption/scene rotation offset). --date YYYY-MM-DD
 * re-runs a specific day.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const ASSETS = ".claude/assets/brand/danny"; // read-side (ships to Railway)
const BRAND = ".claude/brand-content/danny"; // write-side (plans + rendered runs)
const PUBLISH = process.argv.includes("--publish");
const argOf = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const dateArg = argOf("--date");
const SLOT = parseInt(argOf("--slot") || "0", 10) || 0;

// Day key in ET so folders + rotation flip at local midnight, not UTC.
const now = new Date();
const et = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const DAY = dateArg || et.format(now); // YYYY-MM-DD
// Each slot advances the rotation like an extra "day", so the AM and PM posts
// differ in hook, scenes, and caption.
const dayIndex = Math.floor(new Date(DAY + "T00:00:00Z").getTime() / 86400000) * 2 + SLOT;
const SLOT_TAG = SLOT ? `slot${SLOT}` : "am";

function run(label, args, opts = {}) {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit", env: process.env, ...opts });
  if (r.status !== 0 && !opts.allowFail) {
    console.error(`✗ ${label} failed (exit ${r.status})`);
    process.exit(r.status || 1);
  }
  return r.status;
}

// ---------------------------------------------------------------- scene pools
// All face-hidden (regenerated 2026-07-05 after the fal top-up). Each slot
// rotates per run; the QA gate re-checks every assembled carousel.
const pick = (arr, salt = 0) => arr[(dayIndex + salt) % arr.length];

const MORNING = pick([
  { image: "danny-morning-dog-walk", ov: { kind: "label", time: "6:45 AM", name: "MORNING MILES", subtitle: "Walking the real CEO" } },
  { image: "danny-kitchen-coffee-morning", ov: { kind: "label", time: "6:45 AM", name: "FIRST COFFEE", subtitle: "Quiet before the queue" } },
  { image: "danny-frenchie-couch-chill", ov: { kind: "label", time: "6:45 AM", name: "SLOW START", subtitle: "The boss said five more minutes" } },
], 0);
const WORK = pick([
  { image: "danny-edit-desk-wide", ov: { kind: "label", time: "9:00 AM", name: "THE EDIT CAVE", subtitle: "One block, nine clients" } },
  { image: "danny-ring-light-filming-setup", ov: { kind: "label", time: "9:00 AM", name: "SET LIFE", subtitle: "Filming day for two clients" } },
  { image: "danny-cafe-laptop-work", ov: { kind: "label", time: "9:00 AM", name: "REMOTE HQ", subtitle: "Captions + scheduling sprint" } },
], 1);
const CALLS = pick([
  { image: "danny-rooftop-client-call", ov: { kind: "label", time: "2:00 PM", name: "CLIENT CALLS", subtitle: "Two calls. That's the meeting load." } },
  { image: "danny-corner-office-desk", ov: { kind: "label", time: "2:00 PM", name: "CHECK-INS", subtitle: "Two calls. That's it." } },
  { image: "danny-boardroom-presentation", ov: { kind: "label", time: "2:00 PM", name: "PITCH DAY", subtitle: "One deck, one yes" } },
], 2);
const MONEY = pick([
  { image: "danny-911-leaning-golden-hour", ov: { kind: "caption", time: "6:00 PM", text: "Organic content paid for this" } },
  { image: "danny-911-driver-seat", ov: { kind: "caption", time: "6:00 PM", text: "Organic content paid for this" } },
  { image: "danny-hotel-lobby-walk", ov: { kind: "caption", time: "6:00 PM", text: "Client work travels well" } },
], 3);

const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, ASSETS, "hook-headers.json"), "utf8")).headers;
const hook = hooks[dayIndex % hooks.length];

// ------------------------------------------------------------------- caption
const CAPTIONS = [
  `POV: your one-man agency made $22k last month — and you still trained every single day 🐾\n\nthe honest version of the dream:\n🌅 4:58 club (the Frenchie disagrees)\n🏋️ train before the phone wakes up\n🎬 one deep-work block edits 9 clients' content\n📲 CreatorOS queues everything — IG, TikTok, X, one dashboard\n📞 two calls. that's the whole meeting load\n📈 receipts near the end\n\nno team. no chaos. one app.\n\ncomment "OS" and I'll DM you the link.`,
  `a full day running a one-man social media agency — unedited 🐾\n\n4:58 wake up, train first\n6:45 walk the boss\n9:00 one editing block covers all 9 clients\n2:00 two client calls, that's the meeting load\n6:00 golden hour (organic content paid for the car)\n\nreceipts near the end. no team needed. comment "OS" and I'll send you the app.`,
  `$22k last month. zero employees. here's the actual day 👇\n\ntrain → walk the dog → edit 9 clients in one block → schedule it all in one dashboard → two calls → client dinner → done by 10\n\nthe whole agency runs on one app — receipts near the end.\n\ncomment "OS" for the link 🐾`,
];
const tiktokCaption = CAPTIONS[dayIndex % CAPTIONS.length];

// ---------------------------------------------------------------------- plan
const topic = `Day in the life ${DAY} ${SLOT_TAG}`;
const plan = {
  topic,
  content_pillar: "creatoros",
  visual_pillar: "aesthetic",
  concept: `Auto-generated daily day-in-the-life (${DAY}, slot ${SLOT}). Face-hidden era: every persona shot is from-behind / phone-over-face / POV. Hook #${hook.id}; pools rotated by day×2+slot.`,
  identity_anchor: "Danny — a young Black man in his mid-20s with deep brown skin, a short cropped fade, athletic muscular build, thin silver cuban-link chain necklace; face never visible.",
  slides: [
    { source: "library", image: "danny-bedroom-mirror-close", time: "4:58 AM", scene: "Cover — phone-over-face mirror (hook)", overlay: "", focus: "top" },
    { source: "library", image: "danny-gym-curl-side", time: "5:30 AM", scene: "Gym from behind — today's list", overlay: "", focus: "top" },
    { source: "library", image: MORNING.image, time: "6:45 AM", scene: "Morning slot", overlay: "", focus: "center" },
    { source: "library", image: "danny-meal-prep-counter", time: "7:30 AM", scene: "Fuel prep (POV, no face)", overlay: "", focus: "center" },
    { source: "library", image: WORK.image, time: "9:00 AM", scene: "Work slot", overlay: "", focus: "center" },
    { source: "file", file: `${ASSETS}/screenshots/post-analytics.png`, scene: "Real CreatorOS analytics beat", overlay: "" },
    { source: "library", image: CALLS.image, time: "2:00 PM", scene: "Calls slot", overlay: "", focus: "center" },
    { source: "library", image: MONEY.image, time: "6:00 PM", scene: "Money slot", overlay: "", focus: "center" },
    { source: "library", image: "danny-client-dinner-2", time: "7:30 PM", scene: "Client dinner from behind", overlay: "", focus: "center" },
    { source: "file", file: `${ASSETS}/screenshots/social-analytics-danny.png`, scene: "Receipts + CTA closer", overlay: "" },
  ],
  caption: { instagram: tiktokCaption, tiktok: tiktokCaption },
  hashtags: ["#dayinthelife", "#agencyowner", "#smma", "#socialmediamarketing", "#entrepreneur", "#contentcreator", "#agencylife", "#creatoros"],
};

const overlays = {
  note: `Auto-generated ${DAY} slot ${SLOT} — approved text system (Manrope timestamp).`,
  style: { timeFont: ".claude/assets/fonts/Manrope-ExtraBold.ttf", timeSize: 76, timeCase: "lower", timeGap: 0.5 },
  slides: [
    { kind: "hook", time: "4:58 AM", headline: hook.hook },
    { kind: "bullets", time: "5:30 AM", title: "Today's list:", items: ["Train (non-negotiable)", "Walk the boss", "Edit 9 clients' content", "Schedule it all in one app", "Two client calls", "Client dinner"] },
    MORNING.ov,
    { kind: "label", time: "7:30 AM", name: "FUEL PREP", subtitle: "Meals done once, decisions saved all week" },
    WORK.ov,
    { kind: "caption", text: "45 posts. 679k views. one dashboard." },
    CALLS.ov,
    MONEY.ov,
    { kind: "label", time: "7:30 PM", name: "DINNER W/ A CLIENT", subtitle: "Retention > cold outreach" },
    { kind: "caption", text: 'the receipts — comment "OS" for the app' },
  ],
};

const planPath = path.join(ROOT, BRAND, "plans", `daily-${DAY}-${SLOT_TAG}.json`);
fs.mkdirSync(path.dirname(planPath), { recursive: true });
fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
console.log(`plan: ${planPath}\nhook #${hook.id}: ${hook.hook}\nslots: ${MORNING.image} | ${WORK.image} | ${CALLS.image} | ${MONEY.image}`);

// ------------------------------------------------------------------ pipeline
const slugTopic = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const runDir = path.join(ROOT, BRAND, "carousels", `${DAY}-${slugTopic}`);
const sidecar = path.join(runDir, "carousel.json");

run("carousel-gen", [".claude/skills/carousel-gen/scripts/carousel-gen.js", "--plan", planPath, "--slug", "danny"]);

// QA gate: a failing pooled slide swaps to the slot's next face-hidden image
// and re-renders; fixed-slide failures bail to human review.
let qaOK = false;
for (let attempt = 1; attempt <= 3; attempt++) {
  const status = run(`carousel-qa (attempt ${attempt})`, [".claude/skills/carousel-qa/scripts/carousel-qa.js", "--carousel", sidecar], { allowFail: true });
  if (status === 0) { qaOK = true; break; }
  const qa = JSON.parse(fs.readFileSync(path.join(runDir, "qa.json"), "utf8"));
  const failed = qa.slides.filter((s) => s.verdict === "fail").map((s) => s.index);
  console.log(`QA failed slides: ${failed.join(", ")} — rotating alternates and retrying`);
  const pools = {
    3: ["danny-morning-dog-walk", "danny-kitchen-coffee-morning", "danny-frenchie-couch-chill"],
    5: ["danny-edit-desk-wide", "danny-ring-light-filming-setup", "danny-cafe-laptop-work"],
    7: ["danny-rooftop-client-call", "danny-corner-office-desk", "danny-boardroom-presentation"],
    8: ["danny-911-leaning-golden-hour", "danny-911-driver-seat", "danny-hotel-lobby-walk"],
  };
  let swapped = false;
  for (const idx of failed) {
    if (pools[idx]) {
      const pool = pools[idx];
      const cur = plan.slides[idx - 1].image;
      plan.slides[idx - 1].image = pool[(pool.indexOf(cur) + attempt) % pool.length];
      console.log(`  slide ${idx}: ${cur} → ${plan.slides[idx - 1].image}`);
      swapped = true;
    }
  }
  if (!swapped) break;
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
  run("carousel-gen (retry)", [".claude/skills/carousel-gen/scripts/carousel-gen.js", "--plan", planPath, "--slug", "danny"]);
}
if (!qaOK) { console.error("✗ QA could not be satisfied — NOT publishing. Review qa.json:", path.join(runDir, "qa.json")); process.exit(2); }

const overlaysPath = path.join(runDir, "overlays.json");
fs.writeFileSync(overlaysPath, JSON.stringify(overlays, null, 2));
run("carousel-overlay", [".claude/skills/carousel-gen/scripts/carousel-overlay.js", "--carousel", sidecar, "--overlays", overlaysPath]);

const textedSidecar = path.join(runDir, "texted", "carousel.json");
run(PUBLISH ? "carousel-publish-tiktok --publish" : "carousel-publish-tiktok (dry run)",
  [".claude/skills/carousel-publish-tiktok/scripts/carousel-publish-tiktok.js", "--persona", "danny", "--carousel", textedSidecar, ...(PUBLISH ? ["--publish"] : [])]);

// Instagram: IG can't attach audio natively — the publisher bakes a male/any
// trending sound into a video first slide. A TikTok failure above aborts the
// run; an IG failure is logged loudly but never retracts the live TikTok post.
run(PUBLISH ? "carousel-publish-instagram --publish" : "carousel-publish-instagram (dry run)",
  [".claude/skills/carousel-publish-instagram/scripts/carousel-publish-instagram.js",
   "--persona", "danny", "--sound-gender", "male", "--carousel", textedSidecar,
   ...(PUBLISH ? ["--publish"] : [])]);

console.log(`\n✓ daily danny carousel ${PUBLISH ? "PUBLISHED (TikTok + Instagram)" : "dry-run complete"} — ${runDir}`);
