#!/usr/bin/env node
/**
 * stories-gen — Vertical story frame pipeline
 *
 * 1. Gemini generates story concept (topic, 3-5 frames, per-frame text + image prompts)
 * 2. FAL nano-banana-2 generates each frame at 9:16 aspect ratio
 * 3. ffmpeg drawtext overlays text centered on each frame
 * 4. ffmpeg stitches all frames into a 15-second MP4 with crossfade transitions
 * 5. Output saved to ~/{PersonaName}/stories/{date}-{slug}/
 */

const { execSync } = require('child_process');
const { assertFal } = require("../../../lib/fal-gate.js");
const fs = require('fs');
const path = require('path');
const { loadPersonaContext, getOutputDir } = require('../../../lib/persona');

// ============================================================================
// Config
// ============================================================================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
assertFal("stories-gen");
const FAL_KEY = process.env.FAL_KEY;

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const persona = loadPersonaContext(ROOT_DIR);
const REF_IMAGE = path.join(ROOT_DIR, 'brand-content', 'reference-hero.png');
const OUTPUT_BASE = getOutputDir('stories', ROOT_DIR);
const LAST_PILLAR_PATH = path.join(OUTPUT_BASE, '.last-pillar');

// ============================================================================
// Topic Bank (from INFORMATION.md)
// ============================================================================

const TOPICS = [
  { topic: "Samoa's Best Beaches", pillar: 'adventure', hook: "Samoa has beaches that don't even look real." },
  { topic: 'To Sua Ocean Trench', pillar: 'hidden-samoa', hook: 'Have you heard of the ocean trench you can swim in?' },
  { topic: 'Samoan Food Guide', pillar: 'local-life', hook: "Here's everything you need to eat in Samoa." },
  { topic: 'Sunday in Samoa', pillar: 'local-life', hook: "Sunday in Samoa hits different. Let me show you why." },
  { topic: "Samoa's Most Beautiful Waterfalls", pillar: 'hidden-samoa', hook: "These waterfalls are hidden deep in the Samoan jungle." },
  { topic: 'Savai\'i Island Guide', pillar: 'adventure', hook: "The biggest island in Samoa and most tourists skip it." },
  { topic: 'Fa\'asamoa — The Samoan Way', pillar: 'culture-education', hook: "The word fa'asamoa doesn't translate to English." },
  { topic: 'Beach Fale Stays', pillar: 'business-spotlight', hook: "What does a $40/night beach stay in the Pacific look like?" },
  { topic: 'First Time in Samoa Tips', pillar: 'travel-tips', hook: "Things I wish someone told me before visiting Samoa." },
  { topic: 'Samoan Tattoo Pe\'a and Malu', pillar: 'culture-education', hook: "Samoan tattoo is one of the most sacred practices in the world." },
  { topic: 'Apia City Guide', pillar: 'local-life', hook: "The capital of Samoa is tiny but full of surprises." },
  { topic: 'Snorkeling Samoa Coral Reefs', pillar: 'adventure', hook: "The coral reefs here look like someone photoshopped them." },
  { topic: 'Samoan Umu Earth Oven', pillar: 'local-life', hook: "The umu started at 5am. By noon, you understand everything." },
  { topic: 'Fire Knife Dance Siva Afi', pillar: 'culture-education', hook: "The fire knife dance originated in Samoa." },
  { topic: 'Getting Around Samoa', pillar: 'travel-tips', hook: "No Uber, no metro. Here's how you actually get around." },
];

const PILLARS = [
  'hidden-samoa', 'local-life', 'adventure',
  'business-spotlight', 'travel-tips', 'culture-education',
];

// ============================================================================
// CLI
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { topic: null, frames: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--topic': opts.topic = args[++i]; break;
      case '--frames': opts.frames = parseInt(args[++i]); break;
      case '--dry-run': opts.dryRun = true; break;
    }
  }
  return opts;
}

// ============================================================================
// Pillar Rotation
// ============================================================================

