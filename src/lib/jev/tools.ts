import "server-only";
import { query } from "@/lib/insforge/db";
import { boardTargetsForChannel, listAgentPostTargets } from "@/lib/agent-posts/targets";
import { personaSlugsForChannel } from "@/lib/channels/personas";
import { slotBoardsForTargets, formatSlotEt } from "@/lib/agent-posts/slots";
import { agentPostTargetName } from "@/lib/agent-posts/types";
import { brandCriteria, MEDIA_KINDS, mediaDiskPath, mediaIndex, obsidianConfigured, PILLARS, VAULT_NAME, type MediaKindId, type PillarId } from "./obsidian";
import { jevEvaluate, type ChoiceAnswer } from "./client";
import { getActiveChannel } from "@/lib/channels/store";
import { getNewCustomersDaily, getOverviewMetrics } from "@/lib/revenuecat/client";
import { listRailwayAutomations } from "@/lib/automations/railway";
import { listAccounts } from "@/lib/zernio/client";
import { loadDeletableComment, removeComment, type CommentDeleteRow } from "@/lib/comments/delete";
import { replyToComment } from "@/lib/comments/reply";

/**
 * Jev chat tool catalog (Kevin 2026-09-18): Jev CHOOSES the tool and the time
 * range from this list; the dispatcher below RUNS it. All tools are read-only.
 * The catalog descriptions ARE the choice criteria, so keep them honest and
 * distinct; that is what Jev decides on.
 */
export const TOOLS = {
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
  get_media: "Media from the Obsidian B-roll vault (Marketing OS Broll): brand assets (Creator OS logos and app icon, No Code Academy logo, Hoops AI icon, our social profile pictures), AI company / startup logos (Claude, Anthropic, OpenAI, ChatGPT, Codex, Cursor, Gemini, NVIDIA, Meta, GitHub, Apify, Expo, Vercel...) and VIDEO B-ROLL CLIPS (Hoops AI court demo, GitNexus graph screen recording, iPhone foldable duo, Jev playing Subway Surfers). Use for 'do we have a Claude logo', 'find the Creator OS icon', 'what brand assets do we have', 'show me Megan's profile picture', 'AI company logos', 'B-roll for OpenAI', 'jev playing subway surfers clip', 'footage of the hoops app', 'gitnexus screen recording', 'what video b-roll do we have', 'what's in the vault'.",
  delete_comment: "Delete one comment left on the current channel's social posts (spam, hate, the comment just named, or 'it' / 'that' / 'this' meaning the comment just shown). Use when the user asks to remove, delete, take down, or get rid of a specific comment. Not for hiding. Not for deleting posts or DMs. Not for replying.",
  reply_comment: "Reply publicly to one comment on the current channel's social posts. Use when the user asks to reply, respond, answer, or say something under a comment (including 'reply to that' / 'reply saying ...'). The reply text is in the request. Not for DMs. Not for deleting.",
  none: "The request is not answered by any tool above (chit-chat, an opinion, or a write action other than deleting or replying to a comment).",
} as const;
export type ToolId = keyof typeof TOOLS;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"] as const;

export const RANGES = {
  today: "Today (ET).",
  yesterday: "Yesterday (ET).",
  last_7_days: "The last 7 days, this week, past week.",
  last_30_days: "The last 30 days, past month (rolling).",
  last_60_days: "The last 60 days, past two months.",
  last_90_days: "The last 90 days, past quarter, last three months.",
  this_month: "This calendar month (the month we are in now).",
  year_to_date: "Year to date, this year, since January 1.",
  next_7_days: "The week ahead, the next 7 days, upcoming, what is coming up (future).",
  ...Object.fromEntries(MONTHS.map((m) => [`month_${m}`, `The specific month of ${m[0].toUpperCase()}${m.slice(1)} (most recent one).`])) as Record<`month_${(typeof MONTHS)[number]}`, string>,
  all: "No time filter, all time, or not applicable.",
} as const;
export type RangeId = keyof typeof RANGES;

/** Short human label for summaries (the RANGES text is written for Jev). */
export function rangeLabel(range: RangeId): string {
  if (range.startsWith("month_")) return `in ${range.slice(6)[0].toUpperCase()}${range.slice(7)}`;
  return ({
    today: "today", yesterday: "yesterday", last_7_days: "in the last 7 days", last_30_days: "in the last 30 days",
    last_60_days: "in the last 60 days", last_90_days: "in the last 90 days", this_month: "this month",
    year_to_date: "year to date", next_7_days: "in the next 7 days", all: "all time",
  } as Record<string, string>)[range] ?? range.replace(/_/g, " ");
}

export const SORTS = {
  most_views: "Highest views first. This is what 'best', 'top', 'most viewed', 'by views' means.",
  newest: "Newest first, chronological, most recent post at the top.",
  most_likes: "Highest likes first.",
  most_comments: "Highest comments first.",
  best_engagement: "Highest engagement RATE first, only when the request literally says engagement rate.",
  not_applicable: "No ordering was asked for or it does not apply.",
} as const;
export type SortId = keyof typeof SORTS;

export const PLATFORMS = {
  any: "No platform named. Default for 'most recent comment', 'unanswered comments', 'what comments did we get' — search every connected social. Only pick a named platform when the request literally says Instagram, TikTok, YouTube, Twitter/X, Threads, LinkedIn or Facebook.",
  instagram: "Instagram (IG, reels, insta).",
  tiktok: "TikTok.",
  youtube: "YouTube (YT, shorts).",
  twitter: "X / Twitter (tweets).",
  threads: "Threads.",
  linkedin: "LinkedIn.",
  facebook: "Facebook (FB).",
} as const;
export type PlatformId = keyof typeof PLATFORMS;

export const STATUSES = {
  any: "No reply status named; every comment.",
  unanswered: "Comments with no reply and no DM yet: unanswered, unreplied, ignored, missed, still waiting.",
  replied: "Comments we replied to publicly (YouTube keyword replies, persona replies).",
  dm_sent: "Comments that triggered a keyword DM through the Zernio automation (comment-to-DM funnel).",
} as const;
export type StatusId = keyof typeof STATUSES;

/** Kevin 2026-09-19: "past 10 posts from tiktok" pulled 100. Jev decides whether a
 *  number in the request is a COUNT of items; the exact number is parsed here. */
export const QUANTITIES = {
  specific_count: "The request asks for a specific NUMBER OF ITEMS: 'past 10 posts', 'top 5 videos', 'last 20 comments', 'my 3 best reels', 'first 15'.",
  single_item: "The request is SINGULAR and wants exactly one item, no number given: 'the most recent unanswered comment', 'latest comment', 'the last post', 'newest news item', 'which comment came in last', 'my best video'.",
  time_span: "The only number is a time span (days, weeks, months, hours, a date), not a count of items: 'past 60 days', 'last 2 weeks'.",
  none: "No number of items is asked for (show the default amount).",
} as const;
export type QuantityId = keyof typeof QUANTITIES;

const COUNT_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, dozen: 12,
};
const TIME_UNIT = /^(day|days|week|weeks|month|months|hour|hours|hr|hrs|min|mins|minute|minutes|year|years|am|pm)\b/i;
const ITEM_NOUN = /^(posts?|videos?|reels?|shorts?|tweets?|threads?|comments?|clips?|items?|results?|rows?|links?|stories|news|articles|entries|slots?|jobs?|cuts?|automations?)\b/i;
const LEAD = /\b(past|last|top|best|latest|recent|first|newest|next|show|give|pull|get|list|my|the)\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|hundred|dozen)\b\s*([a-z]*)/gi;
const BARE = /\b(\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|hundred|dozen)\s+([a-z]+)/gi;

