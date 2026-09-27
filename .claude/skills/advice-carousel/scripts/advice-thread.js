#!/usr/bin/env node
/**
 * advice-thread — Threads-only advice drop, no deck generation.
 *
 * Builds today's thread from the persona's advice template (deterministic
 * day picks via advice-carousel.js --thread-only) and publishes it through
 * advice-publish-thread.js. Text-only intro (no carousel render = no hook
 * image); the CreatorOS screenshot still rides on the integration tip.
 *
 * Exists because Threads is where Danny over-performs (avg 68 views/post on
 * 2026-07-07 vs 1 on TikTok) — this drops extra written threads without
 * doubling the expensive image pipeline. Each cron slot passes a different
 * --slot so the day's drops rotate to different series/hook combos.
 *
 * Usage:
 *   node advice-thread.js --persona danny [--slot 1] [--platforms threads] [--publish]
 *
 * Dry-run by default (the publisher prints the thread and stops).
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function arg(n) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; }
const SLUG = arg("--persona") || "danny";
const SLOT = parseInt(arg("--slot") || "0", 10) || 0;
const PLATFORMS = arg("--platforms") || "threads";
const PUBLISH = process.argv.includes("--publish");

const SCRIPTS = __dirname;
const CLAUDE_DIR = path.join(SCRIPTS, "..", "..", ".."); // .claude
const ROOT = path.join(CLAUDE_DIR, "..");                 // repo root

function run(label, script, args) {
  console.log(`[advice-thread:${SLUG}] ▶ ${label}`);
  execFileSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, PERSONA_SLUG: SLUG },
    timeout: 10 * 60 * 1000,
  });
}

run("build thread", path.join(SCRIPTS, "advice-carousel.js"), [
  "--persona", SLUG, "--thread-only", "--slot", String(SLOT),
]);

// ET date — toISOString (UTC) flips to tomorrow at 20:00 ET and would
// mislabel evening catch-up runs as the next day's.
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const threadPath = path.join(
  CLAUDE_DIR, "brand-content", SLUG, "plans",
  `${date}${SLOT ? `-s${SLOT}` : ""}-thread.json`,
);
if (!fs.existsSync(threadPath)) {
  console.error(`[advice-thread:${SLUG}] ✗ expected thread not found: ${threadPath}`);
  process.exit(1);
}

run("publish thread", path.join(SCRIPTS, "advice-publish-thread.js"), [
  "--persona", SLUG,
  "--thread", threadPath,
  "--platforms", PLATFORMS,
  ...(PUBLISH ? ["--publish"] : []),
]);
