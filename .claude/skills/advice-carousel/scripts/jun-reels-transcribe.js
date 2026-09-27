#!/usr/bin/env node
/**
 * jun-reels-transcribe — transcribe a scraped creator's top reels so the
 * spoken advice (not just captions) can feed the advice-carousel tip bank.
 *
 * Flow per reel (top N by video views from the Apify dataset):
 *   1. download the reel mp4 (Instagram CDN url from the scrape — these
 *      expire after some hours, so run soon after the scrape)
 *   2. ffmpeg → mono 64k mp3
 *   3. upload the mp3 to Insforge storage (public URL)
 *   4. fal-ai/whisper transcription
 *   5. store in data/jun-yuh-transcripts.json (incremental, resumable)
 *
 * Then feed the transcripts to the tip extractor:
 *   node --env-file=.env.local jun-tips-harvest.js --transcripts \
 *        .claude/skills/advice-carousel/data/jun-yuh-transcripts.json
 *
 * Usage:
 *   node --env-file=.env.local jun-reels-transcribe.js --dataset <apifyDatasetId>
 *        [--top 100] [--concurrency 3]
 */

const fs = require("fs");
const { assertFal } = require("../../../lib/fal-gate.js");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const APIFY_TOKEN = process.env.APIFY_TOKEN;
assertFal("fal-whisper");
const FAL_KEY = process.env.FAL_KEY;
const INSFORGE_BASE = process.env.INSFORGE_API_BASE_URL || "";
const INSFORGE_KEY = process.env.INSFORGE_API_KEY || "";
const BUCKET = "media";
const OUT = path.join(__dirname, "..", "data", "jun-yuh-transcripts.json");

function arg(n, d) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; }
const DATASET = arg("--dataset");
const TOP = parseInt(arg("--top", "100"), 10);
const CONCURRENCY = parseInt(arg("--concurrency", "3"), 10);
if (!DATASET) { console.error("--dataset required"); process.exit(1); }
for (const [k, v] of Object.entries({ APIFY_TOKEN, FAL_KEY, INSFORGE_KEY })) {
  if (!v) { console.error(`${k} required`); process.exit(1); }
}

