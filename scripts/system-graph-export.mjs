#!/usr/bin/env node
/**
 * system-graph-export.mjs — Marketing OS as a system graph.
 *
 * Walks the repo and emits src/data/system-graph.json: the automations, skills,
 * publish helpers, scripts, API routes + webhooks, dashboard pages, lib modules,
 * external services, DB tables, personas and platforms, wired by what actually
 * runs / imports / queries / posts to what. This is what /dashboard/gitnexus
 * renders as the "brain". Pure static analysis — no gitnexus needed (gitnexus
 * skips the dot-dir where the skills live).
 *
 *   node scripts/system-graph-export.mjs
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src/data/system-graph.json");

/* ───────────── catalogs ───────────── */

export const TYPES = [
  "scheduler", // the in-process cron
  "automation", // registry job
  "skill", // .claude/skills/*
  "helper", // .claude/lib/*
  "script", // scripts/*
  "route", // src/app/api/**/route.ts
  "webhook", // inbound routes
  "page", // src/app/dashboard/**/page.tsx
  "module", // src/lib/<dir>
  "service", // external API
  "table", // postgres table
  "persona",
  "platform",
];

export const EDGE_TYPES = [
  "schedules", // scheduler → automation
  "runs", // automation → skill/script
  "posts_to", // automation/skill → platform
  "as", // automation → persona
  "verifies", // automation → table
  "uses", // x → helper/module/skill
  "calls", // x → service
  "reads", // x → table
  "writes", // x → table
  "fetches", // page → route
  "triggers", // service → webhook
  "targets", // skill → platform (by name)
];

// service id → { label, hosts?, envs?, libDirs?, hint }
const SERVICES = {
  zernio: { label: "Zernio", hosts: ["zernio.com"], envs: ["ZERNIO_API_KEY", "ZERNIO_BASE_URL", "LATE_API_KEY"], libDirs: ["zernio"], hint: "Social posting, analytics, comment automations" },
  insforge: { label: "Insforge Postgres", envs: ["DATABASE_URL", "INSFORGE_CONNECTION_STRING"], libDirs: ["insforge"], hint: "Primary database (pg pool)" },
  insforgeStorage: { label: "Insforge Storage", hosts: ["insforge.app"], envs: ["INSFORGE_API_BASE_URL", "INSFORGE_API_KEY"], hint: "S3-style media bucket" },
  revenuecat: { label: "RevenueCat", hosts: ["api.revenuecat.com"], envs: ["REVENUECAT_API_KEY"], libDirs: ["revenuecat"], hint: "Subscriptions + new customers" },
  posthog: { label: "PostHog", hosts: ["posthog.com"], envs: ["POSTHOG_API_KEY"], libDirs: ["posthog"], hint: "Web analytics (HogQL)" },
  giphy: { label: "Giphy", hosts: ["api.giphy.com"], envs: ["GIPHY_API_KEY"], libDirs: ["giphy"], hint: "GIF search + import" },
  ollama: { label: "Ollama", hosts: ["ollama.com"], envs: ["OLLAMA_API_KEY", "OLLAMA_KEY", "OLLAMA_TEXT_MODEL", "OLLAMA_BASE_URL", "OLLAMA_VISION_MODEL"], hint: "LLM gateway (text + vision)" },
  gemini: { label: "Gemini", hosts: ["generativelanguage.googleapis.com"], envs: ["GEMINI_API_KEY"], hint: "Google LLM / image models" },
  anthropic: { label: "Anthropic", hosts: ["api.anthropic.com"], envs: ["ANTHROPIC_API_KEY", "CLAUDE_BIN"], hint: "Claude (agent runs)" },
  fal: { label: "fal.ai", hosts: ["fal.run", "fal.ai"], envs: ["FAL_KEY", "FAL_ALLOW"], hint: "Image generation (gated)" },
  apify: { label: "Apify", hosts: ["api.apify.com"], envs: ["APIFY_TOKEN", "APIFY_API_KEY"], hint: "Scrapers: trending sounds, IG, LinkedIn" },
  heygen: { label: "HeyGen", hosts: ["api.heygen.com"], envs: ["HEYGEN_API_KEY", "HEYGEN_VOICE_ID"], hint: "Avatar video clones" },
  elevenlabs: { label: "ElevenLabs", hosts: ["api.elevenlabs.io"], envs: ["ELEVENLABS_API_KEY", "AGENT_TTS_VOICE_ID"], hint: "Text to speech" },
  instantly: { label: "Instantly", hosts: ["api.instantly.ai"], envs: ["INSTANTLY_API_KEY"], hint: "Cold email" },
  producthunt: { label: "Product Hunt", hosts: ["api.producthunt.com"], envs: ["PRODUCTHUNT_TOKEN"], hint: "Launch feed (AI news)" },
  github: { label: "GitHub", hosts: ["api.github.com"], envs: ["GITHUB_TOKEN"], hint: "Trending repos (AI news)" },
  hackernews: { label: "Hacker News", hosts: ["hn.algolia.com", "news.ycombinator.com"], hint: "Front page feed (AI news)" },
  huggingface: { label: "Hugging Face", hosts: ["huggingface.co"], hint: "Trending models + papers (AI news)" },
  replicate: { label: "Replicate", envs: ["REPLICATE_API_TOKEN"], hint: "Hosted models" },
  railway: { label: "Railway", envs: ["RAILWAY_ENVIRONMENT"], hint: "Hosting + cron host" },
};

