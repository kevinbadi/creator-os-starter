export type CopySkill = "shortform" | "longform";

export const SHORTFORM_SKILL = "copywriter-shortform-kevin";
export const LONGFORM_SKILL = "copywriter-longform-kevin";

/** Instagram reels and anything under 3 minutes use the short-form voice.
 *  YouTube and longer cuts use the long-form YouTube voice. */
export function skillForSource(s: { url: string; durationSec: number | null }): CopySkill {
  if (/youtube\.com|youtu\.be/i.test(s.url)) return "longform";
  if (s.durationSec != null && s.durationSec >= 180) return "longform";
  return "shortform";
}

export function skillDirName(skill: CopySkill): string {
  return skill === "longform" ? LONGFORM_SKILL : SHORTFORM_SKILL;
}

export function skillLabel(skill: CopySkill): string {
  return skill === "longform" ? "long-form" : "short-form";
}
