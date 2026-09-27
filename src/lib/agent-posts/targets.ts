import "server-only";
import { normalizeAccount } from "@/components/SocialAccounts";
import { listChannels } from "@/lib/channels/store";
import { listAccounts, listProfiles } from "@/lib/zernio/client";
import { AGENT_POSTS_PROFILE_ID } from "./store";
import {
  AGENT_POST_TARGET_NAMES,
  KEV_AI_PROFILE_ID,
  KEV_BUILDS_APPS_PROFILE_ID,
  MEGAN_PROFILE_ID,
  agentPostTargetName,
  type AgentPostTarget,
} from "./types";

/** Channels whose Zernio profiles show up on the Agent Posts desk. */
export const AGENT_POSTS_CHANNEL_IDS = ["personal", "ugc-1"] as const;

/** Stable order: Kevin brands first, then Megan. */
const TARGET_ORDER = [
  KEV_BUILDS_APPS_PROFILE_ID,
  KEV_AI_PROFILE_ID,
  MEGAN_PROFILE_ID,
] as const;

function unique(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function sortTargetIds(ids: string[]): string[] {
  const rank = new Map<string, number>(
    TARGET_ORDER.map((id, i) => [id, i]),
  );
  return [...ids].sort((a, b) => {
    const ra = rank.get(a) ?? 100;
    const rb = rank.get(b) ?? 100;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

async function targetProfileIds(profiles: { _id: string }[]): Promise<string[]> {
  // Creator OS mode: the key issued at https://www.creatoros.ca/ is scoped to
  // the user's own Zernio profile(s), so every profile the key can see is a
  // target. CREATOR_OS_PROFILE_ID pins one explicitly.
  if (process.env.CREATOR_OS_API_KEY) {
    const pinned = (process.env.CREATOR_OS_PROFILE_ID ?? "").trim();
    if (pinned) return [pinned];
    return unique(profiles.map((p) => p._id));
  }
  // Dashboard mode: Kevin personal brands + Megan UGC channel.
  const channels = await listChannels().catch(() => []);
  const fromChannels = channels
    .filter((c) =>
      (AGENT_POSTS_CHANNEL_IDS as readonly string[]).includes(c.id),
    )
    .flatMap((c) => c.zernioProfileIds ?? []);
  return sortTargetIds(
    unique([
      AGENT_POSTS_PROFILE_ID,
      KEV_BUILDS_APPS_PROFILE_ID,
      KEV_AI_PROFILE_ID,
      MEGAN_PROFILE_ID,
      ...fromChannels,
    ]),
  );
}

export async function listAgentPostTargets(): Promise<AgentPostTarget[]> {
  const profiles = await listProfiles().catch(() => []);
  const ids = await targetProfileIds(profiles);
  if (!ids.length) return [];

  const accountLists = await Promise.all(
    ids.map((id) => listAccounts(id).catch(() => [])),
  );
  const nameById = new Map(profiles.map((p) => [p._id, p.name]));

  return ids.map((profileId, i) => {
    const accounts = (accountLists[i] ?? [])
      .filter((a) => a.isActive !== false)
      .map(normalizeAccount);
    const handles = unique(
      accounts
        .map((a) => a.username)
        .filter((u): u is string => Boolean(u))
        .map((u) => `@${u.replace(/^@/, "")}`),
    ).slice(0, 3);
    const platforms = unique(accounts.map((a) => a.platform.toLowerCase()));
    return {
      profileId,
      name: agentPostTargetName(
        profileId,
        AGENT_POST_TARGET_NAMES[profileId] || nameById.get(profileId) || "Socials",
      ),
      handles,
      platforms,
      nextSlot: null,
    };
  });
}

export function isAllowedAgentPostProfile(
  profileId: string,
  targets: AgentPostTarget[],
): boolean {
  return targets.some((t) => t.profileId === profileId);
}

/** Megan's UGC channel id on the dashboard. */
export const MEGAN_CHANNEL_ID = "ugc-1";

/**
 * Which targets the slot board shows for the active dashboard channel
 * (Kevin 2026-09-18: Megan does not belong on the board while the
 * Kev Builds Apps tab is active). Megan's channel shows only Megan; every
 * other channel shows the Kevin socials sets.
 */
export function boardTargetsForChannel<T extends { profileId: string }>(
  targets: T[],
  channelId: string | null | undefined,
): T[] {
  const megan = channelId === MEGAN_CHANNEL_ID;
  const picked = targets.filter((t) =>
    megan ? t.profileId === MEGAN_PROFILE_ID : t.profileId !== MEGAN_PROFILE_ID,
  );
  return picked.length ? picked : targets;
}