const PLATFORMS = ["instagram", "tiktok", "youtube", "twitter", "threads", "linkedin", "facebook", "reddit", "whatsapp"];
const PLATFORM_LABEL = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", twitter: "X / Twitter", threads: "Threads", linkedin: "LinkedIn", facebook: "Facebook", reddit: "Reddit", whatsapp: "WhatsApp" };

const PERSONA_LABEL = { megan: "Megan", danny: "Danny", kev: "kev.creatoros", kevbuildsapps: "@kevbuildsapps", kevbuildsagencies: "@kevbuildsagencies", creatoros: "Creator OS (brand)" };

const VERIFY_TABLE = {
  carousels: "content_posts",
  snapshots: "analytics_snapshots",
  followers: "follower_snapshots",
  rc_subs: "revenuecat_subscriptions",
  rc_customers: "revenuecat_customers",
  web_analytics: "web_analytics_snapshots",
  ai_news: "ai_news_briefs",
  sounds: "sounds",
};

const SQL_STOP = new Set([
  "select", "where", "values", "set", "and", "or", "not", "null", "table", "if", "exists", "index", "on", "as", "with", "the", "a", "an", "this", "that", "each", "all", "any", "one", "two", "left", "right", "inner", "outer", "lateral", "unnest", "jsonb_array_elements", "generate_series", "now", "date", "true", "false", "it", "them", "their", "its", "which", "what", "here", "there", "scratch", "disk", "memory", "file", "json", "env", "db", "api", "cache", "config", "process", "response", "request", "data", "state", "items", "rows", "row", "posts", "post", "day", "days", "hour", "hours", "today", "yesterday", "storage", "bucket", "s3", "url", "video", "image", "images", "videos", "slot", "slots", "text", "string", "number", "boolean", "object", "array", "list", "map", "new", "old", "first", "last", "next", "prev", "start", "end", "bottom", "top", "base", "root", "dir", "path", "local", "remote", "server", "client", "main", "entry", "exit", "these", "those", "same", "other",
]);

/* ───────────── fs helpers ───────────── */

function walk(dir, pred, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".next")) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const read = (p) => readFileSync(p, "utf8");
const isCode = (p) => /\.(ts|tsx|js|mjs|cjs)$/.test(p) && !/\.d\.ts$/.test(p);

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  const fm = {};
  if (m) {
    for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
    }
  }
  if (!fm.description) {
    // first paragraph after the H1
    const body = md.replace(/^---[\s\S]*?---/, "");
    const para = body.split(/\n\s*\n/).map((s) => s.trim()).find((s) => s && !s.startsWith("#"));
    if (para) fm.description = para.replace(/\s+/g, " ").slice(0, 280);
  }
  return fm;
}

/* ───────────── graph builder ───────────── */

