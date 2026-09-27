import "server-only";

/**
 * TypeSafe AI "Jev" (System One model) client. Kevin 2026-09-18.
 *
 * Jev never writes text. You send a `state` and a map of typed questions and
 * get one calibrated answer per question: a yes/no probability (noul), a pick
 * from options you listed (choice), or a rubric score (score). ~0.6s, $0.042
 * per million input tokens, output free. Docs: https://docs.typesafe.ai/api
 */

export type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true?: string; false?: string };
};
export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
};
export type ScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};
export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type NoulAnswer = { type: "noul"; noul: number };
export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
export type ScoreAnswer = {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
};
export type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type JevResponse<Q extends Record<string, JevQuestion>> = {
  model: string;
  answers: { [K in keyof Q]: JevAnswer };
  usage?: { input_tokens: number; output_tokens: number };
  latencyMs: number;
};

const BASE = (process.env.TYPESAFE_API_BASE || "https://api.typesafe.ai").replace(/\/$/, "");

export function jevConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

export async function jevEvaluate<Q extends Record<string, JevQuestion>>(
  state: string | Record<string, unknown> | unknown[],
  questions: Q,
  opts?: { model?: string; timeoutMs?: number },
): Promise<JevResponse<Q>> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("TYPESAFE_API_KEY is not set.");
  const t0 = Date.now();
  const res = await fetch(`${BASE}/v1/systemone`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: opts?.model || process.env.TYPESAFE_MODEL || "jev-latest", state, questions }),
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 12_000),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`jev ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as Omit<JevResponse<Q>, "latencyMs">;
  return { ...data, latencyMs: Date.now() - t0 };
}
