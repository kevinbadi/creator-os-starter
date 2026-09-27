#!/usr/bin/env node
// Pull a YouTube channel's most recent long-form videos (transcript via
// captions) into copywriter_sources tagged "<handle>-yt-style".
//   node --env-file=.env.local scripts/copywriter-ingest-youtube.mjs https://www.youtube.com/@KevBuildsApps 20
import { spawnSync } from "node:child_process";
import { Pool } from "pg";

const [channel = "https://www.youtube.com/@KevBuildsApps", countArg = "20"] = process.argv.slice(2);
const COUNT = Math.max(1, Math.min(50, Number(countArg) || 20));
const TOKEN = process.env.APIFY_TOKEN;
const handle = (channel.match(/@([\w.-]+)/)?.[1] || "channel").toLowerCase();
const TAG = `${handle}-yt-style`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apify(path, init) {
  const r = await fetch(`https://api.apify.com/v2${path}${path.includes("?") ? "&" : "?"}token=${TOKEN}`, init);
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`apify ${r.status} ${path}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}
function parseClock(s) {
  const parts = String(s).trim().replace(",", ".").split(":").map(Number);
  return parts.some(Number.isNaN) ? null : parts.reduce((acc, p) => acc * 60 + p, 0);
}
function parseSubs(raw) {
  const segs = []; let cur = null;
  for (const line of String(raw).split(/\r?\n/)) {
    const m = line.match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
    if (m) { if (cur && cur.text) segs.push(cur); cur = { start: parseClock(m[1]) ?? 0, end: parseClock(m[2]) ?? 0, text: "" }; continue; }
    if (!cur) continue;
    const t = line.replace(/<[^>]+>/g, "").trim();
    if (!t || /^\d+$/.test(t) || /^WEBVTT/.test(t) || /^(Kind|Language):/.test(t)) continue;
    if (cur.text.endsWith(t) || t.startsWith(cur.text) && cur.text) { cur.text = t.length > cur.text.length ? t : cur.text; continue; }
    cur.text = cur.text ? `${cur.text} ${t}` : t;
  }
  if (cur && cur.text) segs.push(cur);
  // auto-caption roll-ups repeat the previous line; dedupe consecutive duplicates
  const out = [];
  for (const s of segs) { if (!out.length || out[out.length - 1].text !== s.text) out.push(s); }
  return out;
}
function parseDuration(v) {
  if (v == null) return null;
  if (typeof v === "number") return Math.round(v);
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  if (/^\d{1,2}(:\d{2}){1,2}$/.test(s)) return parseClock(s);
  return null;
}
async function subsText(item) {
  const subs = item.subtitles || item.captions;
  if (!Array.isArray(subs)) return "";
  const en = subs.find((s) => /en/i.test(s.language || s.lang || s.languageCode || "")) || subs[0];
  if (!en) return "";
  let raw = en.srt || en.vtt || en.plaintext || en.content || en.text;
  if (!raw && en.url) { try { raw = await fetch(en.url).then((r) => r.text()); } catch {} }
  if (typeof raw !== "string" || !raw.trim()) return "";
  if (!/-->/.test(raw)) return raw.replace(/\s+/g, " ").trim();
  return parseSubs(raw).map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
}
const YTDLP = (() => { const r = spawnSync("which", ["yt-dlp"], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : null; })();
function ytdlpDiscover(url, limit) {
  const r = spawnSync(YTDLP, ["--flat-playlist", "--playlist-end", String(limit), "--print", "%(id)s", url], { encoding: "utf8", timeout: 120_000 });
  const items = [];
  for (const id of (r.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean)) {
    const j0 = spawnSync(YTDLP, ["-j", "--no-download", `https://www.youtube.com/watch?v=${id}`], { encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
    if (j0.status !== 0) continue;
    try {
      const j = JSON.parse(j0.stdout);
      const tracks = j.automatic_captions?.en || j.subtitles?.en || [];
      const vtt = tracks.find((c) => c.ext === "vtt") || tracks.find((c) => c.ext === "srv1") || null;
      items.push({ id, url: `https://www.youtube.com/watch?v=${id}`, title: j.title, text: j.description, date: j.upload_date ? `${j.upload_date.slice(0, 4)}-${j.upload_date.slice(4, 6)}-${j.upload_date.slice(6, 8)}` : null, duration: j.duration, thumbnailUrl: j.thumbnail, viewCount: j.view_count, likes: j.like_count, commentsCount: j.comment_count, subtitles: vtt ? [{ language: "en", url: vtt.url }] : null });
    } catch {}
  }
  return items;
}
async function analyze(transcript, title, description) {
  const key = process.env.OLLAMA_API_KEY || process.env.OLLAMA_KEY;
  const base = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/$/, "");
  const model = process.env.OLLAMA_TEXT_MODEL || "deepseek-v4-flash:0731";
  const res = await fetch(`${base}/api/chat`, {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(90000),
    body: JSON.stringify({ model, stream: false, think: false,
      format: { type: "object", properties: { topic: { type: "string" }, summary: { type: "string" }, hook: { type: "string" }, keyPoints: { type: "array", items: { type: "string" } }, format: { type: "string" }, cta: { type: "string" } }, required: ["topic", "summary", "hook", "keyPoints", "format", "cta"] },
      messages: [
        { role: "system", content: "You analyze long-form YouTube video transcripts for a copywriter. Output ONLY JSON. topic: 4 to 10 words. summary: 3 to 4 sentences on what it teaches and the angle. hook: the opening 1 to 2 sentences used to grab attention, near verbatim. keyPoints: 5 to 8 short bullets in order (the sections/steps of the video). format: the video format (tutorial, walkthrough, breakdown, vlog, etc). cta: what the viewer is asked to do, or empty. No em dashes. No emoji." },
        { role: "user", content: `TITLE: ${title}\n\nDESCRIPTION:\n${(description || "").slice(0, 1200)}\n\nTRANSCRIPT:\n${transcript.slice(0, 24000)}` },
      ] }),
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
  await pool.query(`alter table copywriter_sources add column if not exists title text`);
  const videosUrl = `${channel.replace(/\/$/, "")}/videos`;
  let items = [];
  if (TOKEN) {
    console.log(`▶ apify streamers~youtube-scraper ${videosUrl} x${COUNT}`);
    try {
      const start = await apify(`/acts/streamers~youtube-scraper/runs`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ startUrls: [{ url: videosUrl }], maxResults: COUNT, maxResultsShorts: 0, maxResultStreams: 0, downloadSubtitles: true, saveSubsToKVS: false, subtitlesLanguage: "en", subtitlesFormat: "srt", preferAutoGeneratedSubtitles: true }) });
      const runId = start.data.id, dsId = start.data.defaultDatasetId;
      for (let i = 0; i < 150; i++) {
        const st = (await apify(`/actor-runs/${runId}`)).data.status;
        if (st === "SUCCEEDED") break;
        if (["FAILED", "ABORTED", "TIMED-OUT"].includes(st)) throw new Error(`run ${st}`);
        if (i % 5 === 0) console.log(`  ${st}…`);
        await sleep(8000);
      }
      items = await apify(`/datasets/${dsId}/items?clean=true`);
    } catch (e) { console.error(`  apify failed: ${e.message}`); }
  }
  if (!items.length && YTDLP) { console.log("  falling back to yt-dlp"); items = ytdlpDiscover(videosUrl, COUNT); }
  console.log(`  ${items.length} items`);
  const s = (v) => (typeof v === "string" ? v.trim() : "");
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  let ok = 0;
  for (const it of items.slice(0, COUNT)) {
    const vid = it.id || it.videoId || (String(it.url || "").match(/(?:v=|shorts\/)([\w-]{6,})/) || [])[1];
    if (!vid || it.type === "channel") continue;
    const url = `https://www.youtube.com/watch?v=${vid}`;
    const transcript = await subsText(it);
    const dur = parseDuration(it.duration);
    const good = transcript.length > 50;
    const title = s(it.title);
    let read = { topic: "", summary: "", hook: "", keyPoints: [], format: "", cta: "" };
    let err = good ? "" : "no captions available";
    if (good) { try { read = await analyze(transcript, title, s(it.text || it.description)); ok++; } catch (e) { err = `topic read failed: ${e.message}`; } }
    const postedAt = it.date ? new Date(it.date).toISOString() : null;
    const params = [url, good ? "done" : "failed", transcript, s(it.text || it.description), s(it.channelUsername || it.channelName || handle), s(it.thumbnailUrl || it.thumbnail), n(it.likes), n(it.commentsCount), n(it.viewCount), dur, "en", read.topic, read.summary, read.hook, JSON.stringify(read.keyPoints), read.format, read.cta, err, TAG, postedAt, title];
    const exists = await pool.query(`select id from copywriter_sources where url = $1 and tag = $2`, [url, TAG]);
    if (exists.rows[0]) {
      await pool.query(`update copywriter_sources set status=$2,transcript=$3,caption=$4,username=$5,thumbnail_url=$6,like_count=$7,comment_count=$8,view_count=$9,duration_sec=$10,language=$11,topic=$12,summary=$13,hook=$14,key_points=$15,format=$16,cta=$17,error=$18,posted_at=$20,title=$21,updated_at=now() where url=$1 and tag=$19`, params);
    } else {
      await pool.query(`insert into copywriter_sources (url,status,transcript,caption,username,thumbnail_url,like_count,comment_count,view_count,duration_sec,language,topic,summary,hook,key_points,format,cta,error,tag,posted_at,title) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`, params);
    }
    console.log(`  ${good ? "✓" : "✗"} ${vid} ${dur ?? "?"}s ${transcript.split(/\s+/).length}w  ${title.slice(0, 60)}  -> ${read.topic || err}`);
  }
  console.log(`done: ${ok}/${items.length} read, tag=${TAG}`);
  await pool.end();
}
main().catch((e) => { console.error("✗", e.message); process.exit(1); });