/** The number of items the request names, or null. Numbers glued to a time unit
 *  ("60 days") never count; a number followed by an item noun always does. */
export function extractCount(message: string): { count: number | null; certain: boolean } {
  const txt = message.toLowerCase();
  const toN = (w: string) => (/^\d+$/.test(w) ? Number(w) : COUNT_WORDS[w] ?? NaN);
  let m: RegExpExecArray | null;
  BARE.lastIndex = 0;
  while ((m = BARE.exec(txt))) {
    const n = toN(m[1]);
    if (!Number.isFinite(n) || n < 1 || n > 500) continue;
    if (ITEM_NOUN.test(m[2])) return { count: n, certain: true };
  }
  LEAD.lastIndex = 0;
  while ((m = LEAD.exec(txt))) {
    const n = toN(m[2]);
    if (!Number.isFinite(n) || n < 1 || n > 500) continue;
    if (TIME_UNIT.test(m[3] || "")) continue;
    return { count: n, certain: false };
  }
  return { count: null, certain: false };
}

/** Only honor a platform the request actually names. Laya otherwise guesses one
 *  and hides the newest unanswered comment on another network. */
function namedPlatform(message: string): PlatformId | null {
  const l = ` ${message.toLowerCase()} `;
  const hits: [PlatformId, RegExp][] = [
    ["instagram", /\b(instagram|insta|\big\b|reels?)\b/],
    ["tiktok", /\b(tiktok|tik tok)\b/],
    ["youtube", /\b(youtube|\byt\b|shorts?)\b/],
    ["twitter", /\b(twitter|tweets?)\b|\bon x\b/],
    ["threads", /\bthreads\b/],
    ["linkedin", /\blinkedin\b/],
    ["facebook", /\b(facebook|\bfb\b)\b/],
  ];
  const found = hits.filter(([, re]) => re.test(l));
  return found.length === 1 ? found[0][0] : null;
}

function hasExplicitRange(message: string): boolean {
  return /\b(today|yesterday|this week|this month|this year|year to date|\bytd\b|last \d+|past \d+|last week|last month|last year|next \d+)\b/i.test(message)
    || MONTHS.some((m) => new RegExp(`\\b${m}\\b`, "i").test(message));
}

const ET = "America/New_York";

/** SQL predicate on a timestamptz column for an ET range. */
function rangeSql(col: string, range: RangeId): string {
  const local = `(${col} at time zone '${ET}')`;
  const today = `date_trunc('day', now() at time zone '${ET}')`;
  if (range.startsWith("month_")) {
    const idx = MONTHS.indexOf(range.slice(6) as (typeof MONTHS)[number]);
    if (idx >= 0) {
      // most recent occurrence of that month: this year if it has started, else last year
      const nowEt = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
      const year = idx <= nowEt.getUTCMonth() ? nowEt.getUTCFullYear() : nowEt.getUTCFullYear() - 1;
      const start = `'${year}-${String(idx + 1).padStart(2, "0")}-01'::timestamp`;
      return `${local} >= ${start} and ${local} < ${start} + interval '1 month'`;
    }
  }
  switch (range) {
    case "today":
      return `${local} >= ${today}`;
    case "yesterday":
      return `${local} >= ${today} - interval '1 day' and ${local} < ${today}`;
    case "last_7_days":
      return `${local} >= ${today} - interval '6 days'`;
    case "last_30_days":
      return `${local} >= ${today} - interval '29 days'`;
    case "last_60_days":
      return `${local} >= ${today} - interval '59 days'`;
    case "last_90_days":
      return `${local} >= ${today} - interval '89 days'`;
    case "this_month":
      return `${local} >= date_trunc('month', now() at time zone '${ET}')`;
    case "year_to_date":
      return `${local} >= date_trunc('year', now() at time zone '${ET}')`;
    case "next_7_days":
      return `${local} >= ${today} and ${local} < ${today} + interval '8 days'`;
    default:
      return "true";
  }
}

export type JevDecision = {
  tool: ToolId;
  toolConfidence: number;
  toolProbabilities: Record<string, number>;
  range: RangeId;
  rangeConfidence: number;
  sort: SortId;
  sortConfidence: number;
  platform: PlatformId;
  platformConfidence: number;
  status: StatusId;
  statusConfidence: number;
  /** Number of items asked for ("past 10 posts"), null = tool default. */
  count: number | null;
  quantity: QuantityId;
  quantityConfidence: number;
  /** Obsidian media vault dimensions (get_media): pillar, brand/company, kind. */
  media: { pillar: PillarId; brand: string; kind: MediaKindId; brandConfidence: number; plural: boolean };
  model: string;
  latencyMs: number;
  usage?: { input_tokens: number; output_tokens: number };
};

export type DecisionEvaluator = typeof jevEvaluate;

/** Laya's option budget is much tighter than Jev's 255. Keep brands that the
 *  request actually names (plus `any`); otherwise a short default set. */
function brandCriteriaForLaya(
  vault: Awaited<ReturnType<typeof mediaIndex>>,
  message: string,
): Record<string, string> {
  const all = brandCriteria(vault);
  const lower = message.toLowerCase();
  const mentioned = Object.keys(all).filter((brand) => {
    if (brand === "any") return false;
    const needles = [
      brand.replace(/-/g, " "),
      brand.replace(/-/g, ""),
      ...vault.filter((m) => m.brand === brand).flatMap((m) => m.aliases),
    ];
    return needles.some((n) => n && n.length >= 3 && lower.includes(n.toLowerCase()));
  });
  const keys = mentioned.length ? mentioned : Object.keys(all).filter((k) => k !== "any").slice(0, 16);
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = all[k];
  out.any = all.any;
  return out;
}

