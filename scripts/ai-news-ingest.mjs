#!/usr/bin/env node
/**
 * ai-news-ingest — the daily AI news agent.
 *
 * Pulls "what's hot today" lists from every source we can reach for free,
 * hands the new candidates to the LLM gateway (.claude/lib/llm.js → DeepSeek)
 * to classify (news / tool / idea), summarize, tag and score for
 * video-worthiness, then writes them into `ai_news_items` (the /dashboard/news
 * desk) and one daily brief row into `ai_news_briefs`.
 *
 * Sources (all keyless unless noted):
 *   producthunt   GraphQL, today's launches by votes      PRODUCTHUNT_TOKEN
 *   github-new    Search API, repos created ≤7d by stars (ai/llm/agents/mcp)
 *   github-trend  github.com/trending daily (scraped)
 *   github-rel    releases.atom for watched repos (Claude Code, OpenAI SDKs…)
 *   hackernews    Algolia front page + top "AI" stories
 *   hf-models     huggingface.co/api/models sort=trendingScore
 *   hf-papers     huggingface.co/api/daily_papers (curated arXiv)
 *   rss           OpenAI news, Google DeepMind blog, TechCrunch AI
 *
 * Scheduled by the content-cron registry (AI_NEWS_CRON_ENABLED=1, default
 * 7 ET). Safe to re-run: items upsert on (source, source_id), the brief upserts
 * on its ET day. Run locally: npm run ai-news
 *
 * Flags: --dry (collect + rank, no DB writes, no LLM)  --no-llm (write raw
 * candidates with heuristic kinds)  --limit N (candidates sent to the LLM, 60)
 */
import { Pool } from "pg";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const llm = require("../.claude/lib/llm.js");
const BLOCKLIST = require("./ai-news-blocklist.json").blocked.map((b) => ({ ...b, match: String(b.match).toLowerCase() }));
const blockedBy = (url) => {
  const u = String(url || "").toLowerCase();
  return u ? BLOCKLIST.find((b) => u.includes(b.match)) || null : null;
};

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const DRY = flag("--dry");
const NO_LLM = flag("--no-llm") || DRY;
const LIMIT = parseInt(opt("--limit", "140"), 10);
const KEEP_MAX = 100; // the daily top-100

const UA = "Mozilla/5.0 (compatible; CreatorOS-news/1.0; +https://creatoros.ca)";
const etDay = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const TODAY = etDay();

// ---------------------------------------------------------------- helpers
async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}
async function getText(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}
const decode = (s = "") =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? decode(m[1]) : "";
};
/** Minimal RSS/Atom → [{title, url, summary, publishedAt}] */
function parseFeed(xml, max = 20) {
  const items = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  return items.slice(0, max).map((it) => {
    let url = tag(it, "link");
    if (!url) {
      const href = it.match(/<link[^>]*href="([^"]+)"/i);
      url = href ? href[1] : "";
    }
    return {
      title: tag(it, "title"),
      url,
      summary: (tag(it, "description") || tag(it, "summary") || tag(it, "content")).slice(0, 600),
      publishedAt: tag(it, "pubDate") || tag(it, "published") || tag(it, "updated") || null,
    };
  });
}
const daysAgo = (n) => new Date(Date.now() - n * 864e5);
const isoDate = (d) => d.toISOString().slice(0, 10);
const cand = (o) => ({ imageUrl: null, summary: "", tags: [], meta: {}, score: 0, ...o });

