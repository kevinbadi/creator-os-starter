#!/usr/bin/env node
/**
 * advice-thread-gifs — GIF-boosted variation of the advice thread drop.
 *
 * Threads supports GIFs on posts, so this builds the same written advice
 * thread as advice-thread.js and rides a reaction GIF on the intro hook plus
 * AT MOST one body item where it really matters (Kevin's format, 2026-07-09).
 * Claude picks the body item (or none) and writes the Giphy search queries;
 * a second pass picks the best candidate from each search by title. Chosen
 * GIFs are mirrored to Insforge (mp4 rendition — Threads renders it as a
 * looping GIF) and recorded in the `gifs` table so the dashboard allow-list
 * stays in sync.
 *
 * FORMAT TEST (Kevin 2026-07-09): Threads-only, manual runs — NOT in the cron
 * registry. If GIF threads out-perform plain ones, this becomes a flag on the
 * armed thread drops.
 *
 * Usage:
 *   node advice-thread-gifs.js --persona danny --slot 5 [--publish] [--max-gifs 6]
 *
 * Dry-run by default: builds everything, prints the thread + chosen GIFs and
 * writes the review feed entry, but does not post.
 */
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function arg(n) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; }
const SLUG = arg("--persona") || "danny";
const SLOT = parseInt(arg("--slot") || "0", 10) || 0;
// Kevin 2026-07-09 (after the first test pair): 1 GIF on the intro + 1 in the
// body ONLY when it really matters — that's it. No CTA GIF, no 6-GIF spread.
const MAX_GIFS = parseInt(arg("--max-gifs") || "2", 10) || 2;
const PUBLISH = process.argv.includes("--publish");

const SCRIPTS = __dirname;
const CLAUDE_DIR = path.join(SCRIPTS, "..", "..", ".."); // .claude
const ROOT = path.join(CLAUDE_DIR, "..");                 // repo root

const { createMessage } = require("../../../lib/llm");

// Unset → the llm gateway routes to OLLAMA_TEXT_MODEL (DeepSeek).
const GIF_MODEL = process.env.QA_MODEL || null;
const GIPHY_KEY = process.env.GIPHY_API_KEY;
const INSFORGE_BASE = process.env.INSFORGE_API_BASE_URL || "";
const INSFORGE_KEY = process.env.INSFORGE_API_KEY || "";

// ET date — never toISOString (UTC flips at 20:00 ET and double-books slots).
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

// ── model call (same house pattern as the reaction QA gate) ─────────────────
async function claude(system, userText, schema) {
  if (!process.env.OLLAMA_API_KEY) throw new Error("OLLAMA_API_KEY not set");
  const json = await createMessage({
    model: GIF_MODEL,
    max_tokens: 3000,
    output_config: { format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: userText }],
  });
  const textBlock = (json.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("model returned no text block");
  return JSON.parse(textBlock.text);
}

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Item index: 0=intro, 1..N=tips, N+1=CTA" },
          query: { type: "string", description: "Giphy search query for a reaction GIF that lands this beat" },
          altQuery: { type: "string", description: "Fallback search if the first returns nothing usable" },
        },
        required: ["index", "query", "altQuery"],
        additionalProperties: false,
      },
    },
  },
  required: ["picks"],
  additionalProperties: false,
};

const CHOICE_SCHEMA = {
  type: "object",
  properties: {
    choices: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "The thread item index this choice is for" },
          candidate: { type: "integer", description: "0-based index into that item's candidate list, or -1 to skip the GIF" },
        },
        required: ["index", "candidate"],
        additionalProperties: false,
      },
    },
  },
  required: ["choices"],
  additionalProperties: false,
};

// ── Giphy (same params as the dashboard's src/lib/giphy/client.ts) ──────────
async function searchGiphy(q, limit = 10) {
  if (!GIPHY_KEY) throw new Error("GIPHY_API_KEY not set");
  const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=${limit}&rating=pg-13&bundle=messaging_non_clips`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Giphy ${res.status}`);
  const j = await res.json();
  return (j.data ?? [])
    .map((g) => ({
      id: String(g.id ?? ""),
      title: String(g.title || "GIF"),
      preview: g.images?.fixed_width?.url || g.images?.original?.url || "",
      mp4: g.images?.original?.mp4 || g.images?.fixed_width?.mp4 || "",
    }))
    .filter((r) => r.id && r.mp4);
}

