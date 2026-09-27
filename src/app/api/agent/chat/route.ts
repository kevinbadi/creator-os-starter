import { spawn } from "node:child_process";
import path from "node:path";
import { buildAgentBrief } from "@/lib/agent/brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// Repo root = parent of creator-os. Running the CLI there means CLAUDE.md, the
// project memory and every skill load exactly like an interactive session.
const REPO_ROOT = path.resolve(process.cwd(), "..");
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
// Behaves like a coding agent: read/search/edit/run. Same trust as `claude` in
// this repo on Kevin's machine (localhost only, behind the password gate).
const ALLOWED_TOOLS =
  process.env.AGENT_ALLOWED_TOOLS ||
  "Read,Glob,Grep,Edit,Write,Bash,WebFetch,WebSearch,Skill,Task";

type Ev =
  | { type: "init"; sessionId: string; model?: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "tool_result"; text: string }
  | { type: "done"; result: string; sessionId: string; cost?: number; turns?: number }
  | { type: "error"; message: string };

/**
 * POST { message, sessionId? } → NDJSON stream of Ev.
 * Spawns `claude -p` (headless Claude Code on Kevin's plan) with the live
 * Marketing OS brief appended to the system prompt. `sessionId` resumes the
 * same conversation so the agent keeps context across voice turns.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { message?: string; sessionId?: string };
  const message = (body.message ?? "").trim();
  if (!message) return new Response(JSON.stringify({ error: "message required" }), { status: 400 });

  const brief = await buildAgentBrief();
  const args = [
    "-p",
    message,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    ALLOWED_TOOLS,
    "--append-system-prompt",
    brief,
  ];
  if (body.sessionId) args.push("--resume", body.sessionId);

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (ev: Ev) => controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
      const env = { ...process.env };
      delete env.ANTHROPIC_API_KEY; // run on the logged-in Claude plan, never the API key
      const child = spawn(CLAUDE_BIN, args, { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
      let buf = "";
      let sessionId = body.sessionId ?? "";
      let closed = false;
      const finish = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      };

      child.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let j: Record<string, unknown>;
          try { j = JSON.parse(line); } catch { continue; }
          const t = j.type as string;
          if (t === "system" && j.subtype === "init") {
            sessionId = String(j.session_id ?? sessionId);
            send({ type: "init", sessionId, model: j.model as string | undefined });
          } else if (t === "assistant") {
            const content = ((j.message as { content?: unknown[] })?.content ?? []) as Record<string, unknown>[];
            for (const c of content) {
              if (c.type === "text" && typeof c.text === "string" && c.text.trim()) send({ type: "text", text: c.text });
              else if (c.type === "tool_use") send({ type: "tool", name: String(c.name), input: c.input });
            }
          } else if (t === "user") {
            const content = ((j.message as { content?: unknown[] })?.content ?? []) as Record<string, unknown>[];
            for (const c of content) {
              if (c && c.type === "tool_result") {
                const raw = c.content;
                const text = typeof raw === "string"
                  ? raw
                  : Array.isArray(raw)
                    ? raw.map((x) => (typeof x === "object" && x && "text" in x ? String((x as { text: unknown }).text) : "")).join("\n")
                    : "";
                send({ type: "tool_result", text: text.slice(0, 400) });
              }
            }
          } else if (t === "result") {
            send({
              type: "done",
              result: String(j.result ?? ""),
              sessionId: String(j.session_id ?? sessionId),
              cost: typeof j.total_cost_usd === "number" ? j.total_cost_usd : undefined,
              turns: typeof j.num_turns === "number" ? j.num_turns : undefined,
            });
          }
        }
      });
      let stderr = "";
      child.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });
      child.on("error", (e) => { send({ type: "error", message: e.message }); finish(); });
      child.on("close", (code) => {
        if (code && code !== 0) send({ type: "error", message: `claude exited ${code}: ${stderr.slice(-400)}` });
        finish();
      });
      req.signal?.addEventListener("abort", () => { child.kill("SIGTERM"); finish(); });
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
