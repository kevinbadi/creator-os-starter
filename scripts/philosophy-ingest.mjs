// philosophy-ingest.mjs — the philosophy-content ingestion engine.
//
// Sweeps the tracked business/philosophy creators for new content, pulls the
// video + caption + transcript, has the model stack read/watch it, and stores
// timestamped insights + topics into the knowledge-graph tables.
//
// Sources per creator (philosophy_creators row):
//   • YouTube   — Apify streamers/youtube-scraper (metadata + subtitles)
//   • Instagram — Apify apify/instagram-scraper (reels metadata + caption +
//                 direct videoUrl); transcript via local Whisper when
//                 available, else the vision model reads the burned captions
//   • Inbox     — .claude/assets/philosophy/inbox/<slug>/ — drop podcast
//                 audio/video files manually (Brute de Force); local Whisper
//                 transcribes them. Local-only (whisper isn't on Railway).
//
// Analysis stack (all via .claude/lib/llm.js — DeepSeek text, Qwen vision):
//   1. ffmpeg frame sample → vision notes (on-screen text + what's happening)
//   2. transcript + caption + vision notes → timestamped insights JSON
//      {kind, text, quote, start_sec, end_sec, topics[], strength}
//
// Usage:
//   npm run philosophy-ingest                 # discover + inbox + analyze
//   npm run philosophy-ingest -- --setup      # create schema + seed creators
//   npm run philosophy-ingest -- --discover-only
//   npm run philosophy-ingest -- --inbox-only
//   npm run philosophy-ingest -- --analyze-only
//   npm run philosophy-ingest -- --creator rob-the-bank --limit 3
//   npm run philosophy-ingest -- --no-vision
//
// Env: DATABASE_URL, APIFY_TOKEN, OLLAMA_API_KEY,
//      INSFORGE_API_BASE_URL, INSFORGE_API_KEY (thumbnails),
//      PHILOSOPHY_LIMIT (per platform per creator, default 5).
import { Pool } from "pg";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync, rmSync } from "fs";
import { spawnSync } from "child_process";
import { tmpdir } from "os";
import { join, basename, extname } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const llm = require("../.claude/lib/llm.js");

// Local convenience: load .env.local if vars aren't already set. No-ops in cloud.
if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}

const YT_ACTOR = "streamers~youtube-scraper";
const IG_ACTOR = "apify~instagram-scraper";
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const INSFORGE_BASE = process.env.INSFORGE_API_BASE_URL;
const INSFORGE_KEY = process.env.INSFORGE_API_KEY;
const BUCKET = "media";
const INBOX_DIR = new URL("../.claude/assets/philosophy/inbox/", import.meta.url).pathname;
const MEDIA_EXT = new Set([".mp3", ".m4a", ".wav", ".mp4", ".mov", ".webm", ".mkv", ".aac", ".ogg"]);

// ET day, never toISOString — UTC flips at 20:00 ET.
const etDay = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- CLI --------------------------------------------------------------
const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const opt = (f, d) => (A.includes(f) ? A[A.indexOf(f) + 1] : d);
const SETUP_ONLY = has("--setup");
const only = has("--discover-only") ? "discover" : has("--inbox-only") ? "inbox" : has("--analyze-only") ? "analyze" : null;
const CREATOR_FILTER = opt("--creator", null);
const LIMIT = parseInt(opt("--limit", process.env.PHILOSOPHY_LIMIT || "5"), 10);
const VISION = !has("--no-vision") && process.env.PHILOSOPHY_VISION !== "0";

const WHISPER = (() => {
  const r = spawnSync("which", ["whisper"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
})();

function assertEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) { console.error("✗ Missing env:", missing.join(", ")); process.exit(1); }
}