// ---------------------------------------------------------------- sources
const SOURCES = {
  async producthunt() {
    const token = process.env.PRODUCTHUNT_TOKEN;
    if (!token) throw new Error("PRODUCTHUNT_TOKEN not set");
    const q = `{ posts(order: VOTES, postedAfter: "${daysAgo(1.2).toISOString()}", first: 40) { edges { node {
      id name tagline description votesCount commentsCount url website createdAt
      thumbnail { url } topics(first: 4) { edges { node { name } } } } } } }`;
    const json = await getJson("https://api.producthunt.com/v2/api/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: q }),
    });
    return (json.data?.posts?.edges || []).map(({ node: p }) =>
      cand({
        source: "producthunt", sourceId: `ph-${p.id}`, title: `${p.name}: ${p.tagline}`,
        url: p.url?.split("?")[0], summary: (p.description || "").slice(0, 600),
        imageUrl: p.thumbnail?.url || null, publishedAt: p.createdAt,
        score: p.votesCount, tags: p.topics.edges.map((e) => e.node.name.toLowerCase()),
        meta: { votes: p.votesCount, comments: p.commentsCount, website: p.website?.split("?")[0] },
      }),
    );
  },

  async "github-new"() {
    const since = isoDate(daysAgo(7));
    const h = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
    const seen = new Set();
    const out = [];
    for (const topic of ["ai", "llm", "ai-agents", "mcp"]) {
      const q = encodeURIComponent(`topic:${topic} created:>${since}`);
      let json;
      try {
        json = await getJson(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=20`, { headers: h });
      } catch (err) { console.warn(`  ! github-new ${topic}: ${err.message}`); continue; }
      for (const r of json.items || []) {
        if (seen.has(r.full_name) || r.stargazers_count < 15) continue;
        seen.add(r.full_name);
        out.push(cand({
          source: "github", sourceId: `repo-${r.full_name}`, title: `${r.full_name}: ${r.description || "new repo"}`.slice(0, 200),
          url: r.html_url, summary: r.description || "", imageUrl: r.owner?.avatar_url || null,
          publishedAt: r.created_at, score: r.stargazers_count,
          tags: (r.topics || []).slice(0, 6), meta: { stars: r.stargazers_count, lang: r.language, list: "new-this-week" },
        }));
      }
    }
    return out;
  },

  async "github-trend"() {
    const html = await getText("https://github.com/trending?since=daily");
    const out = [];
    const blocks = html.split('<article class="Box-row">').slice(1);
    for (const b of blocks.slice(0, 25)) {
      const name = (b.match(/href="\/([^"\/]+\/[^"\/]+)"/) || [])[1];
      if (!name) continue;
      const desc = decode((b.match(/<p class="col-9[^>]*>([\s\S]*?)<\/p>/) || [])[1] || "");
      const today = parseInt(((b.match(/([\d,]+) stars today/) || [])[1] || "0").replace(/,/g, ""), 10);
      const stars = parseInt(((b.match(/stargazers"[^>]*>[\s\S]*?([\d,]+)\s*<\/a>/) || [])[1] || "0").replace(/,/g, ""), 10);
      const lang = decode((b.match(/itemprop="programmingLanguage">([^<]+)/) || [])[1] || "");
      out.push(cand({
        source: "github", sourceId: `repo-${name}`, title: `${name}: ${desc || "trending"}`.slice(0, 200),
        url: `https://github.com/${name}`, summary: desc, score: today,
        imageUrl: `https://github.com/${name.split("/")[0]}.png?size=120`,
        tags: [lang.toLowerCase()].filter(Boolean), meta: { starsToday: today, stars, lang, list: "trending-daily" },
      }));
    }
    return out;
  },

  async "github-rel"() {
    const WATCH = ["anthropics/claude-code", "anthropics/anthropic-sdk-python", "openai/openai-python", "openai/codex", "google-gemini/gemini-cli", "ollama/ollama", "huggingface/transformers", "vllm-project/vllm", "comfyanonymous/ComfyUI", "n8n-io/n8n", "modelcontextprotocol/servers", "Lightricks/LTX-Video"];
    const out = [];
    await Promise.all(WATCH.map(async (repo) => {
      try {
        const xml = await getText(`https://github.com/${repo}/releases.atom`);
        for (const e of parseFeed(xml, 3)) {
          if (!e.publishedAt || new Date(e.publishedAt) < daysAgo(2)) continue;
          if (/nightly|alpha|beta|rc\d|preview|^stable$|^beta$|^latest$/i.test(e.title)) continue;
          out.push(cand({
            source: "github", sourceId: `rel-${repo}-${e.title}`, title: `${repo} ${e.title}`, url: e.url,
            summary: e.summary.slice(0, 500), publishedAt: e.publishedAt, score: 50,
            imageUrl: `https://github.com/${repo.split("/")[0]}.png?size=120`, tags: ["release"], meta: { repo, list: "release" },
          }));
        }
      } catch (err) { console.warn(`  ! ${repo} releases: ${err.message}`); }
    }));
    return out;
  },

  async hackernews() {
    const [front, ai] = await Promise.all([
      getJson("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=40"),
      getJson(`https://hn.algolia.com/api/v1/search?query=AI%20OR%20LLM%20OR%20agent%20OR%20model&tags=story&numericFilters=created_at_i>${Math.floor(daysAgo(1.2).getTime() / 1000)},points>30&hitsPerPage=40`),
    ]);
    const seen = new Set();
    return [...front.hits, ...ai.hits].filter((h) => !seen.has(h.objectID) && seen.add(h.objectID)).map((h) =>
      cand({
        source: "hackernews", sourceId: `hn-${h.objectID}`, title: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        publishedAt: h.created_at, score: h.points, meta: { points: h.points, comments: h.num_comments, hn: `https://news.ycombinator.com/item?id=${h.objectID}` },
      }),
    );
  },

  async "hf-models"() {
    const list = await getJson("https://huggingface.co/api/models?sort=trendingScore&limit=20");
    return list.map((m) =>
      cand({
        source: "huggingface", sourceId: `model-${m.id}`, title: `${m.id} (Hugging Face trending model)`,
        url: `https://huggingface.co/${m.id}`, publishedAt: m.createdAt || null, score: m.likes || 0,
        tags: [m.pipeline_tag].filter(Boolean), meta: { likes: m.likes, downloads: m.downloads, trending: m.trendingScore, list: "trending-models" },
      }),
    );
  },

  async "hf-papers"() {
    const list = await getJson("https://huggingface.co/api/daily_papers?limit=15");
    return list.map((p) =>
      cand({
        source: "huggingface", sourceId: `paper-${p.paper.id}`, title: p.paper.title, url: `https://huggingface.co/papers/${p.paper.id}`,
        summary: (p.paper.summary || "").slice(0, 600), publishedAt: p.publishedAt || p.paper.publishedAt, score: p.paper.upvotes || 0,
        imageUrl: p.thumbnail || null, tags: ["paper"], meta: { upvotes: p.paper.upvotes, arxiv: `https://arxiv.org/abs/${p.paper.id}`, list: "daily-papers" },
      }),
    );
  },

  async rss() {
    const FEEDS = [
      ["openai", "https://openai.com/news/rss.xml", 60],
      ["deepmind", "https://deepmind.google/blog/rss.xml", 60],
      ["techcrunch", "https://techcrunch.com/category/artificial-intelligence/feed/", 30],
      ["verge", "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", 25],
    ];
    const out = [];
    await Promise.all(FEEDS.map(async ([name, url, base]) => {
      try {
        const xml = await getText(url);
        for (const e of parseFeed(xml, 15)) {
          if (!e.title || !e.url) continue;
          if (e.publishedAt && new Date(e.publishedAt) < daysAgo(1.5)) continue;
          out.push(cand({ source: name, sourceId: e.url.split("?")[0], title: e.title, url: e.url, summary: e.summary, publishedAt: e.publishedAt, score: base, meta: { list: "rss" } }));
        }
      } catch (err) { console.warn(`  ! rss ${name}: ${err.message}`); }
    }));
    return out;
  },
};

