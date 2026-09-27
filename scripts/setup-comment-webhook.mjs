#!/usr/bin/env node
// Register / update the Zernio webhook → Marketing OS dashboard.
// Pairs with src/app/api/zernio/webhook/route.ts (HMAC-verified receiver).
//
// Subscribes to comment.received (CTA replies) plus post lifecycle events so
// comments-to-DM can attach the moment a scheduled post goes live.
// Existing events on the same URL (e.g. message.received) are preserved.
//
// REQUIRES the Zernio Inbox addon (registration for comment.received is gated:
// "feature_not_available" without it).
//
// Usage:
//   node scripts/setup-comment-webhook.mjs [--url <receiver-url>] [--apply]

import path from "node:path";
import process from "node:process";

process.loadEnvFile(path.join(import.meta.dirname, "..", ".env.local"));

const ZERNIO_BASE = process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1";
const DEFAULT_URL =
  "https://your-app.up.railway.app/api/zernio/webhook";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const APPLY = process.argv.includes("--apply");
const url = arg("--url", DEFAULT_URL);

const secret = process.env.ZERNIO_WEBHOOK_SECRET;
if (!secret) throw new Error("ZERNIO_WEBHOOK_SECRET not set in .env.local");

const EVENTS = [
  "comment.received",
  "post.published",
  "post.partial",
  "post.platform.published",
  "post.platform.failed",
  "post.failed",
  "post.cancelled",
];

const headers = {
  Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`,
  "Content-Type": "application/json",
};

async function listWebhooks() {
  const res = await fetch(`${ZERNIO_BASE}/webhooks/settings`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`\n✗ List webhooks ${res.status}: ${JSON.stringify(data)}`);
    return [];
  }
  const list = data.webhooks ?? data.data ?? (Array.isArray(data) ? data : []);
  return Array.isArray(list) ? list : [];
}

function sameUrl(a, b) {
  try {
    return new URL(a).href.replace(/\/$/, "") === new URL(b).href.replace(/\/$/, "");
  } catch {
    return a === b;
  }
}

const existing = await listWebhooks();
const match = existing.find((w) => w.url && sameUrl(w.url, url));
const events = [...new Set([...(match?.events ?? []), ...EVENTS])];

const payload = {
  name: "Marketing OS — comment CTA",
  url,
  secret,
  events,
  isActive: true,
};

console.log("\n=== ZERNIO WEBHOOK REGISTRATION ===");
console.log(JSON.stringify({ ...payload, secret: "<from .env.local>" }, null, 2));

if (match) {
  console.log(
    `\nExisting webhook ${match._id ?? match.id} already points at this URL.`,
  );
  console.log(`Current events: ${(match.events ?? []).join(", ") || "(none)"}`);
  console.log(`Merged events:  ${events.join(", ")}`);
}

if (!APPLY) {
  console.log("\n[DRY RUN] Nothing registered. Re-run with --apply.");
  process.exit(0);
}

const res = match
  ? await fetch(`${ZERNIO_BASE}/webhooks/settings`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        _id: match._id ?? match.id,
        events,
        isActive: true,
        url,
      }),
    })
  : await fetch(`${ZERNIO_BASE}/webhooks/settings`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`\n✗ Zernio ${res.status}: ${JSON.stringify(data)}`);
  if (data.code === "feature_not_available") {
    console.error("→ comment.received webhooks need the Inbox addon on the Zernio account.");
  }
  process.exit(1);
}
const id = data.webhook?._id ?? data.webhook?.id ?? match?._id ?? match?.id;
console.log(`\n✓ Webhook ${match ? "updated" : "registered"}: ${id}`);
console.log("→ Verify delivery with POST /v1/webhooks/test once the route is deployed.");
