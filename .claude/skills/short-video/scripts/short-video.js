#!/usr/bin/env node
/**
 * short-video — Short-form vertical video pipeline for persona avatar
 *
 * Stage 1: Content Creation (Gemini script + HeyGen avatar video)
 * Stage 2: Post-Production (Whisper transcription + word-by-word captions + ffmpeg burn-in)
 * Stage 3: Cloud Upload (Late presigned URL → public media URL + database storage)
 *
 * Output: A publish-ready video with cloud URL, stored in DB.
 * To publish: run short-publish
 */

const { Pool } = require('pg');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadPersonaContext } = require('../../../lib/persona');

// ============================================================================
// Config
// ============================================================================

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const LATE_API_KEY = process.env.LATE_API_KEY;
const HEYGEN_VOICE_ID = process.env.HEYGEN_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
const DATABASE_URL = process.env.INSFORGE_CONNECTION_STRING || process.env.DATABASE_URL;
const LATE_BASE_URL = 'https://zernio.com/api/v1';

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const OUTPUT_DIR = path.join(require('os').homedir(), loadPersonaContext(ROOT_DIR).dirName, 'videos');
const AVATARS_PATH = path.join(ROOT_DIR, 'config', 'heygen-avatars.json');
const LAST_PILLAR_PATH = path.join(OUTPUT_DIR, '.last-pillar');

const isRealDB = DATABASE_URL && !DATABASE_URL.includes('user:pass@host');
const pool = isRealDB ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

// ============================================================================
// Topic Bank (from INFORMATION.md)
// ============================================================================

