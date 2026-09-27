import "server-only";
import { jevConfigured, jevEvaluate, type ChoiceAnswer } from "@/lib/jev/client";
import { tregCall, tregCatalogGet, tregCatalogSearch } from "./client";
import { extractRows } from "./extract";
import { getRun, patchRun, setStep } from "./store";
import {
  SEARCH_LANES,
  type SearchLaneId,
  type TregCatalogHit,
  type TregRun,
} from "./types";

const LANE_FALLBACKS: Record<SearchLaneId, TregCatalogHit[]> = {
  tiktok_us_feed: [
    {
      id: "scrapecreators.x.v1-tiktok-get-trending-feed",
      provider: "scrapecreators",
      name: "TikTok trending feed by region — viral videos",
      summary: "Fetches TikTok's trending/For You feed for a given region.",
      method: "GET",
      platform: "tiktok",
      platformLabel: "TikTok",
      capability: "tiktok.feed.home",
      costUsd: 0.00188,
      okRate: 0.9831,
      samples: 472,
      score: 50,
      testRequest: { queryParams: { region: "US" } },
    },
  ],
  tiktok_search: [
    {
      id: "tikhub.x.tiktok-web-fetch-trending-searchwords",
      provider: "tikhub",
      name: "TikTok trending search words",
      summary: "Daily trending TikTok search terms.",
      method: "GET",
      platform: "tiktok",
      platformLabel: "TikTok",
      capability: "tiktok.search.trending",
      costUsd: 0.001,
      okRate: 0.994,
      samples: 80,
      score: 40,
      testRequest: { queryParams: {} },
    },
  ],
  tiktok_music: [
    {
      id: "tikhub.x.tiktok-app-v3-fetch-music-chart-list",
      provider: "tikhub",
      name: "TikTok music charts — Top 50, Viral 50",
      summary: "Music Chart List",
      method: "GET",
      platform: "tiktok",
      platformLabel: "TikTok",
      capability: "tiktok.music.charts",
      costUsd: 0.001,
      okRate: 0.9881,
      samples: 86,
      score: 40,
      testRequest: { queryParams: { scene: 0, cursor: 0, count: 5 } },
    },
  ],
  as_asked: [],
  none: [],
};

const PICK_LIMIT = 10;

