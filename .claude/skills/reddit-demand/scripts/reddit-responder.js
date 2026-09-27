#!/usr/bin/env node
/**
 * reddit-responder — the ICP problem-solver agent.
 *
 * Scans target subreddits for fresh posts where our ICP (creators, SMMs,
 * small-business owners) describes the problems Creator OS solves (posting
 * admin, cross-platform chaos, consistency burnout, tool-stack questions),
 * drafts a genuinely helpful reply in a peer voice with a tolerance-matched
 * CTA, and queues it in the `reddit_replies` table.
 *
 * Reply posture by sub tolerance (mirrors SKILL.md):
 *   high  — may name Creator OS + say we built it
 *   med   — may name Creator OS once, no links, only if it truly fits
 *   low   — NO product mention; pure problem-solving (goodwill + karma)
 *
 * Reddit access: official OAuth (script app, password grant) — the ONLY
 * reliable server-side path; anonymous scraping is fingerprint-blocked.
 * Requires in env: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET,
 * REDDIT_USERNAME, REDDIT_PASSWORD (u/creator_os). Without them this script
 * exits 0 with a loud note so the cron stays green until creds land.
 *
 * REDDIT_AUTOPOST=1 posts queued replies automatically (max 3/run, spaced);
 * default leaves them status='pending' for review.
 *
 * Usage: node --env-file=.env.local reddit-responder.js [--limit 5] [--post]
 */
const { Pool } = require("pg");

const { createMessage } = require("../../../lib/llm");

// Unset → the llm gateway routes to OLLAMA_TEXT_MODEL (DeepSeek).
const MODEL = process.env.TIPS_MODEL || null;
const UA = "web:com.creatoros.responder:v1.0 (by /u/creator_os)";
const APP_URL = "https://your-app.up.railway.app/go/reddit";

const TARGETS = [
  { sub: "SideProject", tolerance: "high" },
  { sub: "EntrepreneurRideAlong", tolerance: "high" },
  { sub: "indiehackers", tolerance: "high" },
  { sub: "socialmediamanagers", tolerance: "med" },
  { sub: "SocialMediaMarketing", tolerance: "med" },
  { sub: "UGCcreators", tolerance: "med" },
  { sub: "InstagramMarketing", tolerance: "med" },
  { sub: "NewTubers", tolerance: "low" },
  { sub: "smallbusiness", tolerance: "low" },
  { sub: "Entrepreneur", tolerance: "low" },
  { sub: "socialmedia", tolerance: "low" },
  { sub: "Tiktokhelp", tolerance: "low" },
];

const PAIN = new RegExp(
  [
    "post(ing)? (to|on) (all|every|multiple|each)",
    "cross.?post", "repurpos", "every platform", "all platforms",
    "schedul(e|ing) (content|posts)", "content calendar",
    "hours? a day (posting|uploading|on social)",
    "burn(ed|t)? ?out", "stay(ing)? consistent", "consistency",
    "social media manager.{0,40}(tool|stack|app)",
    "what (tool|app|scheduler)", "best (tool|app|scheduler) for",
    "manag(e|ing) (multiple|several|client)",
    "automat(e|ing) (my|our|social)",
  ].join("|"),
  "i",
);

function arg(n, d) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; }
const LIMIT = parseInt(arg("--limit", "5"), 10);
const AUTOPOST = process.argv.includes("--post") || process.env.REDDIT_AUTOPOST === "1";

