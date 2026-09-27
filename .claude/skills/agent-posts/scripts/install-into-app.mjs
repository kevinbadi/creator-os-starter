#!/usr/bin/env node
/**
 * Copy this skill's Next.js overlay into a Creator OS / App Router project.
 * Usage: node scripts/install-into-app.mjs /path/to/app
 * Default target is cwd (must contain src/ or app/).
 * Do not run this against the original Creator OS dashboard — it replaces branded profile IDs.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetArg = process.argv[2] || process.cwd();
const srcRoot = fs.existsSync(path.join(targetArg, "src"))
  ? path.join(targetArg, "src")
  : targetArg;

const overlays = [
  ["app/dashboard/agent-posts/page.tsx", "app/dashboard/agent-posts/page.tsx"],
  ["app/api/agent-posts/route.ts", "app/api/agent-posts/route.ts"],
  ["app/api/agent-posts/rewire/route.ts", "app/api/agent-posts/rewire/route.ts"],
  ["components/AgentPostsDesk.tsx", "components/AgentPostsDesk.tsx"],
  ["components/ScheduledPostEditor.tsx", "components/ScheduledPostEditor.tsx"],
  ["components/PlatformBadge.tsx", "components/PlatformBadge.tsx"],
  ["components/PageHeader.tsx", "components/PageHeader.tsx"],
  ["components/MissingCreatorOsKey.tsx", "components/MissingCreatorOsKey.tsx"],
  ["lib/format.ts", "lib/format.ts"],
  ["lib/et-datetime.ts", "lib/et-datetime.ts"],
];

function copyFile(fromRel, toRel) {
  const from = path.join(skillRoot, fromRel);
  const to = path.join(srcRoot, toRel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`wrote ${path.relative(targetArg, to)}`);
}

if (!fs.existsSync(srcRoot)) {
  console.error(`No app at ${targetArg}`);
  process.exit(1);
}

for (const [from, to] of overlays) copyFile(from, to);

const libFrom = path.join(skillRoot, "lib/agent-posts");
const libTo = path.join(srcRoot, "lib/agent-posts");
fs.mkdirSync(libTo, { recursive: true });
for (const name of fs.readdirSync(libFrom)) {
  if (!name.endsWith(".ts")) continue;
  fs.copyFileSync(path.join(libFrom, name), path.join(libTo, name));
  console.log(`wrote ${path.relative(targetArg, path.join(libTo, name))}`);
}

const envExample = path.join(skillRoot, ".env.example");
const destEnv = path.join(targetArg, ".env.example");
if (fs.existsSync(envExample) && !fs.existsSync(path.join(targetArg, ".env.example"))) {
  fs.copyFileSync(envExample, destEnv);
  console.log("wrote .env.example");
}

const check = spawnSync(process.execPath, [path.join(skillRoot, "scripts/check-setup.mjs")], {
  cwd: targetArg,
  encoding: "utf8",
});
if (check.stdout) process.stdout.write(check.stdout);
if (check.stderr) process.stderr.write(check.stderr);
if (check.status === 2) {
  process.exit(2);
}
console.log("\nSetup looks ready. Add a sidebar link to /dashboard/agent-posts.");
