#!/usr/bin/env node
// Detached runner for Marketing OS Agent Edits.
// Claude Code first; on weekly-limit / 429, fall back to local Cursor agent
// (cursor-agent CLI) so ffmpeg + the talking-head clip stay on this Mac.
//
//   node scripts/agent-edits-run.mjs --workdir <abs> --job <uuid> --prompt <file>
//
// Env:
//   EDIT_RUNNER=auto|claude|cursor    default auto (falls back to CLONE_RUNNER)
//   CURSOR_API_KEY                    Cursor Dashboard → Integrations
//   CURSOR_AGENT_BIN                  default cursor-agent
//   EDIT_CURSOR_MODEL / CLONE_CURSOR_MODEL   optional, e.g. composer-2.5
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : "";
}

const workdir = arg("--workdir");
const jobId = arg("--job");
const promptFile = arg("--prompt");
if (!workdir || !promptFile) {
  console.error("usage: agent-edits-run.mjs --workdir <abs> --prompt <file> [--job <id>]");
  process.exit(2);
}

const CREATOR_OS = process.cwd();
const REPO_ROOT = path.resolve(CREATOR_OS, "..");
const CLONE_ROOT = path.join(REPO_ROOT, "clone-projects");
const progressFile = path.join(workdir, "agent-progress.jsonl");
const statusFile = path.join(workdir, "agent-status.json");
const pidFile = path.join(workdir, "agent.pid");
const logFile = path.join(workdir, "agent.log");
const finalMp4 = path.join(workdir, "renders", "final.mp4");
const SYSTEM =
  "You are the Marketing OS Agent Edits runner. Execute the split-animated-talking-head skill to completion. Follow CLAUDE.md. Never call HeyGen or fal.ai. Dates are ET. Do not ask follow-up questions — finish the cut.";

fs.mkdirSync(path.join(workdir, "renders"), { recursive: true });
fs.writeFileSync(pidFile, String(process.pid), "utf8");
const QUOTA_FILE = path.join(os.homedir(), ".cache", "creator-os", "claude-weekly-limit.json");

function now() {
  return new Date().toISOString();
}

function writeStatus(patch) {
  let cur = {};
  try {
    cur = JSON.parse(fs.readFileSync(statusFile, "utf8"));
  } catch {
    /* first write */
  }
  const next = { ...cur, ...patch, jobId: jobId || cur.jobId };
  fs.writeFileSync(statusFile, JSON.stringify(next, null, 2), "utf8");
}

function emit(ev) {
  fs.appendFileSync(progressFile, JSON.stringify({ ts: now(), ...ev }) + "\n", "utf8");
}

function hasFinal() {
  try {
    return fs.statSync(finalMp4).size > 1000;
  } catch {
    return false;
  }
}

function toolSummary(name, input) {
  const i = input && typeof input === "object" ? input : {};
  const short = (s, n = 90) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);
  if (name === "Read" || name === "Edit" || name === "Write") return short(i.file_path || i.path);
  if (name === "Bash" || name === "Shell") return short(i.command, 120);
  if (name === "Grep") return short(i.pattern, 60);
  if (name === "Glob") return short(i.pattern || i.glob_pattern);
  if (name === "WebSearch") return short(i.query);
  if (name === "WebFetch") return short(i.url);
  if (name === "Skill") return short(i.skill || i.name);
  if (name === "Task") return short(i.description);
  return short(JSON.stringify(i), 90);
}

function loadDotEnvLocal(env) {
  const p = path.join(process.cwd(), ".env.local");
  let raw = "";
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch {
    return env;
  }
  const next = { ...env };
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    if (!key || next[key] != null) continue;
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    next[key] = val;
  }
  return next;
}

function withPath(env) {
  const extras = [
    path.join(os.homedir(), ".local/bin"),
    "/opt/homebrew/bin",
    "/Applications/Cursor.app/Contents/Resources/app/bin",
  ];
  const parts = String(env.PATH || "")
    .split(":")
    .filter(Boolean);
  const prefix = extras.filter((e) => !parts.includes(e));
  return { ...env, PATH: [...prefix, ...parts].join(":") };
}

const prompt = fs.readFileSync(promptFile, "utf8");
const log = fs.createWriteStream(logFile, { flags: "a" });
log.write(`\n--- ${now()} job ${jobId || "?"} ---\n`);