class Graph {
  constructor() {
    this.nodes = [];
    this.byId = new Map();
    this.edges = new Map(); // key → edge
  }
  add(id, type, label, extra = {}) {
    let n = this.byId.get(id);
    if (n) {
      Object.assign(n, { ...extra, ...n, files: [...new Set([...(n.files || []), ...(extra.files || [])])] });
      return n;
    }
    n = { id, type, label, files: [], envs: [], ...extra };
    this.byId.set(id, n);
    this.nodes.push(n);
    return n;
  }
  has(id) {
    return this.byId.has(id);
  }
  link(a, b, type, extra = {}) {
    if (!a || !b || a === b) return;
    if (!this.byId.has(a) || !this.byId.has(b)) return;
    const key = `${a}|${b}|${type}`;
    const e = this.edges.get(key);
    if (e) e.weight++;
    else this.edges.set(key, { source: a, target: b, type, weight: 1, ...extra });
  }
}

const g = new Graph();

/* --- fixed vocab nodes --- */
g.add("scheduler:content-cron", "scheduler", "Content cron", {
  description: "In-process scheduler: arms one timer per job×ET hour on boot, spawns the job script, 30-min watchdog self-heals missed slots.",
  files: ["src/lib/content/cron.ts", "src/lib/content/registry.ts"],
});
g.add("scheduler:sounds-cron", "scheduler", "Sounds cron", {
  description: "Daily in-app refresh of trending sounds (Apify) into the sounds table.",
  files: ["src/lib/sounds/cron.ts"],
});
for (const p of PLATFORMS) g.add(`platform:${p}`, "platform", PLATFORM_LABEL[p]);
for (const [slug, label] of Object.entries(PERSONA_LABEL)) g.add(`persona:${slug}`, "persona", label, { slug });
for (const [id, s] of Object.entries(SERVICES)) g.add(`service:${id}`, "service", s.label, { description: s.hint, envs: s.envs ?? [] });

/* --- file → entity resolution --- */

const fileEntity = new Map(); // repo-relative file → node id
const entityFiles = new Map(); // node id → files[]

function bind(file, id) {
  fileEntity.set(file, id);
  const n = g.byId.get(id);
  if (n && !n.files.includes(file)) n.files.push(file);
  if (!entityFiles.has(id)) entityFiles.set(id, []);
  entityFiles.get(id).push(file);
}

// skills
const skillDocs = new Map(); // skill id → SKILL.md text (service mentions for script-less skills)
const skillsDir = path.join(ROOT, ".claude/skills");
for (const name of readdirSync(skillsDir)) {
  const dir = path.join(skillsDir, name);
  if (!statSync(dir).isDirectory()) continue;
  const mdPath = path.join(dir, "SKILL.md");
  const fm = existsSync(mdPath) ? frontmatter(read(mdPath)) : {};
  const id = `skill:${name}`;
  g.add(id, "skill", name, { description: fm.description || "", files: existsSync(mdPath) ? [rel(mdPath)] : [] });
  for (const f of walk(dir, isCode)) bind(rel(f), id);
  if (existsSync(mdPath)) skillDocs.set(id, read(mdPath));
  for (const p of PLATFORMS) if (name.includes(p) || (p === "twitter" && /tweet|x-/.test(name))) g.link(id, `platform:${p}`, "targets");
}

// helpers
for (const f of walk(path.join(ROOT, ".claude/lib"), isCode)) {
  const base = path.basename(f).replace(/\.(js|mjs|cjs)$/, "");
  const id = `helper:${base}`;
  const src = read(f);
  const doc = src.match(/^\/\*\*\s*\n\s*\*\s*([^\n]+)/);
  g.add(id, "helper", base, { description: doc ? doc[1].replace(/^[\w.-]+\.js\s*[—-]\s*/, "").trim() : "" });
  bind(rel(f), id);
}