// Normalize per-source scores to a 0..1 rank so a 400-vote PH post and a
// 40-star repo can sit in the same list.
function normalize(bySource) {
  const all = [];
  for (const [src, items] of Object.entries(bySource)) {
    const max = Math.max(1, ...items.map((i) => i.score));
    for (const it of items) all.push({ ...it, rank: it.score / max, via: src });
  }
  return all.sort((a, b) => b.rank - a.rank);
}

// ---------------------------------------------------------------- LLM pass
const AI_WORDS = /\b(ai|llm|gpt|claude|gemini|openai|anthropic|agent|model|diffusion|transformer|rag|mcp|copilot|whisper|inference|neural|deepseek|qwen|llama|mistral|hugging|ollama|comfy|voice|video gen)/i;

function heuristicKind(c) {
  if (c.source === "producthunt" || (c.source === "github" && c.meta.list !== "release")) return "tool";
  return "news";
}


/** createJson with a tolerant parse: DeepSeek sometimes leaves trailing commas or fences. */
async function jsonCall(body) {
  const res = await llm.createMessage(body);
  let text = String(res.content?.[0]?.text || "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const a = text.search(/[\[{]/);
  const b = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (a >= 0 && b > a) text = text.slice(a, b + 1);
  try { return JSON.parse(text); } catch {}
  const fixed = text.replace(/,\s*([\]}])/g, "$1");
  try { return JSON.parse(fixed); } catch (e) {
    throw new Error(`model did not return valid JSON (${e.message}): ${text.slice(0, 160)}`);
  }
}

