// refresh-sounds.mjs — pull trending audio into Insforge + the `sounds` table.
//
// Two charts:
//   • music  — automation-lab/tiktok-trends-scraper (Creative Center trending
//     sounds per country; replaced novi/tiktok-music-trend-api 2026-07-10 —
//     novi is a RENTAL actor whose trial expired, this one is pay-per-event
//     under the platform plan)
//   • sounds — clockworks/tiktok-scraper (general/original sounds from viral videos)
//
//   npm run refresh-sounds -- both 40        music (EN) + sounds, 40 each  (default)
//   npm run refresh-sounds -- music EN 40     just the English music chart
//   npm run refresh-sounds -- sounds 40       just the general-sounds chart
//   npm run refresh-sounds -- US 20           legacy: single-region music
//
// Env: APIFY_TOKEN, INSFORGE_API_BASE_URL, INSFORGE_API_KEY, DATABASE_URL.
import { Pool } from "pg";
import { readFileSync } from "fs";

// Local convenience: load .env.local if vars aren't already set. No-ops in cloud.
if (!process.env.APIFY_TOKEN) {
  try {
    for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}

const MUSIC_ACTOR = "automation-lab~tiktok-trends-scraper";
const SOUNDS_ACTOR = "clockworks~tiktok-scraper";
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const INSFORGE_BASE = process.env.INSFORGE_API_BASE_URL;
const INSFORGE_KEY = process.env.INSFORGE_API_KEY;
const BUCKET = "media";

const REGIONS = [
  "US", "GB", "CA", "AU", "BR", "MX", "DE", "FR", "ES", "IT",
  "ID", "PH", "MY", "TH", "VN", "JP", "KR", "TR", "SA", "AE",
  "NL", "PL", "PT", "SE", "AR", "CO", "CL", "PE", "EG", "NG",
  "ZA", "PK", "UA", "RO", "GR", "IE", "NZ", "TW", "MA", "KZ",
];
const ENGLISH = ["US", "CA", "GB", "AU", "IE", "NZ", "ZA"];
const WAVE = 8;

// --- CLI --------------------------------------------------------------
const A = process.argv.slice(2);
const first = (A[0] || "both").toLowerCase();
let doMusic = false, doSounds = false, region = "EN", limit = 40;
if (first === "both") { doMusic = doSounds = true; limit = parseInt(A[1] || "40", 10); }
else if (first === "sounds") { doSounds = true; limit = parseInt(A[1] || "40", 10); }
else if (first === "music") { doMusic = true; region = (A[1] || "EN").toUpperCase(); limit = parseInt(A[2] || "40", 10); }
else { doMusic = true; region = first.toUpperCase(); limit = parseInt(A[1] || "40", 10); } // legacy

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

function assertEnv() {
  const missing = ["APIFY_TOKEN", "INSFORGE_API_BASE_URL", "INSFORGE_API_KEY", "DATABASE_URL"].filter((k) => !process.env[k]);
  if (missing.length) { console.error("✗ Missing env:", missing.join(", ")); process.exit(1); }
}

// --- Apify ------------------------------------------------------------
async function apifyRun(actor, input) {
  const start = await fetch(`https://api.apify.com/v2/acts/${actor}/runs?token=${APIFY_TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).then((r) => r.json());
  const runId = start?.data?.id, dsId = start?.data?.defaultDatasetId;
  if (!runId) return [];
  for (let i = 0; i < 90; i++) {
    const st = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`).then((r) => r.json()).then((j) => j?.data?.status);
    if (st === "SUCCEEDED") break;
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(st)) return [];
    await sleep(6000);
  }
  const items = await fetch(`https://api.apify.com/v2/datasets/${dsId}/items?token=${APIFY_TOKEN}&clean=true`).then((r) => r.json());
  return Array.isArray(items) ? items : [];
}

// --- music chart (Creative Center via automation-lab) ------------------
function normMusic(it) {
  const id = String(it.soundId || it.id);
  return {
    id,
    title: it.name || it.title || "sound",
    author: it.soundAuthor || it.author || "",
    duration: Number(it.duration) || 0,
    url: it.soundPlayUrl || null,
    sourceUrl: it.linkedVideoUrl || `https://www.tiktok.com/music/x-${id}`,
  };
}

const musicInput = (countryCode, max) => ({ trendType: "sound", countryCode, period: 7, maxResults: max });

async function collectMusic(cap) {
  const multi = region === "ALL" ? REGIONS : region === "EN" ? ENGLISH : null;
  if (!multi) {
    const items = await apifyRun(MUSIC_ACTOR, musicInput(region, cap));
    return { items: items.slice(0, cap).map(normMusic), label: region };
  }
  const label = region === "EN" ? "EN" : "GLOBAL";
  const pool = new Map();
  console.log(`▶ [music] pooling ${label} markets (cap ${cap})…`);
  for (const wave of chunk(multi, WAVE)) {
    const results = await Promise.all(wave.map((r) => apifyRun(MUSIC_ACTOR, musicInput(r, 50))));
    wave.forEach((r, i) => {
      for (const it of results[i]) {
        const key = String(it.soundId || it.id);
        if (!pool.has(key)) pool.set(key, it);
      }
      if (results[i].length) console.log(`   ${r}: +${results[i].length}  (pool ${pool.size})`);
    });
    if (pool.size >= cap) break;
  }
  return { items: Array.from(pool.values()).slice(0, cap).map(normMusic), label };
}

