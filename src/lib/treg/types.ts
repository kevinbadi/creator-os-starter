/**
 * Shared Treg + Jev pipeline types. Safe for client components.
 * Kevin 2026-09-24: first Marketing OS live-data desk.
 */

export const TREG_STATIONS = [
  { id: "route", label: "Jev route", blurb: "Pick a catalog lane" },
  { id: "catalog", label: "Catalog", blurb: "Search 3600+ endpoints" },
  { id: "pick", label: "Jev pick", blurb: "Choose the cheapest reliable tool" },
  { id: "call", label: "Treg call", blurb: "Fetch live data" },
  { id: "result", label: "Result", blurb: "Rows we can post to" },
] as const;

export type TregStationId = (typeof TREG_STATIONS)[number]["id"];

export type TregStepStatus = "pending" | "running" | "done" | "error" | "skipped";

export type TregStep = {
  id: TregStationId;
  status: TregStepStatus;
  startedAt?: string;
  endedAt?: string;
  detail?: string;
};

export type TregCatalogHit = {
  id: string;
  provider: string;
  name: string;
  summary: string;
  method: string;
  platform: string;
  platformLabel: string;
  capability: string;
  costUsd: number | null;
  okRate: number | null;
  samples: number;
  score: number;
  testRequest: TregTestRequest | null;
};

export type TregTestRequest = {
  queryParams?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, unknown>;
};

export type TregRow = {
  title: string;
  subtitle?: string;
  metric?: string;
  url?: string;
  thumb?: string;
};

export type TregRunStatus = "queued" | "running" | "done" | "failed";

export type TregRun = {
  id: string;
  ask: string;
  status: TregRunStatus;
  createdAt: string;
  updatedAt: string;
  steps: TregStep[];
  lane?: string;
  laneConfidence?: number;
  catalogQuery?: string;
  catalogTotal?: number;
  candidates?: TregCatalogHit[];
  picked?: TregCatalogHit;
  pickConfidence?: number;
  callId?: string;
  costUsd?: number | null;
  cacheHit?: boolean;
  rows?: TregRow[];
  raw?: unknown;
  error?: string;
};

export const SEARCH_LANES = {
  tiktok_us_feed: {
    query: "tiktok trending feed US viral videos",
    label: "US TikTok For You",
    hint: "Viral / For You / trending TikTok videos in the US that we could post to today.",
  },
  tiktok_search: {
    query: "tiktok trending search words keywords",
    label: "TikTok search terms",
    hint: "Trending TikTok search terms, keywords, or hashtags people are typing today.",
  },
  tiktok_music: {
    query: "tiktok music chart viral sounds",
    label: "TikTok music chart",
    hint: "Viral sounds, trending music, Top 50 or Viral 50 TikTok charts.",
  },
  as_asked: {
    query: "",
    label: "Catalog as asked",
    hint: "Live external data, but not one of the three TikTok lanes. Search the catalog with the user's own words.",
  },
  none: {
    query: "",
    label: "Skip",
    hint: "Not a live-data question. Chit-chat, an opinion, or something our own dashboard already answers.",
  },
} as const;

export type SearchLaneId = keyof typeof SEARCH_LANES;

export const DEFAULT_TREG_ASK =
  "What's trending on TikTok in the US right now that we could post to today?";

export const TREG_STARTERS = [
  DEFAULT_TREG_ASK,
  "TikTok daily trending search terms in the US",
  "TikTok viral music chart — sounds we could use today",
] as const;

export function emptySteps(): TregStep[] {
  return TREG_STATIONS.map((s) => ({ id: s.id, status: "pending" }));
}
