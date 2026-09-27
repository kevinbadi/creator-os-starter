#!/usr/bin/env node
/**
 * pro-tips-deck — the brand's professional "best marketing tips" deck,
 * end to end: curate fresh tips → fal backgrounds (locked style) → composite
 * branded slides → publish TikTok + Instagram + LinkedIn + X.
 *
 * Runs EVERY OTHER DAY (dayIndex parity gate) from the daily 13:00 ET timer.
 * See SKILL.md for the locked visual system and rotation rules.
 *
 *   node --env-file=.env.local scripts/pro-tips-deck.mjs [--dry-run|--publish] [--force] [--slot N]
 */
import fs from "node:fs";
import { createRequire as __cr } from "node:module";
const { assertFal } = __cr(import.meta.url)("../../../lib/fal-gate.js");
import path from "node:path";
import { execFileSync, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..", ".."); // repo root
const CLAUDE = path.join(ROOT, ".claude");
const FONTS = path.join(CLAUDE, "assets/fonts");
const HEAD = path.join(FONTS, "Manrope-ExtraBold.ttf");
const BODY = path.join(FONTS, "Arimo-Regular.ttf");
const MARK = path.join(FONTS, "Montserrat-Bold.ttf");
const ICON = path.join(CLAUDE, "assets/brand/creatoros/app-icon.png");
const TIPS_BANK = path.join(CLAUDE, "skills/advice-carousel/data/jun-yuh-tips.json");
const TEAL = "0x2dd4bf";
const FAL_KEY = process.env.FAL_KEY;

const argv = process.argv.slice(2);
const PUBLISH = argv.includes("--publish");
const FORCE = argv.includes("--force");
const DAILY_TIP = argv.includes("--daily-tip"); // X-only single tip of the day

// ── cadence (Kevin 2026-07-08 pm) ────────────────────────────────────────────
// Full deck: WEEKLY (TikTok + IG + LinkedIn), anchored to 2026-07-08 → runs
// every Wednesday-ish (dayIndex % 7 === WEEK_ANCHOR). X instead gets a DAILY
// single-tip post via --daily-tip.
// ET date, not toISOString (UTC) — UTC flips to tomorrow at 20:00 ET, so an
// evening catch-up run would label its post with the next day's date and eat
// that day's slot (the 07-08 20:14 daily-tip incident).
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const dayIndex = Math.floor(Date.parse(date) / 86400000);
const WEEK_ANCHOR = 6; // 2026-07-08 % 7
const runIndex = Math.floor(dayIndex / 7);
const DECK_ID = `pro-tips-deck-${date}`;
const DIR = path.join(CLAUDE, "brand-content/creatoros/carousels", `${date}-pro-tips-deck`);
const RAW = path.join(DIR, "raw");

// ── content banks ────────────────────────────────────────────────────────────
// Tips that contradict the product message never make a deck.
const EXCLUDE = ["Master One Platform Before Expanding"];

// REAL, widely-documented creator quotes only — verify before adding.
const QUOTES = [
  { quote: "Make 100 videos and improve one thing every time. By video 100 you'll be good enough to blow up.", who: "MrBeast" },
  { quote: "Document. Don't create.", who: "Gary Vaynerchuk" },
  { quote: "Volume negates luck.", who: "Alex Hormozi" },
  { quote: "The most dangerous thing you can do is play it safe.", who: "Casey Neistat" },
  { quote: "You can't use up creativity. The more you use, the more you have.", who: "Maya Angelou" },
  { quote: "Start before you're ready.", who: "Steven Pressfield" },
];

// The subtle native slide — styled EXACTLY like a tip so it reads as one.
const NATIVE = {
  eyebrow: "THE SHORTCUT",
  headline: "Connect every platform to one system",
  support: "The best creators never upload six times. Creator OS schedules, posts and tracks all your socials from one place, so the rules above run on autopilot.",
  subject: "a glowing wireframe hub node connected by thin light lines to six orbiting platform nodes arranged in a ring",
};

const COVER = {
  title: "10 rules the best creators follow",
  sub: "the best marketing tips for creators, curated for you.",
  eyebrow: "THE CREATOR PLAYBOOK",
  subject: "a large triangular play button knot of glowing wireframe lines and nodes, floating",
};
const CTA = {
  title: "One app runs your whole content system",
  sub: "Schedule once. Post to every platform. Track it all. Creator OS - link in bio.",
  eyebrow: "CREATOR OS",
  subject: "a wireframe smartphone radiating thin light lines to six orbiting glowing nodes",
};

// Deterministic per-tip visual metaphor so the imagery always fits the copy.
const SUBJECTS = {
  consistency: "a long chain of small glowing links stretching to the horizon with one link burning brightest",
  systems: "an isometric flowchart of glowing nodes and connecting lines",
  scripting: "a glowing waveform of thin teal lines with elegant peaks",
  platform_mechanics: "an abstract glowing interface grid of cards and toggles",
  monetization: "a rising stack of thin glowing coins dissolving into particles",
  niche_audience: "a glowing fingerprint made of fine particle lines",
  analytics: "a smooth ascending analytics curve with a soft glow under the line",
  repurposing: "three glowing rectangles unfolding from a single bright square",
  hooks: "a glowing fishhook drawn in one continuous wireframe line",
  mindset: "a wireframe human head profile filled with constellation stars",
};

// Locked style — brighter than v1 (Kevin: overall brighter, luminous).
const STYLE = (subject) =>
  `Premium dark editorial brand background, deep charcoal-black gradient with a soft ambient teal glow, ${subject} rendered as an elegant luminous teal wireframe of thin lines, nodes and light particles (vibrant teal #2dd4bf, bright glow, like a hologram), centered in the upper two thirds, generous negative space, luminous high-key lighting for a dark theme, high contrast, cinematic minimal tech-brand aesthetic. Absolutely no text, no letters, no numbers, no logos, no people, no faces.`;

// ── tip curation: category round-robin, sliced by runIndex ───────────────────
function pickTips() {
  const bank = JSON.parse(fs.readFileSync(TIPS_BANK, "utf8"));
  const all = (Array.isArray(bank) ? bank : bank.tips ?? [])
    .filter((t) => !EXCLUDE.some((x) => t.headline.includes(x)));
  const byCat = new Map();
  for (const t of all) {
    if (!byCat.has(t.category)) byCat.set(t.category, []);
    byCat.get(t.category).push(t);
  }
  // Round-robin across categories → maximal variety within every slice.
  const order = [];
  const cats = [...byCat.keys()].sort();
  for (let i = 0; order.length < all.length; i++) {
    for (const c of cats) {
      const arr = byCat.get(c);
      if (arr[i]) order.push(arr[i]);
    }
  }
  const start = (runIndex * 10) % order.length;
  const picked = [];
  for (let i = 0; picked.length < 10; i++) picked.push(order[(start + i) % order.length]);
  return picked;
}

// ── rendering (ported from deck v1, text sizes up + brighter grade) ─────────
const wrap = (text, max) => {
  const words = String(text).split(/\s+/); const lines = []; let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= max) line += " " + w;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
};
const tmpFiles = [];
const tf = (text) => {
  const f = path.join(RAW_OVERRIDE ?? RAW, `t-${tmpFiles.length}.txt`);
  fs.writeFileSync(f, text); tmpFiles.push(f); return f;
};
const dt = (file, font, size, color, x, y) =>
  `drawtext=fontfile='${font}':textfile='${file}':fontsize=${size}:fontcolor=${color}:x=${x}:y=${y}`;