const env = withPath(loadDotEnvLocal({ ...process.env }));
delete env.ANTHROPIC_API_KEY;

const CLAUDE = env.CLAUDE_BIN || "claude";
const CURSOR_AGENT = env.CURSOR_AGENT_BIN || "cursor-agent";
const CURSOR_MODEL = env.EDIT_CURSOR_MODEL || env.CLONE_CURSOR_MODEL || "";
const ALLOWED =
  env.AGENT_ALLOWED_TOOLS ||
  "Read,Glob,Grep,Edit,Write,Bash,WebFetch,WebSearch,Skill,Task";
const RUNNER_PREF = String(env.EDIT_RUNNER || env.CLONE_RUNNER || "auto").toLowerCase();

function rememberClaudeQuota(untilMs) {
  const fallback = Date.parse("2026-09-17T21:00:00-04:00");
  const until = Number(untilMs) > Date.now() ? Number(untilMs) : fallback;
  fs.mkdirSync(path.dirname(QUOTA_FILE), { recursive: true });
  fs.writeFileSync(QUOTA_FILE, JSON.stringify({ until }), "utf8");
}

function claudeQuotaCached() {
  try {
    const j = JSON.parse(fs.readFileSync(QUOTA_FILE, "utf8"));
    return Number(j.until) > Date.now();
  } catch {
    return false;
  }
}

function cursorLoggedIn() {
  const r = spawnSync(CURSOR_AGENT, ["status"], {
    encoding: "utf8",
    env,
    timeout: 20_000,
  });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  if (/not logged in|authentication required/i.test(out)) return false;
  return r.status === 0;
}

function cursorPreflightError() {
  if (!fs.existsSync(CREATOR_OS)) {
    return `Cursor workspace missing: ${CREATOR_OS}`;
  }
  const which = spawnSync("which", [CURSOR_AGENT], { encoding: "utf8", env });
  if (which.status !== 0) {
    return "cursor-agent not found on PATH. Install with: curl https://cursor.com/install -fsS | bash";
  }
  if (!cursorLoggedIn()) {
    return (
      "Cursor agent is not signed in, so the fallback cannot run. " +
      "In a terminal run: cursor-agent login   — or add CURSOR_API_KEY to creator-os/.env.local " +
      "(cursor.com/dashboard/integrations) and restart the dashboard."
    );
  }
  return "";
}

let activeChild = null;
let cancelled = false;

function killActive() {
  if (!activeChild) return;
  try {
    activeChild.kill("SIGTERM");
  } catch {
    /* ignore */
  }
}

function blobHasClaudeQuota(text) {
  const s = String(text || "");
  return (
    /you've hit your weekly limit/i.test(s) ||
    /weekly limit · resets/i.test(s) ||
    /weekly limit/i.test(s) ||
    /overageDisabledReason/i.test(s) ||
    /out_of_credits/i.test(s) ||
    /rateLimitType":"seven_day/i.test(s)
  );
}

function blobHasProviderError(text) {
  const s = String(text || "");
  return (
    /NonRetriableError/i.test(s) ||
    /Provider Error/i.test(s) ||
    /trouble connecting to the model provider/i.test(s) ||
    /ECONNRESET|ETIMEDOUT|socket hang up|fetch failed/i.test(s)
  );
}

function eventIsClaudeQuota(j) {
  if (!j || typeof j !== "object") return false;
  if (j.type === "rate_limit_event") return true;
  if (j.error === "rate_limit") return true;
  if (j.api_error_status === 429) return true;
  if (j.type === "result" && j.is_error && (j.api_error_status === 429 || blobHasClaudeQuota(j.result))) {
    return true;
  }
  if (j.type === "assistant") {
    const content = (j.message && j.message.content) || [];
    for (const c of content) {
      if (c && c.type === "text" && blobHasClaudeQuota(c.text)) return true;
    }
  }
  return false;
}

const CURSOR_TOOL_LABELS = {
  readToolCall: "Read",
  writeToolCall: "Write",
  editToolCall: "Edit",
  shellToolCall: "Bash",
  bashToolCall: "Bash",
  grepToolCall: "Grep",
  globToolCall: "Glob",
  lsToolCall: "Glob",
  deleteToolCall: "Delete",
  todoToolCall: "Todo",
};