function getNextPillar() {
  if (fs.existsSync(LAST_PILLAR_PATH)) {
    const last = fs.readFileSync(LAST_PILLAR_PATH, 'utf8').trim();
    const idx = PILLARS.indexOf(last);
    return PILLARS[(idx + 1) % PILLARS.length];
  }
  return PILLARS[0];
}

function savePillar(pillar) {
  fs.writeFileSync(LAST_PILLAR_PATH, pillar);
}

function selectTopic(topicOverride) {
  if (topicOverride) {
    const match = TOPICS.find(t => t.topic.toLowerCase() === topicOverride.toLowerCase());
    if (match) return match;
    return { topic: topicOverride, pillar: getNextPillar(), hook: null };
  }
  const pillar = getNextPillar();
  const candidates = TOPICS.filter(t => t.pillar === pillar);
  if (candidates.length === 0) return TOPICS[Math.floor(Math.random() * TOPICS.length)];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ============================================================================
// Gemini — Generate Story Plan
// ============================================================================

async function generateStoryPlan(topicObj, frameCount) {
  const frameCountInstruction = frameCount
    ? `Create exactly ${frameCount} frames.`
    : 'Decide the optimal frame count (between 3 and 5).';

  const prompt = `You are creating a vertical story (Instagram/Facebook Stories format) for ${persona.name} — the brand persona for ${persona.brand}.
${persona.voice ? `\nVoice guide:\n${persona.voice}\n` : ''}

Topic: "${topicObj.topic}"
${topicObj.hook ? `Hook: "${topicObj.hook}"` : ''}
Pillar: ${topicObj.pillar}

${frameCountInstruction}

IMPORTANT — Stories are quick, punchy, and visual. The text across all frames must tell a MINI STORY — each frame continues where the last left off. Think of it like tapping through a story. Example flow:
- Frame 1: "This is Samoa"
- Frame 2: "Crystal clear water"
- Frame 3: "No crowds anywhere"
- Frame 4: "Add it to your list"

For each frame provide:
1. The overlay text — MAX 5 WORDS. Ultra-short, punchy, fits on one tap. This is critical for story format readability.
2. An image generation prompt describing the scene (vivid, specific, Samoa-related, VERTICAL 9:16 composition)
3. Whether the persona should appear in this frame — YES or NO. Use YES for intro/outro frames or when showing a person experiencing a place. Use NO for landscape shots, food close-ups, aerial views, cultural objects, etc. Most frames should be NO.

Format EXACTLY like this:

FRAME_COUNT: [number]

FRAME_1_TEXT: [overlay text]
FRAME_1_PROMPT: [image prompt]
FRAME_1_PERSONA: [YES or NO]

FRAME_2_TEXT: [overlay text]
FRAME_2_PROMPT: [image prompt]
FRAME_2_PERSONA: [YES or NO]

[...continue for all frames...]`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 2048 },
      }),
    }
  );

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini error: ${JSON.stringify(data)}`);

  // Parse frames
  const maxScan = 10;
  const frames = [];
  for (let i = 1; i <= maxScan; i++) {
    const textRe = new RegExp(`FRAME_${i}_TEXT:\\s*(.+)`, 'i');
    const promptRe = new RegExp(`FRAME_${i}_PROMPT:\\s*(.+)`, 'i');
    const personaRe = new RegExp(`FRAME_${i}_PERSONA:\\s*(YES|NO)`, 'i');
    const textMatch = text.match(textRe);
    const promptMatch = text.match(promptRe);
    const personaMatch = text.match(personaRe);
    if (textMatch && promptMatch) {
      frames.push({
        index: i,
        overlayText: textMatch[1].trim(),
        imagePrompt: promptMatch[1].trim(),
        includePersona: personaMatch ? personaMatch[1].toUpperCase() === 'YES' : false,
      });
    }
  }

  if (frames.length === 0) throw new Error('Gemini returned no parseable frames');

  return { frames, rawResponse: text };
}

// ============================================================================
// FAL nano-banana-2 — Generate Frame Images (9:16)
// ============================================================================

async function generateFrameImage(frame, outputPath) {
  const usePersona = frame.includePersona;
  const endpoint = usePersona
    ? 'https://fal.run/fal-ai/nano-banana-2/edit'
    : 'https://fal.run/fal-ai/nano-banana-2';

  console.log(`  [Frame ${frame.index}] Generating image (${usePersona ? 'with persona' : 'scene only'})...`);

  const body = {
    prompt: frame.imagePrompt,
    num_images: 1,
    resolution: '1K',
    aspect_ratio: '9:16',
    output_format: 'png',
    safety_tolerance: '5',
  };

  if (usePersona) {
    const refData = fs.readFileSync(REF_IMAGE);
    body.image_urls = [`data:image/png;base64,${refData.toString('base64')}`];
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`FAL API error ${response.status} for frame ${frame.index}: ${err}`);
  }

  const result = await response.json();
  const images = result.images || [];
  if (images.length === 0) throw new Error(`FAL returned no images for frame ${frame.index}`);

  const imgResponse = await fetch(images[0].url);
  const buffer = Buffer.from(await imgResponse.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  console.log(`  [Frame ${frame.index}] Saved raw image: ${path.basename(outputPath)}`);
  return { width: images[0].width, height: images[0].height, url: images[0].url };
}

// ============================================================================
// ffmpeg — Text Overlay (centered vertically for stories)
// ============================================================================

function overlayText(inputPath, outputPath, text) {
  const escaped = text
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "\u2019")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%')
    .replace(/\$/g, '\\$');

  // Stories text: larger font, centered vertically
  const charCount = text.length;
  let fontsize;
  if (charCount <= 10) fontsize = 96;
  else if (charCount <= 15) fontsize = 80;
  else if (charCount <= 20) fontsize = 68;
  else fontsize = 56;

  const cmd = `ffmpeg -y -i "${inputPath}" -vf "drawtext=text='${escaped}':fontsize=${fontsize}:fontcolor=white:borderw=5:bordercolor=black@0.8:x=(w-tw)/2:y=(h-th)/2:font=Arial" "${outputPath}"`;

  execSync(cmd, { timeout: 30000, stdio: 'pipe' });
}

// ============================================================================
// ffmpeg — Stitch Frames into 15s Video with Crossfade
// ============================================================================

function stitchVideo(framePaths, outputPath) {
  const n = framePaths.length;
  const totalDuration = 15;
  const fadeDuration = 0.5;
  const frameDuration = totalDuration / n;

  // Build ffmpeg command with xfade transitions
  const inputs = framePaths.map(p => `-loop 1 -t ${frameDuration} -i "${p}"`).join(' ');

  if (n === 1) {
    // Single frame — just convert to video
    const cmd = `ffmpeg -y -loop 1 -t ${totalDuration} -i "${framePaths[0]}" -c:v libx264 -pix_fmt yuv420p -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" "${outputPath}"`;
    execSync(cmd, { timeout: 60000, stdio: 'pipe' });
    return;
  }

  // Build xfade filter chain
  let filterParts = [];
  let currentInput = '[0]';

  for (let i = 1; i < n; i++) {
    const offset = (frameDuration * i) - (fadeDuration * i);
    const outputLabel = i < n - 1 ? `[v${i}]` : '';
    filterParts.push(`${currentInput}[${i}]xfade=transition=fade:duration=${fadeDuration}:offset=${offset.toFixed(2)}${outputLabel}`);
    currentInput = `[v${i}]`;
  }

  const filterComplex = filterParts.join(';');
  const cmd = `ffmpeg -y ${inputs} -filter_complex "${filterComplex},scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -pix_fmt yuv420p "${outputPath}"`;

  execSync(cmd, { timeout: 120000, stdio: 'pipe' });
}