// Brighter grade: lift the fal image, lighter global scrim than v1.
function chrome(extra) {
  return [
    "scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350,setsar=1",
    "eq=brightness=0.07:saturation=1.2",
    "drawbox=x=0:y=0:w=1080:h=1350:color=black@0.18:t=fill",
    ...extra,
    dt(tf("CREATOR OS"), MARK, 34, "white", 150, 64),
    dt(tf("@creator_oss"), BODY, 26, "white@0.5", "(w-text_w)/2", 1290),
  ].join(",");
}
function composite(bg, out, filters) {
  execFileSync("ffmpeg", ["-y", "-i", bg, "-i", ICON,
    "-filter_complex", `[0:v]${filters}[base];[1:v]scale=72:72[logo];[base][logo]overlay=48:44`,
    "-frames:v", "1", out], { stdio: "pipe", timeout: 120000 });
}

function buildTip(eyebrow, headline, support, bg, out) {
  const heads = wrap(headline, 18);       // v1: 20 chars @72 → now 18 @80
  const sups = wrap(support, 40);         // v1: 42 @36 → now 40 @40
  const headSize = 80, headLh = 96, supLh = 56;
  const blockH = heads.length * headLh + 28 + sups.length * supLh;
  const y0 = 1230 - blockH - 60;
  composite(bg, out, chrome([
    `drawbox=x=0:y=${y0 - 60}:w=1080:h=${1350 - (y0 - 60)}:color=black@0.30:t=fill`,
    dt(tf(eyebrow), MARK, 32, TEAL, 72, y0 - 14),
    ...heads.map((l, i) => dt(tf(l), HEAD, headSize, "white", 72, y0 + 40 + i * headLh)),
    ...sups.map((l, i) => dt(tf(l), BODY, 40, "white@0.8", 72, y0 + 40 + heads.length * headLh + 24 + i * supLh)),
  ]));
}
function buildQuote(q, bg, out) {
  const lines = wrap(`"${q.quote}"`, 24);
  const size = 64, lh = 82;
  const y0 = Math.round((1350 - lines.length * lh) / 2) - 40;
  composite(bg, out, chrome([
    `drawbox=x=0:y=${y0 - 70}:w=1080:h=${lines.length * lh + 200}:color=black@0.30:t=fill`,
    dt(tf("FROM A CREATOR WHO DID IT"), MARK, 30, TEAL, 72, y0 - 24),
    ...lines.map((l, i) => dt(tf(l), HEAD, size, "white", 72, y0 + 32 + i * lh)),
    dt(tf("- " + q.who), BODY, 40, "white@0.85", 72, y0 + 32 + lines.length * lh + 20),
  ]));
}
function buildTitle(spec, bg, out) {
  const heads = wrap(spec.title, 17);     // v1: 18 @86 → now 17 @92
  const subs = wrap(spec.sub, 38);
  const headSize = 92, headLh = 110;
  const y0 = 620;
  composite(bg, out, chrome([
    `drawbox=x=0:y=${y0 - 70}:w=1080:h=${1350 - (y0 - 70)}:color=black@0.30:t=fill`,
    dt(tf(spec.eyebrow), MARK, 34, TEAL, 72, y0 - 20),
    ...heads.map((l, i) => dt(tf(l), HEAD, headSize, "white", 72, y0 + 40 + i * headLh)),
    ...subs.map((l, i) => dt(tf(l), BODY, 42, "white@0.85", 72, y0 + 40 + heads.length * headLh + 30 + i * 58)),
  ]));
}