export async function decide(
  message: string,
  opts?: { evaluate?: DecisionEvaluator; slimBrands?: boolean },
): Promise<JevDecision> {
  // Obsidian vault: the brand/company list is a live choice question (Kevin
  // 2026-09-20: "Jev needs choice question access to the Obsidian graph").
  const vault = await mediaIndex();
  const evaluate = opts?.evaluate ?? jevEvaluate;
  const brands = opts?.slimBrands ? brandCriteriaForLaya(vault, message) : brandCriteria(vault);
  const r = await evaluate(
    { request: message, context: "Marketing OS dashboard for kevbuildsapps, Kev AI and Megan social accounts. Times are ET." },
    {
      tool: {
        type: "choice",
        instructions: "Which tool answers this request?",
        criteria: { ...TOOLS },
      },
      range: {
        type: "choice",
        instructions: "Which time range does the request refer to?",
        criteria: { ...RANGES },
      },
      sort: {
        type: "choice",
        instructions: "If the request asks for posts ranked or ordered, which ordering?",
        criteria: { ...SORTS },
      },
      platform: {
        type: "choice",
        instructions: "Which social platform does the request NAME? If none is named, pick any (every platform).",
        criteria: { ...PLATFORMS },
      },
      status: {
        type: "choice",
        instructions: "For comments: does the request ask about a reply status (unanswered, replied, DM sent)?",
        criteria: { ...STATUSES },
      },
      quantity: {
        type: "choice",
        instructions: "Does the request name how many items to return?",
        criteria: { ...QUANTITIES },
      },
      media_pillar: {
        type: "choice",
        instructions: "If the request is about media, logos, icons, profile pictures or B-roll from the vault: which pillar?",
        criteria: { ...PILLARS },
      },
      media_brand: {
        type: "choice",
        instructions: "If the request is about media from the vault: which brand or company is named?",
        criteria: brands,
      },
      media_kind: {
        type: "choice",
        instructions: "If the request is about media from the vault: what kind of file?",
        criteria: { ...MEDIA_KINDS },
      },
    },
  );
  const mpA = r.answers.media_pillar as ChoiceAnswer;
  const mbA = r.answers.media_brand as ChoiceAnswer;
  const mkA = r.answers.media_kind as ChoiceAnswer;
  // A brand only sticks when the request actually names it (slug or an alias):
  // "what brand assets do we have" must not narrow to kevbuildsapps.
  const lower = message.toLowerCase();
  const mentions = (brand: string) => {
    const needles = [brand.replace(/-/g, " "), brand.replace(/-/g, ""), ...vault.filter((m) => m.brand === brand).flatMap((m) => m.aliases)];
    return needles.some((n) => n && lower.includes(n.toLowerCase()));
  };
  let chosenBrand = mbA?.choice && mbA.choice !== "any" ? mbA.choice : "any";
  if (chosenBrand === "any" || !mentions(chosenBrand)) {
    // Jev said "any" (or a brand the text never names): fall back to the brand whose
    // longest alias actually appears in the request ("jev playing subway surfers clip" -> jev).
    let best: { brand: string; len: number } | null = null;
    for (const brand of new Set(vault.map((m) => m.brand))) {
      const needles = [brand.replace(/-/g, " "), brand.replace(/-/g, ""), ...vault.filter((m) => m.brand === brand).flatMap((m) => m.aliases)];
      for (const n of needles) {
        if (n && n.length >= 3 && lower.includes(n.toLowerCase()) && (!best || n.length > best.len)) best = { brand, len: n.length };
      }
    }
    chosenBrand = best ? best.brand : "any";
  }
  const media = {
    pillar: (mpA?.choice in PILLARS ? mpA.choice : "any") as PillarId,
    brand: chosenBrand,
    kind: (mkA?.choice in MEDIA_KINDS ? mkA.choice : "any") as MediaKindId,
    // a brand confirmed by the request text is certain, whatever Jev's own read was
    brandConfidence: chosenBrand !== "any" ? 1 : (mbA?.confidence ?? 0),
    // Kevin 2026-09-20: plural ask = every match, singular ask = the single best-ranked one.
    plural: /\b(all|every|each|multiple|several|various|any of|list|show me (?:the )?\w+s\b|logos|icons|clips|videos|pictures|avatars|assets|marks|files|images|options|versions|footage|b-?roll)\b/i.test(message)
      || ((r.answers.quantity as ChoiceAnswer | undefined)?.choice !== "single_item" && !/\b(a|an|the|one|single|best|top|main|primary|official)\s+(\w+\s+)?(logo|icon|clip|video|picture|avatar|mark|file|image|tile|wordmark|banner)\b/i.test(message) && !/\b(logo|icon|clip|video|picture|avatar|mark|file|image)\b(?!s)/i.test(message)),
  };
  // "jev playing subway surfers clip" read as none/agent posts at 0.4: when the
  // request names a vault brand and asks for a clip/logo/footage, it is get_media.
  const mediaWords = /\b(clip|clips|footage|b-?roll|logo|logos|icon|icons|screen recording|recording|profile picture|avatar|asset|assets|vault)\b/i.test(message);
  const toolPick = r.answers.tool as ChoiceAnswer;
  // a vault brand named in the text + a media noun beats any other tool read ("the best openai logo" is not post analytics)
  const mediaAssist = mediaWords && (media.brand !== "any" || (media.pillar !== "any" && (mpA?.confidence ?? 0) >= 0.7 && (toolPick.confidence < 0.75 || !(toolPick.choice in TOOLS))));
  if (mediaAssist) {
    toolPick.choice = "get_media";
    toolPick.confidence = Math.max(toolPick.confidence, 0.9);
  }
  const quantityA = r.answers.quantity as ChoiceAnswer;
  const quantity = (quantityA.choice in QUANTITIES ? quantityA.choice : "none") as QuantityId;
  const parsed = extractCount(message);
  // a number glued to an item noun wins; otherwise trust Jev's read of the number
  const count =
    parsed.count != null && (parsed.certain || quantity === "specific_count")
      ? parsed.count
      : quantity === "single_item"
        ? 1 // Kevin 2026-09-19: "the most recently unresponded comment" is one row, not the list
        : null;
  const platform = r.answers.platform as ChoiceAnswer;
  const statusA = r.answers.status as ChoiceAnswer;
  const tool = r.answers.tool as ChoiceAnswer;
  const range = r.answers.range as ChoiceAnswer;
  const sort = r.answers.sort as ChoiceAnswer;
  const named = namedPlatform(message);
  const commentTool = tool.choice === "get_comments" || tool.choice === "delete_comment" || tool.choice === "reply_comment";
  let rangeId = (range.choice in RANGES ? range.choice : "all") as RangeId;
  // "most recent unanswered comment" is the newest on any network, not today's
  // guess on one platform Laya invented.
  if (commentTool && !hasExplicitRange(message) && /\b(most recent|latest|last|newest)\b/i.test(message)) {
    rangeId = "all";
  }
  return {
    tool: (tool.choice in TOOLS ? tool.choice : "none") as ToolId,
    toolConfidence: tool.confidence,
    toolProbabilities: tool.probabilities,
    range: rangeId,
    rangeConfidence: rangeId === "all" && range.choice !== "all" ? 1 : range.confidence,
    sort: (sort.choice in SORTS ? sort.choice : "not_applicable") as SortId,
    sortConfidence: sort.confidence,
    platform: named ?? "any",
    platformConfidence: named ? 1 : 0,
    status: (statusA.choice in STATUSES ? statusA.choice : "any") as StatusId,
    statusConfidence: statusA.confidence,
    count,
    quantity,
    quantityConfidence: quantityA.confidence,
    media,
    model: r.model,
    latencyMs: r.latencyMs,
    usage: r.usage,
  };
}

export type ToolResult = {
  summary: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  /** true when the rows came from the Obsidian vault (UI + terminal paint these neon blue). */
  media?: boolean;
};

/** Zernio account ids for every profile on the active channel (Kevin 2026-09-18:
 *  tools answer for THIS channel's accounts only, never the whole Zernio org). */