const TOPICS = [
  // Hidden Samoa
  { topic: 'To Sua Ocean Trench', pillar: 'hidden-samoa', hook: 'Have you heard of the ocean trench you can swim in?' },
  { topic: 'Piula Cave Pool', pillar: 'hidden-samoa', hook: 'There\'s a freshwater cave pool hidden under a church in Samoa.' },
  { topic: 'Papapapaitai Falls', pillar: 'hidden-samoa', hook: 'One of the tallest waterfalls in the Pacific and most people drive right past it.' },
  { topic: 'Lake Lanoto\'o Crater Lake', pillar: 'hidden-samoa', hook: 'There\'s a crater lake in Samoa with wild goldfish living in it.' },
  { topic: 'Falealupo Rainforest Canopy Walk', pillar: 'hidden-samoa', hook: 'You can walk through the treetops of one of the last lowland rainforests in Samoa.' },
  { topic: 'Salamumu Beach', pillar: 'hidden-samoa', hook: 'This beach is so hidden, even most Samoans haven\'t been here.' },

  // Local Life
  { topic: 'Sunday To\'ona\'i Feast', pillar: 'local-life', hook: 'Sunday in Samoa hits different. Let me show you why.' },
  { topic: 'Samoan Umu Earth Oven', pillar: 'local-life', hook: 'The umu started at 5am. By noon, you understand everything.' },
  { topic: 'Maketi Fou Market Apia', pillar: 'local-life', hook: 'The best food in Samoa isn\'t in a restaurant. It\'s at this market.' },
  { topic: 'Koko Samoa Traditional Chocolate', pillar: 'local-life', hook: 'Samoa makes chocolate the old way. And it\'s nothing like what you\'ve had before.' },
  { topic: 'Palusami — Coconut Cream in Taro Leaves', pillar: 'local-life', hook: 'If you only try one Samoan dish, make it this one.' },
  { topic: 'Oka — Samoan Raw Fish', pillar: 'local-life', hook: 'Samoa has its own version of ceviche and it\'s life-changing.' },
  { topic: 'Aiga Bus Experience', pillar: 'local-life', hook: 'Forget Uber. In Samoa, you ride the aiga bus.' },

  // Adventure
  { topic: 'Lalomanu Beach', pillar: 'adventure', hook: 'This beach has been called one of the most beautiful in the world. I live 20 minutes away.' },
  { topic: 'Return to Paradise Beach', pillar: 'adventure', hook: 'This beach was so beautiful they literally named a movie after it.' },
  { topic: 'Togitogiga Waterfall Swimming', pillar: 'adventure', hook: 'Imagine a waterfall you can actually swim in, surrounded by rainforest.' },
  { topic: 'Alofaaga Blowholes Savai\'i', pillar: 'adventure', hook: 'Locals throw coconuts into these blowholes and watch them launch 30 meters into the air.' },
  { topic: 'Afu Aau Waterfall', pillar: 'adventure', hook: 'One of the most beautiful waterfalls in the entire Pacific. And barely anyone knows about it.' },
  { topic: 'Surfing at Salani', pillar: 'adventure', hook: 'Samoa has world-class surf breaks and zero crowds.' },
  { topic: 'Whale Watching in Samoa', pillar: 'adventure', hook: 'Humpback whales come to Samoa every year. You can see them from shore.' },
  { topic: 'Snorkeling Samoa Coral Reefs', pillar: 'adventure', hook: 'The coral reefs here look like someone photoshopped them. They didn\'t.' },

  // Business Spotlight
  { topic: 'Beach Fale Stays in Samoa', pillar: 'business-spotlight', hook: 'What does a $40/night beach stay in the Pacific actually look like?' },
  { topic: 'Sinalei Reef Resort', pillar: 'business-spotlight', hook: 'If you want luxury in Samoa, this is the spot.' },
  { topic: 'Coconuts Beach Club', pillar: 'business-spotlight', hook: 'One of the most iconic resorts in the South Pacific is right here in Samoa.' },
  { topic: 'Apia Thursday Night Market', pillar: 'business-spotlight', hook: 'Every Thursday night, Apia comes alive with the best street food in the Pacific.' },

  // Travel Tips
  { topic: 'First Time in Samoa Tips', pillar: 'travel-tips', hook: 'Things I wish someone told me before visiting Samoa for the first time.' },
  { topic: 'Best Time to Visit Samoa', pillar: 'travel-tips', hook: 'There\'s a right time and a wrong time to visit Samoa. Here\'s the truth.' },
  { topic: 'Getting Around Samoa', pillar: 'travel-tips', hook: 'No Uber, no metro. Here\'s how you actually get around Samoa.' },
  { topic: 'Samoa vs American Samoa', pillar: 'travel-tips', hook: 'People confuse these two all the time. They\'re completely different countries.' },
  { topic: 'What to Pack for Samoa', pillar: 'travel-tips', hook: 'Pack wrong for Samoa and you\'ll regret it. Here\'s what you actually need.' },
  { topic: 'Samoa Money and Currency Tips', pillar: 'travel-tips', hook: 'ATMs are rare outside Apia. Here\'s how to handle money in Samoa.' },

  // Culture Education
  { topic: 'Fa\'asamoa — The Samoan Way', pillar: 'culture-education', hook: 'The word fa\'asamoa doesn\'t translate to English. Let me try to explain it.' },
  { topic: 'Samoan Tattoo Pe\'a and Malu', pillar: 'culture-education', hook: 'Samoan tattoo is one of the most sacred practices in the world. Here\'s why.' },
  { topic: 'Ava Ceremony Explained', pillar: 'culture-education', hook: 'Before anything important happens in Samoa, there\'s a ceremony. Here\'s what it means.' },
  { topic: 'Siapo Tapa Cloth Art', pillar: 'culture-education', hook: 'This art form has been passed down for generations. And it starts with tree bark.' },
  { topic: 'Fire Knife Dance Siva Afi', pillar: 'culture-education', hook: 'The fire knife dance originated in Samoa. And it\'s as intense as it sounds.' },
  { topic: 'Samoan Church Choirs', pillar: 'culture-education', hook: 'Samoan church choirs are world-class. This is not an exaggeration.' },
  { topic: 'Ie Toga Fine Mats', pillar: 'culture-education', hook: 'In Samoa, these woven mats are more valuable than money. Here\'s why.' },
];

const PILLARS = [
  'hidden-samoa',
  'local-life',
  'adventure',
  'business-spotlight',
  'travel-tips',
  'culture-education',
];

const PILLAR_LOOK_MAP = {
  'hidden-samoa': ['waterfall', 'jungle'],
  'local-life': ['jungle', 'waterfall'],
  'adventure': ['jungle', 'waterfall'],
  'business-spotlight': ['studio'],
  'travel-tips': ['studio'],
  'culture-education': ['waterfall', 'studio'],
};