const STOCK_DIR = path.join(CLAUDE, "assets/brand/creatoros/bg-stock");
let stockCursor = dayIndex; // deterministic per day, advances per use in a run

async function falImage(prompt, out) {
  if (fs.existsSync(out)) return;
  try {
    assertFal("pro-tips-bg"); // hard stop 2026-09-05 → stock bg below
    const res = await fetch("https://fal.run/fal-ai/nano-banana-2", {
      method: "POST",
      headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, num_images: 1, resolution: "1K", aspect_ratio: "4:5", output_format: "png", safety_tolerance: "5" }),
    });
    if (!res.ok) throw new Error(`FAL ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const img = ((await res.json()).images || [])[0];
    if (!img) throw new Error("no image");
    fs.writeFileSync(out, Buffer.from(await (await fetch(img.url)).arrayBuffer()));
  } catch (e) {
    // fal outage (billing, rate limits): fall back to the on-brand stock
    // backgrounds so the daily tip / weekly deck never miss a slot.
    const stock = fs.existsSync(STOCK_DIR)
      ? fs.readdirSync(STOCK_DIR).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort()
      : [];
    if (!stock.length) throw e;
    const pick = stock[stockCursor++ % stock.length];
    console.warn(`  ! fal failed (${e.message.slice(0, 60)}) — stock bg ${pick}`);
    fs.copyFileSync(path.join(STOCK_DIR, pick), out);
  }
}

// ── publishing helpers ───────────────────────────────────────────────────────
const ZBASE = process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1";
const zh = { Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`, "Content-Type": "application/json" };
const PROFILE = "ZERNIO_PROFILE_BRAND";
const ACCOUNTS = { linkedin: "ZERNIO_ACCOUNT_1", twitter: "ZERNIO_ACCOUNT_2", facebook: "ZERNIO_ACCOUNT_3" };