// --- schema -----------------------------------------------------------
const SEED_CREATORS = [
  // Kevin 2026-08-24: the founding four. Handles are best-effort — edit the
  // rows in philosophy_creators if any are wrong; seeding never overwrites.
  ["brute-de-force", "Brute de Force", "podcast", null, "https://www.instagram.com/brutedeforce/",
   "Podcaster (X-lineage philosopher). Episodes mostly off-YouTube — drop files into the inbox folder for local Whisper ingestion."],
  ["rob-the-bank", "Rob The Bank", "shortform", "https://www.youtube.com/@robthebankmotion", "https://www.instagram.com/robthebank/",
   "Robert Oliver — sold $30M Amazon FBA brand; leverage/ownership/storytelling philosophy."],
  ["greglav", "GregLav", "shortform", null, "https://www.instagram.com/greglav/",
   "Greg LaVecchia — Bloom Nutrition co-founder/CEO. No confirmed YouTube; IG primary."],
  ["newageceo", "NewAgeCEO", "shortform", "https://www.youtube.com/c/JustinOwens", "https://www.instagram.com/newageceo/",
   "Justin Owens — Run The Play; leadership/awakening angle, 2.3M IG."],
];

async function ensureSchema(pool) {
  await pool.query(`
    create table if not exists philosophy_creators (
      id serial primary key,
      slug text unique not null,
      display_name text not null,
      kind text not null default 'shortform',
      youtube_url text,
      instagram_url text,
      notes text,
      active boolean not null default true,
      created_at timestamptz not null default now()
    );
    create table if not exists philosophy_content (
      id text primary key,
      creator_id int not null references philosophy_creators(id),
      platform text not null,
      platform_post_id text not null,
      url text,
      title text,
      caption text,
      published_at timestamptz,
      duration_sec int,
      transcript jsonb,
      transcript_text text,
      transcript_source text,
      visual_notes jsonb,
      summary text,
      thumbnail_url text,
      status text not null default 'scraped',
      error text,
      scraped_day text not null,
      analyzed_at timestamptz,
      created_at timestamptz not null default now(),
      unique (platform, platform_post_id)
    );
    create index if not exists philosophy_content_creator_idx
      on philosophy_content (creator_id, published_at desc nulls last);
    create table if not exists philosophy_insights (
      id serial primary key,
      content_id text not null references philosophy_content(id) on delete cascade,
      creator_id int not null references philosophy_creators(id),
      kind text not null default 'point',
      text text not null,
      quote text,
      start_sec numeric,
      end_sec numeric,
      topics text[] not null default '{}',
      strength int,
      created_at timestamptz not null default now()
    );
    create index if not exists philosophy_insights_topics_idx
      on philosophy_insights using gin (topics);
    create index if not exists philosophy_insights_content_idx
      on philosophy_insights (content_id);
  `);
  for (const [slug, name, kind, yt, ig, notes] of SEED_CREATORS) {
    await pool.query(
      `insert into philosophy_creators (slug, display_name, kind, youtube_url, instagram_url, notes)
       values ($1,$2,$3,$4,$5,$6) on conflict (slug) do nothing`,
      [slug, name, kind, yt, ig, notes],
    );
  }
}

// --- Apify ------------------------------------------------------------
async function apifyRun(actor, input, { pollSec = 6, maxPolls = 150 } = {}) {
  const start = await fetch(`https://api.apify.com/v2/acts/${actor}/runs?token=${APIFY_TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).then((r) => r.json());
  const runId = start?.data?.id, dsId = start?.data?.defaultDatasetId;
  if (!runId) {
    console.error(`   ✗ apify ${actor} did not start: ${JSON.stringify(start).slice(0, 200)}`);
    return [];
  }
  for (let i = 0; i < maxPolls; i++) {
    const st = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`)
      .then((r) => r.json()).then((j) => j?.data?.status);
    if (st === "SUCCEEDED") break;
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(st)) {
      console.error(`   ✗ apify ${actor} run ${st}`);
      return [];
    }
    await sleep(pollSec * 1000);
  }
  const items = await fetch(`https://api.apify.com/v2/datasets/${dsId}/items?token=${APIFY_TOKEN}&clean=true`)
    .then((r) => r.json());
  return Array.isArray(items) ? items : [];
}

