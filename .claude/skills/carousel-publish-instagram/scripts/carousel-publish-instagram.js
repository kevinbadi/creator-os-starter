#!/usr/bin/env node
/**
 * carousel-publish-instagram — publish a carousel to Instagram via Zernio with
 * a TRENDING SOUND baked into the first slide.
 *
 * Instagram's API cannot attach audio to a carousel, but a carousel CAN mix
 * video + images — and when slide 1 is a video, its audio plays across the
 * whole carousel. So:
 *
 *   1. Pick the next favorited trending sound from the `sounds` table
 *      (unchecked / least-recently-used first — same rotation the Sounds tab
 *      tracks with its checkboxes).
 *   2. Download the audio from Insforge storage; ffmpeg-mux it with slide 1's
 *      image into an H.264/AAC video that lasts as long as the song
 *      (clamped 15–60s; audio loops up to 15s if the clip is shorter).
 *   3. Upload the video + remaining slides to Insforge → public URLs.
 *   4. POST /posts to Zernio for the persona's Instagram (video first).
 *   5. Mark the sound used (checked, used_count, last_used_at) + stamp sidecar.
 *
 * SAFE BY DEFAULT: dry-run unless --publish is passed.
 *
 * Usage:
 *   node --env-file=.env.local carousel-publish-instagram.js \
 *     [--persona megan] [--carousel <dir-or-json>] [--sound <id>]
 *     [--schedule <ISO8601>] [--publish]
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Pool } = require("pg");
const { loadPersona, getOutputDir, closePersonaPool } = require("../../../lib/persona");
const { writeSeoCaptions } = require("../../../lib/seo-caption");

const ROOT_DIR = path.join(__dirname, "..", "..", ".."); // creator-os/.claude
const ZERNIO_BASE = process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1";
const INSFORGE_BASE = process.env.INSFORGE_API_BASE_URL || "";
const INSFORGE_KEY = process.env.INSFORGE_API_KEY || "";
const BUCKET = "media";

const MIN_SEC = 15; // Kevin: at least 15s to start
const MAX_SEC = 60; // IG carousel video ceiling

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { persona: null, carousel: null, sound: null, schedule: null, publish: false, reel: false, slideshow: false, secPerSlide: 2.0, soundGender: "female" };
  for (let i = 0; i < a.length; i++) {
    switch (a[i]) {
      case "--persona": o.persona = a[++i]; break;
      case "--carousel": o.carousel = a[++i]; break;
      case "--sound": o.sound = a[++i]; break;
      // Which creator gender the sound rotation may pull: that gender + 'any'.
      // Default 'female' preserves the original Megan behavior.
      case "--sound-gender": o.soundGender = a[++i]; break;
      case "--schedule": o.schedule = a[++i]; break;
      case "--publish": o.publish = true; break;
      case "--dry-run": o.publish = false; break;
      case "--reel": o.reel = true; break;
      // ALL slides → one 9:16 slideshow video with the trending sound across
      // it, posted as a Reel. Dodges the 10-item carousel cap entirely.
      case "--slideshow": o.slideshow = true; break;
      case "--sec-per-slide": o.secPerSlide = Number(a[++i]); break;
      default: throw new Error(`Unknown arg: ${a[i]}`);
    }
  }
  if (!["female", "male", "any"].includes(o.soundGender)) throw new Error("--sound-gender must be female|male|any");
  return o;
}

function resolveSidecar(carouselArg, persona) {
  if (carouselArg) {
    const p = fs.statSync(carouselArg).isDirectory()
      ? path.join(carouselArg, "carousel.json")
      : carouselArg;
    if (!fs.existsSync(p)) throw new Error(`Sidecar not found: ${p}`);
    return p;
  }
  const base = getOutputDir("carousels", ROOT_DIR, persona.slug);
  const dirs = fs.readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse();
  for (const dir of dirs) {
    const p = path.join(base, dir, "carousel.json");
    if (!fs.existsSync(p)) continue;
    if (!JSON.parse(fs.readFileSync(p, "utf8")).published_at) return p;
  }
  throw new Error(`No unpublished carousels in ${base}`);
}

// ── Trending sound rotation (Kevin 2026-07-08): VIP lane first (active
// vip_until window — may repeat while the boost lasts), then unused favorites
// NEWEST-first (trending boosts decay in days), then least-recently-used. ───
async function pickSound(pool, soundId, soundGender) {
  // Eligible = the persona's gender + 'any' (Megan → female+any, Danny → male+any).
  const where = soundId
    ? { sql: "id = $1", params: [soundId] }
    : soundGender === "any"
      ? { sql: "favorite and not hidden", params: [] }
      : { sql: "favorite and not hidden and gender in ($1, 'any')", params: [soundGender] };
  const { rows } = await pool.query(
    `select id, title, author, duration, audio_url, mime
       from sounds
      where ${where.sql}
      order by (coalesce(vip_until, 'epoch'::timestamptz) > now()) desc,
               checked asc,
               (case when not checked then created_at end) desc nulls last,
               last_used_at asc nulls first
      limit 1`,
    where.params,
  );
  if (!rows.length) throw new Error("No favorited sound available (favorite some in the Sounds tab)");
  return rows[0];
}

async function markSoundUsed(pool, id) {
  await pool.query(
    `update sounds
        set checked = true, used_count = used_count + 1, last_used_at = now()
      where id = $1`,
    [id],
  );
}

// ── ffmpeg: slide image + audio → first-slide video ─────────────────────────
function probeDuration(file) {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ]).toString().trim();
  const d = parseFloat(out);
  if (!Number.isFinite(d) || d <= 0) throw new Error(`ffprobe failed on ${file}`);
  return d;
}

function buildSoundVideo(imagePath, audioPath, outPath) {
  const audioDur = probeDuration(audioPath);
  // The photo lasts as long as the song requires, within IG's limits.
  const target = Math.min(Math.max(audioDur, MIN_SEC), MAX_SEC);
  const loopAudio = audioDur < target - 0.25; // clip shorter than floor → loop it

  const args = ["-y", "-loop", "1", "-framerate", "30", "-i", imagePath];
  if (loopAudio) args.push("-stream_loop", "-1");
  args.push(
    "-i", audioPath,
    "-t", target.toFixed(2),
    // Cover-crop to 4:5 so both 4:5 and 9:16 slide renders come out undistorted.
    "-vf", "scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350,setsar=1,format=yuv420p",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", "30",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    "-shortest",
    outPath,
  );
  execFileSync("ffmpeg", args, { stdio: "pipe", timeout: 180000 });
  return { audioDur, target };
}

// ── beat detection: decode PCM via ffmpeg, autocorrelate the onset envelope ──
// Dependency-free (pure JS over raw PCM) so it runs identically on Railway.
// Returns BPM in [80, 160] or null when the track has no clear pulse.
function detectBPM(audioPath) {
  try {
    const pcm = execFileSync(
      "ffmpeg",
      ["-v", "error", "-i", audioPath, "-ac", "1", "-ar", "11025", "-t", "60", "-f", "s16le", "pipe:1"],
      { maxBuffer: 64 * 1024 * 1024, timeout: 60000 },
    );
    const hop = 256; // ~23ms energy frames
    const frames = Math.floor(pcm.length / 2 / hop);
    if (frames < 200) return null;
    const energy = new Float64Array(frames);
    for (let f = 0; f < frames; f++) {
      let s = 0;
      for (let i = f * hop; i < (f + 1) * hop; i++) { const v = pcm.readInt16LE(i * 2) / 32768; s += v * v; }
      energy[f] = s;
    }
    const onset = new Float64Array(frames);
    for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f] - energy[f - 1]);
    const fps = 11025 / hop;
    let best = { bpm: 0, score: -1 };
    for (let bpm = 70; bpm <= 180; bpm++) {
      const lag = Math.round((fps * 60) / bpm);
      let s = 0;
      for (let f = 0; f < frames - lag; f++) s += onset[f] * onset[f + lag];
      if (s > best.score) best = { bpm, score: s };
    }
    if (!best.bpm) return null;
    let bpm = best.bpm;
    while (bpm < 80) bpm *= 2;
    while (bpm > 160) bpm /= 2;
    return Math.round(bpm);
  } catch {
    return null;
  }
}

// ── reading-speed pacing ─────────────────────────────────────────────────────
// Kevin 2026-07-06: slides with on-screen text hold for how long an average
// person needs to read them, minus 2%. Average adult silent reading ≈ 238 wpm
// (Brysbaert 2019 meta-analysis), plus a short scene-parse buffer before the
// eye finds the text. Clamped so no slide flashes or drags.
const WPM = 238;
const READ_SPEEDUP = 0.98; // "2% quicker than average"
const SCENE_BUFFER = 0.4;
const SLIDE_MIN = 1.5;
const SLIDE_MAX = 5.5;
const SKIM_WEIGHT = 0.4; // support/bullet lines get skimmed, not read linearly

function overlayWordCount(ov) {
  if (!ov) return 0;
  const count = (s) => (s ? String(s).split(/\s+/).filter(Boolean).length : 0);
  // Headlines/captions are read in full; support lines and recap bullets are
  // skimmed; the "TIP 3/10" eyebrow is a glanced label, not reading load.
  const full = count(ov.headline) + count(ov.title) + count(ov.text);
  const skim = [...(ov.support || []), ...(ov.items || [])].reduce((a, s) => a + count(s), 0);
  return full + skim * SKIM_WEIGHT;
}

function readingSeconds(words) {
  if (!words) return SLIDE_MIN;
  return Math.max(SLIDE_MIN, Math.min(SLIDE_MAX, SCENE_BUFFER + (words / WPM) * 60 * READ_SPEEDUP));
}

// ── ffmpeg: ALL slides + audio → one 9:16 slideshow Reel ────────────────────
// Per-slide duration = reading time of that slide's overlay text (2% quicker
// than the average reader), then snapped to the nearest whole beat of the
// sound so every cut still rides the song. Slides with no/short text run
// fast. Total is scaled down if it would exceed IG's 90s Reel ceiling; audio
// loops to cover the full video.
function buildSlideshowVideo(slideSpecs, audioPath, outPath, fallbackSec) {
  const REEL_MAX = 90;
  const bpm = detectBPM(audioPath);
  const spb = bpm ? 60 / bpm : null;

  let durs = slideSpecs.map((s) => {
    const want = s.words != null ? readingSeconds(s.words) : Math.max(SLIDE_MIN, fallbackSec);
    if (!spb) return want;
    const beats = Math.max(2, Math.round(want / spb));
    return beats * spb;
  });
  let total = durs.reduce((a, b) => a + b, 0);
  if (total > REEL_MAX) {
    const k = REEL_MAX / total;
    durs = durs.map((d) => d * k);
    total = REEL_MAX;
  }
  const audioDur = probeDuration(audioPath);

  const args = ["-y"];
  slideSpecs.forEach((s, i) => args.push("-loop", "1", "-t", durs[i].toFixed(2), "-framerate", "30", "-i", s.path));
  args.push("-stream_loop", "-1", "-i", audioPath);

  // Normalize every slide to 1080x1920 (Reels are full 9:16) then concat.
  const norm = slideSpecs
    .map((_, i) => `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p[v${i}]`)
    .join(";");
  const concat = slideSpecs.map((_, i) => `[v${i}]`).join("") + `concat=n=${slideSpecs.length}:v=1:a=0[v]`;
  args.push(
    "-filter_complex", `${norm};${concat}`,
    "-map", "[v]", "-map", `${slideSpecs.length}:a`,
    "-t", total.toFixed(2),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", "30",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    "-shortest",
    outPath,
  );
  execFileSync("ffmpeg", args, { stdio: "pipe", timeout: 300000 });
  return { audioDur, target: total, durs, bpm };
}

// ── Insforge storage upload (mirrors src/lib/insforge/storage.ts) ────────────
async function uploadToInsforge(localPath, contentType) {
  if (!INSFORGE_BASE || !INSFORGE_KEY) throw new Error("Insforge storage not configured");
  // Unique per upload — same-named files from concurrent cron jobs raced in
  // Insforge and swapped URLs (megan video on danny tiktok, 2026-07-08).
  const filename = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${path.basename(localPath)}`;
  const buf = fs.readFileSync(localPath);
  const auth = { Authorization: `Bearer ${INSFORGE_KEY}` };

  const strat = await fetch(`${INSFORGE_BASE}/api/storage/buckets/${BUCKET}/upload-strategy`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType, size: buf.length }),
  });
  if (!strat.ok) throw new Error(`Upload strategy failed (${strat.status})`);
  const s = await strat.json();

  if (s.method === "presigned") {
    const fd = new FormData();
    for (const [k, v] of Object.entries(s.fields ?? {})) fd.append(k, v);
    fd.append("file", new Blob([buf], { type: contentType }), filename);
    const up = await fetch(s.uploadUrl, { method: "POST", body: fd });
    if (up.status < 200 || up.status >= 300) throw new Error(`Storage upload failed (${up.status})`);
    const cf = await fetch(`${INSFORGE_BASE}${s.confirmUrl}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ size: buf.length, contentType }),
    });
    if (!cf.ok) throw new Error(`Upload confirm failed (${cf.status})`);
    return (await cf.json()).url;
  }
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: contentType }), filename);
  const up = await fetch(`${INSFORGE_BASE}${s.uploadUrl}`, { method: "PUT", headers: auth, body: fd });
  if (!up.ok) throw new Error(`Storage upload failed (${up.status})`);
  const j = await up.json().catch(() => ({}));
  return j.url || `${INSFORGE_BASE}/api/storage/buckets/${BUCKET}/objects/${s.key}`;
}

// ── Zernio ───────────────────────────────────────────────────────────────────
async function zernio(pathname, init = {}) {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) throw new Error("ZERNIO_API_KEY not set");
  const res = await fetch(`${ZERNIO_BASE}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Zernio ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}

async function main() {
  const opts = parseArgs();
  const persona = await loadPersona(ROOT_DIR, opts.persona);
  const igAccountId = persona.accounts?.instagram;
  if (!igAccountId) throw new Error(`Persona '${persona.slug}' has no Instagram account`);

  const sidecarPath = resolveSidecar(opts.carousel, persona);
  const dir = path.dirname(sidecarPath);
  const meta = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
  const slides = meta.slides || [];
  if (slides.length < 2) throw new Error("Carousel needs at least 2 slides");
  for (const s of slides) {
    if (!fs.existsSync(s.localPath)) throw new Error(`Missing slide: ${s.localPath}`);
  }

  const caption = meta.caption?.instagram || "";
  const hashtags = (meta.hashtags || []).join(" ");
  // SEO captions (Kevin 2026-07-08): keyword-rich description tells IG's
  // algo who to show the carousel to — sidecar caption is seed + fallback.
  const seo = await writeSeoCaptions({
    persona: { name: persona.name, voice: persona.voice, niche: persona.niche },
    topic: meta.topic,
    onScreenTexts: slides.map((s) => s.overlayText).filter(Boolean).slice(0, 12),
    seedCaptions: { instagram: caption, tiktok: meta.caption?.tiktok || caption },
    hashtags: meta.hashtags || [],
  });
  const igFull = seo.generated ? seo.instagram : caption + (hashtags ? `\n\n${hashtags}` : "");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });

  try {
    const sound = await pickSound(pool, opts.sound, opts.soundGender);

    console.log(`\n=== INSTAGRAM ${opts.slideshow ? "SLIDESHOW REEL" : opts.reel ? "REEL" : "CAROUSEL"} + TRENDING SOUND (${persona.name}) ===`);
    console.log(`Carousel: ${meta.carousel_id || path.basename(dir)}`);
    console.log(
      opts.slideshow
        ? `Slides:   ALL ${slides.length} → one 9:16 video, posted as a Reel`
        : opts.reel
          ? `Slides:   1 of ${slides.length} (sound video posts alone as a Reel)`
          : `Slides:   ${slides.length} (slide 1 becomes the sound video)`,
    );
    console.log(`Sound:    ${sound.title} — ${sound.author} (${sound.duration}s, id ${sound.id})`);
    console.log(`IG acct:  ${igAccountId}  profile: ${persona.profileId}`);
    console.log(`Mode:     ${opts.schedule ? `SCHEDULE ${opts.schedule}` : opts.publish ? "PUBLISH NOW" : "DRY RUN"}`);
    console.log(`\n--- Caption ---\n${igFull}\n`);

    // 1. Download the sound + build the first-slide video (dry-run builds too,
    //    so the output can be reviewed locally before going live).
    const tmpAudio = path.join(os.tmpdir(), `igsound-${sound.id}.m4a`);
    const audioRes = await fetch(sound.audio_url);
    if (!audioRes.ok) throw new Error(`Audio download failed (${audioRes.status})`);
    fs.writeFileSync(tmpAudio, Buffer.from(await audioRes.arrayBuffer()));

    let videoPath, audioDur, target;
    if (opts.slideshow) {
      videoPath = path.join(dir, "slideshow-reel.mp4");
      console.log(`[1/4] Building ${slides.length}-slide slideshow Reel (ffmpeg)…`);
      // Per-slide overlay text (for reading-speed pacing) lives in the
      // overlays spec next to the sidecar; without it, fall back to a fast
      // uniform pace.
      let overlayByIdx = null;
      const overlaysPath = path.join(dir, "overlays.json");
      if (fs.existsSync(overlaysPath)) {
        try { overlayByIdx = JSON.parse(fs.readFileSync(overlaysPath, "utf8")).slides || null; } catch { /* fall back */ }
      }
      const specs = slides.map((s) => ({
        path: s.localPath,
        words: overlayByIdx ? overlayWordCount(overlayByIdx[s.index - 1]) : null,
      }));
      const r = buildSlideshowVideo(specs, tmpAudio, videoPath, opts.secPerSlide);
      audioDur = r.audioDur; target = r.target;
      const beatNote = r.bpm ? `${r.bpm} BPM, cuts on the beat grid` : "no clear pulse, fixed pace";
      const dmin = Math.min(...r.durs), dmax = Math.max(...r.durs);
      console.log(`  ${slides.length} slides, ${dmin.toFixed(1)}–${dmax.toFixed(1)}s each by reading speed (238wpm −2%) = ${target.toFixed(1)}s @1080x1920 (${beatNote}), audio ${audioDur.toFixed(1)}s (looped) → ${path.basename(videoPath)}`);
      console.log(`  per-slide: ${r.durs.map((d) => d.toFixed(1)).join(" ")}`);
    } else {
      videoPath = path.join(dir, "slide-01-sound.mp4");
      console.log(`[1/4] Building first-slide video (ffmpeg)…`);
      const r = buildSoundVideo(slides[0].localPath, tmpAudio, videoPath);
      audioDur = r.audioDur; target = r.target;
      console.log(`  audio ${audioDur.toFixed(1)}s → video ${target.toFixed(1)}s @1080x1350 → ${path.basename(videoPath)}`);
    }
    fs.unlinkSync(tmpAudio);

    if (!opts.publish && !opts.schedule) {
      console.log(`\n[DRY RUN] Video built for review: ${videoPath}`);
      console.log(
        opts.slideshow
          ? `Would upload the slideshow video, then POST /posts as a Reel.`
          : `Would upload video + ${slides.length - 1} images, then POST /posts (video first).`,
      );
      console.log(`To go live: add --publish`);
      return;
    }

    // 2. Upload video + remaining slides (video only in --reel/--slideshow modes).
    console.log(`[2/4] Uploading media to Insforge…`);
    const mediaItems = [];
    const videoUrl = await uploadToInsforge(videoPath, "video/mp4");
    mediaItems.push({ type: "video", url: videoUrl });
    console.log(`  video: ${videoUrl}`);
    if (!opts.reel && !opts.slideshow) {
      for (const s of slides.slice(1)) {
        // IG feed images must be ≤4:5 (0.75). 9:16 renders (TikTok format) get
        // a centered cover-crop to 1080×1350 — same treatment the sound video
        // already receives — so one render pipeline can feed both platforms.
        let uploadPath = s.localPath;
        const [w, h] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0",
          "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", s.localPath,
        ]).toString().trim().split("x").map(Number);
        if (w && h && h / w > 1.26) {
          uploadPath = path.join(os.tmpdir(), `ig-crop-${path.basename(s.localPath)}`);
          execFileSync("ffmpeg", ["-y", "-i", s.localPath,
            "-vf", "scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350,setsar=1",
            uploadPath], { stdio: "pipe", timeout: 60000 });
          console.log(`  slide ${s.index}: cover-cropped ${w}x${h} → 1080x1350 for IG`);
        }
        const url = await uploadToInsforge(uploadPath, "image/png");
        mediaItems.push({ type: "image", url });
        console.log(`  slide ${s.index}: ${url}`);
      }
    }

    // 3. Publish. Instagram picks the format from the media: a single video
    // becomes a REEL (contentType:'reels' + shareToFeed makes that explicit
    // and puts it on the profile feed too); multiple items are a feed
    // carousel, which the API cannot publish as a Reel — there we still send
    // shareToFeed (ignored on feed posts, per Zernio's Instagram schema).
    const isReel = mediaItems.length === 1 && mediaItems[0].type === "video";
    const platformSpecificData = isReel
      ? { contentType: "reels", shareToFeed: true }
      : { shareToFeed: true };
    // Tracked App Store link as the auto first comment (Kevin 07-28: CTA link
    // on every post, tracked per source). IG comment links aren't tappable but
    // the /go slug still logs whoever copies it, and the comment doubles as a
    // "link in bio" pointer.
    platformSpecificData.firstComment =
      `Download Creator OS (link in bio 📲): https://your-app.up.railway.app/go/${persona.slug}-ig`;
    // Branded Reels cover via Zernio's REAL thumbnail field (Kevin
    // 2026-07-14: the baked-first-frame hack "looks terrible" — a static
    // card flashed at the start of every reel). thumbnailUrl in the IG
    // platformSpecificData is proven working (top5-danny reel, kai factory);
    // the video ships untouched. Layout: CreatorOS tile + persona avatar +
    // Claude tile, headline at the bottom, silver/black/cyan.
    if (isReel) {
      try {
        const { buildReelThumbnail } = require("../../../lib/reel-thumbnail");
        const headline = String(meta.topic || meta.caption?.instagram || "creator growth advice")
          .split("\n")[0].replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "").trim();
        const words = headline.split(/\s+/);
        const mid = Math.ceil(words.length * 0.6);
        const thumbPath = path.join(os.tmpdir(), `reel-cover-${Date.now()}.png`);
        await buildReelThumbnail({
          persona: persona.slug,
          line1: words.slice(0, mid).join(" "),
          line2: words.slice(mid).join(" ") || "CREATOR OS",
          out: thumbPath,
        });
        platformSpecificData.thumbnailUrl = await uploadToInsforge(thumbPath, "image/png");
        console.log(`  ✓ branded cover attached via thumbnailUrl`);
      } catch (e) {
        console.warn(`  ! Reels cover failed (${String(e.message).slice(0, 80)}) — posting without`);
      }
    }

    console.log(`[3/4] ${opts.schedule ? "Scheduling" : "Publishing"} via Zernio (${isReel ? "REEL" : "feed carousel"})…`);
    const body = {
      profileId: persona.profileId,
      content: igFull,
      mediaItems,
      platforms: [
        { platform: "instagram", accountId: igAccountId, platformSpecificData },
      ],
    };
    if (opts.schedule) body.scheduledFor = new Date(opts.schedule).toISOString();
    else body.publishNow = true;

    const result = await zernio("/posts", { method: "POST", body: JSON.stringify(body) });
    const postId = result.post?._id || result.post?.id || result._id || result.id || null;
    console.log(`  Zernio post id: ${postId}`);

    // 4. Record: sound rotation + sidecar.
    console.log(`[4/4] Recording…`);
    await markSoundUsed(pool, sound.id);
    meta.instagram = {
      zernio_post_id: postId,
      sound: { id: sound.id, title: sound.title, author: sound.author, video_seconds: target },
      published_at: opts.schedule ? null : new Date().toISOString(),
      scheduled_for: opts.schedule || null,
    };
    if (!meta.published_at && !opts.schedule) meta.published_at = meta.instagram.published_at;
    fs.writeFileSync(sidecarPath, JSON.stringify(meta, null, 2));
    console.log(`  sound marked used · sidecar stamped`);

    // content_posts row — the Insforge record the automations timeline verifies.
    try {
      await pool.query(`create table if not exists content_posts (
        id bigserial primary key, persona text, carousel_id text, zernio_post_id text,
        content text, media_urls jsonb, platforms jsonb, status text,
        scheduled_for timestamptz, posted_at timestamptz, metadata jsonb,
        created_at timestamptz not null default now())`);
      await pool.query(
        `insert into content_posts (persona, carousel_id, zernio_post_id, content, media_urls, platforms, status, scheduled_for, posted_at, metadata)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          persona.slug,
          meta.carousel_id || path.basename(dir),
          postId,
          igFull,
          JSON.stringify(mediaItems.map((m) => m.url)),
          JSON.stringify(["instagram"]),
          opts.schedule ? "scheduled" : "published",
          opts.schedule ? new Date(opts.schedule).toISOString() : null,
          opts.schedule ? null : new Date().toISOString(),
          JSON.stringify({ topic: meta.topic, reel: isReel, sound: { id: sound.id, title: sound.title } }),
        ],
      );
      console.log(`  recorded in content_posts (persona=${persona.slug})`);
    } catch (e) {
      console.error(`  ! content_posts record failed (post is live): ${e.message}`);
    }

    // Confirm platform status (publishing is async on Zernio's side).
    for (let i = 0; i < 6 && postId; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const check = await zernio(`/posts/${postId}`).catch(() => null);
      const post = check?.post ?? check;
      const ig = post?.platforms?.find((p) => p.platform === "instagram");
      const st = ig?.status ?? post?.status;
      console.log(`  status: ${st}${ig?.platformPostUrl ? ` → ${ig.platformPostUrl}` : ""}`);
      if (st === "published" || st === "failed") break;
    }

    console.log(`\n✅ done`);
  } finally {
    await pool.end();
    await closePersonaPool();
  }
}

main().catch(async (e) => {
  console.error(`\n✗ ${e.message}`);
  await closePersonaPool().catch(() => {});
  process.exit(1);
});
