#!/usr/bin/env node
/**
 * Fork / first-run gate for Agent Posts.
 * Never prints key values. Exit 0 = ready, 2 = tell the user to get a key.
 */
import fs from "node:fs";
import path from "node:path";

const KEY_NAME = "CREATOR_OS_API_KEY";
const KEY_URL = "https://www.creatoros.ca/";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function findEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    for (const name of [".env.local", ".env"]) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const envFile = findEnv();
const fromFile = envFile ? loadEnvFile(envFile) : {};
const value = String(process.env[KEY_NAME] || fromFile[KEY_NAME] || "").trim();
const placeholder = /^(paste|your[_-]?key|changeme|xxx+)?$/i.test(value);

if (!value || placeholder) {
  const prompt = `
Agent Posts needs a Creator OS API key before it can schedule posts.

Get yours at ${KEY_URL}
Sign in, copy the API key, and add it to .env.local:

${KEY_NAME}=paste_the_key_here

Use your own key. Do not copy someone else's. Do not skip this.
Tell me when it is saved and I will continue setup.
`.trim();
  console.error(prompt);
  process.exit(2);
}

console.log(`Agent Posts setup OK (${KEY_NAME} is set${envFile ? ` in ${path.basename(envFile)}` : " in the environment"}).`);
process.exit(0);
