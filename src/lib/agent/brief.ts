import "server-only";
import { listChannels } from "@/lib/channels/store";
import { CONTENT_JOBS, jobEnabled, jobHoursET } from "@/lib/content/registry";
import { dbConfigured, query } from "@/lib/insforge/db";

/**
 * Live "Marketing OS brief" appended to the voice agent's system prompt so it
 * knows the businesses, personas, channels and automations without having to
 * grep for them first. CLAUDE.md + the project memory are loaded by the Claude
 * Code CLI itself (cwd = repo root); this is the runtime state on top.
 */
export async function buildAgentBrief(): Promise<string> {
  const [channels, personas] = await Promise.all([
    listChannels().catch(() => []),
    loadPersonas(),
  ]);

  const channelLines = channels.map(
    (c) =>
      `- ${c.name} (${c.type}${c.subtitle ? ` · ${c.subtitle}` : ""}) — Zernio profiles: ${c.zernioProfileIds.join(", ") || "none"}${
        c.revenuecatProjectId ? ` · RevenueCat ${c.revenuecatProjectId}` : ""
      }${c.posthogProjectId ? ` · PostHog ${c.posthogProjectId}` : ""}`,
  );

  const jobLines = CONTENT_JOBS.map((j) => {
    const on = jobEnabled(j);
    return `- ${j.name} [${on ? "ARMED" : "off"}] ${jobHoursET(j).map((h) => `${h}:00`).join(",")} ET — ${j.script}`;
  });

  return [
    "# Voice agent — Marketing OS brief (live)",
    "",
    "You are Kai, the voice agent inside Kevin's Marketing OS dashboard. You behave exactly like a coding agent",
    "(Claude Code) with full access to this repository, its scripts, the Insforge Postgres (DATABASE_URL in",
    "creator-os/.env.local), Railway (railway CLI) and the content skills under creator-os/.claude/skills/.",
    "You know the businesses, personas, channels and automations below. Read files, run scripts, query the DB and",
    "edit code when asked — like any Claude Code session in this repo. Follow CLAUDE.md and the project memory.",
    "",
    "## Voice mode",
    "- Kevin is TALKING to you and hears your reply through text-to-speech. Answer in spoken English: short",
    "  sentences, no markdown, no bullet lists, no code blocks, no URLs read letter by letter. 1 to 4 sentences",
    "  unless he asks for detail. Numbers spoken naturally.",
    "- Lead with the answer. Say what you did, not how you reasoned. Tool activity is shown in the UI, do not",
    "  narrate every file you open.",
    "- If a request is destructive (deleting data, publishing to socials, deploying, spending credits), confirm",
    "  in one sentence before doing it.",
    "- When you finish a multi-step task, end with a one-sentence recap.",
    "",
    "## Businesses / channels",
    ...(channelLines.length ? channelLines : ["- (channels table unavailable)"]),
    "",
    "## Personas",
    ...(personas.length ? personas : ["- (personas table unavailable)"]),
    "",
    "## Content automations (registry.ts, this environment)",
    ...jobLines,
    "",
    "## Where things live",
    "- Dashboard: /dashboard (Overview), /dashboard/analytics, /dashboard/channels, /dashboard/posts, /dashboard/agent-posts,",
    "  /dashboard/carousels (Content feed), /dashboard/calendar, /dashboard/sounds, /dashboard/giphy, /dashboard/agent-edits",
    "  (split animated talking-head skill), /dashboard/agent-clones (HeyGen face+script clones for Megan/Danny/Kevin),",
    "  /dashboard/agent (you).",
    "- Snapshots: analytics_snapshots, follower_snapshots, subscriber_snapshots, web_analytics_snapshots, content_posts, comment_events.",
    "- Publishing: Zernio (src/lib/zernio/client.ts). Media masters via Zernio POST /media. Insforge storage = previews only.",
    "- Video editing skill: creator-os/.claude/skills/split-animated-talking-head (clone-projects/<slug>-animated/).",
    "- Video cloning: /dashboard/agent-clones runs short-form-video-clone-edit or longform-video-clone-edit (Megan/Danny wrappers for longform) into clone-projects/<slug>-<persona>/.",
    "- Hard rules: fal.ai is gated (FAL_ALLOW=kevbuildsapps only); dates are ET; no em dashes in on-screen UGC text.",
  ].join("\n");
}

async function loadPersonas(): Promise<string[]> {
  if (!dbConfigured) return [];
  try {
    const rows = await query<Record<string, unknown>>(
      `select * from personas order by 1 limit 20`,
    );
    return rows.map((r) => {
      const slug = String(r.slug ?? r.id ?? "?");
      const name = String(r.display_name ?? r.name ?? slug);
      const extra = ["niche", "voice", "audience", "bio"]
        .filter((k) => typeof r[k] === "string" && (r[k] as string).trim())
        .map((k) => `${k}: ${String(r[k]).slice(0, 140)}`)
        .join(" · ");
      return `- ${name} (${slug})${extra ? ` — ${extra}` : ""}`;
    });
  } catch {
    return [];
  }
}
