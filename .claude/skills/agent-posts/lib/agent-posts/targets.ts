import "server-only";
import { listAccounts, listProfiles } from "@/lib/zernio/client";
import { agentPostTargetName, type AgentPostTarget } from "./types";
import { creatorOsForkKeyConfigured } from "./setup";

function normalizeAccount(a: {
  _id: string;
  platform: string;
  username?: string;
  isActive?: boolean;
  metadata?: { profileData?: { username?: string } };
}) {
  return {
    id: a._id,
    platform: a.platform,
    username: a.metadata?.profileData?.username ?? a.username,
  };
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

async function targetProfileIds(profiles: { _id: string }[]): Promise<string[]> {
  const pinned = (process.env.CREATOR_OS_PROFILE_ID ?? "").trim();
  if (pinned) return [pinned];
  const extra = (process.env.CREATOR_OS_PROFILE_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (extra.length) return unique(extra);
  return unique(profiles.map((p) => p._id));
}

export async function listAgentPostTargets(): Promise<AgentPostTarget[]> {
  if (!creatorOsForkKeyConfigured()) return [];

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
      name: agentPostTargetName(profileId, nameById.get(profileId) || "Socials"),
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
