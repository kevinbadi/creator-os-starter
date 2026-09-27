#!/usr/bin/env node
/**
 * jun-tips-harvest — distill a scraped creator's post archive (Apify dataset)
 * into the advice-carousel tip bank.
 *
 * Built for Jun Yuh (@jun_yuh — systems-as-content, 8M followers): his post
 * captions carry the actual advice, so extraction runs on captions. Each
 * Claude call sees a batch of captions plus the bank's existing tip headlines,
 * extracts only NEW actionable tips, and returns them in the exact shape the
 * advice-carousel templates use (headline / short / support / thread) plus a
 * category and the source post index for engagement-based ranking.
 *
 * Output: data/jun-yuh-tips.json — { tips: [ {headline, short, support,
 * thread, category, source: {url, likes, comments, ts, excerpt}} ] },
 * saved incrementally after every batch (safe to re-run / resume: already-
 * processed post urls are skipped).
 *
 * Progress: prints a "MILESTONE" block every 50 banked tips (Kevin wants
 * quality pings at that cadence).
 *
 * Usage:
 *   node --env-file=.env.local jun-tips-harvest.js --dataset <apifyDatasetId>
 *        [--limit 2000] [--batch 20] [--min-caption 120]
 *   node --env-file=.env.local jun-tips-harvest.js --transcripts <file.json>
 *        # harvest from reel transcripts (built by jun-reels-transcribe.js)
 *        # instead of captions — same bank, same dedup, same milestones.
 */

const fs = require("fs");
const path = require("path");

const { createMessage } = require("../../../lib/llm");

const OLLAMA_KEY = process.env.OLLAMA_API_KEY;
const APIFY_TOKEN = process.env.APIFY_TOKEN;
// Unset → the llm gateway routes to OLLAMA_TEXT_MODEL (DeepSeek).
const MODEL = process.env.TIPS_MODEL || null;
const OUT = path.join(__dirname, "..", "data", "jun-yuh-tips.json");

function arg(n, d) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; }
const DATASET = arg("--dataset");
const TRANSCRIPTS = arg("--transcripts");
const LIMIT = parseInt(arg("--limit", "2000"), 10);
const BATCH = parseInt(arg("--batch", TRANSCRIPTS ? "10" : "20"), 10);
const MIN_CAPTION = parseInt(arg("--min-caption", "120"), 10);
if (!DATASET && !TRANSCRIPTS) { console.error("--dataset <apifyDatasetId> or --transcripts <file> required"); process.exit(1); }
if (!OLLAMA_KEY) { console.error("OLLAMA_API_KEY required"); process.exit(1); }
if (DATASET && !APIFY_TOKEN) { console.error("APIFY_TOKEN required"); process.exit(1); }

const SCHEMA = {
  type: "object",
  properties: {
    tips: {
      type: "array",
      items: {
        type: "object",
        properties: {
          headline: { type: "string", description: "Slide headline, <=8 punchy words, imperative voice" },
          short: { type: "string", description: "Recap-checklist version, <=5 words, lowercase" },
          support: { type: "array", items: { type: "string" }, description: "1-2 support lines (never more than 2), <=90 chars each" },
          thread: { type: "string", description: "Standalone tweet version WITHOUT a leading number, <=240 chars" },
          category: { type: "string", enum: ["hooks", "systems", "consistency", "platform_mechanics", "niche_audience", "scripting", "mindset", "repurposing", "analytics", "monetization"] },
          source_index: { type: "integer", description: "Index of the source post in this batch" },
        },
        required: ["headline", "short", "support", "thread", "category", "source_index"],
        additionalProperties: false,
      },
    },
  },
  required: ["tips"],
  additionalProperties: false,
};

const SYSTEM = `You are distilling a top creator-growth educator's Instagram content (post captions and spoken reel transcripts) into a reusable tip bank for advice carousels aimed at brand-new UGC/content creators.

Extract only REAL, ACTIONABLE, SPECIFIC tips — things a beginner could act on today. The test: "could the viewer do this this week without buying anything?"

Rules:
- Extract a tip ONLY when the text actually teaches it (not when it merely mentions a topic or teases a video). If a caption's advice lives in the video and the caption is just a teaser, skip it. Transcripts are spoken-word — ignore filler, sponsor reads, and intros; extract the taught mechanics.
- SKIP: pure motivation/inspiration, personal announcements, giveaways, brand-deal promos, engagement bait, anything already covered by the EXISTING TIP HEADLINES provided (semantic duplicates count — "post daily" == "be consistent every day").
- One caption can yield 0, 1, or several tips. Most captions yield 0-1. Be selective — this bank feeds a premium daily carousel; mediocre tips dilute it.
- Rewrite in OUR voice: punchy, concrete, second person, no hashtags, no emojis, no creator's name. Keep any specific numbers/mechanics from the source (times, ratios, retention thresholds, formulas) — specificity is the value.
- headline <=8 words; support lines <=90 chars; thread <=240 chars and must stand alone without the carousel.`;