async function uploadPng(localPath, name) {
  const BASE = process.env.INSFORGE_API_BASE_URL, KEY = process.env.INSFORGE_API_KEY;
  const buf = fs.readFileSync(localPath);
  const auth = { Authorization: `Bearer ${KEY}` };
  const strat = await (await fetch(`${BASE}/api/storage/buckets/media/upload-strategy`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ filename: name, contentType: "image/png", size: buf.length }),
  })).json();
  const fd = new FormData();
  if (strat.method === "presigned") {
    for (const [k, v] of Object.entries(strat.fields ?? {})) fd.append(k, v);
    fd.append("file", new Blob([buf], { type: "image/png" }), name);
    const up = await fetch(strat.uploadUrl, { method: "POST", body: fd });
    if (up.status >= 300) throw new Error(`upload ${up.status}`);
    return (await (await fetch(`${BASE}${strat.confirmUrl}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ size: buf.length, contentType: "image/png" }) })).json()).url;
  }
  fd.append("file", new Blob([buf], { type: "image/png" }), name);
  const up = await (await fetch(`${BASE}${strat.uploadUrl}`, { method: "PUT", headers: auth, body: fd })).json();
  return up.url || `${BASE}/api/storage/buckets/media/objects/${strat.key}`;
}

async function record(pool, postId, platform, content) {
  await pool.query(
    `insert into content_posts (persona, carousel_id, zernio_post_id, content, media_urls, platforms, status, posted_at, metadata)
     values ($1,$2,$3,$4,'[]',$5,'published',now(),$6)`,
    ["creatoros", DECK_ID, postId, content.slice(0, 300), JSON.stringify([platform]), JSON.stringify({ topic: "pro tips deck", pro_deck: true, run_index: runIndex })],
  );
}

const runNode = (script, args) => new Promise((resolve) => {
  execFile(process.execPath, [script, ...args], { cwd: ROOT, env: process.env, timeout: 15 * 60 * 1000 },
    (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}\n${stderr}` }));
});

