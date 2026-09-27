#!/usr/bin/env node
/**
 * tips-style-variant — write a styled rewrite of every original tip in the
 * bank and append the variants as additional tips (Kevin 2026-07-10: "with
 * alex hormozi writing style, create a duplicate additional variation of all
 * 171 tips").
 *
 * Variants carry `style` + `variant_of` (the original's key) and keep the
 * original's category/audience/source, so tips-classify skips them and the
 * thread rotation can avoid pairing an original with its own restyle in one
 * thread. Resume-safe: originals that already have a variant of this style
 * are skipped, and the bank is saved after every batch.
 *
 * Usage: node --env-file=.env.local tips-style-variant.js [--style hormozi]
 *        [--batch 10] [--dry-run]
 */
const fs = require("fs");
const path = require("path");

const { createMessage } = require("../../../lib/llm");

// Unset → the llm gateway routes to OLLAMA_TEXT_MODEL (DeepSeek).
const MODEL = process.env.TIPS_MODEL || null;
const BANK = path.join(__dirname, "..", "data", "jun-yuh-tips.json");
if (!process.env.OLLAMA_API_KEY) { console.error("OLLAMA_API_KEY required"); process.exit(1); }

function arg(n, d) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; }
const STYLE = arg("--style", "hormozi");
const BATCH = parseInt(arg("--batch", "10"), 10);
const DRY = process.argv.includes("--dry-run");

const key = (t) => t.headline.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);
// Kevin's tell rule: no em/en dashes anywhere in bank copy.
const deDash = (s) => String(s).replace(/\s*[—–]\s*/g, " - ");

const STYLES = {
  // Same principle, NOVEL anchor (Kevin 2026-07-10: "get the jist of the tip
  // and make a novel example that rhymes so the threads are not sounding the
  // exact same"). This is NOT a voice restyle — it swaps the tip's concrete
  // example/number/scenario for a fresh one that teaches the same lesson.
  remix: `First identify the tip's underlying PRINCIPLE. Then write a NEW tip that teaches the same principle through a COMPLETELY DIFFERENT concrete anchor: a different number, analogy, scenario or mechanism.
Example: original "Commit to 100 videos before judging your results" → remix "It takes 22 days to build a habit. Commit to 22 days of posting before you judge anything. By the time the habit locks in, the momentum carries you."
Rules:
- The remix must NOT reuse the original's key numbers, examples or metaphors. If the original says 100 videos, the remix anchors on days, reps, hours or another credible frame.
- The new anchor must be practical and credible for a beginner creator (folk-wisdom numbers like 21/22 days, 30-day challenges, 5-minute rules are fine).
- Keep the same category of advice and the same actionable outcome. Never contradict the original's principle.
- Punchy, conversational creator voice. No celebrity impression, no emojis, no hashtags, no em dashes.`,
  // Jun's own instructional voice + a fresh anchor — a second remix layer so
  // the same principle can resurface twice in a cycle without rhyming.
  jun: `First identify the tip's underlying PRINCIPLE. Then write a NEW tip that teaches the same principle through a COMPLETELY DIFFERENT concrete anchor: a different number, analogy, scenario or mechanism — different from the original AND from every EXISTING VARIATION listed for that tip.
Voice: the original creator-mentor tone of the bank (Jun Yuh) — warm, direct, practical. Second person. Short clear sentences. One specific mechanism the reader can run this week. Concrete over clever; zero hype, zero celebrity impression.
Rules:
- Do NOT reuse key numbers, examples or metaphors from the original or any listed existing variation.
- The new anchor must be practical and credible for a beginner creator.
- Keep the same category of advice and the same actionable outcome. Never contradict the principle.
- No emojis, no hashtags, no em dashes.`,
  hormozi: `Teach the SAME advice with the SAME specifics (numbers, tools, mechanics); only change the voice. Rewrite each tip in ALEX HORMOZI's writing voice:
- Short, punchy sentences. Fragments allowed. Zero fluff, zero hedging.
- Contrast framing: "Most people X. Winners do Y." / "You don't need X. You need Y."
- Brutal specificity: keep every number, timeframe and mechanic from the original; add simple math framing where natural ("That's 30 posts. Not 3.").
- Pain then payoff: name the cost of the current behavior, then the exact move.
- Direct second person. Imperatives. No emojis, no hashtags, no em dashes.
- Occasional Hormozi-isms where they fit naturally: "Here's the math.", "Read that again.", "It's not sexy. It works.", "Volume negates luck." Use sparingly, max one per tip.`,
  robbins: `Teach the SAME advice with the SAME specifics (numbers, tools, mechanics); only change the voice. Rewrite each tip in TONY ROBBINS' voice and tonality:
- High-energy empowerment: the reader is one DECISION away from a different result. Momentum, state, standards.
- Open with a rhetorical question or a challenge to the reader's current standard where natural ("What if the only thing between you and X was Y?", "Raise your standard.").
- Identity and decision language: "Decide.", "This is where everything changes.", "Progress equals happiness.", "Where focus goes, energy flows." Max one signature phrase per tip.
- Reframe the tip as taking MASSIVE ACTION on a simple mechanism; keep every number, tool and mechanic from the original exactly.
- Warm but commanding second person. Strategic ALL-CAPS on one or two power words max. No emojis, no hashtags, no em dashes, no exclamation spam (one "!" max per tip).`,
};
if (!STYLES[STYLE]) { console.error(`unknown style '${STYLE}' (have: ${Object.keys(STYLES).join(", ")})`); process.exit(1); }