async function redditToken() {
  const { REDDIT_CLIENT_ID: id, REDDIT_CLIENT_SECRET: secret, REDDIT_USERNAME: user, REDDIT_PASSWORD: pass } = process.env;
  if (!id || !secret || !user || !pass) return null;
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body: new URLSearchParams({ grant_type: "password", username: user, password: pass }),
  });
  if (!res.ok) throw new Error(`Reddit OAuth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token;
}

async function reddit(token, pathname, body) {
  const res = await fetch(`https://oauth.reddit.com${pathname}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "User-Agent": UA, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: body ? new URLSearchParams(body) : undefined,
  });
  if (!res.ok) throw new Error(`Reddit ${res.status} ${pathname}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function draftReply(post, tolerance) {
  const posture = {
    high: "You may say 'we built Creator OS for exactly this' once, naturally, and mention it's on the App Store. No raw links unless the sub loves them.",
    med: "You may mention Creator OS by name AT MOST once, only if it genuinely answers their question, phrased as 'we ended up building our own tool (Creator OS)'. No links.",
    low: "Do NOT mention any product, tool name, or link. Pure problem-solving. End with an offer to share more of the workflow if useful.",
  }[tolerance];
  const json = await createMessage({
      model: MODEL,
      max_tokens: 1000,
      system:
        "You write Reddit replies as a tired-but-helpful person who runs social media for multiple brands. " +
        "Actually solve the poster's specific problem with concrete steps drawn from real workflow knowledge (batching, scheduling, cross-posting, one-dashboard analytics). " +
        "Sound human: lowercase-ish, contractions, no bullet-point essays unless the answer truly needs steps, under 160 words. " +
        "NEVER use em dashes or double hyphens. No emojis. No 'great question'. No sign-offs. " + posture,
      messages: [{ role: "user", content: `Subreddit: r/${post.subreddit}\nTitle: ${post.title}\nPost:\n${(post.selftext || "").slice(0, 1500)}\n\nWrite the reply.` }],
  });
  return (json.content || []).find((b) => b.type === "text")?.text?.trim();
}

async function main() {
  const token = await redditToken();
  if (!token) {
    console.log("[reddit-responder] REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD not set — skipping run. " +
      "Create a script app at reddit.com/prefs/apps (logged in as u/creator_os) and add the creds to env.");
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
  await pool.query(`create table if not exists reddit_replies (
    id bigserial primary key, reddit_post_id text unique, subreddit text, title text, url text,
    tolerance text, draft_reply text, status text default 'pending',
    created_at timestamptz default now(), posted_at timestamptz)`);

  let queued = 0, posted = 0;
  try {
    for (const t of TARGETS) {
      if (queued >= LIMIT) break;
      let listing;
      try {
        listing = await reddit(token, `/r/${t.sub}/new?limit=30`);
      } catch (e) { console.error(`  ! r/${t.sub}: ${e.message}`); continue; }
      for (const c of listing.data.children) {
        if (queued >= LIMIT) break;
        const p = c.data;
        const ageH = (Date.now() / 1000 - p.created_utc) / 3600;
        if (ageH > 36 || p.stickied || !PAIN.test(`${p.title} ${p.selftext || ""}`)) continue;
        const { rows } = await pool.query("select 1 from reddit_replies where reddit_post_id = $1", [p.name]);
        if (rows.length) continue;

        const reply = await draftReply(p, t.tolerance);
        if (!reply) continue;
        await pool.query(
          `insert into reddit_replies (reddit_post_id, subreddit, title, url, tolerance, draft_reply, status)
           values ($1,$2,$3,$4,$5,$6,'pending') on conflict do nothing`,
          [p.name, t.sub, p.title, `https://www.reddit.com${p.permalink}`, t.tolerance, reply],
        );
        queued++;
        console.log(`  + queued r/${t.sub}: "${p.title.slice(0, 70)}"`);

        if (AUTOPOST && posted < 3) {
          await reddit(token, "/api/comment", { thing_id: p.name, text: reply });
          await pool.query("update reddit_replies set status='posted', posted_at=now() where reddit_post_id=$1", [p.name]);
          posted++;
          console.log(`    ✓ replied`);
          await new Promise((r) => setTimeout(r, 45000)); // human pacing
        }
      }
    }
    const { rows: pending } = await pool.query("select count(*)::int n from reddit_replies where status='pending'");
    console.log(`\n[reddit-responder] queued ${queued}, posted ${posted}, pending review: ${pending[0].n}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
