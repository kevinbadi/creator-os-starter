import "server-only";
import { dbConfigured, query } from "@/lib/insforge/db";

// Per-profile Zernio API keys, mapped on channel_profiles (Kevin 2026-07-13).
// Zernio's /api-keys lists every key's name/preview + profile scope, but full
// secrets are only visible at creation — so the mapping stores name/preview
// for every profile-scoped key and the full secret where Kevin has provided
// it. Resolution falls back to the org-wide ZERNIO_API_KEY, which can access
// every profile anyway; scoped keys matter for agent/CLI isolation.

export type ProfileKeyInfo = {
  profileId: string;
  apiKey: string; // full secret if stored, else the org fallback
  scopedKeyName: string | null;
  scopedKeyPreview: string | null;
  isScoped: boolean; // true when a stored full per-profile secret is used
};

export async function getProfileApiKey(profileId: string): Promise<ProfileKeyInfo> {
  const fallback = {
    profileId,
    apiKey: process.env.ZERNIO_API_KEY ?? "",
    scopedKeyName: null,
    scopedKeyPreview: null,
    isScoped: false,
  };
  if (!dbConfigured) return fallback;
  try {
    const rows = await query<{ api_key: string | null; api_key_name: string | null; api_key_preview: string | null }>(
      `select api_key, api_key_name, api_key_preview
         from channel_profiles where zernio_profile_id = $1
        order by api_key nulls last limit 1`,
      [profileId],
    );
    const r = rows[0];
    if (!r) return fallback;
    return {
      profileId,
      apiKey: r.api_key ?? fallback.apiKey,
      scopedKeyName: r.api_key_name,
      scopedKeyPreview: r.api_key_preview,
      isScoped: Boolean(r.api_key),
    };
  } catch {
    return fallback;
  }
}