function cursorToolFromEvent(j) {
  const tc = j && j.tool_call;
  if (!tc || typeof tc !== "object") return null;
  if (tc.function && typeof tc.function === "object") {
    const name = tc.function.name || "tool";
    let input = {};
    try {
      input = JSON.parse(tc.function.arguments || "{}");
    } catch {
      input = { raw: tc.function.arguments };
    }
    return { name, summary: toolSummary(name, input) };
  }
  for (const [key, label] of Object.entries(CURSOR_TOOL_LABELS)) {
    if (!tc[key]) continue;
    const args = tc[key].args && typeof tc[key].args === "object" ? tc[key].args : {};
    return {
      name: label,
      summary: toolSummary(label, {
        file_path: args.path,
        command: args.command,
        pattern: args.pattern || args.glob_pattern,
        query: args.query,
        url: args.url,
      }),
    };
  }
  const key = Object.keys(tc)[0];
  return key ? { name: key.replace(/ToolCall$/, ""), summary: "" } : null;
}

function onClaudeLine(line, state) {
  log.write(line + "\n");
  let j;
  try {
    j = JSON.parse(line);
  } catch {
    return;
  }
  if (eventIsClaudeQuota(j)) {
    state.quota = true;
    const resets =
      j.rate_limit_info?.resetsAt ||
      j.rate_limit_info?.unifiedWindows?.seven_day?.resetsAt;
    rememberClaudeQuota(resets ? Number(resets) * 1000 : 0);
  }
  const t = j.type;
  if (t === "system" && j.subtype === "init") {
    writeStatus({ sessionId: j.session_id, model: j.model, engine: "claude" });
    emit({ type: "status", text: j.model ? `Claude Code · ${j.model}` : "Claude Code session started" });
  } else if (t === "assistant") {
    const content = (j.message && j.message.content) || [];
    for (const c of content) {
      if (c.type === "text" && typeof c.text === "string" && c.text.trim()) {
        writeStatus({ lastText: c.text.slice(0, 240) });
        emit({ type: "text", text: c.text });
      } else if (c.type === "tool_use") {
        const summary = toolSummary(c.name, c.input);
        writeStatus({ lastTool: `${c.name} ${summary}`.trim() });
        emit({ type: "tool", name: c.name, summary });
      }
    }
  } else if (t === "user") {
    const content = (j.message && j.message.content) || [];
    for (const c of content) {
      if (c && c.type === "tool_result") {
        const raw = c.content;
        const text =
          typeof raw === "string"
            ? raw
            : Array.isArray(raw)
              ? raw.map((x) => (x && typeof x === "object" && "text" in x ? String(x.text) : "")).join("\n")
              : "";
        emit({ type: "tool_result", text: text.slice(0, 400) });
      }
    }
  } else if (t === "result") {
    writeStatus({
      sessionId: j.session_id,
      cost: typeof j.total_cost_usd === "number" ? j.total_cost_usd : undefined,
      turns: typeof j.num_turns === "number" ? j.num_turns : undefined,
    });
    emit({ type: "done", text: String(j.result || "").slice(0, 800) });
    if (j.is_error) state.errorText = String(j.result || state.errorText || "");
  }
}

function onCursorLine(line, state) {
  log.write(line + "\n");
  if (blobHasProviderError(line)) {
    state.provider = true;
    state.errorText = line.slice(0, 500);
  }
  let j;
  try {
    j = JSON.parse(line);
  } catch {
    return;
  }
  const t = j.type;
  if (t === "system" && j.subtype === "init") {
    writeStatus({ sessionId: j.session_id, model: j.model || "cursor-agent", engine: "cursor" });
    emit({
      type: "status",
      text: j.model ? `Cursor agent · ${j.model}` : "Cursor agent session started",
    });
  } else if (t === "assistant") {
    const content = (j.message && j.message.content) || [];
    for (const c of content) {
      if (c && c.type === "text" && typeof c.text === "string" && c.text.trim()) {
        writeStatus({ lastText: c.text.slice(0, 240) });
        emit({ type: "text", text: c.text });
      }
    }
  } else if (t === "tool_call" && j.subtype === "started") {
    const tool = cursorToolFromEvent(j);
    if (tool) {
      writeStatus({ lastTool: `${tool.name} ${tool.summary}`.trim(), heartbeatAt: now() });
      emit({ type: "tool", name: tool.name, summary: tool.summary });
    }
  } else if (t === "result") {
    writeStatus({ sessionId: j.session_id });
    emit({ type: "done", text: String(j.result || "").slice(0, 800) });
  }
}