// --- subtitle / duration parsing --------------------------------------
function parseClock(s) {
  // "01:02:03,500" / "01:02:03.500" / "02:03.500" / "125" → seconds
  const str = String(s).trim().replace(",", ".");
  const parts = str.split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function parseSubs(raw) {
  // Tolerant SRT/VTT → [{start, end, text}], deduping auto-caption roll-ups.
  const segs = [];
  const lines = String(raw).split(/\r?\n/);
  let cur = null;
  for (const line of lines) {
    const m = line.match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
    if (m) {
      if (cur && cur.text) segs.push(cur);
      cur = { start: parseClock(m[1]) ?? 0, end: parseClock(m[2]) ?? 0, text: "" };
      continue;
    }
    if (!cur) continue;
    const t = line
      .replace(/<[^>]+>/g, "")
      .replace(/^\d+$/, "")
      .replace(/^WEBVTT.*/, "")
      .trim();
    if (t) cur.text = cur.text ? `${cur.text} ${t}` : t;
  }
  if (cur && cur.text) segs.push(cur);
  // Rolling auto-captions repeat lines; drop a segment whose text is contained
  // in its neighbor.
  const out = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (prev && (prev.text.includes(s.text) || s.text.includes(prev.text))) {
      prev.end = s.end;
      if (s.text.length > prev.text.length) prev.text = s.text;
      continue;
    }
    out.push({ ...s });
  }
  return out.length ? out : null;
}

function parseDuration(v) {
  if (v == null) return null;
  if (typeof v === "number") return Math.round(v);
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  if (/^\d{1,2}(:\d{2}){1,2}$/.test(s)) return parseClock(s);
  return null;
}

async function ytSubtitles(item) {
  const subs = item.subtitles || item.captions;
  if (!Array.isArray(subs)) return null;
  const en = subs.find((s) => /en/i.test(s.language || s.lang || s.languageCode || "")) || subs[0];
  if (!en) return null;
  let raw = en.srt || en.vtt || en.plaintext || en.content || en.text;
  if (!raw && en.url) {
    try { raw = await fetch(en.url).then((r) => r.text()); } catch {}
  }
  if (typeof raw !== "string" || !raw.trim()) return null;
  if (!/-->/.test(raw)) {
    // plaintext — one segment, no timing
    return [{ start: 0, end: 0, text: raw.replace(/\s+/g, " ").trim() }];
  }
  return parseSubs(raw);
}

// --- media helpers ----------------------------------------------------
const SCRATCH = join(tmpdir(), "philosophy-ingest");
mkdirSync(SCRATCH, { recursive: true });

async function downloadFile(url, dest) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length) throw new Error("empty download");
  writeFileSync(dest, bytes);
  return dest;
}

function ffprobeDuration(path) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { encoding: "utf8" });
  const d = parseFloat(r.stdout);
  return Number.isFinite(d) ? Math.round(d) : null;
}

function extractFrames(videoPath, durationSec, maxFrames = 10) {
  const dur = durationSec || ffprobeDuration(videoPath) || 60;
  const n = Math.min(maxFrames, Math.max(4, Math.floor(dur / 6)));
  const frames = [];
  for (let i = 0; i < n; i++) {
    const t = Math.round(((i + 0.5) / n) * dur);
    const out = join(SCRATCH, `frame-${basename(videoPath).replace(/\W/g, "_")}-${t}.jpg`);
    const r = spawnSync("ffmpeg", ["-ss", String(t), "-i", videoPath, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "6", "-y", out], { encoding: "utf8" });
    if (r.status === 0 && existsSync(out)) frames.push({ t, path: out });
  }
  return frames;
}

