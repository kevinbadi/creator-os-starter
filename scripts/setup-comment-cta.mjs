#!/usr/bin/env node
// Set up the "comment OS → DM the app link" automation for a persona via
// Zernio's native comment-to-DM API (POST /v1/comment-automations).
//
// Account-wide on the persona's Instagram: any comment that is exactly the
// keyword triggers (1) a DM with a tracked link button to the App Store and
// (2) a public reply pointing at the DM. Instagram + Facebook only — Zernio
// cannot auto-reply on TikTok.
//
// REQUIRES the Zernio Inbox addon (API returns INBOX_REQUIRED without it).
//
// Usage:
//   node scripts/setup-comment-cta.mjs [--persona megan] [--keyword OS] [--apply]
//
// Dry-run by default: prints the payload without creating anything.

import { Pool } from "pg";
import path from "node:path";
import process from "node:process";

process.loadEnvFile(path.join(import.meta.dirname, "..", ".env.local"));

const ZERNIO_BASE = process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1";
const APP_STORE_URL = "https://your-app.up.railway.app/go/comment-dm";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const APPLY = process.argv.includes("--apply");
const slug = arg("--persona", "megan");
const keyword = arg("--keyword", "OS");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const { rows } = await pool.query("select * from personas where slug = $1", [slug]);
await pool.end();
if (!rows.length) throw new Error(`Persona '${slug}' not found`);
const p = rows[0];
const igAccountId = p.accounts?.instagram;
if (!igAccountId) throw new Error(`Persona '${slug}' has no instagram account id`);

const payload = {
  profileId: p.zernio_profile_id,
  accountId: igAccountId,
  trigger: "comment",
  // No platformPostId → account-wide: every post/reel/carousel on the account.
  name: `${p.name} — comment "${keyword}" → Creator OS link`,
  keywords: [keyword],
  // exact, not contains: "os" as a substring would false-trigger on words
  // like "most"/"photos". Widen with explicit variants if needed.
  matchMode: "exact",
  dmMessage:
    `hey, it's ${p.name} 🤍 here's the app I run everything from — ` +
    `tap below to grab Creator OS:`,
  buttons: [{ type: "url", title: "Get Creator OS", url: APP_STORE_URL }],
  commentReply: "just sent it to your DMs 🤍",
  linkTracking: true,
  clickTag: "creator-os-click",
};

console.log(`\n=== COMMENT CTA SETUP (${p.name} / @instagram ${igAccountId}) ===`);
console.log(JSON.stringify(payload, null, 2));

if (!APPLY) {
  console.log("\n[DRY RUN] Nothing created. Re-run with --apply to create the automation.");
  process.exit(0);
}

const res = await fetch(`${ZERNIO_BASE}/comment-automations`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});
const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`\n✗ Zernio ${res.status}: ${JSON.stringify(data)}`);
  if (data.code === "INBOX_REQUIRED") {
    console.error("→ The Zernio account needs the Inbox addon before this API works.");
  }
  process.exit(1);
}
console.log(`\n✓ Automation created: ${data.automation?.id}`);
console.log(`  Active: ${data.automation?.isActive}  Keywords: ${data.automation?.keywords?.join(", ")}`);