// ============================================================================
// CLI Arg Parsing
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    topic: null,
    pillar: null,
    look: null,
    dryRun: false,
    skipCaptions: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--topic': opts.topic = args[++i]; break;
      case '--pillar': opts.pillar = args[++i]; break;
      case '--look': opts.look = args[++i]; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--skip-captions': opts.skipCaptions = true; break;
    }
  }

  return opts;
}

// ============================================================================
// Stage 0: Selection (topic, pillar, look)
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

function selectTopic(pillar, topicOverride) {
  if (topicOverride) {
    const match = TOPICS.find(t => t.topic.toLowerCase() === topicOverride.toLowerCase());
    if (match) return match;
    return { topic: topicOverride, pillar, hook: null };
  }
  const candidates = TOPICS.filter(t => t.pillar === pillar);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function selectLook(pillar, lookOverride) {
  const avatars = JSON.parse(fs.readFileSync(AVATARS_PATH, 'utf8'));
  const verticalLooks = avatars.vertical.looks;

  if (lookOverride && verticalLooks[lookOverride]) {
    return { name: lookOverride, ...verticalLooks[lookOverride] };
  }

  const preferred = PILLAR_LOOK_MAP[pillar] || ['waterfall'];
  for (const lookName of preferred) {
    if (verticalLooks[lookName]) {
      return { name: lookName, ...verticalLooks[lookName] };
    }
  }

  const defaultName = avatars.vertical.default;
  return { name: defaultName, ...verticalLooks[defaultName] };
}

// ============================================================================
// Stage 1: Gemini Script Generation
// ============================================================================

async function generateScript(topicObj, pillar) {
  const persona = loadPersonaContext(path.join(__dirname, '..', '..', '..'));
  const systemPrompt = `You are writing a short-form video script for ${persona.name} for ${persona.brand}.
${persona.voice ? `\nVoice guide:\n${persona.voice}\n` : `
Voice: Warm, punchy, and real. Like a friend texting you about something you absolutely need to see. Short sentences. No corporate speak. Authentic.`}

Rules:
- 30 to 60 seconds when spoken aloud (roughly 80-150 words)
- Hook-first: start with a surprising fact, question, or bold statement
- Weave in local phrases naturally (not forced)
- End with a brand call-to-action that feels like an invite, not a command
- No hashtags in the script itself
- No stage directions or brackets
- Write as spoken word — conversational, not written prose
- Content pillar: ${pillar}`;

  const userPrompt = `Write a short-form video script about: "${topicObj.topic}"
${topicObj.hook ? `\nSuggested hook: "${topicObj.hook}"` : ''}

Also provide:
1. A short Instagram/TikTok caption (1-2 sentences, {{PERSONA_NAME}}'s voice)
2. 8-10 relevant hashtags

Format your response exactly like this:
SCRIPT:
[the script here]

CAPTION:
[the caption here]

HASHTAGS:
[comma-separated hashtags]`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 1024,
        },
      }),
    }
  );

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error(`Gemini error: ${JSON.stringify(data)}`);
  }

  const scriptMatch = text.match(/SCRIPT:\s*([\s\S]*?)(?=\nCAPTION:)/i);
  const captionMatch = text.match(/CAPTION:\s*([\s\S]*?)(?=\nHASHTAGS:)/i);
  const hashtagsMatch = text.match(/HASHTAGS:\s*([\s\S]*?)$/i);

  const script = scriptMatch ? scriptMatch[1].trim() : text.trim();
  const caption = captionMatch ? captionMatch[1].trim() : '';
  const hashtags = hashtagsMatch
    ? hashtagsMatch[1].trim().split(/[,\n]+/).map(h => h.trim().replace(/^#?/, '#')).filter(Boolean)
    : [];

  return { script, caption, hashtags, rawResponse: text };
}

// ============================================================================
// Stage 1: HeyGen Video Generation
// ============================================================================

async function createHeyGenVideo(script, look) {
  const response = await fetch('https://api.heygen.com/v2/video/generate', {
    method: 'POST',
    headers: {
      'X-Api-Key': HEYGEN_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_inputs: [{
        character: {
          type: 'avatar',
          avatar_id: look.avatar_id,
          avatar_style: 'normal',
        },
        voice: {
          type: 'text',
          input_text: script,
          voice_id: HEYGEN_VOICE_ID,
        },
      }],
      dimension: { width: 1080, height: 1920 },
    }),
  });

  const data = await response.json();
  if (data.data?.video_id) {
    return data.data.video_id;
  }
  throw new Error(`HeyGen generate error: ${JSON.stringify(data.error || data)}`);
}

