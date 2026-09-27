#!/usr/bin/env node
/**
 * Gold labels for the same Marketing OS tool questions Jev answers.
 * Criteria strings are copied from src/lib/jev/tools.ts + obsidian.ts so the
 * fine-tune sees the live option text, not abbreviated slugs.
 *
 *   node scripts/laya/build_tool_dataset.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_CRITERIA = {
  get_comments: "Comments other people left on the current channel's social posts (our own replies excluded): counts, which got a keyword DM or a reply, which are unanswered, the comment text and authors.",
  get_agent_posts: "Agent Posts for the current channel: videos queued, scheduled, or published through the Agent Posts pipeline, with their slot time, keyword and status.",
  get_slots: "Open and booked upload slots on the current channel's Agent Posts pipeline, the next open slot per socials set.",
  get_content_posts: "Automated persona content for the current channel (carousels, reactions, threads) posted by the cron jobs.",
  get_news: "AI news items and the daily brief from the AI news agent (global, not per channel).",
  get_link_clicks: "Clicks on tracked /go/ links (download attribution, global across channels), grouped by link slug.",
  get_followers: "Follower counts for the social accounts connected to the current channel and how they changed: social growth, audience growth, new followers, subscriber gains, 'how are my socials doing', 'what is my growth today / this week'.",
  get_revenue: "RevenueCat numbers for the current channel's app: new customers / downloads per day, active subscriptions, MRR, revenue, trials. Use for 'downloads', 'new customers', 'how many subs', 'revenue', 'mrr', 'are we on pace'.",
  get_automations: "The automations (cron jobs) running for the current channel: what each one does, cadence, last run, next run, health (healthy / overdue / paused). Use for 'what automations are running', 'is anything overdue', 'when does X run next', 'did the news agent run'.",
  get_post_analytics: "Per-post performance for the current channel's published posts: views, likes, comments, saves, shares, engagement rate, sortable (most views, newest, most likes). Use for 'best posts', 'top videos', 'how did posts do', 'past N posts by views'.",
  get_media: "Media from the Obsidian B-roll vault (Marketing OS Broll): brand assets, AI company logos and VIDEO B-ROLL CLIPS. Use for 'do we have a Claude logo', 'find the Creator OS icon', 'what's in the vault'.",
  delete_comment: "Delete one comment left on the current channel's social posts. Use when the user asks to remove, delete, take down, or get rid of a specific comment.",
  reply_comment: "Reply publicly to one comment. Use when the user asks to reply, respond, answer, or say something under a comment.",
  none: "The request is not answered by any tool above (chit-chat, an opinion, or a write action other than deleting or replying to a comment).",
};

const RANGE_CRITERIA = {
  today: "Today (ET).",
  yesterday: "Yesterday (ET).",
  last_7_days: "The last 7 days, this week, past week.",
  last_30_days: "The last 30 days, past month (rolling).",
  last_60_days: "The last 60 days, past two months.",
  last_90_days: "The last 90 days, past quarter, last three months.",
  this_month: "This calendar month (the month we are in now).",
  year_to_date: "Year to date, this year, since January 1.",
  next_7_days: "The week ahead, the next 7 days, upcoming, what is coming up (future).",
  all: "No time filter, all time, or not applicable.",
};

const SORT_CRITERIA = {
  most_views: "Highest views first. This is what 'best', 'top', 'most viewed', 'by views' means.",
  newest: "Newest first, chronological, most recent post at the top.",
  most_likes: "Highest likes first.",
  most_comments: "Highest comments first.",
  best_engagement: "Highest engagement RATE first, only when the request literally says engagement rate.",
  not_applicable: "No ordering was asked for or it does not apply.",
};

const PLATFORM_CRITERIA = {
  any: "No platform named, or all platforms together.",
  instagram: "Instagram (IG, reels, insta).",
  tiktok: "TikTok.",
  youtube: "YouTube (YT, shorts).",
  twitter: "X / Twitter (tweets).",
  threads: "Threads.",
  linkedin: "LinkedIn.",
  facebook: "Facebook (FB).",
};

const STATUS_CRITERIA = {
  any: "No reply status named; every comment.",
  unanswered: "Comments with no reply and no DM yet: unanswered, unreplied, ignored, missed, still waiting.",
  replied: "Comments we replied to publicly (YouTube keyword replies, persona replies).",
  dm_sent: "Comments that triggered a keyword DM through the Zernio automation (comment-to-DM funnel).",
};

const QUANTITY_CRITERIA = {
  specific_count: "The request asks for a specific NUMBER OF ITEMS: 'past 10 posts', 'top 5 videos', 'last 20 comments'.",
  single_item: "The request is SINGULAR and wants exactly one item, no number given.",
  time_span: "The only number is a time span (days, weeks, months), not a count of items.",
  none: "No number of items is asked for (show the default amount).",
};

const PILLAR_CRITERIA = {
  "brand-assets": "Our own brand assets: Creator OS logos, app icon, profile pictures.",
  "ai-companies": "AI company and startup B-roll marks: Claude, OpenAI, Cursor, etc.",
  "video-broll": "Video B-roll clips (real footage).",
  any: "No pillar named / not specified.",
};

const KIND_CRITERIA = {
  logo: "A logo or wordmark.",
  icon: "An app icon or square tile.",
  profile: "A social account profile picture / avatar.",
  clip: "A video clip.",
  any: "Any kind.",
};

const TEMPLATES = {
  get_comments: ["what comments did we get {range}", "{status} comments {range}", "{platform} comments {range}", "show me {range} {platform} comments"],
  get_agent_posts: ["what is scheduled on agent posts {range}", "queued agent posts {range}", "agent posts {range}"],
  get_slots: ["open slots {range}", "next open slot {range}", "booked slots {range}"],
  get_content_posts: ["what did the cron post {range}", "persona carousels {range}", "automated content posts {range}"],
  get_news: ["what did the news agent find {range}", "ai news items {range}", "ai news brief {range}"],
  get_link_clicks: ["link clicks {range}", "/go/ clicks {range}", "clicks by slug {range}"],
  get_followers: ["follower change {range}", "audience growth {range}", "new followers {range}"],
  get_revenue: ["downloads {range}", "new customers {range}", "revenue {range}", "mrr {range}"],
  get_automations: ["automations running {range}", "cron health {range}", "is anything overdue {range}"],
  get_post_analytics: ["posts ranked by views {range}", "{platform} post analytics {range}", "best {platform} {range}", "how did posts do {range}"],
  get_media: ["do we have a claude logo", "show me megan's profile picture", "jev playing subway surfers clip", "creator os icon", "openai logo", "hoops footage", "what's in the vault"],
  delete_comment: ["delete that comment", "delete the last comment", "remove the comment from @spam", "delete the last unanswered comment", "take down that tiktok comment"],
  reply_comment: ["reply to that comment", "reply saying thanks", "respond to the last comment", "reply to @miron saying appreciate it"],
  none: ["what should i post next", "write a caption for this reel", "publish the queued video", "hey how are you", "deploy to railway"],
};

const RANGE_FILL = {
  today: "today",
  yesterday: "yesterday",
  last_7_days: "this week",
  last_30_days: "last 30 days",
  this_month: "this month",
  year_to_date: "this year",
  next_7_days: "next 7 days",
  all: "",
};

const PLATFORM_FILL = {
  any: "",
  instagram: "instagram",
  tiktok: "tiktok",
  youtube: "youtube",
};

const STATUS_FILL = {
  any: "",
  unanswered: "unanswered",
  dm_sent: "dm-triggered",
};

const PHRASES = {
  get_comments: [
    "what comments did we get today", "unanswered comments this week", "tiktok comments today",
    "comments with no reply today", "show me yesterday's ig comments", "youtube comments last 7 days",
    "which comments triggered a dm today", "missed comments this month", "threads comments yesterday",
  ],
  get_agent_posts: [
    "what is scheduled on agent posts this week", "queued agent posts", "what did we publish through agent posts today",
    "agent posts scheduled next 7 days", "agent posts this month", "what's in the agent posts board",
  ],
  get_slots: [
    "next open slots", "which upload slots are free", "open slots this week", "when is the next open slot",
    "booked slots today", "upcoming slots next 7 days",
  ],
  get_content_posts: [
    "what did the cron post today", "persona carousels this week", "automated content posts this month",
    "megan reactions posted yesterday", "danny content this week", "cron posts year to date",
  ],
  get_news: [
    "what did the news agent find today", "ai news brief", "latest ai news items", "did the news agent run",
    "news items yesterday", "ai news this week",
  ],
  get_link_clicks: [
    "link clicks this month", "how many /go/ clicks today", "download link clicks last 7 days",
    "clicks by slug this week", "go link clicks yesterday", "attribution clicks this year",
  ],
  get_followers: [
    "how did followers change in the last 7 days", "audience growth today", "new followers this month",
    "how are my socials doing", "follower gains yesterday", "social growth last 30 days",
  ],
  get_revenue: [
    "downloads this month", "new customers today", "what is mrr", "how many active subs",
    "revenue this week", "downloads yesterday", "are we on pace this month",
  ],
  get_automations: [
    "what automations are running and is anything overdue", "when does the news agent run next",
    "cron health", "is anything overdue", "list automations", "what jobs run today",
  ],
  get_post_analytics: [
    "past 100 posts ranked by views", "instagram post analytics this month", "best tiktoks this week",
    "top videos by views last 30 days", "how did posts do yesterday", "most liked posts this month",
    "youtube analytics last 7 days", "past 10 posts from tiktok",
  ],
  get_media: [
    "do we have a claude logo", "show me megan's profile picture", "jev playing subway surfers clip",
    "creator os icon", "what brand assets do we have", "openai logo", "hoops footage",
    "gitnexus screen recording", "what's in the vault", "anthropic logo", "cursor logo",
    "gemini mark", "nvidia logo", "find the no code academy logo", "danny profile picture",
    "kev ai avatar", "iphone foldable clip", "b-roll of the hoops app", "ai company logos",
  ],
  delete_comment: [
    "delete that comment", "delete the last comment", "remove the comment from @spam",
    "delete the last unanswered comment", "take down that tiktok comment",
    "delete yesterday's comment from @bot", "remove the comment that says \"free followers\"",
    "delete it", "delete that one", "remove it",
  ],
  reply_comment: [
    "reply to that comment", "reply saying thanks", "respond to the last comment",
    "reply to @miron saying appreciate it", "answer that comment with \"that's the point\"",
    "reply to it saying fair", "respond to the last unanswered comment",
  ],
  none: [
    "what should i post next", "write a caption for this reel", "publish the queued video",
    "hey how are you", "deploy to railway", "edit the talking head",
    "rewrite this hook", "schedule a reel for tomorrow", "make megan's next carousel",
    "should I post this", "give me a growth idea",
  ],
};

const RANGE_NEEDLES = {
  today: ["today", "this morning", "so far today"],
  yesterday: ["yesterday"],
  last_7_days: ["this week", "last 7 days", "past week"],
  last_30_days: ["last 30 days", "past month"],
  last_60_days: ["last 60 days", "past two months"],
  last_90_days: ["last 90 days", "past quarter"],
  this_month: ["this month"],
  next_7_days: ["next 7 days", "upcoming", "this coming week"],
  year_to_date: ["this year", "year to date"],
  all: ["all time", "ever"],
};

const PLATFORM_NEEDLES = {
  instagram: ["instagram", "ig", "reels"],
  tiktok: ["tiktok"],
  youtube: ["youtube", "yt"],
  twitter: ["twitter", "x"],
  threads: ["threads"],
};

const SORT_NEEDLES = {
  most_views: ["by views", "most viewed", "top", "best"],
  newest: ["newest", "latest", "most recent"],
  most_likes: ["most liked", "by likes"],
  most_comments: ["most comments", "by comments"],
  best_engagement: ["engagement rate"],
};

for (const [tool, tpls] of Object.entries(TEMPLATES)) {
  const bag = new Set(PHRASES[tool] ?? []);
  const ranges = tool === "get_media" || tool === "none" ? ["all"] : Object.keys(RANGE_FILL);
  const platforms = tool === "get_post_analytics" || tool === "get_comments" ? Object.keys(PLATFORM_FILL) : ["any"];
  const statuses = tool === "get_comments" ? Object.keys(STATUS_FILL) : ["any"];
  for (const tpl of tpls) {
    const rangeOpts = tpl.includes("{range}") ? ranges : ["all"];
    const platformOpts = tpl.includes("{platform}") ? platforms.filter((p) => p !== "any") : ["any"];
    const statusOpts = tpl.includes("{status}") ? statuses.filter((s) => s !== "any") : ["any"];
    for (const range of rangeOpts) {
      for (const platform of platformOpts) {
        for (const status of statusOpts) {
          const text = tpl
            .replaceAll("{range}", RANGE_FILL[range])
            .replaceAll("{platform}", PLATFORM_FILL[platform])
            .replaceAll("{status}", STATUS_FILL[status])
            .replace(/\s+/g, " ")
            .trim();
          if (text) bag.add(text);
        }
      }
    }
  }
  PHRASES[tool] = [...bag];
}

const CONTEXT = "Marketing OS dashboard for kevbuildsapps, Kev AI and Megan social accounts. Times are ET.";

const QUESTIONS = {
  tool: { type: "choice", instructions: "Which tool answers this request?", criteria: TOOL_CRITERIA },
  range: { type: "choice", instructions: "Which time range does the request refer to?", criteria: RANGE_CRITERIA },
  sort: { type: "choice", instructions: "If the request asks for posts ranked or ordered, which ordering?", criteria: SORT_CRITERIA },
  platform: { type: "choice", instructions: "Which social platform does the request name, if any?", criteria: PLATFORM_CRITERIA },
  status: { type: "choice", instructions: "For comments: does the request ask about a reply status (unanswered, replied, DM sent)?", criteria: STATUS_CRITERIA },
  quantity: { type: "choice", instructions: "Does the request name how many items to return?", criteria: QUANTITY_CRITERIA },
  media_pillar: { type: "choice", instructions: "If the request is about media, logos, icons, profile pictures or B-roll from the vault: which pillar?", criteria: PILLAR_CRITERIA },
  media_kind: { type: "choice", instructions: "If the request is about media from the vault: what kind of file?", criteria: KIND_CRITERIA },
};

function firstMatch(text, table, fallback) {
  const l = text.toLowerCase();
  for (const [id, needles] of Object.entries(table)) {
    if (needles.some((n) => l.includes(n))) return id;
  }
  return fallback;
}
function detectStatus(text, tool) {
  if (tool !== "get_comments") return "any";
  const l = text.toLowerCase();
  if (/no reply|unanswered|unreplied|missed/.test(l)) return "unanswered";
  if (/\bdm\b/.test(l)) return "dm_sent";
  return "any";
}
function detectQuantity(text) {
  if (/\b(past|top|last|first)\s+\d+/.test(text)) return "specific_count";
  if (/\b(the )?(most recent|latest|last|best) (comment|post|video)\b/.test(text)) return "single_item";
  if (/\b\d+\s+(days|weeks|months)\b/.test(text)) return "time_span";
  return "none";
}
function detectPillar(text, tool) {
  if (tool !== "get_media") return "any";
  const l = text.toLowerCase();
  if (/profile picture|avatar|megan|danny|kev/.test(l)) return "brand-assets";
  if (/creator os|brand asset/.test(l)) return "brand-assets";
  if (/claude|openai|cursor|gemini/.test(l)) return "ai-companies";
  if (/clip|footage|b-?roll|screen recording|subway|hoops|gitnexus/.test(l)) return "video-broll";
  return "any";
}
function detectKind(text, tool) {
  if (tool !== "get_media") return "any";
  const l = text.toLowerCase();
  if (/profile picture|avatar/.test(l)) return "profile";
  if (/icon/.test(l)) return "icon";
  if (/clip|footage|b-?roll|recording/.test(l)) return "clip";
  if (/logo/.test(l)) return "logo";
  return "any";
}

const rows = [];
for (const [tool, phrases] of Object.entries(PHRASES)) {
  for (const request of phrases) {
    rows.push({
      state: { request, context: CONTEXT },
      questions: QUESTIONS,
      answers: {
        tool: { type: "choice", choice: tool },
        range: { type: "choice", choice: firstMatch(request, RANGE_NEEDLES, "all") },
        sort: { type: "choice", choice: firstMatch(request, SORT_NEEDLES, "not_applicable") },
        platform: { type: "choice", choice: firstMatch(request, PLATFORM_NEEDLES, "any") },
        status: { type: "choice", choice: detectStatus(request, tool) },
        quantity: { type: "choice", choice: detectQuantity(request) },
        media_pillar: { type: "choice", choice: detectPillar(request, tool) },
        media_kind: { type: "choice", choice: detectKind(request, tool) },
      },
    });
  }
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, "mos-tools.jsonl");
fs.writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`wrote ${rows.length} examples → ${out}`);