// ============================================================================
// Main Pipeline
// ============================================================================

async function main() {
  const opts = parseArgs();

  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your-gemini-key-here') {
    throw new Error('GEMINI_API_KEY not set in .env');
  }

  fs.mkdirSync(OUTPUT_BASE, { recursive: true });

  // Select topic
  const topicObj = selectTopic(opts.topic);
  const dateStr = new Date().toISOString().slice(0, 10);
  const slug = topicObj.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
  const storyDir = path.join(OUTPUT_BASE, `${dateStr}-${slug}`);

  console.log(`\n=== ${persona.name.toUpperCase()} STORIES GEN ===`);
  console.log(`Topic:   ${topicObj.topic}`);
  console.log(`Pillar:  ${topicObj.pillar}`);
  console.log(`Output:  ${storyDir}`);

  // Step 1: Gemini story plan
  console.log('\n[Step 1] Generating story plan via Gemini...');
  const plan = await generateStoryPlan(topicObj, opts.frames);

  console.log(`\n--- STORY PLAN (${plan.frames.length} frames) ---`);
  for (const frame of plan.frames) {
    const personaTag = frame.includePersona ? ' [+persona]' : '';
    console.log(`  Frame ${frame.index}: "${frame.overlayText}"${personaTag}`);
    console.log(`    Prompt: ${frame.imagePrompt.substring(0, 80)}...`);
  }

  if (opts.dryRun) {
    console.log('\n[DRY RUN] Stopping here. No images generated.');
    savePillar(topicObj.pillar);

    const dryMeta = {
      topic: topicObj.topic,
      pillar: topicObj.pillar,
      frames: plan.frames,
      dry_run: true,
      created_at: new Date().toISOString(),
    };
    const dryPath = path.join(OUTPUT_BASE, `${dateStr}-${slug}-dryrun.json`);
    fs.writeFileSync(dryPath, JSON.stringify(dryMeta, null, 2));
    console.log(`Metadata saved: ${dryPath}`);
    return;
  }

  // Create output directory
  fs.mkdirSync(storyDir, { recursive: true });

  // Step 2: Generate images via FAL
  console.log(`\n[Step 2] Generating ${plan.frames.length} frame images via FAL nano-banana-2 (9:16)...`);

  const frameOutputs = [];
  for (const frame of plan.frames) {
    const rawPath = path.join(storyDir, `frame-${String(frame.index).padStart(2, '0')}-raw.png`);
    const finalPath = path.join(storyDir, `frame-${String(frame.index).padStart(2, '0')}.png`);

    const imgResult = await generateFrameImage(frame, rawPath);

    // Step 3: Text overlay
    console.log(`  [Frame ${frame.index}] Overlaying text: "${frame.overlayText}"`);
    overlayText(rawPath, finalPath, frame.overlayText);

    // Clean up raw file
    if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);

    frameOutputs.push({
      index: frame.index,
      overlayText: frame.overlayText,
      imagePrompt: frame.imagePrompt,
      localPath: finalPath,
      width: imgResult.width,
      height: imgResult.height,
    });
  }

  // Step 4: Stitch frames into video
  console.log(`\n[Step 4] Stitching ${frameOutputs.length} frames into 15s video with crossfade...`);
  const videoPath = path.join(storyDir, 'story.mp4');
  const framePaths = frameOutputs.map(f => f.localPath);
  stitchVideo(framePaths, videoPath);
  console.log(`  Video saved: ${videoPath}`);

  savePillar(topicObj.pillar);

  // Write sidecar JSON
  const sidecar = {
    story_id: `story-${dateStr}-${slug}`,
    topic: topicObj.topic,
    pillar: topicObj.pillar,
    frame_count: frameOutputs.length,
    frames: frameOutputs,
    video_path: videoPath,
    created_at: new Date().toISOString(),
  };

  const sidecarPath = path.join(storyDir, 'story.json');
  fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));

  console.log('\n=== STORIES GEN COMPLETE ===');
  console.log(`Frames:   ${frameOutputs.length} images`);
  console.log(`Video:    ${videoPath}`);
  console.log(`Output:   ${storyDir}`);
  console.log(`Sidecar:  ${sidecarPath}`);
  console.log(`Topic:    ${topicObj.topic}`);
  console.log(`Pillar:   ${topicObj.pillar}`);
  console.log(`\nNext: node skills/stories-publish/scripts/stories-publish.js`);
}

main().catch(e => {
  console.error(`\nError: ${e.message}`);
  process.exit(1);
});