async function pollHeyGenVideo(videoId, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(
      `https://api.heygen.com/v1/video_status.get?video_id=${videoId}`,
      { headers: { 'X-Api-Key': HEYGEN_API_KEY } }
    );

    const data = await response.json();

    if (data.data?.status === 'completed') {
      return data.data;
    } else if (data.data?.status === 'failed' || data.data?.error) {
      throw new Error(`HeyGen failed: ${data.data?.error || 'Unknown error'}`);
    }

    const elapsed = (i + 1) * 10;
    if (elapsed % 30 === 0) {
      console.log(`  Still processing... (${elapsed}s elapsed — HeyGen typically takes 2-5 min)`);
    }

    await new Promise(r => setTimeout(r, 10000));
  }
  throw new Error('HeyGen video generation timed out after 20 minutes');
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(buffer));
  return outputPath;
}

// ============================================================================
// Stage 2: Whisper Transcription
// ============================================================================

function runWhisper(videoPath) {
  const outputDir = path.dirname(videoPath);
  const baseName = path.basename(videoPath, '.mp4');

  console.log('  Running Whisper transcription...');
  execSync(
    `whisper "${videoPath}" --model base --language en --word_timestamps True --output_format json --output_dir "${outputDir}"`,
    { timeout: 300000, stdio: 'pipe' }
  );

  const jsonPath = path.join(outputDir, `${baseName}.json`);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Whisper output not found at ${jsonPath}`);
  }

  const whisperData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  const words = [];
  for (const segment of whisperData.segments || []) {
    for (const word of segment.words || []) {
      words.push({
        word: word.word.trim(),
        start: word.start,
        end: word.end,
      });
    }
  }

  for (const ext of ['.json', '.txt', '.vtt', '.srt', '.tsv']) {
    const f = path.join(outputDir, `${baseName}${ext}`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  return words;
}

// ============================================================================
// Stage 2: ASS Subtitle Generation (word-by-word Hormozi style)
// ============================================================================

function formatASSTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

function generateASS(words) {
  const phrases = [];
  let current = [];

  for (const w of words) {
    current.push(w);
    if (current.length >= 4 || /[.!?]$/.test(w.word)) {
      phrases.push([...current]);
      current = [];
    }
  }
  if (current.length > 0) phrases.push(current);

  const header = `[Script Info]
Title: Persona Captions
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,100,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,3,2,60,60,520,1
Style: Highlight,Arial,100,&H0000DDFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,3,2,60,60,520,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = [];

  for (const phrase of phrases) {
    const phraseStart = phrase[0].start;
    const phraseEnd = phrase[phrase.length - 1].end;

    for (let i = 0; i < phrase.length; i++) {
      const wordStart = phrase[i].start;
      const wordEnd = phrase[i].end;

      const parts = phrase.map((w, j) => {
        if (j === i) {
          return `{\\c&H00DDFF&\\b1}${w.word}{\\c&HFFFFFF&\\b1}`;
        }
        return w.word;
      });

      const text = parts.join(' ');
      const start = formatASSTime(wordStart);
      const end = formatASSTime(wordEnd);

      events.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
    }

    const fullText = phrase.map(w => w.word).join(' ');
    const gapStart = formatASSTime(phraseStart);
    const gapEnd = formatASSTime(phraseEnd);
    events.push(`Dialogue: -1,${gapStart},${gapEnd},Default,,0,0,0,,${fullText}`);
  }

  return header + events.join('\n') + '\n';
}

// ============================================================================
// Stage 2: ffmpeg Caption Burn-in
// ============================================================================

function burnCaptions(inputPath, assPath, outputPath) {
  console.log('  Burning captions onto video...');
  execSync(
    `ffmpeg -y -i "${inputPath}" -vf "ass=${assPath}" -c:a copy -c:v libx264 -crf 18 -preset medium "${outputPath}"`,
    { timeout: 600000, stdio: 'pipe' }
  );
  return outputPath;
}

// ============================================================================
// Stage 3: Late Cloud Upload
// ============================================================================

