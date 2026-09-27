#!/usr/bin/env node
// Pull a creator's most recent reels through memo23/instagram-transcript-scraper
// and land them in copywriter_sources (tagged) with the LLM topic read, so the
// Copywriter page and the style-skill builder can use them.
//   node --env-file=.env.local scripts/copywriter-ingest-profile.mjs kevbuildsapps 20
import { Pool } from "pg";

const [handle = "kevbuildsapps", countArg = "20"] = process.argv.slice(2);
const COUNT = Math.max(1, Math.min(50, Number(countArg) || 20));
const TOKEN = process.env.APIFY_TOKEN;
if (!TOKEN) throw new Error("APIFY_TOKEN missing");
const ACTOR = (process.env.APIFY_IG_TRANSCRIPT_ACTOR || "memo23~instagram-transcript-scraper").replace("/", "~");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAG = `${handle}-style`;

async function apify(path, init) {
  const r = await fetch(`https://api.apify.com/v2${path}${path.includes("?") ? "&" : "?"}token=${TOKEN}`, init);
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`apify ${r.status} ${path}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

async function analyze(transcript, caption) {
  const key = process.env.OLLAMA_API_KEY || process.env.OLLAMA_KEY;
  const base = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/$/, "");
  const model = process.env.OLLAMA_TEXT_MODEL || "deepseek-v4-flash:0731";
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model, stream: false, think: false,
      format: { type: "object", properties: { topic: { type: "string" }, summary: { type: "string" }, hook: { type: "string" }, keyPoints: { type: "array", items: { type: "string" } }, format: { type: "string" }, cta: { type: "string" } }, required: ["topic", "summary", "hook", "keyPoints", "format", "cta"] },
      messages: [
        { role: "system", content: "You analyze short-form video transcripts for a copywriter. Output ONLY JSON. topic: 4 to 10 words. summary: 2 to 3 sentences on what it says and the angle. hook: the opening line used to grab attention, near verbatim. keyPoints: 3 to 6 short bullets. format: the content format. cta: what the viewer is asked to do, or empty. No em dashes. No emoji." },
        { role: "user", content: `${caption ? `CAPTION:\n${caption.slice(0, 1500)}\n\n` : ""}TRANSCRIPT:\n${transcript.slice(0, 6000)}` },
      ],
    }),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`ollama ${res.status}: ${t.slice(0, 200)}`);
  const c = JSON.parse(t)?.message?.content || t;
  const j = JSON.parse(c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1));
  const s = (v) => (typeof v === "string" ? v.replace(/[–—]/g, "-").trim() : "");
  return { topic: s(j.topic), summary: s(j.summary), hook: s(j.hook), keyPoints: Array.isArray(j.keyPoints) ? j.keyPoints.map(s).filter(Boolean) : [], format: s(j.format), cta: s(j.cta) };
}

async function main() {
  await pool.query(`alter table copywriter_sources add column if not exists tag text`);
  await pool.query(`alter table copywriter_sources add column if not exists posted_at timestamptz`);
  console.log(`▶ apify ${ACTOR} @${handle} x${COUNT}`);
  const start = await apify(`/acts/${ACTOR}/runs`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handles: [handle], maxReelsPerHandle: COUNT, maxItems: COUNT, whisperModel: "base", language: "auto", includeSegments: false, maxDurationSec: 600, maxConcurrency: 3, analyzeReel: false }),
  });
  const runId = start.data.id, dsId = start.data.defaultDatasetId;
  console.log(`  run ${runId}`);
  for (let i = 0; i < 120; i++) {
    const st = (await apify(`/actor-runs/${runId}`)).data.status;
    if (st === "SUCCEEDED") break;
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(st)) throw new Error(`run ${st}`);
    if (i % 5 === 0) console.log(`  ${st}…`);
    await sleep(8000);
  }
  const items = await apify(`/datasets/${dsId}/items?clean=true`);
  console.log(`  ${items.length} items`);
  const s = (v) => (typeof v === "string" ? v.trim() : "");
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  let ok = 0;
  for (const it of items) {
    const url = s(it.url) || (it.shortcode ? `https://www.instagram.com/reel/${it.shortcode}/` : "");
    const transcript = s(it.transcript).replace(/\s+/g, " ");
    const good = ["ok", "success"].includes(String(it.status).toLowerCase()) && transcript;
    const postedAt = typeof it.timestamp === "number" ? new Date(it.timestamp * 1000).toISOString() : null;
    const exists = await pool.query(`select id from copywriter_sources where url = $1 and tag = $2`, [url, TAG]);
    let read = { topic: "", summary: "", hook: "", keyPoints: [], format: "", cta: "" };
    let err = good ? "" : String(it.status).toLowerCase() === "no_speech" ? "no speech detected" : "transcription failed";
    if (good) {
      try { read = await analyze(transcript, s(it.caption)); ok++; } catch (e) { err = `topic read failed: ${e.message}`; }
    }
    const params = [url, runId, good ? "done" : "failed", transcript, s(it.caption), s(it.hook3s), s(it.username), s(it.thumbnailUrl), n(it.likeCount), n(it.commentCount), n(it.viewCount), n(it.durationSec), s(it.language) || null, read.topic, read.summary, read.hook, JSON.stringify(read.keyPoints), read.format, read.cta, err, TAG, postedAt];
    if (exists.rows[0]) {
      await pool.query(`update copywriter_sources set run_id=$2,status=$3,transcript=$4,caption=$5,hook3s=$6,username=$7,thumbnail_url=$8,like_count=$9,comment_count=$10,view_count=$11,duration_sec=$12,language=$13,topic=$14,summary=$15,hook=$16,key_points=$17,format=$18,cta=$19,error=$20,tag=$21,posted_at=$22,updated_at=now() where url=$1 and tag=$21`, params);
    } else {
      await pool.query(`insert into copywriter_sources (url,run_id,status,transcript,caption,hook3s,username,thumbnail_url,like_count,comment_count,view_count,duration_sec,language,topic,summary,hook,key_points,format,cta,error,tag,posted_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`, params);
    }
    console.log(`  ${good ? "✓" : "✗"} ${it.shortcode || url} ${n(it.durationSec) ?? "?"}s ${read.topic || err}`);
  }
  console.log(`done: ${ok}/${items.length} read, tag=${TAG}`);
  await pool.end();
}
main().catch((e) => { console.error("✗", e.message); process.exit(1); });
