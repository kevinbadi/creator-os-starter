#!/usr/bin/env node
/**
 * tips-classify — tag every tip in the bank with its audience so series
 * assembly can pull creator-relevant tips only. Jun Yuh's archive mixes
 * creator-growth advice with his original study/med-school content; the
 * carousel targets new UGC creators.
 *
 *   creator_growth       — directly about content, social growth, posting
 *   general_productivity — adaptable to creators (focus windows, Pomodoro…)
 *   study_academic       — flashcards, lectures, exams: off-topic
 *
 * Usage: node --env-file=.env.local tips-classify.js
 */
const fs = require("fs");
const path = require("path");

const { createMessage } = require("../../../lib/llm");

// Unset → the llm gateway routes to OLLAMA_TEXT_MODEL (DeepSeek).
const MODEL = process.env.TIPS_MODEL || null;
const BANK = path.join(__dirname, "..", "data", "jun-yuh-tips.json");

const SCHEMA = {
  type: "object",
  properties: {
    classifications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          audience: { type: "string", enum: ["creator_growth", "general_productivity", "study_academic"] },
        },
        required: ["index", "audience"],
        additionalProperties: false,
      },
    },
  },
  required: ["classifications"],
  additionalProperties: false,
};

async function classifyBatch(tips, offset) {
  const list = tips.map((t, i) => `[${i}] ${t.headline} — ${(t.support || []).join(" / ")}`).join("\n");
  const json = await createMessage({
    model: MODEL,
    max_tokens: 4000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    system:
      "Classify each tip's audience. creator_growth = directly about making content, growing social accounts, posting, hooks, platforms. " +
      "general_productivity = not content-specific but a creator could apply it as-is (focus, procrastination, time-boxing). " +
      "study_academic = about studying, lectures, exams, flashcards, school — off-topic for content creators.",
    messages: [{ role: "user", content: `Classify every tip:\n${list}` }],
  });
  const block = (json.content || []).find((b) => b.type === "text");
  for (const c of JSON.parse(block.text).classifications) {
    if (tips[c.index]) tips[c.index].audience = c.audience;
  }
}

async function main() {
  const bank = JSON.parse(fs.readFileSync(BANK, "utf8"));
  const todo = bank.tips.filter((t) => !t.audience);
  console.log(`${todo.length} unclassified of ${bank.tips.length}`);
  for (let i = 0; i < todo.length; i += 50) {
    await classifyBatch(todo.slice(i, i + 50), i);
    fs.writeFileSync(BANK, JSON.stringify(bank, null, 2));
    console.log(`  classified ${Math.min(i + 50, todo.length)}/${todo.length}`);
  }
  const counts = {};
  for (const t of bank.tips) counts[t.audience || "unknown"] = (counts[t.audience || "unknown"] || 0) + 1;
  console.log("Audience counts:", JSON.stringify(counts));
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