async function fetchJSON(url, opts, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, opts);
    if (res.ok) return res.json();
    if (attempt < retries && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

async function uploadToInsforge(localPath) {
  const filename = path.basename(localPath);
  const buf = fs.readFileSync(localPath);
  const contentType = "audio/mpeg";
  const size = buf.length;
  const auth = { Authorization: `Bearer ${INSFORGE_KEY}` };
  const s = await fetchJSON(`${INSFORGE_BASE}/api/storage/buckets/${BUCKET}/upload-strategy`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType, size }),
  });
  if (s.method === "presigned") {
    const fd = new FormData();
    for (const [k, v] of Object.entries(s.fields ?? {})) fd.append(k, v);
    fd.append("file", new Blob([buf], { type: contentType }), filename);
    const up = await fetch(s.uploadUrl, { method: "POST", body: fd });
    if (up.status < 200 || up.status >= 300) throw new Error(`storage upload ${up.status}`);
    const cf = await fetchJSON(`${INSFORGE_BASE}${s.confirmUrl}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ size, contentType }),
    });
    return cf.url;
  }
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: contentType }), filename);
  const j = await fetchJSON(`${INSFORGE_BASE}${s.uploadUrl}`, { method: "PUT", headers: auth, body: fd });
  return j.url || `${INSFORGE_BASE}/api/storage/buckets/${BUCKET}/objects/${s.key}`;
}

async function transcribeOne(reel, idx, total) {
  const stamp = `jun-${Date.now()}-${idx}`;
  const mp4 = path.join(os.tmpdir(), `${stamp}.mp4`);
  const mp3 = path.join(os.tmpdir(), `${stamp}.mp3`);
  try {
    // 1. Download with retries (transient CDN resets happen under load).
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(reel.videoUrl, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } });
        if (!res.ok) throw new Error(`CDN ${res.status} (url likely expired)`);
        fs.writeFileSync(mp4, Buffer.from(await res.arrayBuffer()));
        break;
      } catch (e) {
        if (attempt >= 2) throw e;
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }

    // 2. Audio check + extract. Instagram serves some reels as VIDEO-ONLY
    // files (audio is a separate DASH stream the scraper doesn't capture) —
    // those have no audio track at all. Store them as speech:false instead of
    // failing so they're marked done and never re-attempted.
    const probe = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", mp4], { stdio: "pipe", timeout: 60000 }).toString().trim();
    if (!probe) {
      console.log(`reel ${idx + 1}/${total} (${reel.views ?? "?"} views): no audio track [no speech]`);
      return { ...reel, transcript: "", speech: false, no_audio: true };
    }
    execFileSync("ffmpeg", ["-y", "-i", mp4, "-vn", "-ac", "1", "-b:a", "64k", mp3], { stdio: "pipe", timeout: 120000 });

    // 3. Public URL for fal.
    const audioUrl = await uploadToInsforge(mp3);

    // 4. Whisper. language pinned to en — auto-detect hallucinates foreign
    //    syllables on music-only audio.
    const w = await fetchJSON("https://fal.run/fal-ai/whisper", {
      method: "POST",
      headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ audio_url: audioUrl, task: "transcribe", language: "en" }),
    });
    const text = (w.text || "").trim();
    // Speech detector: montage reels yield song lyrics / repeated syllables /
    // near-empty text. Only speech:true transcripts feed the tip extractor.
    const words = text.split(/\s+/).filter(Boolean);
    const asciiRatio = text.length ? [...text].filter((c) => c.charCodeAt(0) < 128).length / text.length : 0;
    const uniqRatio = words.length ? new Set(words.map((x) => x.toLowerCase())).size / words.length : 0;
    const speech = text.length > 200 && asciiRatio > 0.9 && uniqRatio > 0.25;
    console.log(`reel ${idx + 1}/${total} (${reel.views ?? "?"} views): ${text.length} chars ${speech ? "[SPEECH]" : "[no speech]"}`);
    return { ...reel, transcript: text, speech, audio_url: audioUrl };
  } finally {
    for (const f of [mp4, mp3]) if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

async function main() {
  console.log(`Loading dataset ${DATASET}…`);
  const items = [];
  for (let offset = 0; ; offset += 500) {
    const page = await fetchJSON(`https://api.apify.com/v2/datasets/${DATASET}/items?token=${APIFY_TOKEN}&offset=${offset}&limit=500&clean=true`);
    items.push(...page);
    if (page.length < 500) break;
  }

  const videos = items
    .filter((it) => it.type === "Video" && it.videoUrl)
    .map((it) => ({
      url: it.url || `https://www.instagram.com/p/${it.shortCode}/`,
      videoUrl: it.videoUrl,
      caption: (it.caption || "").trim(),
      views: it.videoViewCount ?? null,
      likes: it.likesCount ?? null,
      comments: it.commentsCount ?? null,
      ts: it.timestamp || null,
    }))
    .sort((a, b) => (b.views ?? b.likes ?? 0) - (a.views ?? a.likes ?? 0));
  // Selection: top-by-views alone surfaces music-montage reels (no speech).
  // The advice lives in TALKING reels, which correlate with substantive
  // captions — so take the union: top N by views + every reel whose caption
  // reads like an advice post, capped at 2×N.
  const byViews = videos.slice(0, TOP);
  const advicey = videos.filter((v) => v.caption.length >= 300);
  const seen = new Set();
  const reels = [...byViews, ...advicey].filter((v) => !seen.has(v.url) && seen.add(v.url)).slice(0, TOP * 2);
  console.log(`${reels.length} reels selected (${byViews.length} top-views ∪ ${advicey.length} advice-caption, of ${videos.length} videos)`);

  const doc = fs.existsSync(OUT)
    ? JSON.parse(fs.readFileSync(OUT, "utf8"))
    : { source: "jun_yuh top reels (fal whisper)", transcribed_at: null, reels: [] };
  const done = new Set(doc.reels.map((r) => r.url));
  const todo = reels.filter((r) => !done.has(r.url));
  console.log(`${todo.length} to transcribe (${done.size} already stored)\n`);

  let completed = 0, failed = 0, cursor = 0;
  const save = () => {
    doc.transcribed_at = new Date().toISOString();
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(doc, null, 2));
  };
  const worker = async () => {
    while (cursor < todo.length) {
      const idx = cursor++;
      try {
        const r = await transcribeOne(todo[idx], idx, todo.length);
        const { videoUrl, ...keep } = r; // CDN url expires — don't persist it
        doc.reels.push(keep);
        completed++;
        save();
        if (completed % 10 === 0) console.log(`PROGRESS: ${doc.reels.length} transcripts stored (${failed} failed)`);
      } catch (e) {
        failed++;
        console.error(`  ! reel ${idx + 1} failed: ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  save();
  console.log(`\nTRANSCRIBE DONE — ${doc.reels.length} transcripts stored, ${failed} failed → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