function runChild(bin, args, { onLine, cwd = REPO_ROOT }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;
    writeStatus({ claudePid: child.pid });
    let buf = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) onLine(line);
      }
    });
    child.stderr.on("data", (c) => {
      const s = c.toString("utf8");
      stderr += s;
      log.write(s);
    });
    child.on("error", (e) => {
      activeChild = null;
      resolve({ code: 1, stderr: e.message, spawnError: e.message });
    });
    child.on("close", (code) => {
      if (buf.trim()) onLine(buf.trim());
      activeChild = null;
      resolve({ code: code ?? 1, stderr });
    });
  });
}

async function runClaude() {
  writeStatus({ engine: "claude", model: "claude" });
  emit({ type: "status", text: "Claude Code started on the talking-head skill" });
  const state = { quota: false, errorText: "" };
  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    ALLOWED,
    "--append-system-prompt",
    SYSTEM,
  ];
  const { code, stderr, spawnError } = await runChild(CLAUDE, args, {
    onLine: (line) => onClaudeLine(line, state),
  });
  if (blobHasClaudeQuota(stderr) || blobHasClaudeQuota(state.errorText)) {
    state.quota = true;
    rememberClaudeQuota(0);
  }
  const err =
    spawnError ||
    state.errorText ||
    (code === 0 ? "" : `claude exited ${code}${stderr.trim() ? `: ${stderr.trim().slice(-400)}` : ""}`);
  return { code, stderr, quota: state.quota, error: err };
}

function cursorAuthHint(stderr, spawnError) {
  const s = `${spawnError || ""}\n${stderr || ""}`;
  if (/ENOENT|not found/i.test(s) && /cursor-agent/i.test(s)) {
    return "cursor-agent not found on PATH. Install with: curl https://cursor.com/install -fsS | bash";
  }
  if (/not logged in|unauthoriz|authentication|api key|CURSOR_API_KEY|401/i.test(s)) {
    return (
      "Cursor agent is not signed in. Add CURSOR_API_KEY to creator-os/.env.local " +
      "(cursor.com/dashboard/integrations) or run `cursor-agent login`, then retry. " +
      "Restart the dashboard after adding the key."
    );
  }
  return "";
}

async function runCursor(reason, resumeSessionId) {
  emit({
    type: "status",
    text:
      reason === "claude-quota"
        ? "Claude Code hit the weekly plan limit. Falling back to Cursor agent on this Mac."
        : resumeSessionId
          ? "Resuming Cursor agent session after a crash / power cut."
          : "Cursor agent started on the talking-head skill",
  });
  writeStatus({ engine: "cursor", model: CURSOR_MODEL || "cursor-agent", lastTool: "", heartbeatAt: now() });
  const continuePrompt = `${SYSTEM}

You were interrupted (power cut or model-provider drop). Continue this edit from disk. Do not redo completed steps. Do not stop until renders/final.mp4 exists at 1080x1920.

WORKDIR: ${workdir}

If audio/words.json and audio/narration.m4a exist, skip Whisper.
If renders/talking_band45.mp4 exists, skip band crop.
If render.py exists and is for this script, keep it and compose.
Then ffmpeg crf 16 + audio/narration.m4a.

When done print: DONE ${workdir}/renders/final.mp4 1080x1920`;
  const cursorPrompt = resumeSessionId ? continuePrompt : `${SYSTEM}\n\n${prompt}`;
  // cursor-agent trims trailing spaces on --workspace, and this repo folder
  // ends with a space. Point it at creator-os (no trailing space) and add
  // clone-projects so the source/output tree is in-workspace.
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--trust",
    "--force",
    "--sandbox",
    "disabled",
    "--approve-mcps",
    "--workspace",
    CREATOR_OS,
    "--add-dir",
    CLONE_ROOT,
    "--add-dir",
    workdir,
  ];
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }
  if (CURSOR_MODEL) {
    args.push("--model", CURSOR_MODEL);
  }
  args.push("--", cursorPrompt);
  const state = { provider: false, errorText: "" };
  const { code, stderr, spawnError } = await runChild(CURSOR_AGENT, args, {
    onLine: (line) => onCursorLine(line, state),
    cwd: CREATOR_OS,
  });
  const blob = `${spawnError || ""}\n${stderr || ""}\n${state.errorText || ""}`;
  const auth = cursorAuthHint(blob, spawnError);
  const provider = state.provider || blobHasProviderError(blob);
  const err =
    spawnError && !auth
      ? spawnError
      : auth
        ? auth
        : provider
          ? state.errorText || stderr.trim().slice(-400) || "Cursor provider dropped"
          : code === 0
            ? ""
            : `cursor-agent exited ${code}${stderr.trim() ? `: ${stderr.trim().slice(-400)}` : ""}`;
  return { code, stderr, error: err, provider };
}