// scripts (the graph exporters themselves are meta tooling, not the system)
const META_SCRIPTS = new Set(["system-graph-export", "gitnexus-export"]);
for (const f of walk(path.join(ROOT, "scripts"), isCode)) {
  const base = path.basename(f).replace(/\.(js|mjs|cjs)$/, "");
  if (META_SCRIPTS.has(base)) continue;
  const id = `script:${base}`;
  const src = read(f);
  const doc = src.match(/^(?:#![^\n]*\n)?\/\*\*?\s*\n?\s*\*?\s*([^\n]+)/) || src.match(/^(?:#![^\n]*\n)?\/\/\s*([^\n]+)/);
  g.add(id, "script", base, { description: doc ? doc[1].replace(/^\*?\s*/, "").replace(new RegExp(`^${base}\\.(mjs|js)\\s*[—-]\\s*`), "").trim() : "" });
  bind(rel(f), id);
}

// api routes + webhooks
for (const f of walk(path.join(ROOT, "src/app/api"), (p) => /route\.tsx?$/.test(p))) {
  const r = rel(f);
  const route = "/" + r.replace(/^src\/app\//, "").replace(/\/route\.tsx?$/, "");
  const isHook = /webhook/i.test(route);
  const id = `${isHook ? "webhook" : "route"}:${route}`;
  const src = read(f);
  const methods = [...src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  g.add(id, isHook ? "webhook" : "route", route, { methods, description: isHook ? "Inbound webhook" : "API route" });
  bind(r, id);
  if (isHook) {
    for (const sid of Object.keys(SERVICES)) {
      if (route.toLowerCase().includes(sid)) g.link(`service:${sid}`, id, "triggers");
    }
  }
}
// /go/[slug] redirect
const goRoute = path.join(ROOT, "src/app/go/[slug]/route.ts");
if (existsSync(goRoute)) {
  g.add("route:/go/[slug]", "route", "/go/[slug]", { methods: ["GET"], description: "Tracked short-link redirect" });
  bind(rel(goRoute), "route:/go/[slug]");
}

// dashboard pages (+ their private components under the same folder)
const pageDirs = new Map(); // dir → page id
for (const f of walk(path.join(ROOT, "src/app/dashboard"), (p) => /page\.tsx$/.test(p))) {
  const r = rel(f);
  const seg = r.replace(/^src\/app\/dashboard\/?/, "").replace(/\/?page\.tsx$/, "");
  const route = "/dashboard" + (seg ? "/" + seg : "");
  const label = seg
    ? seg.split("/").map((s) => s.replace(/\[|\]/g, "").replace(/-/g, " ")).join(" / ").replace(/^\w/, (c) => c.toUpperCase())
    : "Overview";
  const id = `page:${route}`;
  g.add(id, "page", label, { route });
  pageDirs.set(path.dirname(r), id);
}
for (const f of walk(path.join(ROOT, "src/app/dashboard"), isCode)) {
  const r = rel(f);
  let dir = path.dirname(r);
  while (dir.startsWith("src/app/dashboard")) {
    if (pageDirs.has(dir)) {
      bind(r, pageDirs.get(dir));
      break;
    }
    dir = path.dirname(dir);
  }
}

// lib modules (per directory); service client dirs resolve to services
const libDir = path.join(ROOT, "src/lib");
const serviceByLibDir = {};
for (const [sid, s] of Object.entries(SERVICES)) for (const d of s.libDirs ?? []) serviceByLibDir[d] = `service:${sid}`;
for (const name of readdirSync(libDir)) {
  const p = path.join(libDir, name);
  if (statSync(p).isDirectory()) {
    if (serviceByLibDir[name]) {
      for (const f of walk(p, isCode)) bind(rel(f), serviceByLibDir[name]);
      continue;
    }
    if (name === "content") {
      for (const f of walk(p, isCode)) bind(rel(f), "scheduler:content-cron");
      continue;
    }
    const id = `module:${name}`;
    g.add(id, "module", name.replace(/-/g, " "), { description: `src/lib/${name}` });
    for (const f of walk(p, isCode)) {
      if (name === "sounds" && /cron\.ts$/.test(f)) bind(rel(f), "scheduler:sounds-cron");
      else bind(rel(f), id);
    }
  } else if (isCode(p)) {
    const base = name.replace(/\.tsx?$/, "");
    if (base === "auth") {
      g.add("module:auth", "module", "auth", { description: "Single-user password gate (session cookie)" });
      bind(rel(p), "module:auth");
    }
  }
}

// shared components: pass-through (resolved transitively, not entities)
const componentFiles = walk(path.join(ROOT, "src/components"), isCode).map(rel);

/* --- automations from the registry (node strips types natively) --- */
const registry = await import(path.join(ROOT, "src/lib/content/registry.ts"));
for (const job of registry.CONTENT_JOBS) {
  const id = `automation:${job.name}`;
  g.add(id, "automation", job.displayName, {
    description: job.description,
    hours: job.defaultHours.split(",").map((s) => s.trim()),
    envPrefix: job.envPrefix,
    script: job.script,
    args: job.args(0),
    verify: job.verify,
    files: ["src/lib/content/registry.ts"],
    envs: [`${job.envPrefix}_CRON_ENABLED`, `${job.envPrefix}_CRON_HOURS_ET`],
  });
  g.link("scheduler:content-cron", id, "schedules");
  const target = fileEntity.get(job.script);
  if (target) g.link(id, target, "runs");
  for (const p of job.platforms) g.link(id, `platform:${p}`, "posts_to");
  if (job.persona) g.link(id, `persona:${job.persona}`, "as");
  const t = VERIFY_TABLE[job.verify];
  if (t) {
    g.add(`table:${t}`, "table", t);
    g.link(id, `table:${t}`, "verifies");
  }
}
g.add("automation:trending-sounds", "automation", "Trending sounds sync", {
  description: "Refreshes both charts daily — English-market trending music + general trending sounds — via Apify into the sounds table.",
  hours: ["6 UTC"],
  envPrefix: "SOUNDS",
  verify: "sounds",
  files: ["src/lib/sounds/cron.ts"],
  envs: ["SOUNDS_CRON_ENABLED", "SOUNDS_CRON_HOUR_UTC"],
});
g.link("scheduler:sounds-cron", "automation:trending-sounds", "schedules");
g.link("automation:trending-sounds", "skill:trending-sounds", "runs");
g.link("automation:trending-sounds", "script:refresh-sounds", "runs");
g.add("table:sounds", "table", "sounds");
g.link("automation:trending-sounds", "table:sounds", "verifies");

/* --- per-file analysis: imports, sql, services, api fetches, env --- */

function resolveImport(fromFile, spec) {
  let target;
  if (spec.startsWith("@/")) target = "src/" + spec.slice(2);
  else if (spec.startsWith(".")) target = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  else return null;
  const cands = [target, `${target}.ts`, `${target}.tsx`, `${target}.js`, `${target}.mjs`, `${target}/index.ts`, `${target}/index.js`];
  for (const c of cands) if (fileEntity.has(c)) return fileEntity.get(c);
  for (const c of cands) if (componentFiles.includes(c)) return `component:${c}`;
  // directory import inside lib → module
  const m = target.match(/^src\/lib\/([^/]+)/);
  if (m) return serviceByLibDir[m[1]] ?? (g.has(`module:${m[1]}`) ? `module:${m[1]}` : null);
  return null;
}

const IMPORT_RE = /(?:import\s+(?:[\s\S]*?)\s+from\s+|import\s*\(\s*|export\s+(?:\*|\{[^}]*\})\s+from\s+|require\s*\(\s*)["']([^"']+)["']/g;
const SQL_RE = /\b(from|into|update|join|table if not exists|table)\s+"?([a-z][a-z0-9_]{3,})"?/gi;
const WRITE_RE = /\b(insert\s+into|update|delete\s+from|create\s+table(?:\s+if\s+not\s+exists)?|alter\s+table|truncate)\s+"?([a-z][a-z0-9_]{3,})"?/gi;
const API_RE = /["'`](\/api\/[a-z0-9/_\-]+)/g;
const ENV_RE = /process\.env\.([A-Z][A-Z0-9_]+)/g;

const componentImports = new Map(); // component file → Set(entity ids | component ids)
const componentApis = new Map();
const componentSvcs = new Map();

const tableMentions = new Map(); // table → count (for pruning junk)

function analyze(file, src) {
  const imports = new Set();
  for (const m of src.matchAll(IMPORT_RE)) {
    const r = resolveImport(file, m[1]);
    if (r) imports.add(r);
  }
  const tables = new Map(); // name → "reads"|"writes"
  const sqlish = /\b(select|insert|update|delete|create table)\b/i.test(src);
  if (sqlish) {
    for (const m of src.matchAll(WRITE_RE)) {
      const t = m[2].toLowerCase();
      if (!SQL_STOP.has(t)) tables.set(t, "writes");
    }
    for (const m of src.matchAll(SQL_RE)) {
      const t = m[2].toLowerCase();
      if (SQL_STOP.has(t) || tables.has(t)) continue;
      // require SQL context on the same line to avoid prose ("from the bank")
      const lineStart = src.lastIndexOf("\n", m.index) + 1;
      const lineEnd = src.indexOf("\n", m.index);
      const line = src.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      if (/\b(select|delete|insert|update|join|count\(|where|returning|create table)\b/i.test(line) || /`\s*$/.test(src.slice(Math.max(0, lineStart - 40), lineStart))) {
        tables.set(t, "reads");
      }
    }
  }
  const services = new Set();
  const envs = new Set([...src.matchAll(ENV_RE)].map((m) => m[1]));
  for (const [sid, s] of Object.entries(SERVICES)) {
    if (s.hosts?.some((h) => src.includes(h))) services.add(`service:${sid}`);
    else if (s.envs?.some((e) => envs.has(e))) services.add(`service:${sid}`);
  }
  const apis = new Set([...src.matchAll(API_RE)].map((m) => m[1]));
  return { imports, tables, services, envs, apis };
}

// components first (so pages can flatten through them)
for (const f of componentFiles) {
  const a = analyze(f, read(path.join(ROOT, f)));
  componentImports.set(`component:${f}`, a.imports);
  componentApis.set(`component:${f}`, a.apis);
  componentSvcs.set(`component:${f}`, a.services);
}
function flattenComponent(cid, seen, acc) {
  if (seen.has(cid)) return;
  seen.add(cid);
  for (const x of componentImports.get(cid) ?? []) {
    if (x.startsWith("component:")) flattenComponent(x, seen, acc);
    else acc.imports.add(x);
  }
  for (const a of componentApis.get(cid) ?? []) acc.apis.add(a);
  for (const s of componentSvcs.get(cid) ?? []) acc.services.add(s);
}

function routeIdForApi(apiPath) {
  // longest matching route prefix, treating [param] segments as wildcards
  let best = null;
  for (const n of g.nodes) {
    if (n.type !== "route" && n.type !== "webhook") continue;
    const re = new RegExp("^" + n.label.replace(/\[[^\]]+\]/g, "[^/]+").replace(/\//g, "\\/") + "(?:\\/|$)");
    if (re.test(apiPath) && (!best || n.label.length > best.label.length)) best = n;
  }
  return best?.id ?? null;
}

for (const [file, id] of fileEntity) {
  const node = g.byId.get(id);
  if (!node) continue;
  const a = analyze(file, read(path.join(ROOT, file)));
  const acc = { imports: new Set(a.imports), apis: new Set(a.apis), services: new Set(a.services) };
  for (const x of a.imports) if (x.startsWith("component:")) flattenComponent(x, new Set(), acc);
  for (const x of acc.imports) {
    if (x.startsWith("component:")) continue;
    if (x.startsWith("service:")) g.link(id, x, "calls");
    else g.link(id, x, "uses");
  }
  for (const s of acc.services) g.link(id, s, "calls");
  for (const [t, mode] of a.tables) {
    tableMentions.set(t, (tableMentions.get(t) ?? 0) + 1);
    g.add(`table:${t}`, "table", t);
    g.link(id, `table:${t}`, mode);
  }
  if (node.type === "page") for (const ap of acc.apis) {
    const rid = routeIdForApi(ap);
    if (rid) g.link(id, rid, "fetches");
  }
  for (const e of a.envs) if (!node.envs.includes(e)) node.envs.push(e);
}

// skills whose docs name a service (hosts / env keys) but ship no script here
for (const [sid, md] of skillDocs) {
  const envs = new Set([...md.matchAll(ENV_RE)].map((m) => m[1]), ...[...md.matchAll(/\b([A-Z][A-Z0-9]+_(?:API_KEY|TOKEN|KEY))\b/g)].map((m) => m[1]));
  for (const [svc, s] of Object.entries(SERVICES)) {
    if (s.hosts?.some((h) => md.includes(h)) || s.envs?.some((e) => envs.has(e))) g.link(sid, `service:${svc}`, "calls");
  }
}

// helper-level knowledge that regexes cannot see
g.link("helper:persona", "table:personas", "reads");
g.link("helper:persona", "service:insforge", "calls");
g.link("scheduler:content-cron", "service:railway", "calls");

/* --- prune --- */
// A table is real if some file declares it (create table …) or 2+ entities
// touch it; single regex hits ("from the bank", "update rule") are noise.
const declared = new Set();
for (const file of fileEntity.keys()) {
  const src = read(path.join(ROOT, file));
  for (const m of src.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z][a-z0-9_]{3,})"?/gi)) declared.add(m[1].toLowerCase());
}
const PLAIN_TABLES = new Set(["sounds", "gifs", "goals", "channels", "personas", "accomplishments", "clients"]);
const TABLE_NOISE = new Set(["skip", "failed", "font", "rule", "real", "against", "by_plat"]);
for (const n of [...g.nodes]) {
  if (n.type !== "table") continue;
  const touches = [...g.edges.values()].filter((e) => e.target === n.id);
  const sources = new Set(touches.map((e) => e.source));
  const verified = touches.some((e) => e.type === "verifies");
  const strong = touches.some((e) => ["module", "script"].includes(g.byId.get(e.source)?.type));
  const plausible = n.label.includes("_") || PLAIN_TABLES.has(n.label);
  const keep = plausible && !TABLE_NOISE.has(n.label) && (verified || declared.has(n.label) || strong || sources.size >= 2);
  if (touches.length === 0 || !keep) {
    g.nodes.splice(g.nodes.indexOf(n), 1);
    g.byId.delete(n.id);
    for (const [k, e] of g.edges) if (e.source === n.id || e.target === n.id) g.edges.delete(k);
  }
}
// drop isolated services / platforms / personas (nothing in the repo touches them)
for (const n of [...g.nodes]) {
  if (!["service", "platform", "persona"].includes(n.type)) continue;
  const deg = [...g.edges.values()].filter((e) => e.source === n.id || e.target === n.id).length;
  if (deg === 0) {
    g.nodes.splice(g.nodes.indexOf(n), 1);
    g.byId.delete(n.id);
  }
}

/* --- flag what is live (wired to a scheduled automation) --- */
const live = new Set();
for (const e of g.edges.values()) if (e.type === "runs") live.add(e.target);
for (const n of g.nodes) if (n.type === "skill" || n.type === "script") n.live = live.has(n.id);

/* --- emit --- */
const typeIndex = new Map(TYPES.map((t, i) => [t, i]));
const edgeIndex = new Map(EDGE_TYPES.map((t, i) => [t, i]));
const idx = new Map(g.nodes.map((n, i) => [n.id, i]));
const commit = (() => {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
})();

const out = {
  version: 1,
  generatedAt: new Date().toISOString(),
  commit,
  types: TYPES,
  edgeTypes: EDGE_TYPES,
  nodes: g.nodes.map((n) => ({
    id: n.id,
    t: typeIndex.get(n.type),
    label: n.label,
    description: n.description || undefined,
    files: n.files.length ? n.files : undefined,
    envs: n.envs.length ? n.envs : undefined,
    hours: n.hours,
    envPrefix: n.envPrefix,
    args: n.args,
    methods: n.methods?.length ? n.methods : undefined,
    route: n.route,
    live: n.live,
  })),
  edges: [...g.edges.values()].map((e) => [idx.get(e.source), idx.get(e.target), edgeIndex.get(e.type), e.weight]),
};

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));

const counts = {};
for (const n of g.nodes) counts[n.type] = (counts[n.type] ?? 0) + 1;
console.log(`[system-graph] ${g.nodes.length} nodes, ${g.edges.size} edges → ${rel(OUT)} (${(statSync(OUT).size / 1024).toFixed(0)} KB)`);
console.log("[system-graph]", counts);
