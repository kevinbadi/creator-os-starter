import type { CloneFormat, ClonePersonaId } from "./types";

export type HeygenCharacter =
  | { type: "talking_photo"; talking_photo_id: string }
  | { type: "avatar"; avatar_id: string; avatar_style: "normal" };

export type ClonePersona = {
  id: ClonePersonaId;
  label: string;
  handle: string;
  spokenName: string;
  brandName: string;
  blurb: string;
  voiceId: string;
  verticalLookId: string;
  horizontalLookId: string;
  characterKind: "talking_photo" | "avatar";
  portraitRel: string;
  referenceRel: string;
  /** Identity strings that must NOT remain in a Megan/Danny HeyGen chunk. */
  forbiddenInChunks: string[];
};

export const CLONE_PERSONAS: Record<ClonePersonaId, ClonePersona> = {
  megan: {
    id: "megan",
    label: "Megan",
    handle: "@megan",
    spokenName: "Megan",
    brandName: "Megan Creator OS",
    blurb: "Talking-photo clone. Vertical Reels look + horizontal YouTube look.",
    voiceId: "HEYGEN_ID_6",
    verticalLookId: "HEYGEN_ID_5",
    horizontalLookId: "HEYGEN_ID_4",
    characterKind: "talking_photo",
    portraitRel: ".claude/assets/brand/megan/reference-hero.png",
    referenceRel: ".claude/assets/brand/megan/reference-hero.png",
    forbiddenInChunks: ["Kevin", "Kev", "Kyle"],
  },
  danny: {
    id: "danny",
    label: "Danny",
    handle: "@danny",
    spokenName: "Danny",
    brandName: "Danny Creator OS",
    blurb: "Talking-photo clone. Vertical Reels look + horizontal YouTube look.",
    voiceId: "HEYGEN_ID_3",
    verticalLookId: "HEYGEN_ID_2",
    horizontalLookId: "HEYGEN_ID_1",
    characterKind: "talking_photo",
    portraitRel: ".claude/assets/brand/danny/reference-hero.png",
    referenceRel: ".claude/assets/brand/danny/reference-hero.png",
    forbiddenInChunks: ["Kevin", "Kev", "Kyle"],
  },
  kevin: {
    id: "kevin",
    label: "Kevin clone",
    handle: "@kevbuildsapps",
    spokenName: "Kev",
    brandName: "Kev Builds Apps",
    blurb: "Your HeyGen avatar (not a talking photo) + cloned voice.",
    voiceId: "HEYGEN_ID_8",
    verticalLookId: "HEYGEN_ID_7",
    horizontalLookId: "HEYGEN_ID_7",
    characterKind: "avatar",
    portraitRel: ".claude/assets/brand/kev/reference-hero.jpg",
    referenceRel: ".claude/assets/brand/kev/reference-hero.jpg",
    forbiddenInChunks: [],
  },
};

export const PERSONA_IDS = Object.keys(CLONE_PERSONAS) as ClonePersonaId[];

export function isClonePersona(v: string): v is ClonePersonaId {
  return v === "megan" || v === "danny" || v === "kevin";
}

export function isCloneFormat(v: string): v is CloneFormat {
  return v === "shortform" || v === "longform";
}

export function inferFormat(url: string): CloneFormat {
  const s = url.trim();
  if (/youtube\.com\/shorts|tiktok\.com|instagram\.com\/(?:reel|reels|p)\//i.test(s)) {
    return "shortform";
  }
  if (/youtube\.com|youtu\.be/i.test(s)) return "longform";
  return "shortform";
}

export function youtubeIdFromUrl(url: string): string | null {
  const m =
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i.exec(
      url.trim(),
    );
  return m?.[1] ?? null;
}

export function heygenCharacter(p: ClonePersona, format: CloneFormat): HeygenCharacter {
  const lookId = format === "longform" ? p.horizontalLookId : p.verticalLookId;
  if (p.characterKind === "avatar") {
    return { type: "avatar", avatar_id: lookId, avatar_style: "normal" };
  }
  return { type: "talking_photo", talking_photo_id: lookId };
}

export function heygenDimension(format: CloneFormat): { width: number; height: number } {
  return format === "longform" ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
}
