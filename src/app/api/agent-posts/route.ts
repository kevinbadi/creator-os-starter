import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { resolveResourceUrls } from "@/lib/comments/dm-copy";
import { createAgentPost, listAgentPosts } from "@/lib/agent-posts/store";
import {
  boardTargetsForChannel,
  isAllowedAgentPostProfile,
  listAgentPostTargets,
} from "@/lib/agent-posts/targets";
import { getActiveChannel } from "@/lib/channels/store";
import {
  parseAgentPostPlatforms,
  videoPlatformsForTargets,
  AGENT_POST_VIDEO_PLATFORMS,
} from "@/lib/agent-posts/types";
import { kickAgentPostDrain } from "@/lib/agent-posts/run";
import { invalidateSlotBoards, normalizeMonth, slotBoardsForTargets } from "@/lib/agent-posts/slots";

export const runtime = "nodejs";
export const maxDuration = 300;

async function requireSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token);
}

export async function GET(req: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  kickAgentPostDrain();
  const url = new URL(req.url);
  // Fast path for the desk's job poll: DB only, no Zernio walk (Kevin 2026-09-18).
  if (url.searchParams.get("boards") === "0") {
    return NextResponse.json({ jobs: await listAgentPosts(80) });
  }
  const month = normalizeMonth(url.searchParams.get("month"));
  const channelId = await getActiveChannel().then((c) => c?.id ?? null).catch(() => null);
  const [jobs, slotted] = await Promise.all([
    listAgentPosts(80),
    listAgentPostTargets()
      .then((t) => slotBoardsForTargets(t, month))
      .catch(() => ({ targets: [], boards: [] })),
  ]);
  return NextResponse.json({
    jobs,
    targets: slotted.targets,
    boards: boardTargetsForChannel(slotted.boards, channelId),
    month,
  });
}

export async function POST(req: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    videoUrl?: string;
    resourceUrl?: string;
    dmNote?: string;
    title?: string;
    caption?: string;
    profileId?: string;
    profileIds?: string[];
    platforms?: string[];
  };
  try {
    body = (await req.json()) as {
      videoUrl?: string;
      resourceUrl?: string;
      dmNote?: string;
      title?: string;
      caption?: string;
      profileId?: string;
      profileIds?: string[];
      platforms?: string[];
    };
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const videoUrl = String(body.videoUrl ?? "").trim();
  const resourceRaw = String(body.resourceUrl ?? "").trim();
  const title = String(body.title ?? "")
    .replace(/[\u2013\u2014]/g, "-")
    .trim()
    .slice(0, 100);
  const caption = String(body.caption ?? "")
    .replace(/[\u2013\u2014]/g, "-")
    .trim()
    .slice(0, 2200);
  if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) {
    return NextResponse.json(
      { error: "Add a video file or a direct video URL." },
      { status: 400 },
    );
  }
  const urls = resourceRaw ? resolveResourceUrls(resourceRaw) : [];
  if (resourceRaw && urls.length === 0) {
    return NextResponse.json(
      {
        error:
          "That DM resource link is not a URL, /go/slug, or slug. Leave it blank if this post has no comment-to-DM.",
      },
      { status: 400 },
    );
  }

  const targets = await listAgentPostTargets();
  const profileIds = [
    ...new Set(
      [
        ...(Array.isArray(body.profileIds) ? body.profileIds : []),
        body.profileId,
      ]
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    ),
  ];
  if (
    profileIds.length === 0 ||
    profileIds.some((id) => !isAllowedAgentPostProfile(id, targets))
  ) {
    return NextResponse.json(
      { error: "Pick which socials to post to." },
      { status: 400 },
    );
  }

  const available = videoPlatformsForTargets(targets, profileIds);
  const fallback =
    available.length > 0 ? available : [...AGENT_POST_VIDEO_PLATFORMS];
  const requested = parseAgentPostPlatforms(body.platforms);
  const selected = (requested ?? fallback).filter((p) => fallback.includes(p));
  if (selected.length === 0) {
    return NextResponse.json(
      { error: "Pick at least one platform." },
      { status: 400 },
    );
  }
  const platforms =
    selected.length === fallback.length &&
    fallback.every((p) => selected.includes(p))
      ? null
      : selected;

  try {
    const jobs = [];
    for (const profileId of profileIds) {
      jobs.push(
        await createAgentPost({
          profileId,
          videoUrl,
          resourceUrl: urls.join("\n"),
          dmNote: String(body.dmNote ?? "").trim().slice(0, 800) || null,
          youtubeTitle: title || null,
          caption: caption || null,
          platforms,
        }),
      );
    }
    invalidateSlotBoards();
    kickAgentPostDrain();
    return NextResponse.json({ job: jobs[0], jobs });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not queue the post." },
      { status: 500 },
    );
  }
}