const SYSTEM_CTX = `You are the AI news desk for Creator OS / KevBuildsApps: a YouTube + Threads channel run by Kevin, an indie founder who builds AI agents, automations and apps (Claude Code, MCP, voice agents, computer-use agents, video-gen models, open-source tools) and turns each into a short talking-head video. Audience: solo founders, marketers, agency owners, indie hackers.`;

const ITEM_SCHEMA = {
  type: "object",
  properties: { items: { type: "array", items: { type: "object", properties: {
    i: { type: "integer" }, keep: { type: "boolean" }, kind: { type: "string", enum: ["news", "tool", "idea"] },
    summary: { type: "string" }, tags: { type: "array", items: { type: "string" } },
    video_score: { type: "integer" }, angle: { type: "string" },
  }, required: ["i", "keep", "kind", "summary", "tags", "video_score"] } } },
  required: ["items"],
};
const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" }, bullets: { type: "array", items: { type: "string" } },
    video_ideas: { type: "array", items: { type: "object", properties: {
      title: { type: "string" }, hook: { type: "string" }, why: { type: "string" }, refs: { type: "array", items: { type: "integer" } },
    }, required: ["title", "hook", "why", "refs"] } },
  },
  required: ["headline", "bullets", "video_ideas"],
};

function signalOf(c) {
  const m = c.meta;
  return m.votes ? `${m.votes} PH votes` : m.starsToday ? `${m.starsToday} stars today` : m.stars ? `${m.stars} stars` : m.points ? `${m.points} HN pts` : m.upvotes ? `${m.upvotes} upvotes` : m.likes ? `${m.likes} likes` : m.list || "";
}
const rowOf = (c, i) => ({ i, source: c.via, title: c.title.slice(0, 160), summary: (c.summary || "").slice(0, 240), signal: signalOf(c) });

/** Judge candidates in parallel chunks of 35 so DeepSeek never truncates. */
async function judge(cands) {
  const system = `${SYSTEM_CTX}

For each candidate decide:
- keep: false only for items with zero relevance to AI, dev tools, automation or creator tech (pure politics, sports, unrelated science). Keep everything else, this feeds a daily top-100 list.
- kind: "news" (model drop, funding, policy, announcement, research), "tool" (a product, repo, API or model someone could use today), "idea" only if the item itself is a content angle.
- summary: 1-2 plain sentences, concrete, no hype words, what it is and why it matters for Kevin's audience. Never use em dashes.
- tags: 2-5 lowercase tags (company, category).
- video_score: 0-10 how strong this is as a KevBuildsApps short/tutorial (10 = must make today). Favor: free/open-source, "build X for $0", tools with an API/MCP, big-lab drops, things that make money for small operators.
- angle: one-line spoken video hook if score >= 6, else empty string.
Return one entry per candidate index.`;
  const CH = 35;
  const chunks = [];
  for (let s = 0; s < cands.length; s += CH) chunks.push(cands.slice(s, s + CH).map((c, k) => rowOf(c, s + k)));
  const results = await Promise.all(chunks.map(async (rows, n) => {
    try {
      const out = await jsonCall({
        system, max_tokens: 7000,
        messages: [{ role: "user", content: `Date: ${TODAY} (ET). Chunk ${n + 1}/${chunks.length}.\n\nCANDIDATES (JSON):\n${JSON.stringify(rows)}` }],
        output_config: { format: { schema: ITEM_SCHEMA } },
      });
      return out.items || [];
    } catch (err) {
      console.warn(`  ! judge chunk ${n + 1}: ${err.message}`);
      return [];
    }
  }));
  return new Map(results.flat().filter((j) => Number.isInteger(j.i)).map((j) => [j.i, j]));
}

