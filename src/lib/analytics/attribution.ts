import "server-only";
import { dbConfigured, query } from "@/lib/insforge/db";
import { ttlRemember } from "@/lib/cache/ttl";

// Click counts per tracked-link source (/go/<slug>), ET day boundaries to
// match the rest of the dashboard.
export type SourceClicks = {
  slug: string;
  today: number;
  last7: number;
  total: number;
  lastAt: string | null;
};

export async function clicksBySource(): Promise<SourceClicks[]> {
  if (!dbConfigured) return [];
  return ttlRemember("snap:clicksBySource", 60_000, clicksBySourceFresh);
}

async function clicksBySourceFresh(): Promise<SourceClicks[]> {
  const rows = await query<{
    slug: string;
    today: string;
    last7: string;
    total: string;
    last_at: string | null;
  }>(`
    SELECT slug,
      count(*) FILTER (WHERE (clicked_at AT TIME ZONE 'America/New_York')::date
        = (now() AT TIME ZONE 'America/New_York')::date) AS today,
      count(*) FILTER (WHERE clicked_at > now() - interval '7 days') AS last7,
      count(*) AS total,
      max(clicked_at)::text AS last_at
    FROM link_clicks
    GROUP BY slug
    ORDER BY count(*) DESC
  `);
  return rows.map((r) => ({
    slug: r.slug,
    today: Number(r.today),
    last7: Number(r.last7),
    total: Number(r.total),
    lastAt: r.last_at,
  }));
}