function whisperTranscribe(mediaPath) {
  if (!WHISPER) return null;
  const outDir = join(SCRATCH, "whisper");
  mkdirSync(outDir, { recursive: true });
  console.log(`   ⏳ whisper ${basename(mediaPath)}…`);
  const r = spawnSync(WHISPER, [mediaPath, "--model", "base.en", "--language", "en", "--output_format", "json", "--output_dir", outDir, "--fp16", "False", "--verbose", "False"], { encoding: "utf8", timeout: 3 * 60 * 60 * 1000 });
  if (r.status !== 0) {
    console.error(`   ✗ whisper failed: ${(r.stderr || "").slice(-200)}`);
    return null;
  }
  const jsonPath = join(outDir, basename(mediaPath).replace(extname(mediaPath), "") + ".json");
  try {
    const j = JSON.parse(readFileSync(jsonPath, "utf8"));
    return (j.segments || []).map((s) => ({ start: Math.round(s.start * 10) / 10, end: Math.round(s.end * 10) / 10, text: s.text.trim() })).filter((s) => s.text);
  } catch {
    return null;
  }
}

// --- Insforge thumbnail -----------------------------------------------
async function uploadThumb(bytes, filename) {
  if (!INSFORGE_BASE || !INSFORGE_KEY) return null;
  const auth = { Authorization: `Bearer ${INSFORGE_KEY}` };
  const strat = await fetch(`${INSFORGE_BASE}/api/storage/buckets/${BUCKET}/upload-strategy`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType: "image/jpeg", size: bytes.length }),
  }).then((r) => r.json());
  const file = new File([bytes], filename, { type: "image/jpeg" });
  if (strat.method === "presigned") {
    const fd = new FormData();
    for (const [k, v] of Object.entries(strat.fields ?? {})) fd.append(k, v);
    fd.append("file", file, filename);
    const up = await fetch(strat.uploadUrl, { method: "POST", body: fd });
    if (up.status < 200 || up.status >= 300) throw new Error(`upload ${up.status}`);
    const cf = await fetch(`${INSFORGE_BASE}${strat.confirmUrl}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ size: bytes.length, contentType: "image/jpeg" }),
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

async function persistThumb(srcUrl, contentId) {
  if (!srcUrl) return null;
  try {
    const res = await fetch(srcUrl, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > 3_000_000) return null;
    return await uploadThumb(bytes, `philosophy/${contentId.replace(/[^\w-]/g, "_")}.jpg`);
  } catch {
    return null;
  }
}

// --- discovery: YouTube ------------------------------------------------
const YTDLP = (() => {
  const r = spawnSync("which", ["yt-dlp"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
})();

/** Local fallback when Apify is capped/down — yt-dlp lists the tab and pulls
 *  metadata + auto-captions per video. Local runs only (no yt-dlp on Railway). */
function ytdlpDiscover(tabUrls, limit) {
  const ids = new Set();
  for (const url of tabUrls) {
    const r = spawnSync(YTDLP, ["--flat-playlist", "--playlist-end", String(limit), "--print", "%(id)s", url], { encoding: "utf8", timeout: 120_000 });
    for (const id of (r.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean)) ids.add(id);
  }
  const items = [];
  for (const id of ids) {
    const r = spawnSync(YTDLP, ["-j", "--no-download", `https://www.youtube.com/watch?v=${id}`], { encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) continue;
    try {
      const j = JSON.parse(r.stdout);
      const capTracks = j.automatic_captions?.en || j.subtitles?.en || [];
      const vtt = capTracks.find((c) => c.ext === "vtt") || capTracks.find((c) => c.ext === "srv1") || null;
      items.push({
        id,
        url: `https://www.youtube.com/watch?v=${id}`,
        title: j.title,
        text: j.description,
        date: j.upload_date ? `${j.upload_date.slice(0, 4)}-${j.upload_date.slice(4, 6)}-${j.upload_date.slice(6, 8)}` : null,
        duration: j.duration,
        thumbnailUrl: j.thumbnail,
        subtitles: vtt ? [{ language: "en", url: vtt.url }] : null,
      });
    } catch {}
  }
  return items;
}

