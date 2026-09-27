#!/usr/bin/env node
/**
 * infographic-gen — Infographic post pipeline
 *
 * 1. Gemini generates infographic concept (topic, title, 3-5 facts, background prompt, caption)
 * 2. FAL nano-banana-2 generates background image at 4:5 aspect ratio
 * 3. ffmpeg composites dark overlay + title + facts + branding onto background
 * 4. Output saved to ~/{PersonaName}/infographics/{date}-{slug}/
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
assertFal("infographic-gen");
const FAL_KEY = process.env.FAL_KEY;

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const persona = loadPersonaContext(ROOT_DIR);
const REF_IMAGE = path.join(ROOT_DIR, 'brand-content', 'reference-hero.png');
const OUTPUT_BASE = getOutputDir('infographics', ROOT_DIR);
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
  const opts = { topic: null, facts: null, dryRun: false, news: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--topic': opts.topic = args[++i]; break;
      case '--facts': opts.facts = parseInt(args[++i]); break;
      case '--dry-run': opts.dryRun = true; break;
      case '--news': opts.news = true; break;
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
// Gemini — Generate Infographic Plan
// ============================================================================

async function generateInfographicPlan(topicObj, factCount) {
  const factCountInstruction = factCount
    ? `Include exactly ${factCount} facts.`
    : 'Include between 3 and 5 facts (choose the best number for the topic).';

  const prompt = `You are creating an INFOGRAPHIC POST for ${persona.name} — the brand persona for ${persona.brand}.
${persona.voice ? `\nVoice guide:\n${persona.voice}\n` : ''}

Topic: "${topicObj.topic}"
${topicObj.hook ? `Hook: "${topicObj.hook}"` : ''}
Pillar: ${topicObj.pillar}

This is a single-image infographic — NOT a carousel, NOT a story. It's one beautiful image with key facts overlaid on a scenic Samoa background, paired with a long-form written caption.

${factCountInstruction}

Provide:
1. TITLE — A bold infographic headline. MAX 6 WORDS. All caps energy. Example: "5 FACTS ABOUT SAMOA" or "SAMOA TRAVEL ESSENTIALS"
2. FACTS — Each fact is a short, punchy line. MAX 10 WORDS each. These get overlaid on the image as bullet points. Include a number, emoji, or stat where possible. Example: "Population: just 200,000 people" or "Water temp: 26-29°C year-round"
3. BACKGROUND_PROMPT — An image generation prompt for the background scene. This should be a stunning Samoa landscape or scene that works as a BACKGROUND for text. Important: the image should have muted/darker tones or natural vignetting so white text is readable on top. Describe a vertical 4:5 composition. Do NOT include any text, words, or typography in the image itself.
4. PERSONA_IN_BACKGROUND — YES or NO. Should the persona appear in the background image? Usually NO for infographics (text covers most of the image).
5. CAPTION — A long-form written post caption in the persona's voice (3-5 sentences). Warm, educational, authentic. Include a CTA.
6. HASHTAGS — 8-10 relevant hashtags.

Format EXACTLY like this:

TITLE: [infographic title]

FACT_1: [fact text]
FACT_2: [fact text]
FACT_3: [fact text]
[...continue for all facts...]

BACKGROUND_PROMPT: [image prompt for scenic background — muted tones, no text in image]
PERSONA_IN_BACKGROUND: [YES or NO]

CAPTION:
[long-form caption]

HASHTAGS:
[comma-separated hashtags]`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 4096 },
      }),
    }
  );

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini error: ${JSON.stringify(data)}`);

  // Parse title
  const titleMatch = text.match(/TITLE:\s*(.+)/i);
  const title = titleMatch ? titleMatch[1].trim() : 'SAMOA FACTS';

  // Parse facts
  const facts = [];
  for (let i = 1; i <= 10; i++) {
    const re = new RegExp(`FACT_${i}:\\s*(.+)`, 'i');
    const m = text.match(re);
    if (m) facts.push(m[1].trim());
  }
  if (facts.length === 0) throw new Error('Gemini returned no parseable facts');

  // Parse background prompt
  const bgMatch = text.match(/BACKGROUND_PROMPT:\s*(.+)/i);
  const backgroundPrompt = bgMatch ? bgMatch[1].trim() : 'Moody aerial view of Samoa coastline at golden hour, muted tones, cinematic, vertical 4:5';

  // Parse persona in background
  const personaMatch = text.match(/PERSONA_IN_BACKGROUND:\s*(YES|NO)/i);
  const includePersona = personaMatch ? personaMatch[1].toUpperCase() === 'YES' : false;

  // Parse caption and hashtags
  const captionMatch = text.match(/CAPTION:\s*([\s\S]*?)(?=\nHASHTAGS:)/i);
  const hashtagsMatch = text.match(/HASHTAGS:\s*([\s\S]*?)$/i);
  const caption = captionMatch ? captionMatch[1].trim() : '';
  const hashtags = hashtagsMatch
    ? hashtagsMatch[1].trim().split(/[,\n]+/).map(h => h.trim().replace(/^#?/, '#')).filter(Boolean)
    : [];

  return { title, facts, backgroundPrompt, includePersona, caption, hashtags, rawResponse: text };
}

// ============================================================================
// Gemini — Search Viral Samoa News & Generate Newspaper Post
// ============================================================================

async function searchSamoaNews() {
  console.log('  Searching for viral Samoa news via Gemini + Google Search...');

  const prompt = `Search for the most viral, trending, or interesting news about Samoa from the past 7 days. Include news about:
- Samoan government, politics, economy
- Natural disasters, weather, climate
- Sports (rugby, cricket, Olympics)
- Culture, festivals, events
- Tourism, travel, infrastructure
- Diaspora community news
- Pacific region news involving Samoa

Return the TOP 5 most interesting/viral stories. For each, provide:
1. HEADLINE — the actual news headline
2. SUMMARY — 2-3 sentence summary of what happened
3. SOURCE — the news source name
4. VIRALITY — rate 1-10 how viral/interesting this is for social media

Format EXACTLY like this:

STORY_1:
HEADLINE: [headline]
SUMMARY: [summary]
SOURCE: [source]
VIRALITY: [1-10]

STORY_2:
...`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
      }),
    }
  );

  const data = await response.json();
  // Gemini with google_search may return multiple parts — concatenate all text parts
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.filter(p => p.text).map(p => p.text).join('\n');
  if (!text) throw new Error(`Gemini news search error: ${JSON.stringify(data)}`);

  // Parse stories — try structured format first, fall back to flexible parsing
  const stories = [];
  for (let i = 1; i <= 10; i++) {
    const storyBlock = text.match(new RegExp(`STORY_${i}:[\\s\\S]*?HEADLINE:\\s*(.+)[\\s\\S]*?SUMMARY:\\s*([\\s\\S]*?)(?=SOURCE:)SOURCE:\\s*(.+)[\\s\\S]*?VIRALITY:\\s*(\\d+)`, 'i'));
    if (storyBlock) {
      stories.push({
        headline: storyBlock[1].trim(),
        summary: storyBlock[2].trim(),
        source: storyBlock[3].trim(),
        virality: parseInt(storyBlock[4]),
      });
    }
  }

  // Fallback: try line-by-line HEADLINE/SUMMARY/SOURCE parsing
  if (stories.length === 0) {
    const headlines = [...text.matchAll(/HEADLINE:\s*(.+)/gi)];
    const summaries = [...text.matchAll(/SUMMARY:\s*([\s\S]*?)(?=\n(?:SOURCE|HEADLINE|VIRALITY|STORY|\d+\.))/gi)];
    const sources = [...text.matchAll(/SOURCE:\s*(.+)/gi)];
    const viralities = [...text.matchAll(/VIRALITY:\s*(\d+)/gi)];

    for (let i = 0; i < headlines.length; i++) {
      stories.push({
        headline: headlines[i][1].trim(),
        summary: summaries[i] ? summaries[i][1].trim() : '',
        source: sources[i] ? sources[i][1].trim() : 'Unknown',
        virality: viralities[i] ? parseInt(viralities[i][1]) : 5,
      });
    }
  }

  // Last resort: extract any useful content from the response
  if (stories.length === 0) {
    console.log('  [DEBUG] Raw Gemini response (first 500 chars):');
    console.log('  ' + text.substring(0, 500).replace(/\n/g, '\n  '));
    throw new Error('No news stories parsed from Gemini response');
  }

  // Sort by virality, pick top story
  stories.sort((a, b) => b.virality - a.virality);
  return stories;
}

async function generateNewspaperPost(story) {
  console.log(`  Generating newspaper post for: "${story.headline}"`);

  const prompt = `You are ${persona.name} — the brand persona for ${persona.brand}. You're creating a NEWSPAPER-STYLE social media post about breaking/trending news.
${persona.voice ? `\nVoice guide:\n${persona.voice}\n` : ''}

NEWS STORY:
Headline: "${story.headline}"
Summary: "${story.summary}"
Source: ${story.source}

Create a visually striking newspaper-style social media post. This is a single image post — one image with text that looks like a newspaper front page or breaking news graphic.

Provide:
1. HEADLINE — A catchy, bold newspaper headline. MAX 8 WORDS. All caps energy. Should grab attention. Example: "SAMOA MAKES HISTORY AT WORLD CUP" or "CYCLONE WARNING: SAMOA ON HIGH ALERT"
2. SUBHEADLINE — A one-line summary under the headline. MAX 15 WORDS. Example: "The Manu Samoa squad delivered an unforgettable performance in Paris"
3. BODY — 3-4 sentences written in the persona's warm, informative voice. This is the main post text that appears on the image. Explain what happened, why it matters, keep it accessible. MAX 60 WORDS.
4. CTA — A call to action. Include a relevant call to action for the brand. MAX 20 WORDS.
5. IMAGE_PROMPT — A prompt for generating a stunning, bold, eye-catching image that visually represents this news story. This image stands ALONE with no text overlay — it must be visually striking on its own. Think editorial magazine cover, photojournalism, or cinematic still. Vivid colors, dramatic lighting, rich detail, high contrast. NO TEXT, NO WORDS, NO TYPOGRAPHY in the image. Vertical 4:5 composition. Be very specific and descriptive — describe the scene, lighting, mood, colors, composition in detail.
6. CAPTION — Social media caption for the post (outside the image). The persona's voice — warm, punchy, informative. 2-4 sentences.
7. HASHTAGS — 8-10 relevant hashtags

Format EXACTLY like this:

HEADLINE: [headline]
SUBHEADLINE: [subheadline]
BODY: [body text]
CTA: [call to action]
IMAGE_PROMPT: [image generation prompt]
CAPTION: [social media caption]
HASHTAGS: [comma-separated hashtags]`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 4096 },
      }),
    }
  );

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini newspaper post error: ${JSON.stringify(data)}`);

  const get = (label) => {
    const re = new RegExp(`${label}:\\s*(.+)`, 'i');
    const m = text.match(re);
    return m ? m[1].trim() : '';
  };

  const captionMatch = text.match(/CAPTION:\s*([\s\S]*?)(?=\nHASHTAGS:)/i);
  const hashtagsMatch = text.match(/HASHTAGS:\s*([\s\S]*?)$/i);

  return {
    headline: get('HEADLINE') || story.headline,
    subheadline: get('SUBHEADLINE') || story.summary.split('.')[0],
    body: get('BODY') || story.summary,
    cta: get('CTA') || `Check out ${persona.brand} to stay updated`,
    backgroundPrompt: get('IMAGE_PROMPT') || 'Dramatic aerial view of Samoa coastline, moody editorial photography, muted tones, cinematic, vertical 4:5',
    caption: captionMatch ? captionMatch[1].trim() : story.summary,
    hashtags: hashtagsMatch
      ? hashtagsMatch[1].trim().split(/[,\n]+/).map(h => h.trim().replace(/^#?/, '#')).filter(Boolean)
      : [],
    newsSource: story.source,
    originalHeadline: story.headline,
    rawResponse: text,
  };
}

// ============================================================================
// ffmpeg — Composite Newspaper Post
// ============================================================================

function compositeNewspaper(bgPath, outputPath, post) {
  const tmpDir = path.dirname(outputPath);

  // Write text to temp files to avoid shell escaping issues
  const headlineFile = path.join(tmpDir, '_headline.txt');
  const subheadFile = path.join(tmpDir, '_subhead.txt');
  const bodyFile = path.join(tmpDir, '_body.txt');
  const ctaFile = path.join(tmpDir, '_cta.txt');

  // Strip emojis for ffmpeg drawtext
  const stripEmoji = (s) => s.replace(/[\u{1F000}-\u{1FFFF}|\u{2600}-\u{27BF}|\u{FE00}-\u{FE0F}|\u{1F900}-\u{1F9FF}]/gu, '').trim();

  fs.writeFileSync(headlineFile, stripEmoji(post.headline));
  fs.writeFileSync(subheadFile, stripEmoji(post.subheadline));
  fs.writeFileSync(ctaFile, stripEmoji(post.cta));

  // Word-wrap body text at ~35 chars per line for readability on 1080px wide
  const bodyText = stripEmoji(post.body);
  const words = bodyText.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > 38) {
      lines.push(line.trim());
      line = word;
    } else {
      line = line ? line + ' ' + word : word;
    }
  }
  if (line.trim()) lines.push(line.trim());
  fs.writeFileSync(bodyFile, lines.join('\n'));

  function escPath(p) {
    return p.replace(/:/g, '\\:').replace(/'/g, "'\\''");
  }

  // Layout for 1080x1350 (4:5) newspaper style
  const filters = [];

  // Dark gradient overlay — heavier at top and bottom for headline/CTA readability
  filters.push("drawbox=x=0:y=0:w=iw:h=ih:color=black@0.55:t=fill");

  // Top banner: brand name + date line
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const brandLabel = persona.brand.toUpperCase().replace(/'/g, "\\'");
  filters.push(
    `drawtext=text='${brandLabel}':fontsize=24:fontcolor=white@0.6:x=(w-tw)/2:y=50:font=Arial`
  );
  filters.push(
    `drawtext=text='${dateStr.replace(/'/g, "\\'")}':fontsize=18:fontcolor=white@0.4:x=(w-tw)/2:y=82:font=Arial`
  );

  // Thin divider line
  filters.push("drawbox=x=80:y=115:w=iw-160:h=2:color=white@0.4:t=fill");

  // HEADLINE — large, centered, bold
  filters.push(
    `drawtext=textfile='${escPath(headlineFile)}':fontsize=56:fontcolor=white:borderw=3:bordercolor=black@0.6:x=(w-tw)/2:y=160:font=Arial`
  );

  // SUBHEADLINE — smaller, italic feel
  filters.push(
    `drawtext=textfile='${escPath(subheadFile)}':fontsize=28:fontcolor=white@0.85:borderw=2:bordercolor=black@0.4:x=(w-tw)/2:y=240:font=Arial`
  );

  // Thin divider
  filters.push("drawbox=x=120:y=290:w=iw-240:h=2:color=white@0.3:t=fill");

  // BODY — multi-line, left-aligned with padding
  const bodyFontSize = 32;
  const bodyLineHeight = 46;
  const bodyStartY = 330;
  for (let i = 0; i < lines.length && i < 8; i++) {
    const lineFile = path.join(tmpDir, `_bodyline${i}.txt`);
    fs.writeFileSync(lineFile, lines[i]);
    filters.push(
      `drawtext=textfile='${escPath(lineFile)}':fontsize=${bodyFontSize}:fontcolor=white@0.9:borderw=2:bordercolor=black@0.4:x=80:y=${bodyStartY + (i * bodyLineHeight)}:font=Arial`
    );
  }

  // CTA bar at bottom — semi-transparent background
  const ctaBarY = 1350 - 180;
  filters.push(`drawbox=x=0:y=${ctaBarY}:w=iw:h=100:color=black@0.7:t=fill`);
  filters.push(
    `drawtext=textfile='${escPath(ctaFile)}':fontsize=26:fontcolor=white:x=(w-tw)/2:y=${ctaBarY + 35}:font=Arial`
  );

  // Bottom branding
  const brandFooter = persona.brand.replace(/'/g, "\\'");
  filters.push(
    `drawtext=text='${brandFooter}':fontsize=22:fontcolor=white@0.5:x=(w-tw)/2:y=h-55:font=Arial`
  );

  const filterStr = filters.join(',');
  const cmd = `ffmpeg -y -i "${bgPath}" -vf "${filterStr}" "${outputPath}"`;

  const tmpFiles = [headlineFile, subheadFile, bodyFile, ctaFile];
  for (let i = 0; i < lines.length && i < 8; i++) {
    tmpFiles.push(path.join(tmpDir, `_bodyline${i}.txt`));
  }

  try {
    execSync(cmd, { timeout: 30000, stdio: 'pipe' });
  } finally {
    tmpFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });
  }
}

// ============================================================================
// FAL nano-banana-2 — Generate Background Image (4:5)
// ============================================================================

async function generateBackgroundImage(plan, outputPath) {
  const usePersona = plan.includePersona;
  const endpoint = usePersona
    ? 'https://fal.run/fal-ai/nano-banana-2/edit'
    : 'https://fal.run/fal-ai/nano-banana-2';

  console.log(`  Generating background (${usePersona ? 'with persona' : 'scene only'})...`);

  const body = {
    prompt: plan.backgroundPrompt,
    num_images: 1,
    resolution: plan.resolution || '1K',
    aspect_ratio: '4:5',
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
    throw new Error(`FAL API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  const images = result.images || [];
  if (images.length === 0) throw new Error('FAL returned no images');

  const imgResponse = await fetch(images[0].url);
  const buffer = Buffer.from(await imgResponse.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  console.log(`  Background saved: ${path.basename(outputPath)}`);
  return { width: images[0].width, height: images[0].height };
}

// ============================================================================
// ffmpeg — Composite Infographic
// ============================================================================

function compositeInfographic(bgPath, outputPath, title, facts) {
  // Write text to a temporary ffmpeg script to avoid shell escaping nightmares
  // Use ffmpeg textfile= instead of text= for complex strings

  const tmpDir = path.dirname(outputPath);

  // Write title to file
  const titleFile = path.join(tmpDir, '_title.txt');
  fs.writeFileSync(titleFile, title);

  // Write each fact to a file
  const factFiles = facts.map((fact, i) => {
    // Strip emojis — ffmpeg drawtext can't render them
    const clean = fact.replace(/[\u{1F000}-\u{1FFFF}|\u{2600}-\u{27BF}|\u{FE00}-\u{FE0F}|\u{1F900}-\u{1F9FF}]/gu, '').trim();
    const fp = path.join(tmpDir, `_fact${i}.txt`);
    fs.writeFileSync(fp, clean);
    return fp;
  });

  // Escape colon in file paths for ffmpeg filter syntax
  function escPath(p) {
    return p.replace(/:/g, '\\:').replace(/'/g, "'\\''");
  }

  // Layout constants (based on ~1080x1350 canvas at 4:5)
  const titleFontSize = 64;
  const factFontSize = 40;
  const brandFontSize = 28;
  const factLineHeight = 62;
  const topPadding = 160;
  const factStartY = topPadding + titleFontSize + 80;

  // Build filter chain: dark overlay → title → facts → branding
  const filters = [];

  // Semi-transparent dark overlay for text readability
  filters.push("drawbox=x=0:y=0:w=iw:h=ih:color=black@0.45:t=fill");

  // Title — centered, top area
  filters.push(
    `drawtext=textfile='${escPath(titleFile)}':fontsize=${titleFontSize}:fontcolor=white:borderw=3:bordercolor=black@0.6:x=(w-tw)/2:y=${topPadding}:font=Arial`
  );

  // Decorative line under title
  const lineY = topPadding + titleFontSize + 30;
  filters.push(
    `drawbox=x=(iw/2-120):y=${lineY}:w=240:h=3:color=white@0.8:t=fill`
  );

  // Facts — left-aligned with padding, stacked
  for (let i = 0; i < factFiles.length; i++) {
    const y = factStartY + (i * factLineHeight);
    filters.push(
      `drawtext=textfile='${escPath(factFiles[i])}':fontsize=${factFontSize}:fontcolor=white:borderw=2:bordercolor=black@0.5:x=100:y=${y}:font=Arial`
    );
  }

  // Branding — bottom center
  const brandText = persona.brand.replace(/'/g, "\\'");
  filters.push(
    `drawtext=text='${brandText}':fontsize=${brandFontSize}:fontcolor=white@0.7:x=(w-tw)/2:y=h-80:font=Arial`
  );

  const filterStr = filters.join(',');
  const cmd = `ffmpeg -y -i "${bgPath}" -vf "${filterStr}" "${outputPath}"`;

  try {
    execSync(cmd, { timeout: 30000, stdio: 'pipe' });
  } finally {
    // Clean up temp text files
    [titleFile, ...factFiles].forEach(f => { try { fs.unlinkSync(f); } catch {} });
  }
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

  const dateStr = new Date().toISOString().slice(0, 10);

  // ========== NEWS MODE ==========
  if (opts.news) {
    console.log(`\n=== ${persona.name.toUpperCase()} NEWS POST GEN ===`);
    console.log('Mode: Newspaper-style viral news post\n');

    // Step 1: Search for viral Samoa news
    console.log('[Step 1] Searching for viral Samoa news...');
    const stories = await searchSamoaNews();

    console.log(`\n  Found ${stories.length} stories:`);
    for (let i = 0; i < stories.length; i++) {
      const s = stories[i];
      console.log(`  ${i + 1}. [${s.virality}/10] ${s.headline} (${s.source})`);
    }

    const topStory = stories[0];
    console.log(`\n  Selected: "${topStory.headline}" (virality: ${topStory.virality}/10)`);

    // Step 2: Generate newspaper post content
    console.log('\n[Step 2] Generating newspaper post content via Gemini...');
    const post = await generateNewspaperPost(topStory);

    const slug = post.headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').substring(0, 50);
    const outDir = path.join(OUTPUT_BASE, `${dateStr}-news-${slug}`);

    console.log(`\n--- NEWSPAPER POST ---`);
    console.log(`  Headline:    "${post.headline}"`);
    console.log(`  Subheadline: "${post.subheadline}"`);
    console.log(`  Body:        ${post.body}`);
    console.log(`  CTA:         ${post.cta}`);
    console.log(`  Image:       ${post.backgroundPrompt.substring(0, 80)}...`);
    console.log(`\n--- CAPTION ---`);
    console.log(post.caption);
    console.log(`--- HASHTAGS ---`);
    console.log(post.hashtags.join(' '));

    if (opts.dryRun) {
      console.log('\n[DRY RUN] Stopping here. No images generated.');
      const dryMeta = {
        type: 'news',
        headline: post.headline,
        subheadline: post.subheadline,
        body: post.body,
        cta: post.cta,
        caption: post.caption,
        hashtags: post.hashtags,
        news_source: post.newsSource,
        original_headline: post.originalHeadline,
        stories: stories.map(s => ({ headline: s.headline, source: s.source, virality: s.virality })),
        dry_run: true,
        created_at: new Date().toISOString(),
      };
      const dryPath = path.join(OUTPUT_BASE, `${dateStr}-news-${slug}-dryrun.json`);
      fs.writeFileSync(dryPath, JSON.stringify(dryMeta, null, 2));
      console.log(`Metadata saved: ${dryPath}`);
      return;
    }

    // Create output directory
    fs.mkdirSync(outDir, { recursive: true });

    // Step 3: Generate image via FAL (standalone bold graphic — no text overlay)
    console.log('\n[Step 3] Generating news image via FAL nano-banana-2 (4:5, 2K)...');
    const finalPath = path.join(outDir, 'infographic.png');
    const imgResult = await generateBackgroundImage(
      { backgroundPrompt: post.backgroundPrompt, includePersona: false, resolution: '2K' },
      finalPath
    );
    console.log(`  News image saved: ${finalPath}`);

    // Write sidecar JSON
    const sidecar = {
      infographic_id: `news-${dateStr}-${slug}`,
      type: 'news',
      topic: post.originalHeadline,
      pillar: 'news',
      title: post.headline,
      subheadline: post.subheadline,
      body: post.body,
      cta: post.cta,
      facts: [post.subheadline, post.body],
      caption: post.caption,
      hashtags: post.hashtags,
      news_source: post.newsSource,
      original_headline: post.originalHeadline,
      image_path: finalPath,
      width: imgResult.width,
      height: imgResult.height,
      created_at: new Date().toISOString(),
    };

    const sidecarPath = path.join(outDir, 'infographic.json');
    fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));

    console.log('\n=== NEWS POST GEN COMPLETE ===');
    console.log(`Image:    ${finalPath}`);
    console.log(`Output:   ${outDir}`);
    console.log(`Sidecar:  ${sidecarPath}`);
    console.log(`Story:    ${post.originalHeadline}`);
    console.log(`Source:   ${post.newsSource}`);
    console.log(`\nNext: node skills/infographic-publish/scripts/infographic-publish.js`);
    return;
  }

  // ========== STANDARD INFOGRAPHIC MODE ==========

  // Select topic
  const topicObj = selectTopic(opts.topic);
  const slug = topicObj.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
  const outDir = path.join(OUTPUT_BASE, `${dateStr}-${slug}`);

  console.log(`\n=== ${persona.name.toUpperCase()} INFOGRAPHIC GEN ===`);
  console.log(`Topic:   ${topicObj.topic}`);
  console.log(`Pillar:  ${topicObj.pillar}`);
  console.log(`Output:  ${outDir}`);

  // Step 1: Gemini infographic plan
  console.log('\n[Step 1] Generating infographic plan via Gemini...');
  const plan = await generateInfographicPlan(topicObj, opts.facts);

  console.log(`\n--- INFOGRAPHIC PLAN ---`);
  console.log(`  Title: "${plan.title}"`);
  console.log(`  Facts (${plan.facts.length}):`);
  for (const fact of plan.facts) {
    console.log(`    • ${fact}`);
  }
  console.log(`  Background: ${plan.backgroundPrompt.substring(0, 80)}...`);
  console.log(`  Persona in image: ${plan.includePersona ? 'YES' : 'NO'}`);
  console.log(`\n--- CAPTION ---`);
  console.log(plan.caption);
  console.log(`--- HASHTAGS ---`);
  console.log(plan.hashtags.join(' '));

  if (opts.dryRun) {
    console.log('\n[DRY RUN] Stopping here. No images generated.');
    savePillar(topicObj.pillar);

    const dryMeta = {
      topic: topicObj.topic,
      pillar: topicObj.pillar,
      title: plan.title,
      facts: plan.facts,
      caption: plan.caption,
      hashtags: plan.hashtags,
      dry_run: true,
      created_at: new Date().toISOString(),
    };
    const dryPath = path.join(OUTPUT_BASE, `${dateStr}-${slug}-dryrun.json`);
    fs.writeFileSync(dryPath, JSON.stringify(dryMeta, null, 2));
    console.log(`Metadata saved: ${dryPath}`);
    return;
  }

  // Create output directory
  fs.mkdirSync(outDir, { recursive: true });

  // Step 2: Generate background via FAL
  console.log('\n[Step 2] Generating background image via FAL nano-banana-2 (4:5)...');
  const bgPath = path.join(outDir, 'background-raw.png');
  const imgResult = await generateBackgroundImage(plan, bgPath);

  // Step 3: Composite infographic
  console.log('\n[Step 3] Compositing infographic (overlay + title + facts + branding)...');
  const finalPath = path.join(outDir, 'infographic.png');
  compositeInfographic(bgPath, finalPath, plan.title, plan.facts);

  // Clean up raw background
  if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);

  console.log(`  Infographic saved: ${finalPath}`);

  savePillar(topicObj.pillar);

  // Write sidecar JSON
  const sidecar = {
    infographic_id: `infographic-${dateStr}-${slug}`,
    topic: topicObj.topic,
    pillar: topicObj.pillar,
    title: plan.title,
    facts: plan.facts,
    caption: plan.caption,
    hashtags: plan.hashtags,
    image_path: finalPath,
    width: imgResult.width,
    height: imgResult.height,
    created_at: new Date().toISOString(),
  };

  const sidecarPath = path.join(outDir, 'infographic.json');
  fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));

  console.log('\n=== INFOGRAPHIC GEN COMPLETE ===');
  console.log(`Image:    ${finalPath}`);
  console.log(`Output:   ${outDir}`);
  console.log(`Sidecar:  ${sidecarPath}`);
  console.log(`Topic:    ${topicObj.topic}`);
  console.log(`Pillar:   ${topicObj.pillar}`);
  console.log(`\nNext: node skills/infographic-publish/scripts/infographic-publish.js`);
}

main().catch(e => {
  console.error(`\nError: ${e.message}`);
  process.exit(1);
});