// ── daily X tip: one branded slide + tweet, sequential through the bank ─────
async function dailyTip(pool) {
  if (PUBLISH && !FORCE) {
    const dup = await pool.query(
      `select 1 from content_posts where persona='creatoros' and carousel_id = $1 limit 1`,
      [`daily-tip-${date}`],
    );
    if (dup.rows.length) { console.log("[daily-tip] already posted today — skipping"); return; }
  }
  const bank = JSON.parse(fs.readFileSync(TIPS_BANK, "utf8"));
  const all = (Array.isArray(bank) ? bank : bank.tips ?? [])
    .filter((t) => !EXCLUDE.some((x) => t.headline.includes(x)));
  const tip = all[dayIndex % all.length]; // sequential daily walk (~109 days/cycle)
  const dir = path.join(CLAUDE, "brand-content/creatoros/carousels", `${date}-daily-tip`);
  fs.mkdirSync(path.join(dir, "raw"), { recursive: true });
  RAW_OVERRIDE = path.join(dir, "raw");
  const bg = path.join(dir, "raw", "bg.png");
  // Credit efficiency (Kevin 2026-07-09): the daily tip rides the on-brand
  // bg-stock rotation (free, 27 images) — fal is reserved for the weekly deck
  // where fresh metaphors matter. Delete this block to go back to fresh gens.
  {
    const stock = fs.readdirSync(STOCK_DIR).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
    if (stock.length) fs.copyFileSync(path.join(STOCK_DIR, stock[dayIndex % stock.length]), bg);
    else await falImage(STYLE(SUBJECTS[tip.category] ?? SUBJECTS.mindset), bg);
  }
  const slide = path.join(dir, "slide-01.png");
  buildTip("TIP OF THE DAY", tip.headline, (tip.support ?? [])[0] ?? tip.short ?? "", bg, slide);
  fs.writeFileSync(path.join(dir, "carousel.json"), JSON.stringify({
    carousel_id: `daily-tip-${date}`, persona: "creatoros",
    topic: `Daily tip — ${tip.headline}`,
    content_pillar: "creator-education", visual_pillar: "brand-editorial",
    slide_count: 1,
    slides: [{ index: 1, source: "image", localPath: slide, overlayText: tip.headline }],
    caption: {}, created_at: new Date().toISOString(),
  }, null, 2));
  const body = `creator tip of the day:\n\n${tip.headline.toLowerCase()}\n\n${((tip.support ?? [])[0] ?? "").toLowerCase()}`;
  const content = body.length > 270 ? `creator tip of the day:\n\n${tip.headline.toLowerCase()}` : body;
  console.log(`[daily-tip] ${tip.headline}`);
  if (!PUBLISH) { console.log("[daily-tip] DRY RUN — slide in the feed"); return; }
  const url = await uploadPng(slide, `daily-tip-${date}.png`);
  // Per-platform failure tolerance: a dead X connection (07-20 → 07-25: the
  // brand X token went stale in Zernio and the throw here silently killed
  // the FACEBOOK leg too, six days straight) must not take down the other
  // platform. Post everywhere possible; throw at the end only if NOTHING
  // landed so the cron still reports the failure.
  let xError = null;
  try {
    const tw = await (await fetch(`${ZBASE}/posts`, { method: "POST", headers: zh, body: JSON.stringify({
      profileId: PROFILE, content,
      mediaItems: [{ type: "image", url }],
      platforms: [{ platform: "twitter", accountId: ACCOUNTS.twitter }], publishNow: true,
    }) })).json();
    if (!tw.post?._id) throw new Error(JSON.stringify(tw).slice(0, 200));
    await pool.query(
      `insert into content_posts (persona, carousel_id, zernio_post_id, content, media_urls, platforms, status, posted_at, metadata)
       values ('creatoros',$1,$2,$3,'[]','["twitter"]','published',now(),$4)`,
      [`daily-tip-${date}`, tw.post._id, content.slice(0, 300), JSON.stringify({ topic: "daily tip", tip: tip.headline })],
    );
    console.log("[daily-tip] ✓ live on X");
  } catch (e) {
    xError = e;
    console.error(`[daily-tip] ✗ X failed (trying Facebook anyway): ${e.message}`);
  }
  try {
    const fb = await (await fetch(`${ZBASE}/posts`, { method: "POST", headers: zh, body: JSON.stringify({
      profileId: PROFILE, content,
      mediaItems: [{ type: "image", url }],
      platforms: [{ platform: "facebook", accountId: ACCOUNTS.facebook, platformSpecificData: {
        firstComment: "Download Creator OS: https://your-app.up.railway.app/go/dailytip-fb",
      } }], publishNow: true,
    }) })).json();
    if (!fb.post?._id) throw new Error(JSON.stringify(fb).slice(0, 200));
    await pool.query(
      `insert into content_posts (persona, carousel_id, zernio_post_id, content, media_urls, platforms, status, posted_at, metadata)
       values ('creatoros',$1,$2,$3,'[]','["facebook"]','published',now(),$4)`,
      [`daily-tip-${date}-fb`, fb.post._id, content.slice(0, 300), JSON.stringify({ topic: "daily tip", tip: tip.headline })],
    );
    console.log("[daily-tip] ✓ live on Facebook");
    xError = null; // something landed — the run counts as a success
  } catch (e) {
    console.error(`[daily-tip] ✗ facebook failed: ${e.message}`);
    if (xError) throw new Error(`daily-tip: nothing posted — X: ${xError.message} | FB: ${e.message}`);
  }
  if (xError) throw xError;
}
let RAW_OVERRIDE = null;

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
  try {
    if (DAILY_TIP) { await dailyTip(pool); return; }
    const skipRow = async (why) => pool.query(
      `insert into content_posts (persona, carousel_id, zernio_post_id, content, media_urls, platforms, status, posted_at, metadata)
       values ('creatoros',$1,null,$2,'[]','[]','skipped',now(),'{"pro_deck":true}')`,
      [`pro-tips-deck-skip-${date}`, why],
    );
    if (PUBLISH && !FORCE) {
      // Already posted a tips deck today (any id containing "tips" that isn't
      // a skip or daily-tip row)?
      const dup = await pool.query(
        `select 1 from content_posts where persona='creatoros' and carousel_id ilike '%tips%'
          and carousel_id not ilike '%skip%' and carousel_id not ilike 'daily-tip%'
          and (posted_at at time zone 'America/New_York')::date = (now() at time zone 'America/New_York')::date limit 1`,
      );
      if (dup.rows.length) {
        await skipRow("deck already posted today");
        console.log("[pro-tips-deck] already posted today — skipping");
        return;
      }
      if (dayIndex % 7 !== WEEK_ANCHOR) {
        // Off-day: leave a verification row so the watchdog/manager treat the
        // slot as handled instead of flagging it MISSED.
        await skipRow("off-day (weekly cadence)");
        console.log("[pro-tips-deck] off-day (weekly cadence) — skipping");
        return;
      }
    }

    fs.mkdirSync(RAW, { recursive: true });
    const tips = pickTips();
    const quotes = [QUOTES[(runIndex * 2) % QUOTES.length], QUOTES[(runIndex * 2 + 1) % QUOTES.length]];
    console.log(`[pro-tips-deck] run ${runIndex} — tips: ${tips.map((t) => t.headline.slice(0, 30)).join(" | ")}`);

    // 1. Backgrounds (locked style, one metaphor per slide).
    const bgJobs = [
      falImage(STYLE(COVER.subject), path.join(RAW, "bg-cover.png")),
      ...tips.map((t, i) => falImage(STYLE(SUBJECTS[t.category] ?? SUBJECTS.mindset), path.join(RAW, `bg-t${i}.png`))),
      falImage(STYLE("an enormous glowing wireframe quotation mark floating in space"), path.join(RAW, "bg-q0.png")),
      falImage(STYLE("two overlapping glowing wireframe speech bubbles"), path.join(RAW, "bg-q1.png")),
      falImage(STYLE(NATIVE.subject), path.join(RAW, "bg-native.png")),
      falImage(STYLE(CTA.subject), path.join(RAW, "bg-cta.png")),
    ];
    const bgRes = await Promise.allSettled(bgJobs);
    const bgFail = bgRes.filter((r) => r.status === "rejected");
    if (bgFail.length) throw new Error(`backgrounds failed: ${bgFail.map((r) => r.reason.message).join("; ")}`);

    // 2. Composite — deck order: cover, t1-3, quote, t4-6, NATIVE, t7-10, quote, cta.
    const slides = [];
    const add = (out, overlayText) => slides.push({ index: slides.length + 1, source: "image", localPath: out, overlayText });
    const slidePath = () => path.join(DIR, `slide-${String(slides.length + 1).padStart(2, "0")}.png`);

    let p = slidePath(); buildTitle(COVER, path.join(RAW, "bg-cover.png"), p); add(p, COVER.title);
    tips.forEach((t, i) => {
      if (i === 3) { const q = slidePath(); buildQuote(quotes[0], path.join(RAW, "bg-q0.png"), q); add(q, quotes[0].who); }
      if (i === 6) { const n = slidePath(); buildTip(NATIVE.eyebrow, NATIVE.headline, NATIVE.support, path.join(RAW, "bg-native.png"), n); add(n, NATIVE.headline); }
      const o = slidePath();
      buildTip(`TIP ${String(i + 1).padStart(2, "0")} / 10`, t.headline, (t.support ?? [])[0] ?? t.short ?? "", path.join(RAW, `bg-t${i}.png`), o);
      add(o, t.headline);
    });
    p = slidePath(); buildQuote(quotes[1], path.join(RAW, "bg-q1.png"), p); add(p, quotes[1].who);
    p = slidePath(); buildTitle(CTA, path.join(RAW, "bg-cta.png"), p); add(p, CTA.title);

    // 3. Sidecar → Carousels feed (review rule).
    const caption = {
      tiktok: `the ${tips.length} rules the best creators actually follow 📌 save this\n\nwe drop the best creator marketing tips every other day — and built Creator OS so acting on them takes one tap. app in bio 📲\n\n#contentcreator #creatortips #socialmediamarketing #creatoreconomy #creatoros`,
      instagram: `the ${tips.length} rules the best creators actually follow 📌 save this\n\nwe post the best marketing tips for creators here every other day — and built Creator OS so they run on autopilot. link in bio 📲\n\n#contentcreator #creatortips #socialmediamarketing #creatoreconomy #creatoros`,
      linkedin: `The ${tips.length} rules that actually grow creator accounts — curated from studying top creators.\n\nAt Creator OS we surface the best marketing tips for creators every single day, and build the tools that make acting on them effortless.\n\nWhich rule do you disagree with?`,
    };
    fs.writeFileSync(path.join(DIR, "carousel.json"), JSON.stringify({
      carousel_id: DECK_ID, persona: "creatoros",
      topic: `Best creator tips deck — run ${runIndex}`,
      content_pillar: "creator-education", visual_pillar: "brand-editorial",
      slide_count: slides.length, slides, caption, created_at: new Date().toISOString(),
    }, null, 2));
    console.log(`[pro-tips-deck] ${slides.length} slides → ${DIR}`);
    if (!PUBLISH) { console.log("[pro-tips-deck] DRY RUN — review in the Carousels feed, then --publish"); return; }

    // 4. Publish — each platform isolated; exit 1 if any fail, 2 if all fail.
    const failures = [];
    // TikTok: full deck, native trending sound. Skipped with --no-tiktok
    // (Kevin 2026-07-08: carousels underperform reaction UGC on TikTok —
    // those keep the upload slots there).
    if (argv.includes("--no-tiktok")) {
      console.log("  – tiktok skipped (--no-tiktok)");
    } else {
      const tt = await runNode(path.join(CLAUDE, "skills/carousel-publish-tiktok/scripts/carousel-publish-tiktok.js"),
        ["--persona", "creatoros", "--carousel", path.join(DIR, "carousel.json"), "--publish"]);
      console.log(tt.ok ? "  ✓ tiktok" : `  ✗ tiktok: ${tt.out.slice(-300)}`);
      if (!tt.ok) failures.push("tiktok");
    }

    // Instagram: 10-item cut (cover + 7 strongest tips incl. native + CTA), sound video cover.
    const igKeep = new Set([1, 2, 3, 4, 6, 7, 8, 9, 12, slides.length]); // cover, t1-3, t4-5, native, t6, t8, cta
    const igDir = path.join(DIR, "ig"); fs.mkdirSync(igDir, { recursive: true });
    const igSlides = slides.filter((s) => igKeep.has(s.index)).map((s, i) => ({ ...s, index: i + 1 }));
    fs.writeFileSync(path.join(igDir, "carousel.json"), JSON.stringify({
      carousel_id: `${DECK_ID}-ig`, persona: "creatoros", topic: `Best creator tips deck — run ${runIndex}`,
      slide_count: igSlides.length, slides: igSlides, caption, created_at: new Date().toISOString(),
    }, null, 2));
    const ig = await runNode(path.join(CLAUDE, "skills/carousel-publish-instagram/scripts/carousel-publish-instagram.js"),
      ["--persona", "creatoros", "--carousel", path.join(igDir, "carousel.json"), "--sound-gender", "any", "--publish"]);
    console.log(ig.ok ? "  ✓ instagram" : `  ✗ instagram: ${ig.out.slice(-300)}`);
    if (!ig.ok) failures.push("instagram");

    // LinkedIn (all slides) + X (thread) direct via Zernio.
    try {
      const urls = [];
      for (const s of slides) urls.push(await uploadPng(s.localPath, `${DECK_ID}-${s.index}.png`));
      const li = await (await fetch(`${ZBASE}/posts`, { method: "POST", headers: zh, body: JSON.stringify({
        profileId: PROFILE, content: caption.linkedin,
        mediaItems: urls.map((u) => ({ type: "image", url: u })),
        platforms: [{ platform: "linkedin", accountId: ACCOUNTS.linkedin, platformSpecificData: {
          // Links live in the first comment — LinkedIn suppresses caption links.
          // B2B audience → web app first, App Store second; both tracked.
          firstComment: "Try Creator OS — web app: https://your-app.up.railway.app/go/web-protips-li · iOS app: https://your-app.up.railway.app/go/protips-li",
        } }], publishNow: true,
      }) })).json();
      if (!li.post?._id) throw new Error(JSON.stringify(li).slice(0, 200));
      await record(pool, li.post._id, "linkedin", caption.linkedin);
      console.log("  ✓ linkedin");

      // Facebook: same multi-image deck, IG-style caption (FB reads casual).
      const fb = await (await fetch(`${ZBASE}/posts`, { method: "POST", headers: zh, body: JSON.stringify({
        profileId: PROFILE, content: caption.instagram,
        mediaItems: urls.map((u) => ({ type: "image", url: u })),
        platforms: [{ platform: "facebook", accountId: ACCOUNTS.facebook, platformSpecificData: {
          firstComment: "Download Creator OS: https://your-app.up.railway.app/go/protips-fb",
        } }], publishNow: true,
      }) })).json();
      if (!fb.post?._id) throw new Error("facebook: " + JSON.stringify(fb).slice(0, 200));
      await record(pool, fb.post._id, "facebook", caption.instagram);
      console.log("  ✓ facebook");
    } catch (e) {
      failures.push("linkedin/facebook");
      console.error(`  ✗ linkedin/facebook: ${e.message}`);
    }

    if (failures.length >= 3) process.exitCode = 2;
    else if (failures.length) { console.error(`[pro-tips-deck] published with failures: ${failures.join(", ")}`); process.exitCode = 1; }
    else console.log("[pro-tips-deck] ✅ LIVE on all four platforms");
  } finally {
    for (const f of tmpFiles) fs.existsSync(f) && fs.unlinkSync(f);
    await pool.end();
  }
}

main().catch((e) => { console.error(`[pro-tips-deck] ❌ ${e.message}`); process.exit(1); });
