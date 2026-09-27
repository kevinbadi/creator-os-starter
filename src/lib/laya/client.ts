import "server-only";
import type { JevAnswer, JevQuestion, JevResponse } from "@/lib/jev/client";

/**
 * Local Laya client — same typed questions Jev answers (choice / noul / score).
 * Hits the FastAPI sidecar from scripts/laya/server.py (decision-brain /evaluate).
 * Apache 2.0, no TypeSafe key. Docs: https://huggingface.co/convaiinnovations/laya
 */

const BASE = (process.env.LAYA_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

export function layaConfigured(): boolean {
  return process.env.LAYA_ENABLED !== "0";
}

export async function layaEvaluate<Q extends Record<string, JevQuestion>>(
  state: string | Record<string, unknown> | unknown[],
  questions: Q,
  opts?: { timeoutMs?: number },
): Promise<JevResponse<Q>> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state, questions }),
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 30_000),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`laya ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as {
    answers?: JevResponse<Q>["answers"];
    model?: string;
    usage?: JevResponse<Q>["usage"];
  };
  if (!data.answers) throw new Error(`laya: no answers in ${text.slice(0, 200)}`);
  return {
    model: data.model || process.env.LAYA_MODEL || "convaiinnovations/laya",
    answers: normalizeAnswers(data.answers, questions),
    usage: data.usage,
    latencyMs: Date.now() - t0,
  };
}

/** Laya's predict() matches Jev's shape; fill confidence/probabilities if a checkpoint omits them. */
function normalizeAnswers<Q extends Record<string, JevQuestion>>(
  raw: JevResponse<Q>["answers"],
  questions: Q,
): JevResponse<Q>["answers"] {
  const out = { ...raw };
  for (const id of Object.keys(questions) as (keyof Q)[]) {
    const q = questions[id];
    const a = (out[id] ?? {}) as JevAnswer & Record<string, unknown>;
    if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      const probs = (a.probabilities as Record<string, number> | undefined) ?? {};
      const choice = String(a.choice ?? keys[0] ?? "none");
      if (!probs[choice] && keys.length) {
        for (const k of keys) if (probs[k] == null) probs[k] = k === choice ? 1 : 0;
      }
      const top = Math.max(0, ...Object.values(probs));
      out[id] = {
        type: "choice",
        choice,
        confidence: typeof a.confidence === "number" ? a.confidence : top,
        probabilities: probs,
      } as JevResponse<Q>["answers"][keyof Q];
    } else if (q.type === "noul") {
      const noul = typeof a.noul === "number" ? a.noul : 0;
      out[id] = { type: "noul", noul } as JevResponse<Q>["answers"][keyof Q];
    } else if (q.type === "score") {
      out[id] = {
        type: "score",
        score: typeof a.score === "number" ? a.score : 0,
        confidence: typeof a.confidence === "number" ? a.confidence : 0,
        legend: (a.legend as Record<string, string>) ?? {},
        probabilities: (a.probabilities as Record<string, number>) ?? {},
      } as JevResponse<Q>["answers"][keyof Q];
    }
  }
  return out;
}
