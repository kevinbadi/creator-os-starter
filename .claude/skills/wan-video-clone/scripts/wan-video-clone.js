#!/usr/bin/env node
/**
 * wan-video-clone.js — Full AI video clone pipeline with chunking.
 *
 * Takes Kevin's video → outputs Kev's Assistant's version.
 *
 * Pipeline:
 *   1. Download/prepare source video
 *   2. ffmpeg split into ~5s chunks
 *   3. Extract one frame → face swap to Kev's Assistant (Nano Banana Pro)
 *   4. For each chunk:
 *      a. Extract audio (ffmpeg local)
 *      b. Voice clone → Kev's Assistant voice (ChatterboxHD via fal.ai)
 *      c. Merge cloned audio back (ffmpeg local)
 *      d. Upload merged chunk
 *      e. WAN 2.2 animate/replace (fal.ai) → Kev's Assistant video chunk
 *      f. Download output chunk
 *   5. ffmpeg stitch all output chunks
 *   6. Store result
 *
 * Usage:
 *   node wan-video-clone.js --video "https://example.com/video.mp4"
 *   node wan-video-clone.js --video /path/to/local.mp4
 *   node wan-video-clone.js --video "URL" --dry-run
 *   node wan-video-clone.js --video "URL" --chunk-duration 5
 *   node wan-video-clone.js --video "URL" --parallel 2
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const fs = require("fs");
const { assertFal } = require("../../../lib/fal-gate.js");
const path = require("path");
const { execSync, exec } = require("child_process");

// ─── Args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}
function hasFlag(name) { return args.includes(name); }

const videoInput = getArg("--video");
const facePrompt = getArg("--prompt") || "Replace the person in this image with Kev's Assistant, a futuristic AI avatar. Keep the pose, background, and lighting identical.";
const kevsImageUrl = getArg("--kevs-image") || null;
const kevsVoiceUrl = getArg("--kevs-voice") || null;
const resolution = getArg("--resolution") || "720p";
const chunkDuration = parseInt(getArg("--chunk-duration") || "30", 10);
const parallelLimit = parseInt(getArg("--parallel") || "1", 10);
const dryRun = hasFlag("--dry-run");
const skipVoice = hasFlag("--skip-voice");
const skipFaceSwap = hasFlag("--skip-face-swap");
const faceImageUrl = getArg("--face-image") || null; // Lock in a specific face image for consistency
const outputDir = getArg("--output") || path.join(__dirname, "../../../output/wan-clones");

assertFal("wan-video-clone");
const FAL_KEY = process.env.FAL_KEY;
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
const ASSETS_DIR = path.join(__dirname, "../assets");

// ─── Helpers ─────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function timestamp() { return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); }
function log(msg) { process.stderr.write(`${msg}\n`); }
function logInline(msg) { process.stderr.write(`\r${msg}`); }

function ffmpeg(cmd) {
  return execSync(`ffmpeg -y -hide_banner -loglevel error ${cmd}`, {
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

function ffprobe(file, field) {
  return execSync(
    `ffprobe -v error -show_entries format=${field} -of default=noprint_wrappers=1:nokey=1 "${file}"`,
    { encoding: "utf8" }
  ).trim();
}

// ─── Upload to fal.ai storage ────────────────────────────────────────
async function uploadToFal(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1);
  const mimeMap = {
    mp4: "video/mp4", mp3: "audio/mpeg", wav: "audio/wav",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp"
  };
  const mime = mimeMap[ext] || "application/octet-stream";
  const fileName = path.basename(filePath);

  // fal.ai REST storage
  const initRes = await fetch("https://rest.alpha.fal.ai/storage/upload/initiate", {
    method: "POST",
    headers: { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ file_name: fileName, content_type: mime }),
  });
  if (!initRes.ok) throw new Error(`fal upload init failed: ${initRes.status} ${await initRes.text()}`);
  const initData = await initRes.json();

  const uploadRes = await fetch(initData.upload_url, {
    method: "PUT",
    headers: { "Content-Type": mime },
    body: fileBuffer,
  });
  if (!uploadRes.ok) throw new Error(`fal upload PUT failed: ${uploadRes.status}`);
  return initData.file_url;
}

// ─── fal.ai queue helpers ────────────────────────────────────────────
async function falSubmit(endpoint, body) {
  const res = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: "POST",
    headers: { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`fal submit (${endpoint}): ${res.status} ${await res.text()}`);
  return res.json();
}

async function falPoll(endpoint, requestId, maxWaitMs = 1800000) {
  const statusUrl = `https://queue.fal.run/${endpoint}/requests/${requestId}/status`;
  const resultUrl = `https://queue.fal.run/${endpoint}/requests/${requestId}`;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(statusUrl, {
        headers: { "Authorization": `Key ${FAL_KEY}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "COMPLETED") {
          const rr = await fetch(resultUrl, { headers: { "Authorization": `Key ${FAL_KEY}` } });
          if (rr.ok) return rr.json();
        }
        if (data.status === "FAILED") throw new Error(`fal job failed: ${JSON.stringify(data)}`);
        const elapsed = Math.round((Date.now() - start) / 1000);
        logInline(`    ⏳ ${data.status} (${elapsed}s)...`);
      }
    } catch (e) {
      if (e.message.includes("fal job failed")) throw e;
    }
    await sleep(15000);
  }
  throw new Error(`fal timed out after ${maxWaitMs / 1000}s`);
}

// ─── Download ────────────────────────────────────────────────────────
async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${url}): ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer);
  return destPath;
}

// ─── Video splitting ─────────────────────────────────────────────────
function getVideoDuration(filePath) {
  return parseFloat(ffprobe(filePath, "duration"));
}

function splitVideo(inputPath, chunkSec, outDir) {
  fs.mkdirSync(outDir, { recursive: true });

  // Check source codec — if not H.264, re-encode during split
  let codec;
  try {
    codec = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`,
      { encoding: "utf8" }
    ).trim();
  } catch { codec = "unknown"; }

  log(`  Source codec: ${codec}`);

  if (codec === "h264") {
    // Fast copy split
    ffmpeg(`-i "${inputPath}" -c copy -f segment -segment_time ${chunkSec} -reset_timestamps 1 "${outDir}/chunk_%03d.mp4"`);
  } else {
    // Re-encode to H.264 during split (WAN requires H.264, AV1/VP9 cause hangs)
    log(`  ⚠️ Re-encoding from ${codec} to H.264 during split...`);
    ffmpeg(`-i "${inputPath}" -c:v libx264 -preset fast -crf 23 -c:a aac -f segment -segment_time ${chunkSec} -reset_timestamps 1 "${outDir}/chunk_%03d.mp4"`);
  }

  const chunks = fs.readdirSync(outDir)
    .filter(f => f.startsWith("chunk_") && f.endsWith(".mp4"))
    .sort()
    .map(f => path.join(outDir, f));

  return chunks;
}

function extractFrame(videoPath, outputPath, timeSec = 0.5) {
  ffmpeg(`-i "${videoPath}" -ss ${timeSec} -vframes 1 -q:v 2 "${outputPath}"`);
  return outputPath;
}

function extractAudio(videoPath, audioPath) {
  ffmpeg(`-i "${videoPath}" -vn -acodec libmp3lame -q:a 2 "${audioPath}"`);
  return audioPath;
}

function mergeAudioVideo(videoPath, audioPath, outputPath) {
  // Replace video's audio with new audio, match shortest duration
  ffmpeg(`-i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest "${outputPath}"`);
  return outputPath;
}

function stitchVideos(chunkPaths, outputPath) {
  // Create concat list file
  const listPath = path.join(path.dirname(outputPath), "concat_list.txt");
  const listContent = chunkPaths.map(p => `file '${p}'`).join("\n");
  fs.writeFileSync(listPath, listContent);

  ffmpeg(`-f concat -safe 0 -i "${listPath}" -c copy "${outputPath}"`);
  fs.unlinkSync(listPath);
  return outputPath;
}

// ─── Process a single chunk ──────────────────────────────────────────
async function processChunk(chunkPath, chunkIndex, totalChunks, kevsImageUrlForWan, workDir) {
  const prefix = `  [${chunkIndex + 1}/${totalChunks}]`;
  const chunkName = path.basename(chunkPath, ".mp4");
  const chunkWorkDir = path.join(workDir, chunkName);
  fs.mkdirSync(chunkWorkDir, { recursive: true });

  log(`${prefix} 🎬 Processing ${chunkName}...`);

  // 4a. Extract audio locally
  log(`${prefix}   🎵 Extracting audio...`);
  const audioPath = path.join(chunkWorkDir, "audio.mp3");
  extractAudio(chunkPath, audioPath);

  // 4b. Voice clone
  let clonedAudioUrl;
  if (!skipVoice && kevsVoiceUrl_global) {
    log(`${prefix}   🗣️ Cloning voice...`);
    const audioUrl = await uploadToFal(audioPath);

    const voiceSub = await falSubmit("resemble-ai/chatterboxhd/speech-to-speech", {
      source_audio_url: audioUrl,
      target_voice_audio_url: kevsVoiceUrl_global,
    });
    log(`${prefix}   ⏳ Voice clone request: ${voiceSub.request_id}`);
    const voiceRes = await falPoll("resemble-ai/chatterboxhd", voiceSub.request_id, 600000);
    clonedAudioUrl = voiceRes.audio?.url || voiceRes.output?.url;
    log(`${prefix}   ✅ Voice cloned`);
  } else {
    log(`${prefix}   ⏭️ Skipping voice clone`);
    clonedAudioUrl = null;
  }

  // 4c. Merge cloned audio back with video chunk
  let mergedChunkUrl;
  if (clonedAudioUrl) {
    log(`${prefix}   🔗 Merging cloned audio...`);
    const clonedAudioPath = path.join(chunkWorkDir, "cloned_audio.mp3");
    await downloadFile(clonedAudioUrl, clonedAudioPath);
    const mergedPath = path.join(chunkWorkDir, "merged.mp4");
    mergeAudioVideo(chunkPath, clonedAudioPath, mergedPath);
    mergedChunkUrl = await uploadToFal(mergedPath);
  } else {
    mergedChunkUrl = await uploadToFal(chunkPath);
  }

  // 4d. WAN 2.2 animate/replace
  log(`${prefix}   🎬 WAN 2.2 animate (this takes ~15-20min)...`);
  const wanSub = await falSubmit("fal-ai/wan/v2.2-14b/animate/replace", {
    video_url: mergedChunkUrl,
    image_url: kevsImageUrlForWan,
    resolution: resolution,
  });
  log(`${prefix}   ⏳ WAN request: ${wanSub.request_id}`);
  const wanRes = await falPoll("fal-ai/wan", wanSub.request_id, 5400000); // 90 min timeout
  const outputVideoUrl = wanRes.video?.url || wanRes.output?.url;
  log(`${prefix}   ✅ WAN complete`);

  // 4e. Download output chunk
  const outputChunkPath = path.join(chunkWorkDir, "output.mp4");
  await downloadFile(outputVideoUrl, outputChunkPath);
  log(`${prefix}   💾 Saved: ${outputChunkPath}`);

  return outputChunkPath;
}

// Global ref for voice URL (set in main)
let kevsVoiceUrl_global = null;

// ─── Parallel runner with concurrency limit ──────────────────────────
async function runParallel(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(limit, tasks.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────
(async () => {
  log("🎬 WAN 2.2 Video Clone Pipeline (Chunked)");
  log("=".repeat(55));

  if (!videoInput) { log("❌ --video is required"); process.exit(1); }
  if (!FAL_KEY) { log("❌ FAL_KEY env var not set"); process.exit(1); }

  const startTime = Date.now();
  const runId = timestamp();
  const workDir = path.join(outputDir, runId);
  fs.mkdirSync(workDir, { recursive: true });

  log(`📁 Work dir: ${workDir}`);
  log(`🎥 Source: ${videoInput}`);
  log(`⏱️ Chunk duration: ${chunkDuration}s`);
  log(`🖼️ Resolution: ${resolution}`);
  log(`🔀 Parallel: ${parallelLimit}`);
  if (dryRun) log("🏃 DRY RUN MODE");

  // ── Prepare source video locally ──
  let localVideoPath;
  if (videoInput.startsWith("http")) {
    log("\n⬇️ Downloading source video...");
    localVideoPath = path.join(workDir, "source.mp4");
    if (!dryRun) await downloadFile(videoInput, localVideoPath);
  } else {
    localVideoPath = path.resolve(videoInput);
    if (!dryRun && !fs.existsSync(localVideoPath)) {
      log(`❌ File not found: ${localVideoPath}`);
      process.exit(1);
    }
  }

  if (!dryRun) {
    const duration = getVideoDuration(localVideoPath);
    const estimatedChunks = Math.ceil(duration / chunkDuration);
    log(`📏 Video duration: ${duration.toFixed(1)}s → ~${estimatedChunks} chunks`);
  }

  // ── Prepare Kev's Assistant assets ──
  // Kev's Assistant face image
  let kevsImage = kevsImageUrl;
  if (!kevsImage && !skipFaceSwap) {
    const localImg = path.join(ASSETS_DIR, "kevs-reference.png");
    if (fs.existsSync(localImg)) {
      log("\n📤 Uploading Kev's Assistant reference image...");
      if (!dryRun) {
        kevsImage = await uploadToFal(localImg);
        log(`  ✅ ${kevsImage}`);
      }
    } else {
      log(`⚠️ No Kev's Assistant reference image at ${localImg}`);
    }
  }

  // Kev's Assistant voice sample
  kevsVoiceUrl_global = kevsVoiceUrl;
  if (!kevsVoiceUrl_global && !skipVoice) {
    const localVoice = path.join(ASSETS_DIR, "kevs-voice-sample.mp3");
    if (fs.existsSync(localVoice)) {
      log("📤 Uploading Kev's Assistant voice sample...");
      if (!dryRun) {
        kevsVoiceUrl_global = await uploadToFal(localVoice);
        log(`  ✅ ${kevsVoiceUrl_global}`);
      }
    } else {
      log(`⚠️ No voice sample at ${localVoice} — skipping voice clone`);
    }
  }

  // ── Dry run ──
  if (dryRun) {
    log("\n🏃 DRY RUN — Pipeline steps:");
    log("  1. Download source video");
    log(`  2. Split into ~${chunkDuration}s chunks (ffmpeg)`);
    log("  3. Extract frame → face swap to Kev's Assistant (Nano Banana Pro)");
    log("  4. For each chunk:");
    log("     a. Extract audio (ffmpeg local)");
    log("     b. Voice clone → Kev's Assistant (ChatterboxHD)");
    log("     c. Merge cloned audio (ffmpeg local)");
    log("     d. Upload merged chunk to fal.ai");
    log("     e. WAN 2.2 animate/replace → Kev's Assistant chunk");
    log("     f. Download output chunk");
    log("  5. Stitch all output chunks (ffmpeg)");
    log("  6. Output final Kev's Assistant video");
    console.log(JSON.stringify({ dryRun: true, chunkDuration, resolution, parallelLimit }));
    process.exit(0);
  }

  try {
    // ════════════════════════════════════════════
    // STEP 1: Split video into chunks
    // ════════════════════════════════════════════
    log("\n✂️ STEP 1: Splitting video into chunks...");
    const chunksDir = path.join(workDir, "chunks");
    const chunkPaths = splitVideo(localVideoPath, chunkDuration, chunksDir);
    log(`  ✅ Created ${chunkPaths.length} chunks`);

    for (const cp of chunkPaths) {
      const dur = getVideoDuration(cp);
      log(`     ${path.basename(cp)}: ${dur.toFixed(1)}s`);
    }

    // ════════════════════════════════════════════
    // STEP 2: Face swap — get Kev's Assistant face image
    // ════════════════════════════════════════════
    let kevsImageForWan;

    if (faceImageUrl) {
      // Use a locked-in face image for consistency across all chunks
      kevsImageForWan = faceImageUrl;
      log("\n🎭 STEP 2: Using locked face image (--face-image)");
      log(`  ✅ ${faceImageUrl}`);
    } else if (skipFaceSwap && kevsImage) {
      // Use the Kev's Assistant reference image directly (no face swap needed)
      kevsImageForWan = kevsImage;
      log("\n🎭 STEP 2: Using Kev's Assistant reference image directly (--skip-face-swap)");
    } else {
      log("\n🎭 STEP 2: Face swap via Nano Banana Pro...");
      // Extract a clean frame from the first chunk
      const framePath = path.join(workDir, "source_frame.jpg");
      extractFrame(chunkPaths[0], framePath, 0.5);
      const frameUrl = await uploadToFal(framePath);
      log(`  📸 Frame extracted & uploaded: ${frameUrl}`);

      // Face swap
      const faceBody = {
        prompt: facePrompt,
        image_urls: kevsImage ? [frameUrl, kevsImage] : [frameUrl],
      };
      const faceSub = await falSubmit("fal-ai/nano-banana-pro/edit", faceBody);
      log(`  ⏳ Face swap request: ${faceSub.request_id}`);
      const faceRes = await falPoll("fal-ai/nano-banana", faceSub.request_id, 300000);
      kevsImageForWan = faceRes.images?.[0]?.url || faceRes.output?.url;
      log(`\n  ✅ Face swapped: ${kevsImageForWan}`);

      // Save locally
      await downloadFile(kevsImageForWan, path.join(workDir, "kevs_face.jpg"));
    }

    // ════════════════════════════════════════════
    // STEP 3: Process each chunk through pipeline
    // ════════════════════════════════════════════
    log(`\n🔄 STEP 3: Processing ${chunkPaths.length} chunks (parallel: ${parallelLimit})...\n`);

    const tasks = chunkPaths.map((cp, i) => () =>
      processChunk(cp, i, chunkPaths.length, kevsImageForWan, workDir)
    );

    const outputChunks = await runParallel(tasks, parallelLimit);

    log(`\n  ✅ All ${outputChunks.length} chunks processed`);

    // ════════════════════════════════════════════
    // STEP 4: Stitch chunks together
    // ════════════════════════════════════════════
    log("\n🧵 STEP 4: Stitching chunks together...");
    const finalPath = path.join(workDir, `kevs-assistant-clone-${runId}.mp4`);

    if (outputChunks.length === 1) {
      // Single chunk, just copy
      fs.copyFileSync(outputChunks[0], finalPath);
    } else {
      stitchVideos(outputChunks, finalPath);
    }

    const finalDuration = getVideoDuration(finalPath);
    const pipelineDuration = Math.round((Date.now() - startTime) / 1000);

    log(`  ✅ Final video: ${finalPath}`);
    log(`  📏 Duration: ${finalDuration.toFixed(1)}s`);

    log(`\n${"=".repeat(55)}`);
    log(`🎉 Pipeline complete in ${pipelineDuration}s (~${Math.round(pipelineDuration / 60)}min)`);
    log(`📁 Output: ${finalPath}`);

    console.log(JSON.stringify({
      status: "completed",
      outputPath: finalPath,
      chunks: outputChunks.length,
      videoDuration: finalDuration,
      pipelineDuration,
      resolution,
    }));

  } catch (err) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    log(`\n❌ Pipeline failed: ${err.message}`);
    log(err.stack);
    console.log(JSON.stringify({ status: "failed", error: err.message, duration }));
    process.exit(1);
  }
})();
