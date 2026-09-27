import type { ZernioPostPlatform } from "./types";

/**
 * Public URL for a published platform entry. Zernio returns `platformPostUrl`
 * for most platforms but not TikTok — there the platformPostId is a publish
 * handle like "p_pub_url~v2.7657680263291504657" whose numeric tail is the
 * real item id, so we construct the link ourselves. TikTok canonicalizes the
 * username segment (and photo vs video path) via redirect, so "@_" is a safe
 * fallback when the account username isn't populated on the entry.
 */
export function platformPostLink(pl: ZernioPostPlatform): string | null {
  if (pl.platformPostUrl) return pl.platformPostUrl;
  if (pl.platform === "tiktok" && pl.platformPostId) {
    const m = String(pl.platformPostId).match(/(\d{15,})\s*$/);
    if (m) {
      const username =
        typeof pl.accountId === "object" ? pl.accountId?.username : undefined;
      return `https://www.tiktok.com/@${username || "_"}/video/${m[1]}`;
    }
  }
  return null;
}