async function uploadToLate(filePath) {
  if (!LATE_API_KEY) {
    console.log('  (LATE_API_KEY not set — skipping cloud upload)');
    return null;
  }

  const filename = path.basename(filePath);

  console.log('  Getting presigned upload URL from Late...');
  const presignRes = await fetch(`${LATE_BASE_URL}/media/presign`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LATE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filename, contentType: 'video/mp4' }),
  });

  if (!presignRes.ok) {
    console.log(`  Warning: Late presign failed (${presignRes.status}) — skipping cloud upload`);
    return null;
  }

  const { uploadUrl, publicUrl } = await presignRes.json();

  const fileBuffer = fs.readFileSync(filePath);
  console.log(`  Uploading ${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB to Late cloud storage...`);
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4' },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    console.log(`  Warning: Late upload failed (${uploadRes.status}) — skipping cloud upload`);
    return null;
  }

  console.log(`  Uploaded: ${publicUrl}`);
  return publicUrl;
}

// ============================================================================
// Stage 3: Database — Store Video Record
// ============================================================================

async function insertDB(data) {
  if (!pool) {
    console.log('  (No database connection — skipping DB insert)');
    return;
  }

  await pool.query(
    `INSERT INTO heygen_videos (
      heygen_video_id, title, script, avatar_id, voice_id, status,
      video_url, duration_secs, resolution, raw_response
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (heygen_video_id) DO UPDATE SET
      status = EXCLUDED.status,
      video_url = EXCLUDED.video_url,
      duration_secs = EXCLUDED.duration_secs,
      raw_response = EXCLUDED.raw_response,
      updated_at = NOW()`,
    [
      data.heygenVideoId,
      data.title,
      data.script,
      data.avatarId,
      HEYGEN_VOICE_ID,
      'complete',
      data.videoUrl,
      data.durationSecs,
      '1080x1920',
      JSON.stringify(data.metadata),
    ]
  );
  console.log('  DB: heygen_videos row upserted');
}

// ============================================================================
// Main Pipeline
// ============================================================================