async function discoverYouTube(pool, creator, limit) {
  const base = creator.youtube_url.replace(/\/$/, "");
  const tabs = creator.kind === "podcast" ? ["/videos"] : ["/shorts", "/videos"];
  const startUrls = /\/(videos|shorts|streams)$/.test(base)
    ? [{ url: base }]
    : tabs.map((t) => ({ url: base + t }));
  console.log(`▶ [yt] ${creator.slug} (${startUrls.map((u) => u.url).join(", ")})…`);
  let items = await apifyRun(YT_ACTOR, {
    startUrls,
    maxResults: limit,
    maxResultsShorts: limit,
    maxResultStreams: 0,
    downloadSubtitles: true,
    saveSubsToKVS: false,
    subtitlesLanguage: "en",
    subtitlesFormat: "srt",
    preferAutoGeneratedSubtitles: true,
  });
  if (!items.length && YTDLP) {
    console.log("   apify empty — falling back to local yt-dlp");
    items = ytdlpDiscover(startUrls.map((u) => u.url), limit);
  }
  console.log(`   ${items.length} items returned`);
  let added = 0;
  for (const it of items) {
    const vid = it.id || it.videoId || (String(it.url || "").match(/(?:v=|shorts\/)([\w-]{6,})/) || [])[1];
    if (!vid || it.type === "channel") continue;
    const contentId = `youtube:${vid}`;
    const exists = await pool.query("select 1 from philosophy_content where id=$1", [contentId]);
    if (exists.rowCount) continue;
    const segs = await ytSubtitles(it);
    const transcriptText = segs ? segs.map((s) => s.text).join(" ").slice(0, 200_000) : null;
    const thumb = await persistThumb(it.thumbnailUrl || it.thumbnail, contentId);
    await pool.query(
      `insert into philosophy_content
         (id, creator_id, platform, platform_post_id, url, title, caption, published_at,
          duration_sec, transcript, transcript_text, transcript_source, thumbnail_url, status, scraped_day)
       values ($1,$2,'youtube',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'scraped',$13)
       on conflict (id) do nothing`,
      [contentId, creator.id, vid, it.url || `https://www.youtube.com/watch?v=${vid}`,
       it.title || null, it.text || it.description || null,
       it.date ? new Date(it.date) : null, parseDuration(it.duration),
       segs ? JSON.stringify(segs) : null, transcriptText, segs ? "captions" : null,
       thumb, etDay()],
    );
    added++;
  }
  console.log(`   ✓ ${added} new`);
  return added;
}

