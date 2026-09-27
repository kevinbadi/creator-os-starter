#!/usr/bin/env node
/**
 * Local host: Next.js on :3000 plus the Laya sidecar on :8000 if it is down.
 * Laya loads in the background so the dashboard is usable immediately.
 */
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const kids = [];

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" }, () => {
      s.end();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });
}

function run(cmd, args, env) {
  const child = spawn(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  kids.push(child);
  return child;
}

if (!(await portOpen(8000))) {
  console.log("[dev] starting Laya sidecar on :8000");
  const laya = run("python3", ["scripts/laya/server.py"], {
    USE_TF: "0",
    LAYA_DEVICE: process.env.LAYA_DEVICE || "mps",
  });
  laya.on("exit", (code) => {
    if (code) console.warn(`[dev] Laya sidecar exited ${code}`);
  });
} else {
  console.log("[dev] Laya already on :8000");
}

const nextBin = path.join(root, "node_modules", ".bin", "next");
const app = run(nextBin, ["dev"], {});
app.on("exit", (code) => {
  for (const k of kids) {
    if (k !== app && !k.killed) k.kill("SIGTERM");
  }
  process.exit(code ?? 0);
});

function shutdown() {
  for (const k of kids) {
    if (!k.killed) k.kill("SIGTERM");
  }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