async function main() {
  const opts = parseArgs();

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // --- Selection ---
  const pillar = opts.pillar || getNextPillar();
  const topicObj = selectTopic(pillar, opts.topic);
  const look = selectLook(topicObj.pillar || pillar, opts.look);

  const dateStr = new Date().toISOString().slice(0, 10);
  const slug = topicObj.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');

  console.log('\n=== SHORT VIDEO PIPELINE ===');
  console.log(`Topic:  ${topicObj.topic}`);
  console.log(`Pillar: ${pillar}`);
  console.log(`Look:   ${look.name} (${look.setting})`);
  console.log(`Avatar: ${look.avatar_id}`);
  console.log(`Output: ${dateStr}-${slug}.mp4\n`);

  // -------------------------------------------------------------------------
  // Stage 1: Gemini Script
  // -------------------------------------------------------------------------
  console.log('[Stage 1] Generating script via Gemini...');

  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your-gemini-key-here') {
    throw new Error('GEMINI_API_KEY not set in .env — get one from https://makersuite.google.com/app/apikey');
  }

  const { script, caption, hashtags, rawResponse } = await generateScript(topicObj, pillar);

  console.log(`\n--- SCRIPT (${script.split(/\s+/).length} words) ---`);
  console.log(script);
  console.log(`\n--- CAPTION ---`);
  console.log(caption);
  console.log(`--- HASHTAGS ---`);
  console.log(hashtags.join(' '));
  console.log('');

  if (opts.dryRun) {
    console.log('[DRY RUN] Stopping here. No video generated.');
    savePillar(pillar);

    const metaPath = path.join(OUTPUT_DIR, `${dateStr}-${slug}-dryrun.json`);
    fs.writeFileSync(metaPath, JSON.stringify({
      topic: topicObj.topic,
      pillar,
      look: look.name,
      script,
      caption,
      hashtags,
      avatar_id: look.avatar_id,
      dry_run: true,
      created_at: new Date().toISOString(),
    }, null, 2));
    console.log(`Metadata saved: ${metaPath}`);

    if (pool) await pool.end();
    return;
  }

  // -------------------------------------------------------------------------
  // Stage 1 (cont): HeyGen Video
  // -------------------------------------------------------------------------
  if (!HEYGEN_API_KEY) {
    throw new Error('HEYGEN_API_KEY not set in .env');
  }

  console.log('[Stage 1] Generating avatar video via HeyGen...');
  const heygenVideoId = await createHeyGenVideo(script, look);
  console.log(`  HeyGen video ID: ${heygenVideoId}`);

  console.log('  Polling for completion...');
  const heygenResult = await pollHeyGenVideo(heygenVideoId);
  console.log(`  HeyGen video complete! Duration: ${heygenResult.duration}s`);

  const tmpVideoPath = `/tmp/short-${dateStr}-${slug}.mp4`;
  console.log('  Downloading video...');
  await downloadFile(heygenResult.video_url, tmpVideoPath);
  console.log(`  Downloaded to ${tmpVideoPath}`);

  // -------------------------------------------------------------------------
  // Stage 2: Post-Production (captions)
  // -------------------------------------------------------------------------
  let finalOutputPath;

  if (opts.skipCaptions) {
    console.log('\n[Stage 2] Skipping captions (--skip-captions)');
    finalOutputPath = path.join(OUTPUT_DIR, `${dateStr}-${slug}.mp4`);
    fs.copyFileSync(tmpVideoPath, finalOutputPath);
  } else {
    console.log('\n[Stage 2] Post-production — adding word-by-word captions...');

    const words = runWhisper(tmpVideoPath);
    console.log(`  Whisper found ${words.length} words`);

    if (words.length === 0) {
      console.log('  Warning: No words detected. Outputting video without captions.');
      finalOutputPath = path.join(OUTPUT_DIR, `${dateStr}-${slug}.mp4`);
      fs.copyFileSync(tmpVideoPath, finalOutputPath);
    } else {
      const assContent = generateASS(words);
      const assPath = `/tmp/short-${dateStr}-${slug}.ass`;
      fs.writeFileSync(assPath, assContent);
      console.log(`  ASS subtitle file generated (${words.length} words, ${assContent.split('\n').length} lines)`);

      finalOutputPath = path.join(OUTPUT_DIR, `${dateStr}-${slug}.mp4`);
      burnCaptions(tmpVideoPath, assPath, finalOutputPath);

      fs.unlinkSync(assPath);
    }
  }

  if (fs.existsSync(tmpVideoPath)) fs.unlinkSync(tmpVideoPath);

  // Get duration
  let durationSecs = heygenResult.duration || 0;
  try {
    const probe = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${finalOutputPath}"`,
      { encoding: 'utf8', timeout: 30000 }
    );
    durationSecs = parseFloat(probe.trim()) || durationSecs;
  } catch (e) { /* use HeyGen duration */ }

  // -------------------------------------------------------------------------
  // Stage 3: Upload to Late cloud + store in DB
  // -------------------------------------------------------------------------
  console.log('\n[Stage 3] Uploading to Late cloud storage...');
  const mediaUrl = await uploadToLate(finalOutputPath);

  savePillar(pillar);

  // Write metadata sidecar
  const metadata = {
    video_id: `short-${dateStr}-${slug}`,
    topic: topicObj.topic,
    pillar,
    look: look.name,
    script,
    caption,
    hashtags,
    heygen_video_id: heygenVideoId,
    avatar_id: look.avatar_id,
    voice_id: HEYGEN_VOICE_ID,
    duration_secs: durationSecs,
    resolution: '1080x1920',
    captions_added: !opts.skipCaptions,
    media_url: mediaUrl || null,
    created_at: new Date().toISOString(),
  };

  const metaPath = path.join(OUTPUT_DIR, `${dateStr}-${slug}.json`);
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

  // Database insert
  await insertDB({
    heygenVideoId,
    title: `Short: ${topicObj.topic}`,
    script,
    avatarId: look.avatar_id,
    videoUrl: mediaUrl || finalOutputPath,
    durationSecs,
    metadata,
  });

  console.log('\n=== PIPELINE COMPLETE ===');
  console.log(`Video:    ${finalOutputPath}`);
  if (mediaUrl) console.log(`Cloud:    ${mediaUrl}`);
  console.log(`Metadata: ${metaPath}`);
  console.log(`Duration: ${Math.round(durationSecs)}s`);
  console.log(`Topic:    ${topicObj.topic}`);
  console.log(`Pillar:   ${pillar}`);
  console.log(`Look:     ${look.name}`);
  console.log(`\nNext: node skills/short-publish/scripts/short-publish.js`);

  if (pool) await pool.end();
}

main().catch(e => {
  console.error(`\nError: ${e.message}`);
  if (pool) pool.end();
  process.exit(1);
});
