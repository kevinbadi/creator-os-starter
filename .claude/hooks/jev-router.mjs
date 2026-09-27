#!/usr/bin/env node
/**
 * Jev prompt router for Claude Code (Kevin 2026-09-18: "build it").
 *
 * UserPromptSubmit hook. Every prompt you type goes to Jev (TypeSafe System One)
 * first. Jev answers, in one ~200 ms call:
 *   lane        tool | build | produce | assess | conversation
 *   skill       which .claude/skills entry owns this (catalog built from SKILL.md)
 *   persona     kevbuildsapps | kev_ai | megan | danny | creator_os_brand | agencies | none
 *   risk        read_only | local_files | publishes | destructive
 *   platform    any | instagram | ...
 *   is_correction / wants_deploy / near_slot   (yes/no probabilities)
 *   complexity  0..3
 *
 * If lane=tool with high confidence, the hook runs the Marketing OS dispatcher
 * (POST /api/jev, the same code the Jev page uses) and BLOCKS the prompt: the
 * answer prints in the terminal and Claude is never invoked (zero Claude tokens).
 * Otherwise the decision is attached to the prompt as context for Claude.
 *
 * Escape hatches: a prompt starting with "/" or "!" is untouched; add "--jev off"
 * (or "no jev") anywhere to force the prompt through; JEV_ROUTER=0 disables it.
 * Fails open: no key, timeout, or any error -> the prompt passes through as-is.
 *
 * Log: creator-os/.claude/hooks/jev-router.log (JSONL, one line per prompt).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import Table from "cli-table3";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..", "..");            // creator-os/
const SKILLS = path.join(APP, ".claude", "skills");
const LOG = path.join(HERE, "jev-router.log");
// Lane gate: a tool-lane read at or above this is sent to the dispatcher, which
// then decides for real (its own tool confidence must clear DISPATCH_MIN).
// 2026-09-19: "what is my social growth the past day" scored 0.79 and fell
// through to Claude; the dispatcher would have answered it at 100%.
const TOOL_MIN = Number(process.env.JEV_TOOL_MIN || 0.6);
const DISPATCH_MIN = Number(process.env.JEV_DISPATCH_MIN || 0.75);
const BASE_URLS = [
  process.env.JEV_DASHBOARD_URL,
  "http://localhost:3000",
  "https://your-app.up.railway.app",
].filter(Boolean);

function loadEnv() {
  const p = path.join(APP, ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function log(obj) {
  try {
    fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...obj }) + "\n");
  } catch {
    /* never fail the hook on logging */
  }
}

function passThrough(context) {
  if (context) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "UserPromptSubmit", permissionDecision: "allow", additionalContext: context },
      }),
    );
  }
  process.exit(0);
}

/** Block = exit 2. Emit the current deny shape plus the legacy decision/reason
 *  shape, and the text on stderr, so every Claude Code version shows it. */
function block(reason) {
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason,
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", permissionDecision: "deny", permissionDecisionReason: reason },
    }),
  );
  process.stderr.write(reason);
  process.exit(2);
}