// --- sounds chart (clockworks) ---------------------------------------
async function collectSounds(cap) {
  const per = Math.max(12, Math.ceil(cap * 0.7));
  console.log(`▶ [sounds] scraping trending videos for their audio (cap ${cap})…`);
  const videos = await apifyRun(SOUNDS_ACTOR, {
    hashtags: ["fyp", "viral", "trending"],
    resultsPerPage: per,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSubtitles: false,
    shouldDownloadSlideshowImages: false,
  });
  const map = new Map();
  for (const v of videos) {
    const mm = v.musicMeta;
    if (!mm || !mm.musicId || !mm.playUrl) continue;
    const id = String(mm.musicId);
    if (map.has(id)) continue;
    map.set(id, {
      id,
      title: mm.musicName || "sound",
      author: mm.musicAuthor || "",
      duration: Number(mm.duration) || 0,
      url: mm.playUrl,
      sourceUrl: v.webVideoUrl || `https://www.tiktok.com/music/x-${id}`,
    });
    if (map.size >= cap) break;
  }
  console.log(`   ${map.size} unique sounds from ${videos.length} videos`);
  return { items: Array.from(map.values()), label: "SOUNDS" };
}

// --- Insforge storage -------------------------------------------------
async function uploadAudio(bytes, filename, contentType) {
  const auth = { Authorization: `Bearer ${INSFORGE_KEY}` };
  const strat = await fetch(`${INSFORGE_BASE}/api/storage/buckets/${BUCKET}/upload-strategy`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType, size: bytes.length }),
  }).then((r) => r.json());
  const file = new File([bytes], filename, { type: contentType });
  if (strat.method === "presigned") {
    const fd = new FormData();
    for (const [k, v] of Object.entries(strat.fields ?? {})) fd.append(k, v);
    fd.append("file", file, filename);
    const up = await fetch(strat.uploadUrl, { method: "POST", body: fd });
    if (up.status < 200 || up.status >= 300) throw new Error(`upload ${up.status}`);
    const cf = await fetch(`${INSFORGE_BASE}${strat.confirmUrl}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ size: bytes.length, contentType }),
    }).then((r) => r.json());
    return cf.url;
  }
  const fd = new FormData();
  fd.append("file", file, filename);
  const up = await fetch(`${INSFORGE_BASE}${strat.uploadUrl}`, { method: "PUT", headers: auth, body: fd });
  if (!up.ok) throw new Error(`upload ${up.status}`);
  const j = await up.json().catch(() => ({}));
  return j.url || `${INSFORGE_BASE}/api/storage/buckets/${BUCKET}/objects/${strat.key}`;
}

// --- persist ----------------------------------------------------------
async function persist(pool, items, chart, label) {
  const day = new Date().toISOString().slice(0, 10);
  const batch = `${day}_${label}`;
  let ok = 0, dup = 0, skip = 0;
  for (const it of items) {
    if (!it.url) { skip++; continue; }
    try {
      const exists = await pool.query("select 1 from sounds where id=$1", [it.id]);
      if (exists.rowCount) { dup++; continue; }
      const res = await fetch(it.url);
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const ext = ct.includes("mp4") || ct.includes("m4a") ? "m4a" : "mp3";
      const mime = ext === "m4a" ? "audio/mp4" : "audio/mpeg";
      const bytes = Buffer.from(await res.arrayBuffer());
      if (!bytes.length) throw new Error("empty audio");
      const audioUrl = await uploadAudio(bytes, `${it.id}.${ext}`, mime);
      if (!audioUrl) throw new Error("no upload url");
      await pool.query(
        `insert into sounds (id,title,author,duration,region,batch,chart,source_url,audio_url,mime)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (id) do nothing`,
        [it.id, it.title, it.author, Math.round(it.duration), label, batch, chart, it.sourceUrl, audioUrl, mime],
      );
      ok++;
      if (ok % 10 === 0) console.log(`   …${ok} uploaded [${chart}]`);
    } catch {
      skip++;
    }
  }
  console.log(`✓ [${chart}] ${ok} new, ${dup} existing, ${skip} skipped → batch ${batch}`);
  return ok;
}

// --- main -------------------------------------------------------------
async function main() {
  assertEnv();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4 });
  try {
    if (doMusic) {
      const { items, label } = await collectMusic(limit);
      if (items.length) await persist(pool, items, "music", label);
      else console.error("✗ [music] nothing returned");
    }
    if (doSounds) {
      const { items, label } = await collectSounds(limit);
      if (items.length) await persist(pool, items, "sounds", label);
      else console.error("✗ [sounds] nothing returned");
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error("✗", e.message); process.exit(1); });