async function activeChannelAccounts(): Promise<{ name: string; accountIds: string[]; usernames: string[] } | null> {
  const channel = await getActiveChannel().catch(() => null);
  if (!channel) return null;
  const lists = await Promise.all(
    (channel.zernioProfileIds ?? []).map((pid) => listAccounts(pid).catch(() => [])),
  );
  const flat = lists.flat();
  const accountIds = [...new Set(flat.map((a) => String((a as { _id?: string; id?: string })._id ?? (a as { id?: string }).id ?? "")).filter(Boolean))];
  // analytics_snapshots keys posts by account_username (handle or display name)
  const usernames = [
    ...new Set(
      flat
        .flatMap((a) => [a.username, a.displayName, (a as { metadata?: { username?: string } }).metadata?.username])
        .map((u) => String(u ?? "").replace(/^@/, "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  return { name: channel.name, accountIds, usernames };
}

const COMMENT_ROWS = 500;

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v ?? "");
}

/** SQL predicate for a platform column; twitter and x are the same leg. */
function platformSql(col: string, platform: PlatformId): string {
  if (platform === "any") return "true";
  if (platform === "twitter") return `lower(${col}) in ('twitter', 'x')`;
  return `lower(${col}) = '${platform}'`;
}

function statusSql(status: StatusId): string {
  switch (status) {
    case "unanswered":
      return "status not in ('replied', 'automated', 'deleted', 'hidden')";
    case "replied":
      return "status = 'replied'";
    case "dm_sent":
      return "status = 'automated'";
    default:
      return "true";
  }
}

/** USD -> CAD, cached for a day (Kevin 2026-09-18: show money in CAD). */
let fxMemo: { at: number; rate: number } | null = null;
async function usdToCad(): Promise<number | null> {
  if (fxMemo && Date.now() - fxMemo.at < 24 * 3600_000) return fxMemo.rate;
  try {
    const j = (await (await fetch("https://api.frankfurter.app/latest?from=USD&to=CAD", { signal: AbortSignal.timeout(4000) })).json()) as { rates?: { CAD?: number } };
    const rate = Number(j.rates?.CAD);
    if (rate > 0) {
      fxMemo = { at: Date.now(), rate };
      return rate;
    }
  } catch {
    /* fall through */
  }
  return fxMemo?.rate ?? null;
}

function money(usd: number, rate: number | null, currency = "USD"): string {
  if (currency === "CAD") return `CA$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (!rate) return `US$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `CA$${(usd * rate).toLocaleString(undefined, { maximumFractionDigits: 0 })} (US$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })})`;
}

export type PriorComment = { event_id: string };

export function priorCommentsFromBody(raw: unknown): PriorComment[] {
  if (!Array.isArray(raw)) return [];
  const out: PriorComment[] = [];
  for (const item of raw.slice(0, 25)) {
    const id = String((item as { event_id?: unknown })?.event_id ?? "").trim();
    if (id) out.push({ event_id: id });
  }
  return out;
}

function parseDeleteTarget(message: string): {
  authors: string[];
  snippets: string[];
  last: boolean;
  all: boolean;
  anaphoric: boolean;
} {
  const authors = [
    ...[...message.matchAll(/@([a-zA-Z0-9._]+)/g)].map((m) => m[1].toLowerCase()),
    ...[...message.matchAll(/\b(?:from|by)\s+@?([a-zA-Z0-9._]{2,32})/gi)].map((m) => m[1].toLowerCase()),
  ].filter((a, i, arr) => arr.indexOf(a) === i);
  const snippets = [...message.matchAll(/[“"']([^"”']{2,160})[”"']/g)].map((m) => m[1].trim()).filter(Boolean);
  return {
    authors,
    snippets,
    last: /\b(last|latest|first|top)\b/i.test(message),
    all: /\b(all|every)\b/i.test(message),
    anaphoric: /\b(it|that|this|the one|the comment)\b/i.test(message),
  };
}

function commentPreview(r: { author_username?: unknown; comment_text?: unknown; platform?: unknown }): string {
  const who = r.author_username ? `@${String(r.author_username).replace(/^@/, "")}` : "someone";
  const where = r.platform ? ` on ${r.platform === "twitter" ? "X" : String(r.platform)}` : "";
  const text = String(r.comment_text ?? "").replace(/\s+/g, " ").trim();
  return `${who}${where}: "${text}"`;
}

function parseReplyText(message: string): string {
  const quoted = message.match(/[“"']([^"”']{1,500})[”"']/);
  if (quoted?.[1]?.trim()) return quoted[1].trim();
  const saying = message.match(/\b(?:saying|say|with|:)\s+(.+)/i);
  if (saying?.[1]?.trim()) return saying[1].replace(/^["“]|["”]$/g, "").trim();
  const stripped = message
    .replace(/^(please\s+)?(just\s+)?(reply|respond|answer)(\s+back)?(\s+to)?(\s+(that|it|this|the|him|her|them)(\s+comment)?)?\s*/i, "")
    .trim();
  if (stripped.length >= 2 && !/^(to )?(that|it|this|the comment)$/i.test(stripped)) return stripped;
  return "";
}

function goneSummary(
  row: { author_username?: unknown; comment_text?: unknown; platform?: unknown },
  out: { hidden?: boolean },
): string {
  const who = commentPreview(row);
  if (out.hidden) {
    return `Threads (and some Meta apps) cannot delete replies — they only allow hide. Hidden ${who}. Only you and the commenter can still see it.`;
  }
  return `Deleted ${who}.`;
}

function rangeDays(range: RangeId): number {
  if (range === "today") return 1;
  if (range === "yesterday") return 2;
  if (range === "last_7_days") return 7;
  if (range === "last_30_days" || range === "this_month") return 31;
  if (range === "last_60_days") return 60;
  if (range === "last_90_days") return 90;
  if (range === "year_to_date") return 366;
  if (range.startsWith("month_")) return 366;
  return 30;
}

export async function runTool(
  tool: ToolId,
  range: RangeId,
  sort: SortId = "not_applicable",
  platform: PlatformId = "any",
  status: StatusId = "any",
  count: number | null = null,
  media?: JevDecision["media"],
  request?: string,
  priorComments?: PriorComment[],
): Promise<ToolResult> {
  let result = await runToolInner(tool, range, sort, platform, status, count, media, request, priorComments);
  // "latest unanswered comment on youtube": Jev often reads "latest" as today.
  // A singular ask that finds nothing in its window widens to all time.
  if (count === 1 && range !== "all" && (!Array.isArray(result.rows) || result.rows.length === 0)) {
    const wider = await runToolInner(tool, "all", sort, platform, status, count, media, request, priorComments);
    if (Array.isArray(wider.rows) && wider.rows.length) result = wider;
  }
  // A singular ask reads as one sentence about that one row, not a list summary.
  if (count === 1 && tool === "get_comments" && Array.isArray(result.rows) && result.rows.length) {
    const r = result.rows[0] as Record<string, unknown>;
    const who = r.author_username ? `@${String(r.author_username).replace(/^@/, "")}` : "someone";
    const when = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(String(r.received_at)));
    const where = r.platform ? ` on ${r.platform === "twitter" ? "X" : String(r.platform)}` : "";
    const statusWord = status === "any" ? "" : `${status.replace("_", " ")} `;
    const text = String(r.comment_text ?? "").replace(/\s+/g, " ").trim();
    return {
      ...result,
      rows: [r],
      summary: `Most recent ${statusWord}comment: ${who}${where}, ${when} ET: "${text}"`,
    };
  }
  // "last 20 comments" / "10 news items": every list tool honours the asked-for count
  if (count && tool !== "get_post_analytics" && !(tool === "get_media" && count === 1) && Array.isArray(result.rows) && result.rows.length > count) {
    return { ...result, rows: result.rows.slice(0, count), summary: `${result.summary} Showing the ${count} you asked for.` };
  }
  return result;
}

async function runToolInner(
  tool: ToolId,
  range: RangeId,
  sort: SortId,
  platform: PlatformId,
  status: StatusId,
  count: number | null,
  media?: JevDecision["media"],
  request?: string,
  priorComments?: PriorComment[],
): Promise<ToolResult> {
  const label = rangeLabel(range) + (platform === "any" ? "" : ` on ${platform === "twitter" ? "X" : platform}`);
  switch (tool) {
    case "get_media": {
      if (!obsidianConfigured()) {
        return { summary: "The Obsidian media vault is only reachable from Kevin's Mac (OBSIDIAN_API_KEY is not set here).", media: true };
      }
      const all = await mediaIndex();
      if (!all.length) {
        return { summary: "The Obsidian vault answered with no media notes. Is Obsidian open with the Marketing OS Broll vault and the Local REST API plugin enabled?", media: true };
      }
      const pillar = media?.pillar ?? "any";
      // a weak brand read on a "what do we have" question must not narrow to one account
      const brand = media && media.brand !== "any" && media.brandConfidence >= 0.6 ? media.brand : "any";
      const kind = media?.kind ?? "any";
      let rows = all;
      let usedKind = kind;
      // the hub is the folder the file sits in (e.g. ".../AI Companies/Anthropic"), whatever prefix the vault adds
      const hubOf = (m: { file: string }) => m.file.split("/").slice(0, -1).join("/");
      if (pillar !== "any") rows = rows.filter((m) => m.pillar === pillar);
      let familyHubs = new Set<string>();
      if (brand !== "any") {
        const exact = rows.filter((m) => m.brand === brand);
        // AI-company asks return the whole family in that company's hub (Claude ->
        // sphinx, invader, Claude Code, Opus..., Anthropic, the icon and the tile),
        // exact brand first (Kevin 2026-09-20: "show me all possible claude logos/icons").
        familyHubs = new Set(exact.filter((m) => m.pillar === "ai-companies").map(hubOf));
        rows = rows.filter((m) => m.brand === brand || (familyHubs.has(hubOf(m)) && m.pillar === "ai-companies"));
        // brand-assets siblings with the same brand slug (e.g. the Claude tile) ride along
        if (familyHubs.size) rows = [...rows, ...all.filter((m) => m.brand === brand && !rows.includes(m))];
      }
      if (kind !== "any") {
        // logo and icon are the same ask ("logos/icons"); clips stay clips
        const kinds = kind === "logo" || kind === "icon" ? new Set(["logo", "icon", "wordmark"]) : new Set([kind]);
        const narrowed = rows.filter((m) => kinds.has(m.kind));
        // "b-roll for OpenAI" when only a logo is filed: show the logo, don't call it a clip
        if (narrowed.length) rows = narrowed;
        else usedKind = "any";
      }
      if (!rows.length && brand !== "any") rows = all.filter((m) => m.brand === brand);
      // logos and icons first (the thing people mean by "the X logo"), profiles after; then name
      const kindRank = (k: string) => ({ logo: 0, icon: 1, wordmark: 2, profile: 3, clip: 4 } as Record<string, number>)[k] ?? 5;
      const exactFirst = (m: { brand: string }) => (brand !== "any" && m.brand === brand ? 0 : 1);
      const px = (m: { width?: number; height?: number }) => (m.width ?? 0) * (m.height ?? 0);
      // the plain "<Brand> logo" outranks variants (ChatGPT / Codex under openai, banner under claude-code)
      const plainName = (m: { name: string }) => (brand !== "any" && m.name.toLowerCase().startsWith(brand.replace(/-/g, " ")) && /\b(logo|icon)$/i.test(m.name) ? 0 : 1);
      rows = [...rows].sort((a, b) => exactFirst(a) - exactFirst(b) || plainName(a) - plainName(b) || a.pillar.localeCompare(b.pillar) || a.brand.localeCompare(b.brand) || kindRank(a.kind) - kindRank(b.kind) || px(b) - px(a) || a.name.localeCompare(b.name));
      const plural = media?.plural ?? true;
      const totalMatches = rows.length;
      if (!plural && rows.length > 1) rows = rows.slice(0, 1);
      const brands = new Set(rows.map((m) => m.brand));
      const scope = brand !== "any" ? `${brand.replace(/-/g, " ")}${familyHubs.size ? " and family" : ""}` : pillar !== "any" ? pillar.replace(/-/g, " ") : "the vault";
      const summary = rows.length
        ? !plural && totalMatches > 1
          ? `Marketing OS Broll: top pick for ${scope}${usedKind !== "any" ? ` (${usedKind})` : ""} is ${rows[0].name} (${rows[0].width && rows[0].height ? `${rows[0].width}x${rows[0].height}, ` : ""}${rows[0].file}). ${totalMatches - 1} more on file, ask in plural to see them all.`
          : `Marketing OS Broll: ${rows.length} media file${rows.length === 1 ? "" : "s"} for ${scope}${usedKind !== "any" ? ` (${usedKind}s)` : ""}${brands.size > 1 ? ` across ${brands.size} brands` : ""}. ${rows.slice(0, 3).map((m) => m.name).join(", ")}${rows.length > 3 ? " and more" : ""}.`
        : `Marketing OS Broll has nothing filed for ${scope}${kind !== "any" ? ` (${kind}s)` : ""} yet. ${all.length} files in the vault across ${new Set(all.map((m) => m.brand)).size} brands.`;
      return {
        summary,
        media: true,
        columns: ["name", "pillar", "brand", "kind", "file", "size", "duration", "aliases"],
        rows: rows.map((m) => ({
          name: m.name,
          pillar: m.pillar,
          brand: m.brand,
          kind: m.kind,
          file: m.file,
          size: m.width && m.height ? `${m.width}x${m.height}` : "",
          duration: m.duration ? `${Math.floor(m.duration / 60)}:${String(Math.round(m.duration % 60)).padStart(2, "0")}` : "",
          aliases: m.aliases.slice(0, 4).join(", "),
          note: m.note,
          path: mediaDiskPath(m.file) || "",
          vault: VAULT_NAME,
          thumb: mediaDiskPath(m.poster || m.file) ? `/api/jev/media?file=${encodeURIComponent(m.poster || m.file)}` : "",
          video: m.type === "video" && mediaDiskPath(m.file) ? `/api/jev/media?file=${encodeURIComponent(m.file)}` : "",
        })),
      };
    }
    case "get_revenue": {
      const channel = await getActiveChannel().catch(() => null);
      if (!channel?.revenuecatProjectId) {
        return { summary: `${channel?.name ?? "This channel"} has no RevenueCat project connected. Switch to the app channel (Creator OS) for downloads and revenue.` };
      }
      const [overview, daily, fx] = await Promise.all([
        getOverviewMetrics(channel.revenuecatProjectId, channel.revenuecatApiKey).catch(() => null),
        getNewCustomersDaily(channel.revenuecatProjectId, rangeDays(range), channel.revenuecatApiKey).catch(() => []),
        usdToCad(),
      ]);
      const cur = overview?.currency || "USD";
      // daily is ET day-keyed; apply the requested window
      const nowEt = new Intl.DateTimeFormat("en-CA", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const inWindow = daily.filter((d) => {
        if (range === "today") return d.date === nowEt;
        if (range === "yesterday") return d.date < nowEt && d.date >= new Date(Date.parse(nowEt) - 86400000).toISOString().slice(0, 10);
        if (range === "this_month") return d.date.slice(0, 7) === nowEt.slice(0, 7);
        if (range === "year_to_date") return d.date.slice(0, 4) === nowEt.slice(0, 4);
        if (range.startsWith("month_")) return d.date.slice(5, 7) === String(MONTHS.indexOf(range.slice(6) as (typeof MONTHS)[number]) + 1).padStart(2, "0");
        return true;
      });
      const newCustomers = inWindow.reduce((n, d) => n + d.count, 0);
      const days = Math.max(1, inWindow.length);
      const metrics = (overview?.metrics ?? []).map((m) => ({ metric: m.name, value: m.unit === "$" ? money(Number(m.value), fx, cur) : Number(m.value).toLocaleString(), period: m.description }));
      const pick = (id: string) => overview?.metrics.find((m) => m.id === id);
      const mrr = pick("mrr"), subs = pick("active_subscriptions"), rev = pick("revenue");
      return {
        summary: `${channel.name}: ${newCustomers.toLocaleString()} new customers ${rangeLabel(range)} (${(newCustomers / days).toFixed(1)}/day, north star is 100/day)${mrr ? `, MRR ${money(Number(mrr.value), fx, cur)}` : ""}${subs ? `, ${Number(subs.value).toLocaleString()} active subscriptions` : ""}${rev ? `, revenue ${money(Number(rev.value), fx, cur)} ${rev.description.toLowerCase()}` : ""}.${fx && cur !== "CAD" ? ` CAD at ${fx.toFixed(3)} today.` : ""}`,
        columns: ["date", "new_customers"],
        rows: [
          ...inWindow.slice(-31).reverse().map((d) => ({ date: d.date, new_customers: d.count })),
          ...metrics.map((m) => ({ date: m.metric, new_customers: `${m.value} · ${m.period}` })),
        ],
      };
    }
    case "get_automations": {
      const channel = await getActiveChannel().catch(() => null);
      const personas: string[] = channel ? await personaSlugsForChannel(channel) : [];
      const autos = await listRailwayAutomations({ personas, includeShared: channel?.id === "app-1" || personas.length === 0 });
      const fmt = (iso?: string | null) => (iso ? formatSlotEt(new Date(iso)) : "");
      const by = autos.reduce<Record<string, number>>((m, a) => {
        const k = a.health ?? a.status;
        m[k] = (m[k] || 0) + 1;
        return m;
      }, {});
      const overdue = autos.filter((a) => a.health === "overdue").map((a) => a.name);
      return {
        summary: `${channel?.name ?? "This channel"}: ${autos.length} automations (${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(", ")}).${overdue.length ? ` Overdue: ${overdue.join(", ")}.` : " Nothing overdue."}`,
        columns: ["name", "cadence", "health", "last_run", "next_run", "runs_7d", "platforms", "skill"],
        rows: autos.map((a) => ({
          name: a.name,
          cadence: a.cadence,
          health: a.health ?? a.status,
          last_run: fmt(a.lastRunAt),
          next_run: fmt(a.nextRunAt),
          runs_7d: a.recentRuns ?? "",
          platforms: a.platforms.join(", "),
          skill: a.skill,
        })),
      };
    }
    case "get_post_analytics": {
      const scope = await activeChannelAccounts();
      if (!scope) return { summary: "No channel is active, so there are no connected accounts to report on." };
      if (!scope.usernames.length) return { summary: `${scope.name} has no connected social accounts.` };
      // latest snapshot per post = current cumulative totals
      const rows = await query<Record<string, unknown>>(
        `select distinct on (platform, platform_post_id)
                platform, account_username, platform_post_id, published_at, snapshot_date,
                views, impressions, likes, comments, saves, shares, engagement_rate, left(content, 90) as content
           from analytics_snapshots
          where lower(account_username) = any($1)
            and published_at is not null
            and ${rangeSql("published_at", range)}
            and ${platformSql("platform", platform)}
          order by platform, platform_post_id, snapshot_date desc`,
        [scope.usernames],
      );
      const posts = rows.map((r) => ({
        published_at: iso(r.published_at),
        platform: String(r.platform),
        account: String(r.account_username ?? ""),
        views: Number(r.views) || Number(r.impressions) || 0,
        likes: Number(r.likes) || 0,
        comments: Number(r.comments) || 0,
        saves: Number(r.saves) || 0,
        shares: Number(r.shares) || 0,
        engagement_rate: Number(r.engagement_rate) || 0,
        content: String(r.content ?? "").replace(/\s+/g, " "),
      }));
      const key: Exclude<SortId, "not_applicable"> = sort === "not_applicable" ? "newest" : sort;
      // "past 100 posts by views" = the most recent 100, then ordered. With a
      // real time range the range is the window; with no range, the window is
      // the last 100 posts so hourly Threads posts from months ago do not compete.
      posts.sort((a, b) => b.published_at.localeCompare(a.published_at));
      // "past 10 posts" = the 10 most recent (then ordered); "top 10 this month" = the
      // month's posts ranked, cut to 10 below. Default window stays 100 (Kevin 2026-09-19).
      const n = count ?? 100;
      const windowed = range === "all" ? posts.slice(0, key === "newest" || !count ? n : 100) : posts;
      // engagement rate on a 1-view post is noise: require a floor
      const ranked = key === "best_engagement" ? windowed.filter((p) => p.views >= 100) : windowed;
      ranked.sort((a, b) =>
        key === "newest" ? b.published_at.localeCompare(a.published_at)
        : key === "most_likes" ? b.likes - a.likes
        : key === "most_comments" ? b.comments - a.comments
        : key === "best_engagement" ? b.engagement_rate - a.engagement_rate
        : b.views - a.views,
      );
      const top = ranked.slice(0, n);
      const totalViews = windowed.reduce((n, p) => n + p.views, 0);
      const best = [...windowed].sort((a, b) => b.views - a.views)[0];
      const scopeLabel = range === "all"
        ? (count && key !== "newest" ? `top ${top.length} of your last ${windowed.length} posts${platform === "any" ? "" : ` on ${platform === "twitter" ? "X" : platform}`}` : `your last ${windowed.length} posts${platform === "any" ? "" : ` on ${platform === "twitter" ? "X" : platform}`}`)
        : `${count ? `top ${top.length} of ` : ""}${windowed.length} posts ${label}`;
      const orderLabel = key === "most_views" ? "most views" : key === "newest" ? "newest first" : key === "most_likes" ? "most likes" : key === "most_comments" ? "most comments" : "engagement rate (100+ views)";
      return {
        summary: `${scope.name}: ${scopeLabel}, ${totalViews.toLocaleString()} views total, ordered by ${orderLabel}${ranked.length > n ? `, top ${n} shown` : ""}.${best ? ` Best: "${best.content.slice(0, 60)}" on ${best.platform}, ${best.views.toLocaleString()} views.` : ""}`,
        columns: ["published_at", "platform", "account", "views", "likes", "comments", "saves", "shares", "engagement_rate", "content"],
        rows: top,
      };
    }
    case "delete_comment": {
      const scope = await activeChannelAccounts();
      if (!scope) return { summary: "No channel is active, so there is nothing to delete." };
      if (!scope.accountIds.length) return { summary: `${scope.name} has no connected social accounts.` };
      const target = parseDeleteTarget(request ?? "");
      if (target.all) {
        return { summary: "I will not delete every matching comment in one shot. Name the author or the exact text, or click Delete on the row." };
      }
      const prior = priorComments ?? [];
      if (prior.length && !target.authors.length && !target.snippets.length && (target.anaphoric || prior.length === 1 || target.last || count === 1)) {
        if (prior.length > 1 && !target.last && count !== 1 && !/\b(last|latest|first|top)\b/i.test(request ?? "")) {
          return {
            summary: `The last list had ${prior.length} comments. Say "the last one", name the author, quote the text, or click Delete on the row.`,
          };
        }
        const chosen = await loadDeletableComment({ eventId: prior[0].event_id, accountIds: scope.accountIds });
        if (chosen) {
          const out = await removeComment(chosen);
          if (!out.ok) return { summary: `Could not delete ${commentPreview(chosen)}. ${out.error}` };
          return { summary: goneSummary(chosen, out) };
        }
      }
      const params: unknown[] = [scope.accountIds];
      const extra: string[] = [];
      if (target.authors.length) {
        params.push(target.authors);
        extra.push(`lower(replace(coalesce(author_username, ''), '@', '')) = any($${params.length}::text[])`);
      }
      if (target.snippets.length) {
        params.push(`%${target.snippets[0].replace(/[%_]/g, "\\$&")}%`);
        extra.push(`comment_text ilike $${params.length} escape '\\'`);
      }
      const rows = await query<CommentDeleteRow & { received_at: string; account_username: string | null; status: string | null }>(
        `select event_id, comment_id, account_id, post_id, platform_post_id, platform, author_username, comment_text,
                received_at, account_username, status
           from comment_events
          where ${rangeSql("received_at", range)} and account_id = any($1)
            and coalesce(status, '') not in ('deleted', 'hidden')
            and ${platformSql("platform", platform)} and ${statusSql(status)}
            ${extra.length ? `and ${extra.join(" and ")}` : ""}
          order by received_at desc
          limit 25`,
        params,
      );
      if (!rows.length) {
        return { summary: `No matching comment ${label} to delete. Pull the comments first, then click Delete on the row or name the author / quote the text.` };
      }
      const pick = rows.length === 1 || target.last || count === 1 ? rows[0] : null;
      if (!pick) {
        return {
          summary: `${rows.length} comments match. Name the author, quote the text, say "the last one", or click Delete on the row you want gone.`,
          columns: ["received_at", "platform", "author_username", "comment_text", "status"],
          rows: rows.map((r) => ({ ...r, received_at: iso(r.received_at) })),
        };
      }
      const out = await removeComment(pick);
      if (!out.ok) return { summary: `Could not delete ${commentPreview(pick)}. ${out.error}` };
      return { summary: goneSummary(pick, out) };
    }
    case "reply_comment": {
      const scope = await activeChannelAccounts();
      if (!scope) return { summary: "No channel is active, so there is nothing to reply to." };
      if (!scope.accountIds.length) return { summary: `${scope.name} has no connected social accounts.` };
      const text = parseReplyText(request ?? "");
      if (!text) {
        return { summary: 'Say what to reply. Example: reply saying "appreciate it" — or type it in the Reply box on the row.' };
      }
      const target = parseDeleteTarget(request ?? "");
      const prior = priorComments ?? [];
      let chosen: CommentDeleteRow | null = null;
      if (prior.length && !target.authors.length && !target.snippets.length && (target.anaphoric || prior.length === 1 || target.last || count === 1)) {
        if (prior.length > 1 && !target.last && count !== 1 && !/\b(last|latest|first|top)\b/i.test(request ?? "")) {
          return { summary: `The last list had ${prior.length} comments. Say "reply to the last one saying ...", name the author, or use Reply on the row.` };
        }
        chosen = await loadDeletableComment({ eventId: prior[0].event_id, accountIds: scope.accountIds });
      }
      if (!chosen) {
        const params: unknown[] = [scope.accountIds];
        const extra: string[] = [];
        if (target.authors.length) {
          params.push(target.authors);
          extra.push(`lower(replace(coalesce(author_username, ''), '@', '')) = any($${params.length}::text[])`);
        }
        if (target.snippets.length) {
          params.push(`%${target.snippets[0].replace(/[%_]/g, "\\$&")}%`);
          extra.push(`comment_text ilike $${params.length} escape '\\'`);
        }
        const rows = await query<CommentDeleteRow>(
          `select event_id, comment_id, account_id, post_id, platform_post_id, platform, author_username, comment_text
             from comment_events
            where ${rangeSql("received_at", range)} and account_id = any($1)
              and coalesce(status, '') not in ('deleted', 'hidden')
              and ${platformSql("platform", platform)} and ${statusSql(status)}
              ${extra.length ? `and ${extra.join(" and ")}` : ""}
            order by received_at desc
            limit 25`,
          params,
        );
        if (!rows.length) {
          return { summary: `No matching comment ${label} to reply to. Pull the comments first, then click Reply or name the author.` };
        }
        if (rows.length > 1 && !target.last && count !== 1) {
          return {
            summary: `${rows.length} comments match. Name the author, say "the last one", or click Reply on the row.`,
            columns: ["platform", "author_username", "comment_text"],
            rows,
          };
        }
        chosen = rows[0];
      }
      const out = await replyToComment(chosen, text);
      if (!out.ok) return { summary: `Could not reply to ${commentPreview(chosen)}. ${out.error}` };
      return { summary: `Replied to ${commentPreview(chosen)}: "${out.reply}"` };
    }
    case "get_comments": {
      const scope = await activeChannelAccounts();
      if (!scope) return { summary: "No channel is active, so there are no connected accounts to report on." };
      if (!scope.accountIds.length) return { summary: `${scope.name} has no connected social accounts.` };
      const rows = await query<Record<string, unknown>>(
        `select event_id, comment_id, account_id, post_id, platform_post_id,
                platform, account_username, author_username, comment_text, status, status_reason, received_at
           from comment_events
          where ${rangeSql("received_at", range)} and not is_own and account_id = any($1)
            and coalesce(status, '') not in ('deleted', 'hidden')
            and ${platformSql("platform", platform)} and ${statusSql(status)}
          order by received_at desc
          limit ${COMMENT_ROWS}`,
        [scope.accountIds],
      );
      const agg = await query<{ total: number; replied: number; automated: number; unanswered: number }>(
        `select count(*)::int as total,
                count(*) filter (where status = 'replied')::int as replied,
                count(*) filter (where status = 'automated')::int as automated,
                count(*) filter (where status not in ('replied', 'automated', 'deleted', 'hidden'))::int as unanswered
           from comment_events where ${rangeSql("received_at", range)} and not is_own and account_id = any($1)
            and coalesce(status, '') not in ('deleted', 'hidden')
            and ${platformSql("platform", platform)} and ${statusSql(status)}`,
        [scope.accountIds],
      );
      const total = agg[0]?.total ?? rows.length;
      const replied = agg[0]?.replied ?? 0;
      const automated = agg[0]?.automated ?? 0;
      const unanswered = agg[0]?.unanswered ?? 0;
      const byPlatform = Object.entries(
        rows.reduce<Record<string, number>>((m, r) => {
          const k = String(r.platform || "?");
          m[k] = (m[k] || 0) + 1;
          return m;
        }, {}),
      )
        .map(([k, v]) => `${k} ${v}`)
        .join(", ");
      return {
        summary: `${scope.name}: ${total} ${status === "any" ? "" : status.replace("_", " ") + " "}comments ${label}${total ? ` (${byPlatform}${total > rows.length ? `, latest ${rows.length} pulled` : ""})` : ""}. ${automated} got a keyword DM from the Zernio automation, ${replied} got a public reply, ${unanswered} unanswered.`,
        columns: ["received_at", "platform", "account_username", "author_username", "comment_text", "status"],
        rows: rows.map((r) => ({ ...r, received_at: iso(r.received_at) })),
      };
    }
    case "get_agent_posts": {
      const channel = await getActiveChannel().catch(() => null);
      const profileIds = channel?.zernioProfileIds ?? [];
      if (!profileIds.length) return { summary: "No channel is active, so there are no connected socials to report on." };
      const rows = await query<Record<string, unknown>>(
        `select profile_id, status, scheduled_for, keyword, youtube_title, platforms, created_at
           from agent_posts
          where profile_id = any($1)
            and ${range === "all" ? "true" : `(${rangeSql("scheduled_for", range)} or ${rangeSql("created_at", range)})`}
          order by coalesce(scheduled_for, created_at) desc
          limit 100`,
        [profileIds],
      );
      const by = rows.reduce<Record<string, number>>((m, r) => {
        const k = String(r.status);
        m[k] = (m[k] || 0) + 1;
        return m;
      }, {});
      return {
        summary: `${channel?.name ?? "This channel"}: ${rows.length} agent posts ${label}: ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}.`,
        columns: ["scheduled_for", "socials", "status", "keyword", "youtube_title"],
        rows: rows.map((r) => ({
          scheduled_for: r.scheduled_for ? formatSlotEt(new Date(iso(r.scheduled_for))) : "",
          socials: agentPostTargetName(String(r.profile_id)),
          status: r.status,
          keyword: r.keyword,
          youtube_title: r.youtube_title,
        })),
      };
    }
    case "get_slots": {
      const channel = await getActiveChannel().catch(() => null);
      const targets = boardTargetsForChannel(await listAgentPostTargets(), channel?.id ?? null);
      const { boards, targets: withNext } = await slotBoardsForTargets(targets);
      const rows = boards.map((b) => ({
        socials: b.name,
        next_open: b.nextOpen ? formatSlotEt(new Date(b.nextOpen)) : "none in 40 days",
        open_this_month: b.openAhead,
        booked_this_month: b.filled,
        missed_this_month: b.missed,
      }));
      return {
        summary: withNext
          .map((t) => `${t.name}: next open ${t.nextSlot ? formatSlotEt(new Date(t.nextSlot)) : "none"}`)
          .join(" · "),
        columns: ["socials", "next_open", "open_this_month", "booked_this_month", "missed_this_month"],
        rows,
      };
    }
    case "get_content_posts": {
      const channel = await getActiveChannel().catch(() => null);
      const personas: string[] = channel ? await personaSlugsForChannel(channel) : [];
      if (!personas.length) return { summary: `${channel?.name ?? "This channel"} has no automated personas.` };
      const rows = await query<Record<string, unknown>>(
        `select persona, status, platforms, scheduled_for, posted_at, left(content, 140) as content
           from content_posts
          where persona = any($1)
            and ${platform === "any" ? "true" : `lower(platforms::text) like '%${platform === "twitter" ? "twitter" : platform}%'`}
            and ${range === "all" ? "true" : `(${rangeSql("posted_at", range)} or ${rangeSql("scheduled_for", range)})`}
          order by coalesce(posted_at, scheduled_for) desc
          limit 100`,
        [personas],
      );
      const by = rows.reduce<Record<string, number>>((m, r) => {
        const k = String(r.persona || "?");
        m[k] = (m[k] || 0) + 1;
        return m;
      }, {});
      return {
        summary: `${channel?.name ?? "This channel"}: ${rows.length} automated posts ${label}: ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.`,
        columns: ["posted_at", "persona", "status", "platforms", "content"],
        rows: rows.map((r) => ({ ...r, posted_at: iso(r.posted_at || r.scheduled_for), platforms: Array.isArray(r.platforms) ? r.platforms.join(", ") : r.platforms })),
      };
    }
    case "get_news": {
      const rows = await query<Record<string, unknown>>(
        `select kind, source, title, url, ingested_at
           from ai_news_items
          where ${rangeSql("ingested_at", range === "all" ? "last_7_days" : range)}
          order by ingested_at desc
          limit 60`,
      );
      const brief = await query<{ brief_date: unknown; headline: string }>(
        `select brief_date, headline from ai_news_briefs order by brief_date desc limit 1`,
      ).catch(() => []);
      return {
        summary: `${rows.length} news items ${label}. Latest brief${brief[0] ? ` (${String(brief[0].brief_date).slice(0, 10)}): ${brief[0].headline}` : ": none"}`,
        columns: ["ingested_at", "kind", "source", "title", "url"],
        rows: rows.map((r) => ({ ...r, ingested_at: iso(r.ingested_at) })),
      };
    }
    case "get_link_clicks": {
      const rows = await query<Record<string, unknown>>(
        `select slug, count(*)::int as clicks, max(clicked_at) as last_click
           from link_clicks
          where ${rangeSql("clicked_at", range)}
          group by slug
          order by clicks desc
          limit 50`,
      );
      const total = rows.reduce((n, r) => n + Number(r.clicks || 0), 0);
      return {
        summary: `${total} tracked link clicks ${label} across ${rows.length} links.`,
        columns: ["slug", "clicks", "last_click"],
        rows: rows.map((r) => ({ ...r, last_click: iso(r.last_click) })),
      };
    }
    case "get_followers": {
      // Kevin 2026-09-18: only the accounts connected to the active Marketing
      // OS channel, never every profile on the Zernio account (agency clients).
      const channel = await getActiveChannel().catch(() => null);
      const profileIds = channel?.zernioProfileIds ?? [];
      if (!profileIds.length) {
        return { summary: "No channel is active, so there are no connected accounts to report on." };
      }
      const rows = await query<Record<string, unknown>>(
        `with latest as (
           select distinct on (account_id) account_id, profile_name, platform, username, followers, snapshot_date
             from follower_snapshots
            where profile_id = any($1) and ${platformSql("platform", platform)}
            order by account_id, snapshot_date desc),
         earlier as (
           select distinct on (account_id) account_id, followers
             from follower_snapshots
            where snapshot_date <= (current_date at time zone '${ET}')::date - ${
              range === "yesterday" ? 1 : range === "last_7_days" ? 7 : range === "last_30_days" || range === "this_month" ? 30
              : range === "last_60_days" ? 60 : range === "last_90_days" ? 90 : range === "year_to_date" ? 365 : 1}
            order by account_id, snapshot_date desc)
         select l.profile_name, l.platform, l.username, l.followers, (l.followers - coalesce(e.followers, l.followers))::int as delta, l.snapshot_date
           from latest l left join earlier e using (account_id)
          order by l.followers desc`,
        [profileIds],
      );
      const total = rows.reduce((n, r) => n + Number(r.followers || 0), 0);
      const delta = rows.reduce((n, r) => n + Number(r.delta || 0), 0);
      return {
        summary: `${channel?.name ?? "This channel"}: ${total.toLocaleString()} followers across ${rows.length} connected accounts, ${delta >= 0 ? "+" : ""}${delta.toLocaleString()} ${label}.`,
        columns: ["profile_name", "platform", "username", "followers", "delta", "snapshot_date"],
        rows: rows.map((r) => ({ ...r, snapshot_date: iso(r.snapshot_date).slice(0, 10) })),
      };
    }
    default:
      return { summary: "No tool covers that yet. Try asking about comments, replying to a comment, deleting a comment, agent posts, slots, content, news, link clicks, or followers." };
  }
}

export async function logDecision(
  message: string,
  d: JevDecision,
  ok: boolean,
  error?: string,
  surface = "jev-chat",
): Promise<void> {
  try {
    await query(
      `create table if not exists jev_decisions (
         id bigserial primary key,
         created_at timestamptz not null default now(),
         surface text not null,
         request text not null,
         tool text, tool_confidence real, tool_probabilities jsonb,
         range text, range_confidence real,
         model text, latency_ms int, input_tokens int, output_tokens int,
         ok boolean not null default true, error text)`,
    );
    await query(
      `insert into jev_decisions (surface, request, tool, tool_confidence, tool_probabilities, range, range_confidence, model, latency_ms, input_tokens, output_tokens, ok, error)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        surface, message, d.tool, d.toolConfidence, JSON.stringify(d.toolProbabilities), d.range, d.rangeConfidence,
        d.model, d.latencyMs, d.usage?.input_tokens ?? null, d.usage?.output_tokens ?? null, ok, error ?? null,
      ],
    );
  } catch (e) {
    console.warn("[jev] decision log failed:", e instanceof Error ? e.message : e);
  }
}