/** Skill catalog straight from SKILL.md frontmatter, so it never goes stale. */
function skillCatalog() {
  const out = {};
  let dirs = [];
  try {
    dirs = fs.readdirSync(SKILLS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return out;
  }
  for (const name of dirs.sort()) {
    let desc = "";
    try {
      const md = fs.readFileSync(path.join(SKILLS, name, "SKILL.md"), "utf8");
      const m = /^description:\s*(.+)$/m.exec(md);
      desc = (m?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 220);
    } catch {
      /* no SKILL.md */
    }
    if (desc) out[name] = desc;
    if (Object.keys(out).length >= 240) break;
  }
  // repo-level lanes that are not skills
  out["jev"] = "The Jev page on Marketing OS: its tools, choice questions, capacity meter, globe, or the Jev router hook itself.";
  out["dashboard-ui"] = "A Marketing OS dashboard page, chart, strip, component, layout, or sidebar change.";
  out["deploy-ops"] = "Railway deploys, env vars, crons, the agent-post drain, watchdogs, local dev server, performance.";
  out["comment-dm-funnel"] = "Keyword comments, comment-to-DM setups, why someone did or did not get the DM, comment statuses.";
  out["codebase-health"] = "Cleanup, refactor, speed, tech debt across the codebase.";
  out["memory-or-preference"] = "Kevin stating how he wants things done, a correction, or something to remember.";
  out["none"] = "Nothing in this catalog fits.";
  return out;
}

const QUESTIONS_STATIC = {
  lane: {
    type: "choice",
    instructions: "Who should handle this prompt?",
    criteria: {
      tool: "A read-only data question the Marketing OS dispatcher can answer instantly with no reasoning: comments, agent posts, slots, content posts, AI news, link clicks, followers and social growth, post analytics and views, revenue/downloads, automations, and the Obsidian media vault (logos, icons, brand assets, profile pictures, AI company B-roll). Examples: 'what comments did we get today', 'next open slots', 'best posts this month', 'downloads this month', 'is anything overdue', 'what is my social growth the past day', 'how are my followers doing', 'latest unanswered comment', 'do we have a Claude logo', 'what brand assets do we have', 'which AI company logos do we have', 'show me the Creator OS icon', 'B-roll for OpenAI', 'jev playing subway surfers clip', 'footage of the hoops app', 'gitnexus screen recording', 'what video b-roll do we have'. Looking UP an existing clip or logo in the vault is a tool question, not produce.",
      build: "Claude must write or change code, config, a skill, a script, or the dashboard.",
      produce: "Claude must MAKE a new asset: a video edit, a cover, a caption, a script, a post, an upload. Not for finding an existing clip, recording or logo in the vault (that is tool).",
      assess: "Claude should investigate and explain, not change anything: a question, 'is this accurate', 'why did X happen', 'tell me about', 'explain'.",
      conversation: "Chat, opinion, reaction, thinking out loud, thanks.",
    },
  },
  persona: {
    type: "choice",
    instructions: "Which brand or persona is this about, if any?",
    criteria: {
      kevbuildsapps: "Kevin's personal brand, kevbuildsapps socials.",
      kev_ai: "The Kev AI twin account (kev.creatoros).",
      megan: "Megan, the AI UGC persona.",
      danny: "Danny, the AI UGC persona.",
      creator_os_brand: "The Creator OS app brand accounts.",
      agencies: "kevbuildsagencies, the web app B2B persona.",
      none: "No persona named.",
    },
  },
  risk: {
    type: "choice",
    instructions: "What is the blast radius of doing what is asked?",
    criteria: {
      read_only: "Nothing changes: a question, a lookup, an explanation, finding media / B-roll / logos in the vault.",
      local_files: "Edits files or renders assets on the Mac only.",
      publishes: "Something goes out: a social post, a DM, a comment reply, a schedule change, or a prod deploy (railway up).",
      destructive: "Deletes, overwrites, or cannot be undone.",
    },
  },
  platform: {
    type: "choice",
    instructions: "Which social platform is named, if any?",
    criteria: { any: null, instagram: "IG, reels, insta", tiktok: null, youtube: "YT, shorts", twitter: "X, tweets", threads: null, linkedin: null, facebook: "FB" },
  },
  is_correction: { type: "noul", instructions: "Is Kevin correcting how something was done, or stating a preference or rule to remember for the future?" },
  wants_deploy: { type: "noul", instructions: "Does Kevin expect the result to be live on production (Railway) when this is done?" },
  near_slot: { type: "noul", instructions: "Does this ask for a deploy or server restart that could collide with a scheduled publish slot (posts go out on the hour: 12am/3/6/9pm and 1/4/7/10pm ET)?" },
  complexity: {
    type: "score",
    instructions: "How much work is this?",
    criteria: ["one command or one answer", "one file or one asset", "several files or a pipeline", "a new feature across the app"],
  },
};

async function jev(prompt, catalog) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("no TYPESAFE_API_KEY");
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(6000),
    body: JSON.stringify({
      model: process.env.TYPESAFE_MODEL || "jev-latest",
      state: {
        prompt,
        context: "Claude Code session inside the Marketing OS repo (Next.js dashboard + automations for kevbuildsapps, Kev AI, Megan, Danny, Creator OS). Times are ET.",
      },
      questions: { ...QUESTIONS_STATIC, skill: { type: "choice", instructions: "Which skill or workflow in the repo owns this?", criteria: catalog } },
    }),
  });
  if (!res.ok) throw new Error(`jev ${res.status}`);
  return res.json();
}