// --- discovery: Instagram ----------------------------------------------
async function discoverInstagram(pool, creator, limit) {
  console.log(`▶ [ig] ${creator.slug} (${creator.instagram_url})…`);
  const items = await apifyRun(IG_ACTOR, {
    directUrls: [creator.instagram_url],
    resultsType: "posts",
    resultsLimit: limit,
    addParentData: false,
  });
  const videos = items.filter((it) => (it.type === "Video" || it.productType === "clips") && it.videoUrl);
  console.log(`   ${items.length} items, ${videos.length} videos`);
  let added = 0;
  for (const it of videos.slice(0, limit)) {
    const pid = String(it.shortCode || it.id);
    const contentId = `instagram:${pid}`;
    const exists = await pool.query("select 1 from philosophy_content where id=$1", [contentId]);
    if (exists.rowCount) continue;

    // Download the reel while the CDN URL is fresh; transcribe if whisper is
    // local, otherwise the vision pass will read the burned captions later.
    let segs = null, source = null, localPath = null, durationSec = parseDuration(it.videoDuration);
    try {
      localPath = await downloadFile(it.videoUrl, join(SCRATCH, `${pid}.mp4`));
      durationSec = durationSec || ffprobeDuration(localPath);
      if (WHISPER && (durationSec || 0) <= 420) {
        segs = whisperTranscribe(localPath);
        if (segs) source = "whisper";
      }
    } catch (e) {
      console.error(`   ✗ ${pid} video download failed: ${e.message}`);
    }

    let visualNotes = null;
    if (VISION && localPath) {
      try { visualNotes = await visionNotes(localPath, durationSec); } catch (e) {
        console.error(`   ✗ ${pid} vision pass failed: ${e.message}`);
      }
    }
    // No whisper transcript → on-screen text from vision is the transcript.
    if (!segs && visualNotes?.length) {
      const vsegs = visualNotes.filter((f) => f.on_screen_text).map((f) => ({ start: f.t, end: f.t, text: f.on_screen_text }));
      if (vsegs.length) { segs = vsegs; source = "vision"; }
    }
    if (localPath) { try { rmSync(localPath); } catch {} }

    const thumb = await persistThumb(it.displayUrl, contentId);
    await pool.query(
      `insert into philosophy_content
         (id, creator_id, platform, platform_post_id, url, title, caption, published_at,
          duration_sec, transcript, transcript_text, transcript_source, visual_notes, thumbnail_url, status, scraped_day)
       values ($1,$2,'instagram',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'scraped',$14)
       on conflict (id) do nothing`,
      [contentId, creator.id, pid, it.url || `https://www.instagram.com/reel/${pid}/`,
       null, it.caption || null, it.timestamp ? new Date(it.timestamp) : null, durationSec,
       segs ? JSON.stringify(segs) : null,
       segs ? segs.map((s) => s.text).join(" ").slice(0, 200_000) : null, source,
       visualNotes ? JSON.stringify(visualNotes) : null, thumb, etDay()],
    );
    added++;
  }
  console.log(`   ✓ ${added} new`);
  return added;
}

// --- inbox (manual podcast drops) --------------------------------------
async function ingestInbox(pool, creators) {
  if (!existsSync(INBOX_DIR)) return 0;
  let added = 0;
  for (const creator of creators) {
    const dir = join(INBOX_DIR, creator.slug);
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => MEDIA_EXT.has(extname(f).toLowerCase()) && !f.startsWith("."));
    for (const f of files) {
      const full = join(dir, f);
      const pid = f.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-").toLowerCase();
      const contentId = `file:${creator.slug}:${pid}`;
      const exists = await pool.query("select 1 from philosophy_content where id=$1", [contentId]);
      if (exists.rowCount) continue;
      if (!WHISPER) { console.error(`   ✗ inbox file ${f} needs whisper (not installed here) — skipping`); continue; }
      console.log(`▶ [inbox] ${creator.slug}/${f}`);
      const segs = whisperTranscribe(full);
      if (!segs) { console.error(`   ✗ transcription failed for ${f}`); continue; }
      const durationSec = ffprobeDuration(full);
      await pool.query(
        `insert into philosophy_content
           (id, creator_id, platform, platform_post_id, url, title, duration_sec,
            transcript, transcript_text, transcript_source, status, scraped_day)
         values ($1,$2,'file',$3,$4,$5,$6,$7,$8,'whisper','scraped',$9)
         on conflict (id) do nothing`,
        [contentId, creator.id, `${creator.slug}:${pid}`, null, f.replace(/\.[^.]+$/, ""),
         durationSec, JSON.stringify(segs),
         segs.map((s) => s.text).join(" ").slice(0, 400_000), etDay()],
      );
      added++;
      console.log(`   ✓ transcribed (${segs.length} segments)`);
    }
  }
  return added;
}