// ── Insforge upload (same presigned flow as the publishers) ─────────────────
async function uploadToInsforge(buf, filename, contentType) {
  const auth = { Authorization: `Bearer ${INSFORGE_KEY}` };
  const stratRes = await fetch(`${INSFORGE_BASE}/api/storage/buckets/media/upload-strategy`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType, size: buf.length }),
  });
  if (!stratRes.ok) throw new Error(`upload strategy ${stratRes.status}`);
  const s = await stratRes.json();
  if (s.method === "presigned") {
    const fd = new FormData();
    for (const [k, v] of Object.entries(s.fields ?? {})) fd.append(k, v);
    fd.append("file", new Blob([buf], { type: contentType }), filename);
    const up = await fetch(s.uploadUrl, { method: "POST", body: fd });
    if (up.status < 200 || up.status >= 300) throw new Error(`upload ${up.status}`);
    const cf = await fetch(`${INSFORGE_BASE}${s.confirmUrl}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ size: buf.length, contentType }),
    });
    if (!cf.ok) throw new Error(`confirm ${cf.status}`);
    return (await cf.json()).url;
  }
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: contentType }), filename);
  const up = await fetch(`${INSFORGE_BASE}${s.uploadUrl}`, { method: "PUT", headers: auth, body: fd });
  if (!up.ok) throw new Error(`upload ${up.status}`);
  return (await up.json().catch(() => ({}))).url || `${INSFORGE_BASE}/api/storage/buckets/media/objects/${s.key}`;
}

function run(label, script, args) {
  console.log(`[advice-thread-gifs:${SLUG}] ▶ ${label}`);
  execFileSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, PERSONA_SLUG: SLUG },
    timeout: 10 * 60 * 1000,
  });
}

async function main() {
  // 1. Build today's thread text (same deterministic rotation as the cron drops;
  //    pick an unused --slot so the content is distinct from today's scheduled ones).
  run("build thread", path.join(SCRIPTS, "advice-carousel.js"), [
    "--persona", SLUG, "--thread-only", "--slot", String(SLOT),
  ]);
  const threadPath = path.join(
    CLAUDE_DIR, "brand-content", SLUG, "plans",
    `${date}${SLOT ? `-s${SLOT}` : ""}-thread.json`,
  );
  if (!fs.existsSync(threadPath)) throw new Error(`expected thread not found: ${threadPath}`);
  const thread = JSON.parse(fs.readFileSync(threadPath, "utf8"));

  // Final publish-order items (must match advice-publish-thread.js indexing).
  const items = [thread.intro, ...thread.items, thread.cta];
  const integIdx = (thread.media?.integrationItemIndex ?? -2) + 1; // +1: intro shifts tips down

  // 2. Claude plans which items get a GIF and the search queries.
  console.log(`[advice-thread-gifs:${SLUG}] ▶ plan GIFs (${GIF_MODEL})`);
  const plan = await claude(
    "You pick reaction GIFs for a creator-marketing thread on Instagram Threads. " +
      "GIFs must amplify the emotional beat of an item (relatable pain, flex, payoff, mic-drop), never distract from it. " +
      "Favor universally readable reaction GIFs (celebs, sitcoms, animals, sports celebrations). Queries should be short " +
      "Giphy-style phrases like 'shocked cat', 'mic drop', 'money rain', 'typing furiously'.",
    `Thread items (index: text):\n\n${items.map((t, i) => `${i}: ${t}`).join("\n\n")}\n\n` +
      "Pick AT MOST two items: ALWAYS index 0 (the hook), plus ONE body item — but only if a GIF would " +
      "genuinely land on its emotional beat (the single most relatable pain or hardest mic-drop in the thread). " +
      `If no body item truly earns it, return just index 0. Never index ${integIdx} (it carries the app ` +
      `screenshot) and never index ${items.length - 1} (the CTA stays clean).`,
    PLAN_SCHEMA,
  );
  let picks = (plan.picks ?? [])
    .filter((p) => p.index >= 0 && p.index < items.length && p.index !== integIdx)
    .slice(0, MAX_GIFS);
  console.log(`  planned: ${picks.map((p) => `#${p.index} "${p.query}"`).join(", ")}`);

  // 3. Search Giphy per pick and let Claude choose the best candidate by title.
  const candidatesByIndex = new Map();
  for (const p of picks) {
    let results = await searchGiphy(p.query);
    if (!results.length) results = await searchGiphy(p.altQuery);
    if (results.length) candidatesByIndex.set(p.index, results);
    else console.warn(`  ! no Giphy results for #${p.index} ("${p.query}" / "${p.altQuery}") — skipping`);
  }
  picks = picks.filter((p) => candidatesByIndex.has(p.index));
  if (!picks.length) throw new Error("no GIF candidates found for any item");

  console.log(`[advice-thread-gifs:${SLUG}] ▶ choose GIFs`);
  const choice = await claude(
    "You choose the single best reaction GIF for each thread item from Giphy search results, judging by title only. " +
      "Prefer clear, high-energy reactions that match the item's emotional beat. NEVER choose the same GIF for two items " +
      "(searches overlap — a repeated GIF in one thread reads as lazy). Return candidate -1 only if every option is off-tone.",
    picks
      .map((p) => {
        const cands = candidatesByIndex.get(p.index);
        return `ITEM ${p.index}: ${items[p.index]}\nCANDIDATES:\n${cands.map((c, i) => `  ${i}. ${c.title}`).join("\n")}`;
      })
      .join("\n\n"),
    CHOICE_SCHEMA,
  );

  // 4. Download chosen mp4s, mirror to Insforge, build the gifs map.
  const gifs = {};
  const chosen = [];
  const usedIds = new Set();
  for (const c of choice.choices ?? []) {
    const cands = candidatesByIndex.get(c.index);
    if (!cands || c.candidate < 0 || c.candidate >= cands.length) continue;
    let g = cands[c.candidate];
    // Hard dedupe — overlapping searches can surface the same GIF twice; fall
    // back to the item's next unused candidate rather than repeating one.
    if (usedIds.has(g.id)) g = cands.find((x) => !usedIds.has(x.id));
    if (!g) { console.warn(`  ! all candidates for #${c.index} already used — skipping`); continue; }
    usedIds.add(g.id);
    const res = await fetch(g.mp4);
    if (!res.ok) { console.warn(`  ! download failed for ${g.id} (${res.status}) — skipping #${c.index}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    // Unique names per upload (publish-race rule) — hash keeps re-runs stable.
    const md5 = crypto.createHash("md5").update(buf).digest("hex");
    const url = await uploadToInsforge(buf, `gif-${g.id}-${md5.slice(0, 8)}.mp4`, "video/mp4");
    gifs[c.index] = { url, type: "video", giphyId: g.id, title: g.title, preview: g.preview };
    chosen.push({ index: c.index, ...g });
    console.log(`  ✓ #${c.index} "${g.title}" → uploaded`);
  }
  if (!Object.keys(gifs).length) throw new Error("no GIFs survived download/upload");

  thread.gifs = gifs;
  fs.writeFileSync(threadPath, JSON.stringify(thread, null, 2));

  // 5. Keep the dashboard gifs allow-list in sync (auto-picked = checked off).
  try {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
    for (const g of chosen) {
      await pool.query(
        `insert into gifs (id, title, preview_url, mp4_url, query, checked, used_count, last_used_at, notes)
         values ($1,$2,$3,$4,$5,true,1,now(),$6)
         on conflict (id) do update set used_count = gifs.used_count + 1, last_used_at = now(), checked = true`,
        [g.id, g.title, g.preview, g.mp4, picks.find((p) => p.index === g.index)?.query ?? "", `auto-picked · advice-thread-gifs ${SLUG} ${date}`],
      );
    }
    await pool.end();
  } catch (e) {
    console.warn(`  ! gifs table sync failed (posting continues): ${e.message}`);
  }

  // 6. Review feed entry (content-feed rule: ALL generated content → Carousels feed).
  const feedId = `advice-thread-gifs-${date}${SLOT ? `-s${SLOT}` : ""}`;
  const feedDir = path.join(CLAUDE_DIR, "brand-content", SLUG, "carousels", `${date}-advice-thread-gifs${SLOT ? `-s${SLOT}` : ""}`);
  fs.mkdirSync(feedDir, { recursive: true });
  const sidecar = path.join(feedDir, "carousel.json");
  fs.writeFileSync(sidecar, JSON.stringify({
    carousel_id: feedId,
    persona: SLUG,
    topic: `GIF thread test — ${items[0].split("\n")[0].slice(0, 80)}`,
    content_pillar: "creator-education",
    visual_pillar: "gif-reaction",
    slide_count: chosen.length,
    slides: chosen.map((g, i) => ({ index: i + 1, source: "video", url: gifs[g.index].url, overlayText: items[g.index].split("\n")[0].slice(0, 90) })),
    caption: { intro: thread.intro },
    created_at: new Date().toISOString(),
  }, null, 2));

  // 7. Publish (Threads only — the GIF format is a Threads test; X gets ~0 anyway).
  run("publish thread", path.join(SCRIPTS, "advice-publish-thread.js"), [
    "--persona", SLUG,
    "--thread", threadPath,
    "--carousel", sidecar,
    "--platforms", "threads",
    "--gifs",
    ...(PUBLISH ? ["--publish"] : []),
  ]);
}

main().catch((e) => {
  console.error(`✗ advice-thread-gifs: ${e.message}`);
  process.exit(1);
});