async function fetchJSON(url, opts, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, opts);
    if (res.ok) return res.json();
    if (attempt < retries && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

async function loadPosts() {
  const items = [];
  for (let offset = 0; items.length < LIMIT; offset += 500) {
    const page = await fetchJSON(
      `https://api.apify.com/v2/datasets/${DATASET}/items?token=${APIFY_TOKEN}&offset=${offset}&limit=500&clean=true`,
    );
    items.push(...page);
    if (page.length < 500) break;
  }
  return items;
}

async function extractBatch(posts, existingHeadlines) {
  const numbered = posts
    .map((p, i) => `[POST ${i}] (${p.likes ?? "?"} likes, ${p.comments ?? "?"} comments)\n${p.caption}`)
    .join("\n\n---\n\n");
  const body = {
    model: MODEL,
    max_tokens: 8000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{
      role: "user",
      content:
        `EXISTING TIP HEADLINES (do not duplicate, semantically):\n${existingHeadlines.map((h) => `- ${h}`).join("\n") || "(none yet)"}\n\n` +
        `CAPTIONS BATCH:\n\n${numbered}\n\nExtract the new tips.`,
    }],
  };
  const json = await createMessage(body);
  const block = (json.content || []).find((b) => b.type === "text");
  return JSON.parse(block.text).tips || [];
}

function loadBank() {
  if (fs.existsSync(OUT)) return JSON.parse(fs.readFileSync(OUT, "utf8"));
  return { source: "jun_yuh (Instagram, via Apify)", model: MODEL, harvested_at: null, posts_scanned: 0, processed_urls: [], tips: [] };
}

function saveBank(bank) {
  bank.harvested_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(bank, null, 2));
}

function milestone(bank, since) {
  const fresh = bank.tips.slice(-since);
  console.log(`\n${"=".repeat(64)}\n📌 MILESTONE: ${bank.tips.length} tips banked (${bank.posts_scanned} posts scanned)`);
  for (const t of fresh.slice(-5)) {
    console.log(`  • [${t.category}] ${t.headline} — ${t.support[0] || ""}`);
  }
  console.log("=".repeat(64));
}

async function main() {
  let posts;
  if (TRANSCRIPTS) {
    console.log(`Loading transcripts ${TRANSCRIPTS}…`);
    const doc = JSON.parse(fs.readFileSync(TRANSCRIPTS, "utf8"));
    const isSpeech = (r) => {
      if (typeof r.speech === "boolean") return r.speech;
      // Legacy entries without the flag: same heuristic as the transcriber.
      const t = (r.transcript || "").trim();
      const words = t.split(/\s+/).filter(Boolean);
      const asciiRatio = t.length ? [...t].filter((c) => c.charCodeAt(0) < 128).length / t.length : 0;
      const uniqRatio = words.length ? new Set(words.map((x) => x.toLowerCase())).size / words.length : 0;
      return t.length > 200 && asciiRatio > 0.9 && uniqRatio > 0.25;
    };
    posts = (doc.reels || [])
      .filter((r) => isSpeech(r) && (r.transcript || "").trim().length >= MIN_CAPTION)
      .map((r) => ({
        // Distinct key so a reel's transcript is processed even if its caption was.
        url: `${r.url}#transcript`,
        caption: `[SPOKEN TRANSCRIPT]\n${r.transcript.trim()}${r.caption ? `\n\n[CAPTION]\n${r.caption.trim()}` : ""}`,
        likes: r.likes ?? null,
        comments: r.comments ?? null,
        ts: r.ts || null,
      }));
    console.log(`  ${posts.length} transcripts with substance (>=${MIN_CAPTION} chars)`);
  } else {
    console.log(`Loading dataset ${DATASET}…`);
    const raw = await loadPosts();
    console.log(`  ${raw.length} items from Apify`);
    posts = raw
      .map((it) => ({
        url: it.url || it.postUrl || (it.shortCode ? `https://www.instagram.com/p/${it.shortCode}/` : null),
        caption: (it.caption || "").trim(),
        likes: it.likesCount ?? null,
        comments: it.commentsCount ?? null,
        ts: it.timestamp || null,
      }))
      .filter((p) => p.url && p.caption.length >= MIN_CAPTION);
    console.log(`  ${posts.length} posts with substantive captions (>=${MIN_CAPTION} chars)`);
  }

  const bank = loadBank();
  const done = new Set(bank.processed_urls);
  const todo = posts.filter((p) => !done.has(p.url));
  console.log(`  ${todo.length} not yet processed (${done.size} already done)\n`);

  let lastMilestone = Math.floor(bank.tips.length / 50);
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    let tips = [];
    try {
      tips = await extractBatch(batch, bank.tips.map((t) => t.headline));
    } catch (e) {
      console.error(`  ! batch ${i / BATCH + 1} failed (skipping): ${e.message}`);
    }
    for (const t of tips) {
      const src = batch[t.source_index] || {};
      bank.tips.push({
        headline: t.headline,
        short: t.short,
        support: t.support,
        thread: t.thread,
        category: t.category,
        source: { url: src.url, likes: src.likes, comments: src.comments, ts: src.ts, excerpt: (src.caption || "").slice(0, 160) },
      });
    }
    bank.processed_urls.push(...batch.map((p) => p.url));
    bank.posts_scanned = bank.processed_urls.length;
    saveBank(bank);
    console.log(`batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(todo.length / BATCH)}: +${tips.length} tips → ${bank.tips.length} total (${bank.posts_scanned} posts)`);

    if (Math.floor(bank.tips.length / 50) > lastMilestone) {
      lastMilestone = Math.floor(bank.tips.length / 50);
      milestone(bank, 50);
    }
  }

  console.log(`\n✅ DONE — ${bank.tips.length} tips from ${bank.posts_scanned} posts → ${path.relative(process.cwd(), OUT)}`);
  const byCat = {};
  for (const t of bank.tips) byCat[t.category] = (byCat[t.category] || 0) + 1;
  console.log("By category:", JSON.stringify(byCat, null, 2));
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
