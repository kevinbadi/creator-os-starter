import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { CloneFormat, ClonePersonaId } from "./types";

export const REPO_ROOT = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
export const CREATOR_OS = /*turbopackIgnore: true*/ process.cwd();
export const CLONE_ROOT = path.join(/*turbopackIgnore: true*/ REPO_ROOT, "clone-projects");
export const SKILLS_ROOT = path.join(/*turbopackIgnore: true*/ CREATOR_OS, ".claude", "skills");
export const RUNNER_SCRIPT = path.join(CREATOR_OS, "scripts", "agent-clones-run.mjs");

export const SHORTFORM_SKILL = "short-form-video-clone-edit";
export const LONGFORM_SKILL = "longform-video-clone-edit";
export const MEGAN_LONGFORM_SKILL = "megan-longform-clone";
export const DANNY_LONGFORM_SKILL = "danny-longform-clone";

export function skillDir(name: string): string {
  return path.join(SKILLS_ROOT, name);
}

export function skillMd(name: string): string {
  return path.join(skillDir(name), "SKILL.md");
}

export function workdirFor(slug: string): string {
  return path.join(CLONE_ROOT, slug);
}

export function slugifyName(raw: string): string {
  const base = raw
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "clone";
}

export function uniqueSlug(desired: string, persona: ClonePersonaId): string {
  const stem = desired.replace(new RegExp(`-${persona}$`), "");
  const first = `${stem}-${persona}`;
  if (!fs.existsSync(workdirFor(first))) return first;
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
  const next = `${stem}-${stamp}-${persona}`;
  if (!fs.existsSync(workdirFor(next))) return next;
  return `${stem}-${Date.now()}-${persona}`;
}

export function humanizeSlug(slug: string): string {
  return slug
    .replace(/-(megan|danny|kevin|kev)$/i, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export type MediaKind = "final" | "preview" | "poster" | "clip";

function firstExisting(paths: string[]): string | null {
  return paths.find((p) => fs.existsSync(p) && fs.statSync(p).isFile()) ?? null;
}

export function mediaPath(workdir: string, kind: MediaKind): string | null {
  if (kind === "final") {
    return firstExisting([
      path.join(workdir, "renders", "final_clone.mp4"),
      path.join(workdir, "renders", "final.mp4"),
    ]);
  }
  if (kind === "preview") {
    return firstExisting([
      path.join(workdir, "renders", "preview_640p.mp4"),
      path.join(workdir, "renders", "telegram_preview.mp4"),
      path.join(workdir, "renders", "final_clone.mp4"),
      path.join(workdir, "renders", "final.mp4"),
    ]);
  }
  if (kind === "clip") {
    const source = path.join(workdir, "source");
    if (!fs.existsSync(source)) return null;
    const named = ["video.mp4", "input.mp4", "input.mov", "input.m4v", "input.webm"]
      .map((n) => path.join(source, n))
      .find((p) => fs.existsSync(p));
    if (named) return named;
    const first = fs.readdirSync(source).find((n) => /\.(mp4|mov|m4v|webm)$/i.test(n));
    return first ? path.join(source, first) : null;
  }
  return firstExisting([
    path.join(workdir, "renders", "thumbnail.jpg"),
    path.join(workdir, "renders", "thumbnail.png"),
    path.join(workdir, "source", "thumbnail.jpg"),
    path.join(workdir, "source", "maxresdefault.jpg"),
    path.join(workdir, "frames", "poster.jpg"),
  ]);
}

export function artifacts(workdir: string): {
  hasFinal: boolean;
  hasPreview: boolean;
  hasPoster: boolean;
  hasClip: boolean;
  finalBytes: number;
  finalMtime: number | null;
} {
  const final = mediaPath(workdir, "final");
  const preview = mediaPath(workdir, "preview");
  const poster = mediaPath(workdir, "poster");
  const clip = mediaPath(workdir, "clip");
  let finalBytes = 0;
  let finalMtime: number | null = null;
  if (final) {
    const st = fs.statSync(final);
    finalBytes = st.size;
    finalMtime = st.mtimeMs;
  }
  return {
    hasFinal: Boolean(final && finalBytes > 1000),
    hasPreview: Boolean(preview && preview !== final),
    hasPoster: Boolean(poster),
    hasClip: Boolean(clip),
    finalBytes,
    finalMtime,
  };
}

export function ensureWorkdir(slug: string, format: CloneFormat): string {
  const dir = workdirFor(slug);
  const subs =
    format === "longform"
      ? ["source", "avatar", "segments", "frames", "renders", "audio"]
      : ["source", "segments", "avatar", "audio", "renders", "frames"];
  for (const sub of subs) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  return dir;
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

export function personaFromSlug(slug: string): ClonePersonaId | null {
  if (slug.endsWith("-megan")) return "megan";
  if (slug.endsWith("-danny")) return "danny";
  if (slug.endsWith("-kevin") || slug.endsWith("-kev")) return "kevin";
  return null;
}
