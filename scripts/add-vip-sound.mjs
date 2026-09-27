#!/usr/bin/env node
/**
 * add-vip-sound — turn a TikTok/Reels link Kevin discovered into a VIP sound.
 *
 * Downloads the video's audio via yt-dlp → mp3, uploads it to Insforge
 * storage, and inserts a `sounds` row with favorite=true and an active
 * vip_until window. Active VIPs ride the TOP of every publisher's pick queue
 * (reaction-ugc, carousel-publish-instagram, listFavoriteSounds) and may
 * repeat across posts until the window closes — trending boosts only last a
 * few days, so VIPs jump everything.
 *
 *   node --env-file=.env.local scripts/add-vip-sound.mjs <url>
 *        [--days 4] [--title "..."] [--gender any|female|male] [--notes "..."]
 *
 * Requires: yt-dlp + ffmpeg on PATH, DATABASE_URL, INSFORGE_* env.
 * IG Reels sometimes require login — if yt-dlp fails on a Reel, grab the
 * TikTok version of the sound or pass a different link.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";

const BASE = process.env.INSFORGE_API_BASE_URL;
const KEY = process.env.INSFORGE_API_KEY;
if (!BASE || !KEY || !process.env.DATABASE_URL) {
  console.error("✗ DATABASE_URL / INSFORGE_API_BASE_URL / INSFORGE_API_KEY required");
  process.exit(1);
}

const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith("--"));
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
if (!url) { console.error("usage: add-vip-sound.mjs <tiktok/reels url> [--days 4] [--title t] [--gender any] [--notes n]"); process.exit(1); }
const days = parseFloat(arg("--days", "4"));
const gender = arg("--gender", "any");

// 1. Download + extract mp3 (yt-dlp prints the video metadata as JSON).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vip-sound-"));
const outTmpl = path.join(tmpDir, "audio.%(ext)s");
console.log(`▶ downloading audio: ${url}`);
const metaRaw = execFileSync("yt-dlp", [
  "-x", "--audio-format", "mp3", "--audio-quality", "0",
  "--no-playlist", "--print-json", "-o", outTmpl, url,
], { maxBuffer: 32 * 1024 * 1024, timeout: 180000 }).toString();
const meta = JSON.parse(metaRaw.split("\n").find((l) => l.trim().startsWith("{")));
const mp3 = path.join(tmpDir, "audio.mp3");
if (!fs.existsSync(mp3)) throw new Error("yt-dlp did not produce audio.mp3");

const title = arg("--title", meta.track || meta.title || "vip sound").slice(0, 120);
const author = (meta.artist || meta.uploader || meta.channel || "").slice(0, 120);
const duration = Math.round(meta.duration || 0);
console.log(`  ✓ "${title}" by ${author || "?"} (${duration}s)`);

// 2. Upload to Insforge storage (same presigned flow as the publishers).
const buf = fs.readFileSync(mp3);
const md5 = crypto.createHash("md5").update(buf).digest("hex");
const filename = `vip-sound-${md5.slice(0, 10)}.mp3`;
const auth = { Authorization: `Bearer ${KEY}` };
const stratRes = await fetch(`${BASE}/api/storage/buckets/media/upload-strategy`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ filename, contentType: "audio/mpeg", size: buf.length }),
});
if (!stratRes.ok) throw new Error(`upload strategy ${stratRes.status}`);
const s = await stratRes.json();
let audioUrl;
if (s.method === "presigned") {
  const fd = new FormData();
  for (const [k, v] of Object.entries(s.fields ?? {})) fd.append(k, v);
  fd.append("file", new Blob([buf], { type: "audio/mpeg" }), filename);
  const up = await fetch(s.uploadUrl, { method: "POST", body: fd });
  if (up.status < 200 || up.status >= 300) throw new Error(`upload ${up.status}`);
  const cf = await fetch(`${BASE}${s.confirmUrl}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ size: buf.length, contentType: "audio/mpeg" }),
  });
  if (!cf.ok) throw new Error(`confirm ${cf.status}`);
  audioUrl = (await cf.json()).url;
} else {
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "audio/mpeg" }), filename);
  const up = await fetch(`${BASE}${s.uploadUrl}`, { method: "PUT", headers: auth, body: fd });
  if (!up.ok) throw new Error(`upload ${up.status}`);
  audioUrl = (await up.json().catch(() => ({}))).url || `${BASE}/api/storage/buckets/media/objects/${s.key}`;
}
console.log(`  ✓ uploaded → ${audioUrl.split("?")[0]}`);

// 3. Insert as an active VIP favorite — top of every pick queue immediately.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
const id = `vip-${md5.slice(0, 12)}`;
await pool.query(
  `insert into sounds (id, title, author, duration, batch, source_url, audio_url, mime,
                       favorite, hidden, chart, checked, used_count, gender, notes, vip_until)
   values ($1,$2,$3,$4,'vip-manual',$5,$6,'audio/mpeg',
           true,false,'sounds',false,0,$7,$8, now() + ($9 || ' days')::interval)
   on conflict (id) do update set
     favorite = true, hidden = false, vip_until = now() + ($9 || ' days')::interval,
     source_url = excluded.source_url, notes = excluded.notes`,
  [id, title, author, duration, url, audioUrl, gender, arg("--notes", "VIP drop from Kevin"), String(days)],
);
const { rows } = await pool.query(`select vip_until from sounds where id = $1`, [id]);
await pool.end();
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`★ VIP sound live: ${id} "${title}" — top of the queue until ${new Date(rows[0].vip_until).toLocaleString("en-US", { timeZone: "America/New_York" })} ET`);