function sessionToken() {
  const pw = process.env.APP_PASSWORD || "";
  const secret = process.env.APP_AUTH_SECRET || "marketing-os-dev-secret";
  return crypto.createHash("sha256").update(`${pw}::${secret}`).digest("hex");
}

async function dispatch(prompt) {
  const cookie = `mos_session=${sessionToken()}${process.env.JEV_CHANNEL ? `; mos_channel=${process.env.JEV_CHANNEL}` : ""}`;
  let lastErr;
  for (const base of BASE_URLS) {
    try {
      const res = await fetch(`${base}/api/jev`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        signal: AbortSignal.timeout(base.includes("localhost") ? 12000 : 25000),
        body: JSON.stringify({ message: prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return { ...data, base };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("no dashboard reachable");
}

// Terminal date: "Sep 18 9:14pm" in ET (Kevin reads these in the terminal, keep them short).
function etStamp(v) {
  const d = v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    .format(d)
    .replace(",", "")
    .replace(" AM", "am")
    .replace(" PM", "pm");
}
function etDay(v) {
  const d = v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) return String(v ?? "");
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(d);
}
const handle = (v) => (v ? "@" + String(v).replace(/^@/, "") : "");
const num = (v) => (v == null || v === "" ? "" : Number(v).toLocaleString("en-US"));
const plain = (v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

// One table renderer for every Jev tool (cli-table3, Kevin 09-19: "always perfect structure").
// Per-tool column specs: key, header, width (chars), fmt. Columns not listed fall back to the
// dispatcher's `columns` in a generic table. `dropIfUniform` hides a column when every row agrees.
const TEXT = 48;
const COLUMN_SPECS = {
  get_comments: [
    { key: "author_username", head: "user", width: 18, fmt: (v) => handle(v) || "someone" },
    { key: "received_at", head: "when (ET)", width: 16, fmt: etStamp },
    { key: "platform", head: "platform", width: 11, dropIfUniform: true },
    { key: "comment_text", head: "comment", width: TEXT },
  ],
  get_post_analytics: [
    { key: "published_at", head: "posted", width: 10, fmt: etDay },
    { key: "platform", head: "platform", width: 11, dropIfUniform: true },
    { key: "views", head: "views", width: 9, fmt: num, align: "right" },
    { key: "likes", head: "likes", width: 7, fmt: num, align: "right" },
    { key: "comments", head: "cmts", width: 6, fmt: num, align: "right" },
    { key: "saves", head: "saves", width: 6, fmt: num, align: "right" },
    { key: "content", head: "post", width: 44, clip: true },
  ],
  get_agent_posts: [
    { key: "scheduled_for", head: "slot (ET)", width: 16, fmt: etStamp },
    { key: "socials", head: "socials", width: 22 },
    { key: "status", head: "status", width: 10 },
    { key: "keyword", head: "keyword", width: 10 },
    { key: "youtube_title", head: "title", width: 40, clip: true },
  ],
  get_slots: [
    { key: "socials", head: "socials", width: 24 },
    { key: "next_open", head: "next open", width: 16, fmt: etStamp },
    { key: "open_this_month", head: "open", width: 6, fmt: num, align: "right" },
    { key: "booked_this_month", head: "booked", width: 8, fmt: num, align: "right" },
    { key: "missed_this_month", head: "missed", width: 8, fmt: num, align: "right" },
  ],
  get_content_posts: [
    { key: "posted_at", head: "posted (ET)", width: 16, fmt: etStamp },
    { key: "persona", head: "persona", width: 12 },
    { key: "status", head: "status", width: 10 },
    { key: "platforms", head: "platforms", width: 18 },
    { key: "content", head: "post", width: 36 },
  ],
  get_news: [
    { key: "ingested_at", head: "day", width: 8, fmt: etDay },
    { key: "source", head: "source", width: 12 },
    { key: "title", head: "title", width: 56, clip: true },
    { key: "url", head: "url", width: 30 },
  ],
  get_link_clicks: [
    { key: "slug", head: "link", width: 28 },
    { key: "clicks", head: "clicks", width: 8, fmt: num, align: "right" },
    { key: "last_click", head: "last click (ET)", width: 16, fmt: etStamp },
  ],
  get_followers: [
    { key: "profile_name", head: "profile", width: 22, clip: true },
    { key: "platform", head: "platform", width: 11 },
    { key: "username", head: "handle", width: 18, fmt: handle },
    { key: "followers", head: "followers", width: 10, fmt: num, align: "right" },
    { key: "delta", head: "day", width: 7, fmt: (v) => (v == null ? "" : (Number(v) > 0 ? "+" : "") + num(v)), align: "right" },
  ],
  get_automations: [
    { key: "name", head: "job", width: 22 },
    { key: "cadence", head: "cadence", width: 18 },
    { key: "health", head: "health", width: 9 },
    { key: "last_run", head: "last run (ET)", width: 16, fmt: etStamp },
    { key: "next_run", head: "next run (ET)", width: 16, fmt: etStamp },
  ],
  get_media: [
    { key: "name", head: "asset", width: 34, clip: true },
    { key: "brand", head: "brand", width: 16 },
    { key: "kind", head: "kind", width: 8 },
    { key: "size", head: "size", width: 10 },
    { key: "duration", head: "len", width: 6 },
    { key: "file", head: "vault path", width: 40, clip: true },
  ],
  get_revenue: [
    { key: "date", head: "day", width: 12, fmt: etDay },
    { key: "new_customers", head: "downloads", width: 10, fmt: num, align: "right" },
  ],
};

function renderRows(result, tool, max = 30) {
  const all = result.rows || [];
  const rows = all.slice(0, max);
  if (!rows.length) return "";
  let specs = COLUMN_SPECS[tool];
  if (!specs) {
    const cols = result.columns || Object.keys(rows[0]);
    specs = cols.map((c) => ({ key: c, head: c.replace(/_/g, " "), width: Math.min(TEXT, Math.max(8, ...rows.map((r) => plain(r[c]).length + 2))) }));
  }
  specs = specs.filter((c) => {
    if (!rows.some((r) => r[c.key] != null && r[c.key] !== "")) return false;
    if (c.dropIfUniform && new Set(rows.map((r) => plain(r[c.key]))).size === 1) return false;
    return true;
  });
  const table = new Table({
    head: specs.map((c) => c.head),
    colWidths: specs.map((c) => c.width + 2),
    colAligns: specs.map((c) => c.align || "left"),
    wordWrap: true,
    wrapOnWordBoundary: true,
    style: { head: [], border: [], "padding-left": 1, "padding-right": 1, compact: true },
    chars: {
      top: "─", "top-mid": "┬", "top-left": "┌", "top-right": "┐",
      bottom: "─", "bottom-mid": "┴", "bottom-left": "└", "bottom-right": "┘",
      left: "│", "left-mid": "", mid: "", "mid-mid": "", right: "│", "right-mid": "", middle: "│",
    },
  });
  for (const r of rows) {
    table.push(specs.map((c) => {
      const v = (c.fmt ? c.fmt(r[c.key]) : plain(r[c.key])).replace(/\s+/g, " ").trim();
      return c.clip && v.length > c.width ? v.slice(0, c.width - 1).trimEnd() + "…" : v;
    }));
  }
  const more = all.length > max ? `\n… ${all.length - max} more on /dashboard/jev` : "";
  return `\n${table.toString()}${more}`;
}

async function main() {
  loadEnv();
  if (process.env.JEV_ROUTER === "0") process.exit(0);
  const input = readStdin();
  let payload = {};
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0);
  }
  const prompt = String(payload.user_prompt ?? payload.prompt ?? "").trim();
  if (!prompt || prompt.startsWith("/") || prompt.startsWith("!")) process.exit(0);
  if (/--jev\s*off|\bno jev\b/i.test(prompt)) process.exit(0);

  const catalog = skillCatalog();
  let j;
  const t0 = Date.now();
  try {
    j = await jev(prompt, catalog);
  } catch (e) {
    log({ prompt: prompt.slice(0, 200), error: String(e?.message || e) });
    process.exit(0);
  }
  const a = j.answers || {};
  const pick = (k) => a[k]?.choice ?? "";
  const conf = (k) => Number(a[k]?.confidence ?? 0);
  const yes = (k) => Number(a[k]?.noul ?? 0);
  const lane = pick("lane"), skill = pick("skill"), persona = pick("persona"), risk = pick("risk"), platform = pick("platform");
  const complexity = Math.round(Number(a.complexity?.score ?? 0));
  const label =
    `[jev] lane=${lane} ${conf("lane").toFixed(2)} · skill=${skill} ${conf("skill").toFixed(2)} · persona=${persona} ${conf("persona").toFixed(2)}` +
    ` · risk=${risk} ${conf("risk").toFixed(2)} · platform=${platform}` +
    ` · correction=${yes("is_correction").toFixed(2)} · wants_deploy=${yes("wants_deploy").toFixed(2)} · near_slot=${yes("near_slot").toFixed(2)}` +
    ` · complexity=${complexity}/3 · ${j.model} ${Date.now() - t0}ms`;

  // Tool lane: answer from the dispatcher and stop here (no Claude).
  // media lookups are read-only by nature even when Jev reads "b-roll" as local file work
  // Media nouns are always worth a dispatcher look: Jev's lane read wobbles between
  // tool and conversation on "the best openai logo" (the dispatcher still decides).
  const mediaAsk = /\b(logos?|icons?|clips?|footage|b-?roll|profile pictures?|avatars?|brand assets?|wordmark|thumbnail tile|vault)\b/i.test(prompt);
  if ((mediaAsk || (lane === "tool" && conf("lane") >= TOOL_MIN)) && (risk === "read_only" || risk === "local_files")) {
    try {
      const d = await dispatch(prompt);
      const dec = d.decision || {};
      if (dec.tool && dec.tool !== "none" && d.result && (dec.toolConfidence ?? 0) >= DISPATCH_MIN) {
        const head = `Jev answered this without Claude (${dec.tool} ${Math.round((dec.toolConfidence || 0) * 100)}% · ${dec.range}${dec.platform && dec.platform !== "any" ? ` · ${dec.platform}` : ""}${dec.status && dec.status !== "any" ? ` · ${dec.status}` : ""}${dec.count ? ` · ${dec.count === 1 ? "single" : `${dec.count} items`}` : ""} · ${dec.latencyMs} ms · via ${d.base.replace(/^https?:\/\//, "")})`;
        log({ prompt: prompt.slice(0, 200), lane, skill, tool: dec.tool, blocked: true, ms: Date.now() - t0 });
        let body = `${d.result.summary.split(". ")[0].replace(/\.?$/, ".")}${renderRows(d.result, dec.tool, dec.count ? Math.min(100, dec.count) : 30)}`;
        if (d.result.media) {
          // Obsidian vault answer. Claude Code paints hook text in its own colour and
          // strips ANSI, so the neon-blue treatment is a Quick Look contact sheet of
          // the real files (images + video first frames) popped over the terminal
          // (Kevin 2026-09-20), plus a text marker and Obsidian links here.
          const rows = d.result.rows || [];
          const links = rows.slice(0, 12).map((r) => `  obsidian://open?vault=${encodeURIComponent(process.env.OBSIDIAN_VAULT_NAME || "Marketing OS Broll")}&file=${encodeURIComponent(String(r.note || r.file || "").replace(/\.md$/, ""))}`).join("\n");
          // where the files live on this Mac (Kevin 2026-09-20: "show where that file is on the computer")
          const paths = rows.slice(0, 16).map((r) => `  ${r.path || (process.env.OBSIDIAN_VAULT_DIR ? path.join(process.env.OBSIDIAN_VAULT_DIR, String(r.file || "")) : r.file)}`).join("\n");
          body = `◈ OBSIDIAN · MARKETING OS BROLL ◈\n${body}${paths ? `\n\non disk:\n${paths}` : ""}${links ? `\n\nopen in Obsidian:\n${links}` : ""}\n\n(preview in Quick Look, space closes${rows.length === 1 ? "; file revealed in Finder" : ""})`;
          if (rows.length === 1) {
            const p1 = rows[0].path || (process.env.OBSIDIAN_VAULT_DIR ? path.join(process.env.OBSIDIAN_VAULT_DIR, String(rows[0].file || "")) : "");
            if (p1 && fs.existsSync(p1)) {
              try { spawn("open", ["-R", p1], { detached: true, stdio: "ignore" }).unref(); } catch { /* best effort */ }
            }
          }
          try {
            const vault = process.env.OBSIDIAN_VAULT_DIR || "";
            if (vault && rows.length) {
              const child = spawn("python3", [path.join(path.dirname(fileURLToPath(import.meta.url)), "vault-sheet.py")], { detached: true, stdio: ["pipe", "ignore", "ignore"] });
              child.stdin.end(JSON.stringify({ title: d.result.summary.split(". ")[0], vault, rows: rows.slice(0, 16) }));
              child.unref();
            }
          } catch {
            /* preview is best effort */
          }
        }
        block(`${head}\n\n${body}\n\nAdd "--jev off" to send this to Claude instead.`);
      }
    } catch (e) {
      log({ prompt: prompt.slice(0, 200), lane, skill, dispatchError: String(e?.message || e) });
    }
  }

  log({ prompt: prompt.slice(0, 200), lane, skill, persona, risk, platform, complexity, correction: yes("is_correction"), blocked: false, ms: Date.now() - t0 });
  const hints = [];
  if (skill && skill !== "none" && conf("skill") >= 0.6 && fs.existsSync(path.join(SKILLS, skill, "SKILL.md"))) {
    hints.push(`Load the "${skill}" skill first (creator-os/.claude/skills/${skill}/SKILL.md).`);
  }
  if (lane === "assess") hints.push("Kevin is asking a question: investigate and report, do not change anything unless he asks.");
  if (yes("is_correction") >= 0.7) hints.push("This reads as a correction or a standing preference: save it to memory with the why.");
  if (risk === "publishes" || yes("wants_deploy") >= 0.7) hints.push("This publishes or deploys: confirm before anything goes out, and check the publish-slot clock (deploys at slot times drop posts).");
  if (yes("near_slot") >= 0.7) hints.push("A publish slot is close: do not deploy or restart until it has passed.");
  passThrough(`${label}\n${hints.join("\n")}`.trim());
}

main().catch(() => process.exit(0));
