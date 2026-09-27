/**
 * seo-caption.js — shared SEO caption writer for Instagram + TikTok.
 *
 * Kevin 2026-07-08: captions are search surface now — both platforms index
 * caption text to decide WHO to show the content to. Every IG/TikTok
 * publisher calls this at publish time so the wording stays current instead
 * of aging in static banks. The old bank caption rides along as the seed
 * (voice/CTA reference) AND the fallback — an API hiccup must never block a
 * publish (standing rule since the 07-07 outage).
 *
 * Usage:
 *   const { writeSeoCaptions } = require("../../lib/seo-caption");
 *   const c = await writeSeoCaptions({
 *     persona: { name, voice, niche },        // whatever is known — all optional
 *     topic: "reaction meme — one app posts to every platform",
 *     onScreenTexts: [hook, reveal, payoff, mega],
 *     seedCaptions: { instagram: igBank, tiktok: ttBank },
 *     hashtags: ["#creatoros", ...],
 *   });
 *   c.instagram / c.tiktok  → full captions
 *   c.tiktokTitle           → <90 char first line for the Zernio content field
 *   c.generated             → false when the fallback was used
 */

const { createMessage } = require("./llm");

// Unset → the llm gateway routes to OLLAMA_TEXT_MODEL (DeepSeek).
const MODEL = process.env.SEO_CAPTION_MODEL || null;

const SCHEMA = {
  type: "object",
  properties: {
    instagram: { type: "string" },
    tiktok: { type: "string" },
    tiktok_title: { type: "string" },
  },
  required: ["instagram", "tiktok", "tiktok_title"],
  additionalProperties: false,
};

// Em/en dashes read as AI-written (Kevin's tell rule) — scrub everywhere.
const deDash = (s) => String(s).replace(/\s*[—–]\s*/g, " - ");

function buildPrompt({ persona, topic, onScreenTexts, seedCaptions, hashtags }) {
  return `Write the Instagram caption and TikTok caption for a short-form video, optimized for 2026 platform SEO — caption text is indexed for search and tells the algorithm who to show the video to.

WHAT THE VIDEO IS: ${topic || "short-form creator content about Creator OS, the app that posts to every social platform at once"}
ON-SCREEN TEXT BEATS: ${(onScreenTexts || []).filter(Boolean).map((t) => `"${t}"`).join(" → ") || "(none)"}
PERSONA VOICE: ${persona?.name || "creator"} — ${persona?.voice || "casual lowercase creator voice, confident, no hype words"}
NICHE / AUDIENCE: ${persona?.niche || "content creators, UGC creators, and social media managers who post on multiple platforms"}

RULES:
- Write like a real creator, not a brand. Lowercase-casual is fine. Current creator vocab where it fits naturally (POV, no bc, era, the way..., lowkey) — never forced, never more than one per caption.
- SEO: weave in phrases people actually SEARCH on these platforms, in natural sentences — e.g. "social media manager app", "how to post on all platforms at once", "content scheduler for creators", "ugc creator tips", "ai social media manager", "grow on instagram", "content calendar". Describe what the video shows and literally name who it's for (ugc creators, social media managers, small business owners) so the algo can match it.
- Instagram: hook line first, then a short paragraph (2-4 sentences) rich with searchable phrasing, then the CTA "the app is in my bio" (or natural variant), then 6-10 hashtags mixing broad + niche + search-style. Under 1500 chars total.
- TikTok: hook line first (this also becomes the title), then 2-4 short keyword-rich lines, CTA "app in bio", then 4-6 hashtags. Under 1000 chars.
- tiktok_title: the TikTok hook line alone, under 85 characters.
- Emoji: a few, where a creator would put them. NEVER use em dashes or en dashes anywhere.
- Keep any factual claims aligned with the on-screen text; don't invent numbers.

STYLE SEEDS (match this energy, do not copy):
IG: ${seedCaptions?.instagram || "(none)"}
TT: ${seedCaptions?.tiktok || "(none)"}

Suggested hashtags to draw from (add search-intent ones of your own): ${(hashtags || []).join(" ")}`;
}

async function writeSeoCaptions(input) {
  const key = process.env.OLLAMA_API_KEY;
  const fallback = {
    instagram: input.seedCaptions?.instagram || "",
    tiktok: input.seedCaptions?.tiktok || "",
    tiktokTitle: (input.seedCaptions?.tiktok || "").split("\n")[0].slice(0, 85),
    generated: false,
  };
  if (!key) return fallback;
  try {
    const body = {
      model: MODEL,
      max_tokens: 1500,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      system:
        "You are a short-form social SEO copywriter for creator accounts. You write captions that read 100% human and are dense with the exact phrases the target audience searches.",
      messages: [{ role: "user", content: buildPrompt(input) }],
    };
    const json = await createMessage(body);
    const block = (json.content || []).find((b) => b.type === "text");
    const out = JSON.parse(block.text);
    return {
      instagram: deDash(out.instagram).slice(0, 2100),
      tiktok: deDash(out.tiktok).slice(0, 2100),
      tiktokTitle: deDash(out.tiktok_title).slice(0, 88),
      generated: true,
    };
  } catch (e) {
    console.warn(`  ! seo-caption failed (${e.message}) — using bank caption`);
    return fallback;
  }
}

module.exports = { writeSeoCaptions };