/** One brief over the strongest kept items. */
async function brief(kept) {
  const top = kept.slice(0, 45);
  const rows = top.map((c, i) => ({ i, kind: c.kind, source: c.via, title: c.title.slice(0, 140), summary: (c.summary || "").slice(0, 200), video_score: c.videoScore, signal: signalOf(c) }));
  const system = `${SYSTEM_CTX}

Write today's brief from the ranked items:
- headline: one punchy line naming the biggest story of the day.
- bullets: 6-10 bullets covering the day's biggest stories and best new tools, each naming the item by title (never by index), one concrete sentence each. Never use em dashes.
- video_ideas: 4-6 ideas Kevin should film (title, spoken hook line, why now, refs = item indexes used). Favor tutorials someone can copy and "free / open source" angles.`;
  return jsonCall({
    system, max_tokens: 4000,
    messages: [{ role: "user", content: `Date: ${TODAY} (ET).\n\nITEMS (JSON):\n${JSON.stringify(rows)}` }],
    output_config: { format: { schema: BRIEF_SCHEMA } },
  });
}

// ---------------------------------------------------------------- DB
const ITEMS_DDL = `create table if not exists ai_news_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('news', 'tool', 'idea')),
  title text not null, summary text, url text,
  source text not null default 'manual', source_id text not null, image_url text,
  published_at timestamptz, ingested_at timestamptz not null default now(),
  tags text[] not null default '{}',
  status text not null default 'new' check (status in ('new', 'saved', 'used', 'dismissed')),
  extra jsonb not null default '{}'::jsonb
)`;
const BRIEFS_DDL = `create table if not exists ai_news_briefs (
  brief_date date primary key,
  headline text not null,
  bullets jsonb not null default '[]'::jsonb,
  video_ideas jsonb not null default '[]'::jsonb,
  item_count int not null default 0,
  sources jsonb not null default '{}'::jsonb,
  model text,
  created_at timestamptz not null default now()
)`;