export async function runTregPipeline(run: TregRun): Promise<void> {
  try {
    patchRun(run.id, { status: "running" });
    const lane = await routeLane(run);
    if (lane === "none") {
      setStep(run.id, "route", "done", "Jev said this is not a live-data ask.");
      setStep(run.id, "catalog", "skipped");
      setStep(run.id, "pick", "skipped");
      setStep(run.id, "call", "skipped");
      setStep(run.id, "result", "skipped", "Nothing to fetch.");
      patchRun(run.id, { status: "done" });
      return;
    }

    const query = SEARCH_LANES[lane].query || run.ask;
    setStep(run.id, "catalog", "running", `Searching “${query}”`);
    let ranked: TregCatalogHit[] = [];
    let total = 0;
    try {
      const page = await tregCatalogSearch(query, 25);
      ranked = rankHits(page.results, lane);
      total = page.total;
      patchRun(run.id, { catalogQuery: page.query, catalogTotal: page.total, candidates: ranked });
    } catch (e) {
      ranked = LANE_FALLBACKS[lane] ?? [];
      patchRun(run.id, { catalogQuery: query, catalogTotal: ranked.length, candidates: ranked });
      if (!ranked.length) throw e;
      setStep(
        run.id,
        "catalog",
        "done",
        `catalog unreachable · using ${ranked.length} known ${SEARCH_LANES[lane].label} endpoint(s)`,
      );
    }
    if (ranked.length && getRun(run.id)?.steps.find((s) => s.id === "catalog")?.status !== "done") {
      setStep(run.id, "catalog", "done", `${total} matches · showing ${ranked.length}`);
    }

    if (!ranked.length) {
      setStep(run.id, "pick", "error", "Catalog came back empty.");
      patchRun(run.id, { status: "failed", error: "No catalog endpoints matched." });
      return;
    }

    const picked = await pickEndpoint(run, ranked, lane);
    if (!picked) {
      setStep(run.id, "pick", "error", "Jev declined every candidate.");
      setStep(run.id, "call", "skipped");
      setStep(run.id, "result", "skipped");
      patchRun(run.id, { status: "failed", error: "Jev did not pick an endpoint." });
      return;
    }

    setStep(run.id, "call", "running", `${picked.method} ${picked.id}`);
    try {
      await tregCatalogGet(picked.id);
    } catch {
      /* spec is optional; test_request is already on the hit */
    }
    const called = await tregCall(picked, { idempotencyKey: run.id });
    const rows = extractRows(called.body);
    const costUsd = called.costMicro != null ? called.costMicro / 1_000_000 : picked.costUsd;
    patchRun(run.id, {
      callId: called.callId ?? undefined,
      costUsd,
      cacheHit: called.cache === "hit",
      rows,
      raw: called.body,
    });
    setStep(
      run.id,
      "call",
      "done",
      called.callId
        ? `call ${called.callId}${costUsd != null ? ` · $${costUsd.toFixed(5)}` : ""}`
        : "returned",
    );
    setStep(run.id, "result", "done", rows.length ? `${rows.length} rows` : "Raw payload (no rows extracted)");
    patchRun(run.id, { status: "done" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const live = getRun(run.id);
    const cur = live?.steps.find((s) => s.status === "running")?.id;
    if (cur) setStep(run.id, cur, "error", msg);
    const result = getRun(run.id)?.steps.find((s) => s.id === "result");
    if (result && result.status === "pending") setStep(run.id, "result", "skipped");
    patchRun(run.id, { status: "failed", error: friendlyNet(msg) });
  }
}

async function routeLane(run: TregRun): Promise<SearchLaneId> {
  setStep(run.id, "route", "running", "Jev is choosing a catalog lane");
  if (!jevConfigured()) {
    const fallback: SearchLaneId = guessLane(run.ask);
    patchRun(run.id, { lane: fallback, laneConfidence: 0 });
    setStep(run.id, "route", "done", `${SEARCH_LANES[fallback].label} (Jev offline)`);
    return fallback;
  }
  const criteria = Object.fromEntries(
    (Object.keys(SEARCH_LANES) as SearchLaneId[]).map((k) => [k, SEARCH_LANES[k].hint]),
  );
  const res = await jevEvaluate(
    {
      product: "Marketing OS for KevBuildsApps — US TikTok / IG / YouTube content dashboard.",
      ask: run.ask,
      rule: "Prefer a TikTok US lane over Douyin or a generic search when the ask is about TikTok, Reels sounds, or what is viral in the US.",
    },
    {
      lane: {
        type: "choice",
        instructions:
          "Which Treg catalog lane should fetch live data for this ask? Pick none if our own dashboard tools already answer it or it is not live external data.",
        criteria,
      },
    },
  );
  const ans = res.answers.lane as ChoiceAnswer;
  const lane = (ans.choice in SEARCH_LANES ? ans.choice : guessLane(run.ask)) as SearchLaneId;
  patchRun(run.id, { lane, laneConfidence: ans.confidence });
  setStep(run.id, "route", "done", `${SEARCH_LANES[lane].label} · ${pct(ans.confidence)}`);
  return lane;
}

async function pickEndpoint(
  run: TregRun,
  hits: TregCatalogHit[],
  lane: SearchLaneId,
): Promise<TregCatalogHit | null> {
  setStep(run.id, "pick", "running", `Jev ranking ${hits.length} endpoints`);
  const slice = hits.slice(0, PICK_LIMIT);
  if (!jevConfigured()) {
    const picked = slice[0] ?? null;
    if (picked) {
      patchRun(run.id, { picked, pickConfidence: 0 });
      setStep(run.id, "pick", "done", `${picked.name} (Jev offline · first TikTok-leaning hit)`);
    }
    return picked;
  }
  const criteria: Record<string, string> = { none: "None of these match. Do not spend money." };
  const byKey = new Map<string, TregCatalogHit>();
  slice.forEach((h, i) => {
    const key = `opt_${i}`;
    byKey.set(key, h);
    const ok = h.okRate != null ? `${Math.round(h.okRate * 100)}% WORKS (${h.samples} samples)` : `unproven (${h.samples} samples)`;
    const cost = h.costUsd != null ? `$${h.costUsd}` : "unpriced";
    criteria[key] =
      `${h.name} [${h.id}] platform=${h.platform || "unknown"} ${h.platformLabel} · ${cost}/call · ${ok} · ${h.summary}`;
  });
  const res = await jevEvaluate(
    {
      ask: run.ask,
      lane,
      prefer: "TikTok (platform=tiktok) over Douyin. Then reliability (high WORKS with a real sample). Then price. Skip endpoints that need an id we do not have.",
      we_have: "A region (US) and the catalog test_request defaults. No Douyin query_id, no advertiser id.",
    },
    {
      endpoint: {
        type: "choice",
        instructions:
          "Pick the one catalog endpoint to call. Prefer TikTok US over Douyin. Prefer a high WORKS rate with samples over a cheap unproven route. Prefer cheaper when reliability is close.",
        criteria,
      },
    },
  );
  const ans = res.answers.endpoint as ChoiceAnswer;
  if (ans.choice === "none") {
    patchRun(run.id, { pickConfidence: ans.confidence });
    setStep(run.id, "pick", "done", `none · ${pct(ans.confidence)}`);
    return null;
  }
  const picked = byKey.get(ans.choice) ?? slice[0] ?? null;
  if (picked) {
    patchRun(run.id, { picked, pickConfidence: ans.confidence });
    setStep(run.id, "pick", "done", `${picked.name} · ${pct(ans.confidence)}`);
  }
  return picked;
}

function rankHits(hits: TregCatalogHit[], lane: SearchLaneId): TregCatalogHit[] {
  const wantTiktok = lane.startsWith("tiktok");
  return [...hits]
    .filter((h) => h.id)
    .sort((a, b) => scoreHit(b, wantTiktok) - scoreHit(a, wantTiktok))
    .slice(0, 12);
}

function scoreHit(h: TregCatalogHit, wantTiktok: boolean): number {
  let n = h.score;
  if (wantTiktok && h.platform === "tiktok") n += 40;
  if (wantTiktok && h.platform === "douyin") n -= 25;
  if (h.okRate != null && h.samples >= 20) n += h.okRate * 12;
  if (h.costUsd != null && h.costUsd <= 0.005) n += 4;
  if (h.testRequest) n += 3;
  return n;
}

function guessLane(ask: string): SearchLaneId {
  const s = ask.toLowerCase();
  if (/\b(sound|music|chart|audio)\b/.test(s)) return "tiktok_music";
  if (/\b(search term|keyword|hashtag|trending search)\b/.test(s)) return "tiktok_search";
  if (/\b(tiktok|fyp|for you|viral|trending)\b/.test(s)) return "tiktok_us_feed";
  return "as_asked";
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function friendlyNet(msg: string): string {
  if (/fetch failed|ConnectTimeout|UND_ERR|timed out|ECONNRESET|ENOTFOUND/i.test(msg)) {
    return "treg.to timed out from this host. Catalog/call need a live path to https://treg.to — retry in a minute.";
  }
  return msg;
}