function finishOk(engine) {
  writeStatus({
    status: "done",
    finishedAt: now(),
    error: "",
    pid: process.pid,
    engine,
  });
  emit({ type: "status", text: "final.mp4 is ready" });
  try {
    fs.unlinkSync(pidFile);
  } catch {
    /* ignore */
  }
  log.end();
  process.exit(0);
}

function finishFail(err) {
  writeStatus({
    status: "failed",
    finishedAt: now(),
    error: err || "Edit failed before final.mp4",
    pid: process.pid,
  });
  emit({
    type: "error",
    text: err || "Edit failed before final.mp4",
  });
  try {
    fs.unlinkSync(pidFile);
  } catch {
    /* ignore */
  }
  log.end();
  process.exit(1);
}

function isTransientCursorProviderError(err) {
  return blobHasProviderError(err);
}

function previousSessionId() {
  try {
    const j = JSON.parse(fs.readFileSync(statusFile, "utf8"));
    return String(j.resumeSessionId || "");
  } catch {
    return "";
  }
}

async function runCursorOrFail(reason) {
  const blocked = cursorPreflightError();
  if (blocked) return finishFail(blocked);
  const maxAttempts = 8;
  let last = { error: "" };
  let resumeId = previousSessionId();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (cancelled) return;
    if (attempt > 1) {
      const waitMs = Math.min(60_000, 8_000 * 2 ** (attempt - 2));
      emit({
        type: "status",
        text: `Cursor provider dropped. Retry ${attempt}/${maxAttempts} in ${Math.round(waitMs / 1000)}s.`,
      });
      await new Promise((r) => setTimeout(r, waitMs));
    }
    last = await runCursor(reason, resumeId);
    if (cancelled) return;
    if (hasFinal()) return finishOk("cursor");
    if (last.provider) resumeId = "";
    if (attempt < maxAttempts && (last.provider || isTransientCursorProviderError(last.error))) continue;
    return finishFail(last.error || "Cursor agent finished without final.mp4");
  }
  return finishFail(last.error || "Cursor agent finished without final.mp4");
}

async function main() {
  emit({ type: "status", text: "Edit runner started" });
  writeStatus({
    status: "running",
    pid: process.pid,
    heartbeatAt: now(),
    error: "",
    finishedAt: "",
  });
  const beat = setInterval(() => {
    if (cancelled) return;
    writeStatus({ heartbeatAt: now(), pid: process.pid });
  }, 20_000);
  beat.unref();

  if (RUNNER_PREF === "cursor") {
    return runCursorOrFail("forced");
  }

  if (RUNNER_PREF !== "claude" && claudeQuotaCached()) {
    emit({
      type: "status",
      text: "Skipping Claude Code (weekly limit still in effect). Starting Cursor agent.",
    });
    return runCursorOrFail("claude-quota");
  }

  const claude = await runClaude();
  if (cancelled) return;
  if (hasFinal()) return finishOk("claude");

  if (RUNNER_PREF !== "claude" && claude.quota) {
    return runCursorOrFail("claude-quota");
  }

  return finishFail(claude.error || "Edit failed before final.mp4");
}

function stop() {
  cancelled = true;
  killActive();
  let cur = {};
  try {
    cur = JSON.parse(fs.readFileSync(statusFile, "utf8"));
  } catch {
    /* ignore */
  }
  if (cur.status !== "cancelled") {
    writeStatus({
      status: "running",
      error: "Interrupted — will resume when Marketing OS is back",
      heartbeatAt: now(),
    });
  }
  try {
    fs.unlinkSync(pidFile);
  } catch {
    /* ignore */
  }
  process.exit(1);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

main().catch((e) => finishFail(e instanceof Error ? e.message : String(e)));