async function main() {
  console.log(`ai-news-ingest ${TODAY}${DRY ? " (dry)" : ""}`);
  const bySource = {};
  await Promise.all(Object.entries(SOURCES).map(async ([name, fn]) => {
    try {
      const items = (await fn()).filter((c) => c.title && c.url);
      bySource[name] = items;
      console.log(`  ✓ ${name.padEnd(13)} ${items.length}`);
    } catch (err) {
      bySource[name] = [];
      console.warn(`  ✗ ${name.padEnd(13)} ${err.message}`);
    }
  }));
  let ranked = normalize(bySource);
  // dedupe by url/sourceId across sources (HN + TechCrunch often carry the same link)
  const seenUrl = new Set();
  ranked = ranked.filter((c) => {
    const k = (c.url || "").replace(/\/$/, "").toLowerCase();
    if (seenUrl.has(k)) return false;
    seenUrl.add(k);
    return true;
  });
  const sourceCounts = Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, v.length]));
  // Blocklisted URLs (scripts/ai-news-blocklist.json) never reach the desk, the LLM, or the brief.
  const blocked = ranked.filter((c) => blockedBy(c.url));
  if (blocked.length) {
    ranked = ranked.filter((c) => !blockedBy(c.url));
    for (const c of blocked) console.log(`  ⛔ blocklisted ${c.via} ${c.url}`);
  }
  console.log(`  ${ranked.length} candidates after dedupe`);

  if (DRY) {
    for (const c of ranked.slice(0, 40)) console.log(`  ${c.rank.toFixed(2)} ${c.via.padEnd(12)} ${c.title.slice(0, 90)}`);
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
  await pool.query(ITEMS_DDL);
  await pool.query(`create unique index if not exists ai_news_items_source_uid on ai_news_items (source, source_id)`);
  await pool.query(BRIEFS_DDL);
  // Retroactively hide anything already stored that matches the blocklist (items and ideas built on them).
  if (BLOCKLIST.length) {
    const pats = BLOCKLIST.map((b) => `%${b.match}%`);
    const { rowCount } = await pool.query(
      `update ai_news_items set status = 'dismissed'
        where status <> 'dismissed'
          and (lower(coalesce(url, '')) like any($1) or lower((extra->'refs')::text) like any($1))`,
      [pats],
    );
    if (rowCount) console.log(`  ⛔ dismissed ${rowCount} stored item(s) matching the blocklist`);
  }

  // Skip candidates we already hold (keeps the LLM pass to what is new today).
  const { rows: existing } = await pool.query(
    `select source, source_id, kind, summary, tags, extra from ai_news_items
      where source = any($1) and source_id = any($2)
        and (extra->>'videoScore') is not null`, // unscored rows (model outage) get re-judged
    [ranked.map((c) => c.source), ranked.map((c) => c.sourceId)],
  );
  const prior = new Map(existing.map((r) => [`${r.source}|${r.source_id}`, r]));
  const have = new Set(prior.keys());
  const fresh = ranked.filter((c) => !have.has(`${c.source}|${c.sourceId}`));
  // Non-AI HN front-page stories are only worth the model's time if they look AI-ish.
  const pool0 = fresh.filter((c) => c.via !== "hackernews" || AI_WORDS.test(c.title));
  const batch = pool0.slice(0, LIMIT);
  console.log(`  ${fresh.length} new · ${batch.length} sent to LLM`);

  let judged = new Map();
  if (!NO_LLM && batch.length) {
    judged = await judge(batch);
    console.log(`  ✓ llm judged ${judged.size}/${batch.length}`);
  }
  const usedLlm = judged.size > 0;

  // Rank: model video score first, then source-normalized rank. Cap at 100/day.
  const kept = [];
  for (let i = 0; i < batch.length; i++) {
    const c = batch[i];
    const j = judged.get(i);
    if (usedLlm && j && j.keep === false) continue;
    if (!usedLlm && c.via === "hackernews" && !AI_WORDS.test(c.title)) continue;
    const kind = j?.kind && ["news", "tool", "idea"].includes(j.kind) ? j.kind : heuristicKind(c);
    kept.push({ ...c, idx: i, kind, judged: j, videoScore: j?.video_score ?? 0 });
  }
  // Still-trending items judged on an earlier day stay in today's top-100 with
  // their existing score (no second model pass), re-stamped to today's list.
  for (const c of ranked) {
    const r = prior.get(`${c.source}|${c.sourceId}`);
    if (!r) continue;
    kept.push({ ...c, idx: -1, kind: r.kind, judged: { summary: r.summary, tags: r.tags || [], video_score: Number(r.extra?.videoScore) || 0, angle: r.extra?.angle || null }, videoScore: Number(r.extra?.videoScore) || 0, carried: true });
  }
  kept.sort((a, b) => b.videoScore - a.videoScore || b.rank - a.rank);
  const top = kept.slice(0, KEEP_MAX);
  console.log(`  ${top.length} in today's top-${KEEP_MAX} (${top.filter((c) => c.carried).length} carried over)`);

  let written = 0;
  for (const [pos, c] of top.entries()) {
    const j = c.judged;
    const summary = (j?.summary || c.summary || "").replace(/[—–]/g, ",").slice(0, 2000);
    const tags = [...new Set([...(j?.tags || []), ...c.tags])].map((t) => String(t).toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 12);
    const extra = { ...c.meta, rank: Number(c.rank.toFixed(3)), via: c.via, day: TODAY, position: pos + 1, videoScore: j?.video_score ?? null, angle: j?.angle || null };
    await pool.query(
      `insert into ai_news_items (kind, title, summary, url, source, source_id, image_url, published_at, tags, extra)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       on conflict (source, source_id) do update set
         kind = excluded.kind, summary = excluded.summary, tags = excluded.tags,
         image_url = coalesce(excluded.image_url, ai_news_items.image_url),
         extra = ai_news_items.extra || excluded.extra`,
      [c.kind, c.title.slice(0, 300), summary || null, c.url, c.source, c.sourceId.slice(0, 400), c.imageUrl, c.publishedAt ? new Date(c.publishedAt) : null, tags, JSON.stringify(extra)],
    );
    written++;
  }

  let enriched = null;
  if (usedLlm && top.length) {
    try {
      enriched = { brief: await brief(top) };
      console.log(`  ✓ brief: ${enriched.brief.video_ideas?.length ?? 0} video ideas`);
    } catch (err) { console.warn(`  ✗ brief failed: ${err.message}`); }
  }

  // Video ideas land in the Ideas lane so they are actionable from the desk.
  const ideas = (enriched?.brief?.video_ideas || []).filter((idea) => !(idea.refs || []).some((r) => top[r] && blockedBy(top[r].url)));
  for (const [k, idea] of ideas.entries()) {
    const refs = (idea.refs || []).map((r) => top[r]).filter(Boolean);
    if (refs.some((r) => blockedBy(r.url))) continue;
    await pool.query(
      `insert into ai_news_items (kind, title, summary, url, source, source_id, published_at, tags, extra)
       values ('idea',$1,$2,$3,'ai-news-agent',$4,now(),$5,$6::jsonb)
       on conflict (source, source_id) do update set title = excluded.title, summary = excluded.summary, url = excluded.url, extra = excluded.extra`,
      [String(idea.title || "").slice(0, 300), `${idea.hook || ""}\n\n${idea.why || ""}`.replace(/[—–]/g, ",").slice(0, 2000), refs[0]?.url || null, `idea-${TODAY}-${k}`, ["video idea"], JSON.stringify({ day: TODAY, refs: refs.map((r) => ({ title: r.title, url: r.url })) })],
    );
  }

  if (enriched?.brief) {
    await pool.query(
      `insert into ai_news_briefs (brief_date, headline, bullets, video_ideas, item_count, sources, model)
       values ($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7)
       on conflict (brief_date) do update set headline = excluded.headline, bullets = excluded.bullets, video_ideas = excluded.video_ideas,
         item_count = excluded.item_count, sources = excluded.sources, model = excluded.model, created_at = now()`,
      [TODAY, String(enriched.brief.headline || "").replace(/[—–]/g, ","), JSON.stringify(enriched.brief.bullets || []), JSON.stringify(ideas), written, JSON.stringify(sourceCounts), llm.TEXT_MODEL],
    );
  } else {
    // Still stamp the day so the automation reads as "ran" even if the model was down.
    await pool.query(
      `insert into ai_news_briefs (brief_date, headline, item_count, sources, model) values ($1,$2,$3,$4::jsonb,null)
       on conflict (brief_date) do update set item_count = excluded.item_count, sources = excluded.sources, created_at = now()`,
      [TODAY, `${written} new drops (no model brief)`, written, JSON.stringify(sourceCounts)],
    );
  }
  await pool.end();

  console.log(`  ✓ wrote ${written} items, ${ideas.length} ideas, brief for ${TODAY}`);
  for (const c of top.slice(0, 8)) console.log(`    ${String(c.videoScore).padStart(2)}  ${c.kind.padEnd(4)} ${c.title.slice(0, 80)}`);
}

main().catch((err) => {
  console.error("✗ ai-news-ingest failed:", err.message);
  process.exit(1);
});