// --- model stack -------------------------------------------------------
async function visionNotes(videoPath, durationSec) {
  const frames = extractFrames(videoPath, durationSec);
  if (!frames.length) return null;
  const content = [];
  for (const f of frames) {
    content.push({ type: "text", text: `Frame at t=${f.t}s:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: readFileSync(f.path).toString("base64") } });
  }
  content.push({
    type: "text",
    text: "For EACH frame, transcribe any on-screen caption text exactly (empty string if none) and note in a few words what is visually happening.",
  });
  const schema = {
    type: "object",
    properties: {
      frames: {
        type: "array",
        items: {
          type: "object",
          properties: {
            t: { type: "number" },
            on_screen_text: { type: "string" },
            note: { type: "string" },
          },
          required: ["t", "on_screen_text", "note"],
        },
      },
    },
    required: ["frames"],
  };
  const out = await llm.createJson({
    max_tokens: 2000,
    system: "You annotate video frames for a content research pipeline.",
    messages: [{ role: "user", content }],
    output_config: { format: { schema } },
  });
  for (const f of frames) { try { rmSync(f.path); } catch {} }
  const notes = (out.frames || []).filter((f) => typeof f.t === "number");
  // Rolling captions repeat across frames — collapse duplicates.
  const seen = new Set();
  return notes.filter((f) => {
    const key = (f.on_screen_text || "").trim().toLowerCase();
    if (key && seen.has(key)) { f.on_screen_text = ""; }
    else if (key) seen.add(key);
    return true;
  });
}

const INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    insights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["principle", "framework", "tactic", "quote", "story", "hook"] },
          text: { type: "string" },
          quote: { type: "string" },
          start_sec: { type: "number" },
          end_sec: { type: "number" },
          topics: { type: "array", items: { type: "string" } },
          strength: { type: "integer", minimum: 1, maximum: 5 },
        },
        required: ["kind", "text", "topics", "strength"],
      },
    },
  },
  required: ["summary", "insights"],
};

const EXTRACT_SYSTEM = `You are the knowledge-graph extractor for a content studio that studies the best business/philosophy creators. You mine their content for its strongest, most reusable ideas.

Rules:
- Each insight must be one self-contained idea, written so it makes sense with zero context. Not a description of the video ("he talks about X") — the idea itself.
- kind: principle (worldview/law), framework (named model or steps), tactic (do-this advice), quote (verbatim line worth stealing), story (proof/anecdote with its lesson), hook (a framing/opening device worth reusing).
- quote: the best verbatim line supporting the insight, if one exists. Never invent quotes.
- start_sec/end_sec: from the [Ns] markers in the transcript, spanning where the idea lives. Omit only if there are no markers.
- topics: 1-3 kebab-case slugs (e.g. leverage, discipline, status-games, attention, money-psychology, content-strategy, pain-as-fuel, ownership, ego, focus, storytelling). Reuse the obvious canonical slug over inventing synonyms.
- strength 1-5: 5 = a genuinely sharp, non-obvious idea worth building content around; 1 = filler. Be stingy with 4s and 5s.
- Extract only what is actually there. A thin video may yield 1-2 insights; a dense one 6-10. Never pad.`;

function chunkSegments(segs, maxChars = 8000) {
  const chunks = [];
  let cur = [], len = 0;
  for (const s of segs) {
    const line = `[${Math.round(s.start)}s] ${s.text}`;
    if (len + line.length > maxChars && cur.length) { chunks.push(cur); cur = []; len = 0; }
    cur.push(line);
    len += line.length + 1;
  }
  if (cur.length) chunks.push(cur);
  return chunks.map((c) => c.join("\n"));
}

async function analyzeContent(pool, row) {
  const creator = row.creator_slug;
  const segs = row.transcript || [];
  const header =
    `CREATOR: ${row.display_name} (${creator}) — ${row.notes || ""}\n` +
    `PLATFORM: ${row.platform}${row.title ? `\nTITLE: ${row.title}` : ""}` +
    (row.caption ? `\nPOST CAPTION: ${String(row.caption).slice(0, 1500)}` : "") +
    (row.visual_notes?.length
      ? `\nVISUAL NOTES: ${row.visual_notes.map((f) => `[${f.t}s] ${f.note}`).join(" · ").slice(0, 1200)}`
      : "");

  const chunks = segs.length
    ? chunkSegments(segs)
    : row.caption
      ? [`(no transcript available — extract from the caption alone)\n${row.caption}`]
      : null;
  if (!chunks) throw new Error("nothing to analyze (no transcript, no caption)");

  const allInsights = [];
  const summaries = [];
  for (let i = 0; i < chunks.length; i++) {
    const label = chunks.length > 1 ? ` (part ${i + 1}/${chunks.length})` : "";
    const out = await llm.createJson({
      max_tokens: 4000,
      system: EXTRACT_SYSTEM,
      messages: [{
        role: "user",
        content: `${header}\n\nTRANSCRIPT${label} ([Ns] = seconds into the content):\n${chunks[i]}`,
      }],
      output_config: { format: { schema: INSIGHT_SCHEMA } },
    });
    if (out.summary) summaries.push(out.summary);
    for (const ins of out.insights || []) {
      if (!ins.text || !ins.text.trim()) continue;
      allInsights.push(ins);
    }
  }

  for (const ins of allInsights) {
    const topics = (ins.topics || [])
      .map((t) => String(t).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
      .filter(Boolean)
      .slice(0, 3);
    await pool.query(
      `insert into philosophy_insights (content_id, creator_id, kind, text, quote, start_sec, end_sec, topics, strength)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [row.id, row.creator_id, ins.kind || "principle", ins.text.trim(),
       ins.quote?.trim() || null,
       Number.isFinite(ins.start_sec) ? ins.start_sec : null,
       Number.isFinite(ins.end_sec) ? ins.end_sec : null,
       topics, Math.min(5, Math.max(1, ins.strength || 3))],
    );
  }
  await pool.query(
    `update philosophy_content set status='analyzed', summary=$2, analyzed_at=now(), error=null where id=$1`,
    [row.id, summaries.join(" ").slice(0, 2000) || null],
  );
  return allInsights.length;
}

async function analyzePending(pool) {
  const rows = await pool.query(
    `select c.*, cr.slug as creator_slug, cr.display_name, cr.notes
       from philosophy_content c
       join philosophy_creators cr on cr.id = c.creator_id
      where c.status = 'scraped'
      order by c.created_at asc
      limit 40`,
  );
  console.log(`▶ [analyze] ${rows.rowCount} pending`);
  let total = 0;
  for (const row of rows.rows) {
    try {
      const n = await analyzeContent(pool, row);
      total += n;
      console.log(`   ✓ ${row.id}: ${n} insights`);
    } catch (e) {
      console.error(`   ✗ ${row.id}: ${e.message}`);
      await pool.query(`update philosophy_content set status='failed', error=$2 where id=$1`, [row.id, String(e.message).slice(0, 500)]);
    }
  }
  console.log(`✓ [analyze] ${total} insights extracted`);
  return total;
}

// --- main -------------------------------------------------------------
async function main() {
  assertEnv(["DATABASE_URL"]);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4 });
  try {
    await ensureSchema(pool);
    if (SETUP_ONLY) { console.log("✓ schema + seed creators ready"); return; }

    const { rows: creators } = await pool.query(
      `select * from philosophy_creators where active order by id`,
    );
    const targets = CREATOR_FILTER ? creators.filter((c) => c.slug === CREATOR_FILTER) : creators;
    if (CREATOR_FILTER && !targets.length) { console.error(`✗ unknown creator slug: ${CREATOR_FILTER}`); process.exit(1); }

    if (!only || only === "discover") {
      assertEnv(["APIFY_TOKEN"]);
      for (const c of targets) {
        try {
          if (c.youtube_url) await discoverYouTube(pool, c, LIMIT);
          if (c.instagram_url) await discoverInstagram(pool, c, LIMIT);
        } catch (e) {
          console.error(`✗ discovery failed for ${c.slug}: ${e.message}`);
        }
      }
    }
    if (!only || only === "inbox") {
      await ingestInbox(pool, targets);
    }
    if (!only || only === "analyze") {
      assertEnv(["OLLAMA_API_KEY"]);
      await analyzePending(pool);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error("✗", e.stack || e.message); process.exit(1); });
