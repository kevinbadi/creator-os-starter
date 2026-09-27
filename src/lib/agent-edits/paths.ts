import "server-only";
import fs from "node:fs";
import path from "node:path";

/** Repo root (parent of creator-os). Skills, clone-projects, CLAUDE.md live here. */
export const REPO_ROOT = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
export const CREATOR_OS = /*turbopackIgnore: true*/ process.cwd();
export const CLONE_ROOT = path.join(/*turbopackIgnore: true*/ REPO_ROOT, "clone-projects");
export const SKILL_DIR = path.join(
  /*turbopackIgnore: true*/ CREATOR_OS,
  ".claude",
  "skills",
  "split-animated-talking-head",
);
export const SKILL_MD = path.join(SKILL_DIR, "SKILL.md");
export const RUNNER_SCRIPT = path.join(CREATOR_OS, "scripts", "agent-edits-run.mjs");

export const WORKFLOW_ID = "split-animated-talking-head" as const;

export function workdirFor(slug: string): string {
  return path.join(CLONE_ROOT, slug);
}

export function slugifyName(raw: string): string {
  const base = raw
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const stem = base || "talking-head";
  return stem.endsWith("-animated") ? stem : `${stem}-animated`;
}

export function uniqueSlug(desired: string): string {
  if (!fs.existsSync(workdirFor(desired))) return desired;
  const stamp = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date())
    .replace(/[/,]/g, "-")
    .replace(/,?\s+/g, "-")
    .replace(/:/g, "");
  const next = `${desired.replace(/-animated$/, "")}-${stamp}-animated`;
  if (!fs.existsSync(workdirFor(next))) return next;
  return `${desired.replace(/-animated$/, "")}-${Date.now()}-animated`;
}

export function humanizeSlug(slug: string): string {
  return slug
    .replace(/-animated$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

const ALLOWED_REL = new Set([
  "renders/final.mp4",
  "renders/talking_band45.mp4",
  "source/talking_head.mp4",
]);

export type MediaKind = "final" | "band" | "poster" | "clip";

export function mediaPath(workdir: string, kind: MediaKind): string | null {
  if (kind === "final") return path.join(workdir, "renders", "final.mp4");
  if (kind === "band") return path.join(workdir, "renders", "talking_band45.mp4");
  if (kind === "clip") {
    const source = path.join(workdir, "source");
    if (!fs.existsSync(source)) return null;
    const named = ["input.mp4", "input.mov", "input.m4v", "input.webm", "talking_head.mp4"]
      .map((n) => path.join(source, n))
      .find((p) => fs.existsSync(p));
    if (named) return named;
    const first = fs.readdirSync(source).find((n) => /\.(mp4|mov|m4v|webm)$/i.test(n));
    return first ? path.join(source, first) : null;
  }
  const posters = [
    path.join(workdir, "frames", "out5", "f00001.jpg"),
    path.join(workdir, "frames", "out5", "f00000.jpg"),
    path.join(workdir, "frames", "f00001.jpg"),
    path.join(workdir, "frames", "f00000.jpg"),
  ];
  return posters.find((p) => fs.existsSync(p)) ?? null;
}

export function artifacts(workdir: string): {
  hasFinal: boolean;
  hasBand: boolean;
  hasPoster: boolean;
  hasClip: boolean;
  finalBytes: number;
  finalMtime: number | null;
} {
  const final = mediaPath(workdir, "final");
  const band = mediaPath(workdir, "band");
  const poster = mediaPath(workdir, "poster");
  const clip = mediaPath(workdir, "clip");
  let finalBytes = 0;
  let finalMtime: number | null = null;
  if (final && fs.existsSync(final)) {
    const st = fs.statSync(final);
    finalBytes = st.size;
    finalMtime = st.mtimeMs;
  }
  return {
    hasFinal: Boolean(final && fs.existsSync(final) && finalBytes > 0),
    hasBand: Boolean(band && fs.existsSync(band)),
    hasPoster: Boolean(poster && fs.existsSync(poster)),
    hasClip: Boolean(clip && fs.existsSync(clip)),
    finalBytes,
    finalMtime,
  };
}

export function ensureWorkdir(slug: string): string {
  const dir = workdirFor(slug);
  for (const sub of ["source", "audio", "renders", "frames", "assets"]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  return dir;
}

export function resolveInsideWorkdir(workdir: string, rel: string): string | null {
  const abs = path.resolve(workdir, rel);
  if (abs !== workdir && !abs.startsWith(workdir + path.sep)) return null;
  if (!ALLOWED_REL.has(rel.replaceAll("\\", "/")) && !rel.startsWith("frames/")) return null;
  return abs;
}

export function statusPath(workdir: string): string {
  return path.join(workdir, "agent-status.json");
}

export function progressPath(workdir: string): string {
  return path.join(workdir, "agent-progress.jsonl");
}

export function promptPath(workdir: string): string {
  return path.join(workdir, "agent-prompt.md");
}

export function pidPath(workdir: string): string {
  return path.join(workdir, "agent.pid");
}
