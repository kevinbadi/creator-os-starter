import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO_ROOT } from "./paths";

function hasHeygenServer(raw: string): boolean {
  try {
    const j = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    const servers = j.mcpServers ?? {};
    return Object.keys(servers).some((k) => k.toLowerCase() === "heygen");
  } catch {
    return false;
  }
}

/** True when HeyGen Remote MCP is configured (OAuth / plan credits). */
export function heygenMcpConfigured(): boolean {
  const files = [
    path.join(REPO_ROOT, ".mcp.json"),
    path.join(os.homedir(), ".cursor", "mcp.json"),
  ];
  for (const file of files) {
    try {
      if (hasHeygenServer(fs.readFileSync(file, "utf8"))) return true;
    } catch {
      /* missing file */
    }
  }
  return false;
}
