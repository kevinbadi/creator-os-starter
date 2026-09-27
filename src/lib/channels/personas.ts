import "server-only";
import { dbConfigured, query } from "@/lib/insforge/db";
import type { Channel } from "./types";

/** Known profile → persona slug when the personas table hasn't caught up. */
const PROFILE_PERSONA: Record<string, string> = {
  "ZERNIO_PROFILE_PERSONAL": "kevbuildsapps",
  "ZERNIO_PROFILE_BRAND": "creatoros",
  "ZERNIO_PROFILE_KEV": "kev",
  "ZERNIO_PROFILE_MEGAN": "megan",
  "ZERNIO_PROFILE_DANNY": "danny",
  "ZERNIO_PROFILE_AGENCIES": "kevbuildsagencies",
};

/** Persona slugs whose Zernio profile sits on this channel. */
export async function personaSlugsForChannel(
  channel: Channel | null,
): Promise<string[]> {
  const ids = channel?.zernioProfileIds ?? [];
  if (!ids.length) return [];
  const fromMap = ids.map((id) => PROFILE_PERSONA[id]).filter(Boolean);
  if (!dbConfigured) return [...new Set(fromMap)];
  try {
    const rows = await query<{ slug: string }>(
      `select slug from personas where zernio_profile_id = any($1)`,
      [ids],
    );
    return [...new Set([...rows.map((r) => r.slug), ...fromMap])];
  } catch {
    return [...new Set(fromMap)];
  }
}
