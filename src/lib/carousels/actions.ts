"use server";

import fs from "fs";
import path from "path";
import { revalidatePath } from "next/cache";

const BRAND_BASE = path.join(process.cwd(), ".claude", "brand-content");

// Only allow simple directory-name segments — no separators, no traversal.
function safeSegment(s: unknown): string | null {
  const v = String(s ?? "").trim();
  if (!v || v.length > 200) return null;
  if (v.includes("/") || v.includes("\\") || v.includes("..")) return null;
  return v;
}

/**
 * Permanently delete a generated carousel folder (slides + sidecar) from disk.
 * Sandboxed to `.claude/brand-content/{persona}/carousels/{id}` and only if it
 * actually looks like a carousel (has carousel.json).
 */
export async function deleteCarousel(
  persona: string,
  id: string,
): Promise<{ error?: string }> {
  const p = safeSegment(persona);
  const cid = safeSegment(id);
  if (!p || !cid) return { error: "Invalid carousel." };

  const dir = path.resolve(BRAND_BASE, p, "carousels", cid);
  if (dir !== BRAND_BASE && !dir.startsWith(BRAND_BASE + path.sep)) {
    return { error: "Forbidden path." };
  }
  if (!fs.existsSync(path.join(dir, "carousel.json"))) {
    return { error: "Not a carousel." };
  }

  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Delete failed." };
  }

  revalidatePath("/dashboard/carousels");
  return {};
}