const SCHEMA = {
  type: "object",
  properties: {
    variants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Index of the source tip in this batch" },
          headline: { type: "string", description: "Restyled headline, <=8 punchy words, imperative voice, must NOT repeat the original headline" },
          short: { type: "string", description: "Recap-checklist version, <=5 words, lowercase" },
          support: { type: "array", items: { type: "string" }, description: "1-2 support lines (never more), <=90 chars each" },
          thread: { type: "string", description: "Standalone tweet version WITHOUT a leading number, 150-220 chars, MUST end on a complete sentence with terminal punctuation" },
        },
        required: ["index", "headline", "short", "support", "thread"],
        additionalProperties: false,
      },
    },
  },
  required: ["variants"],
  additionalProperties: false,
};

const SYSTEM = `You write variations of creator-growth tips for an advice-thread bank. For EVERY tip in the batch, produce exactly one variation. The variation must not reuse the original's headline or its exact sentences.

${STYLES[STYLE]}

Field limits: headline <=8 words; short <=5 words lowercase; support lines <=90 chars; thread 150-220 chars, standalone, ENDING ON A COMPLETE SENTENCE.`;

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

async function restyleBatch(tips, siblingsOf = () => []) {
  const numbered = tips
    .map((t, i) => {
      const sib = siblingsOf(t)
        .map((s) => `  - (${s.style}) ${s.thread.replace(/\n/g, " ")}`)
        .join("\n");
      return `[TIP ${i}]\nheadline: ${t.headline}\nsupport: ${(t.support || []).join(" | ")}\nthread: ${t.thread}${sib ? `\nEXISTING VARIATIONS (do not reuse their anchors, numbers or examples):\n${sib}` : ""}`;
    })
    .join("\n\n---\n\n");
  const json = await createMessage({
    model: MODEL,
    max_tokens: 8000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: `TIPS BATCH:\n\n${numbered}\n\nRestyle every tip.` }],
  });
  const block = (json.content || []).find((b) => b.type === "text");
  return JSON.parse(block.text).variants || [];
}

(async () => {
  const bank = JSON.parse(fs.readFileSync(BANK, "utf8"));
  const originals = bank.tips.filter((t) => !t.style);
  const have = new Set(bank.tips.filter((t) => t.style === STYLE).map((t) => t.variant_of));
  const todo = originals.filter((t) => !have.has(key(t)));
  console.log(`bank: ${bank.tips.length} tips (${originals.length} originals, ${have.size} already ${STYLE}-styled) — restyling ${todo.length}`);

  // Existing variants per original, so remix-type styles can avoid landing
  // on an anchor a sibling variation already used.
  const siblings = new Map();
  for (const t of bank.tips) {
    if (!t.style) continue;
    if (!siblings.has(t.variant_of)) siblings.set(t.variant_of, []);
    siblings.get(t.variant_of).push(t);
  }
  const siblingsOf = (orig) => siblings.get(key(orig)) || [];

  let added = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const variants = await restyleBatch(batch, siblingsOf);
    for (const v of variants) {
      const src = batch[v.index];
      if (!src) continue;
      // Over-length threads trim at the last sentence boundary inside the
      // cap — a hard slice chops mid-word (2026-07-10: 291 of the first 342
      // variants shipped truncated and needed an API repair pass).
      let thread = deDash(v.thread);
      if (thread.length > 240) {
        const cut = thread.slice(0, 240);
        const end = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
        thread = end > 80 ? cut.slice(0, end + 1) : cut;
      }
      bank.tips.push({
        headline: deDash(v.headline),
        short: deDash(v.short),
        support: (v.support || []).slice(0, 2).map(deDash),
        thread,
        category: src.category,
        audience: src.audience,
        source: src.source,
        style: STYLE,
        variant_of: key(src),
      });
      added++;
    }
    if (!DRY) fs.writeFileSync(BANK, JSON.stringify(bank, null, 2) + "\n");
    console.log(`  batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(todo.length / BATCH)} — ${added} variants banked`);
    if (added > 0 && added % 50 < BATCH && added >= 50) console.log(`MILESTONE: ${added} ${STYLE} variants banked`);
  }
  console.log(`DONE: ${added} ${STYLE} variants added — bank now ${bank.tips.length} tips`);
})();
