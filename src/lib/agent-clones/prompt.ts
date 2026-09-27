import "server-only";
import path from "node:path";
import {
  CREATOR_OS,
  DANNY_LONGFORM_SKILL,
  LONGFORM_SKILL,
  MEGAN_LONGFORM_SKILL,
  SHORTFORM_SKILL,
  skillMd,
} from "./paths";
import { CLONE_PERSONAS, heygenCharacter, heygenDimension } from "./personas";
import type { CloneFormat, ClonePersonaId } from "./types";

export function buildClonePrompt(opts: {
  workdir: string;
  clipPath: string | null;
  notes: string;
  sourceUrl: string;
  title: string;
  persona: ClonePersonaId;
  format: CloneFormat;
}): string {
  const p = CLONE_PERSONAS[opts.persona];
  const format = opts.format;
  const notes = opts.notes.trim() || "(none)";
  const url = opts.sourceUrl.trim() || "(none)";
  const clip = opts.clipPath?.trim() || "(none — download from the source URL)";
  const character = heygenCharacter(p, format);
  const dim = heygenDimension(format);
  const lookId =
    character.type === "talking_photo" ? character.talking_photo_id : character.avatar_id;

  const shortformSkills = `Read this skill first and follow it, ignoring the Nick Saraev avatar IDs in it — use the persona constants below instead:
${skillMd(SHORTFORM_SKILL)}`;

  const longformSkills =
    opts.persona === "megan"
      ? `Read the persona wrapper first (locked v2 pipeline), then the engine skill:
${skillMd(MEGAN_LONGFORM_SKILL)}
${skillMd(LONGFORM_SKILL)}`
      : opts.persona === "danny"
        ? `Read the persona wrapper first (locked v2 pipeline), then the engine skill:
${skillMd(DANNY_LONGFORM_SKILL)}
${skillMd(LONGFORM_SKILL)}`
        : `Read this skill and run it with the Kevin clone constants below:
${skillMd(LONGFORM_SKILL)}`;

  const identity =
    opts.persona === "kevin"
      ? `Persona-swap the ORIGINAL speaker's first-person identity to ${p.spokenName} / ${p.brandName}. Keep product names, URLs, and tutorial facts. If the source already is Kevin, do not rename him to anyone else.`
      : `PERSONA SWAP (never skip): Kevin/Kev Builds Apps → ${p.brandName}; Kevin/Kev (+possessives) → ${p.spokenName}. Also scrub YouTube mishears like "Kyle". IDENTITY GUARD: refuse to submit any HeyGen chunk still matching /\\b(kev(in)?|kyle)\\b/i. Product names, URLs, and "this channel" stay.`;

  const aspect =
    format === "longform"
      ? "16:9 (1920×1080). Deliver renders/final_clone.mp4. Optional 720p preview at renders/preview_640p.mp4."
      : "9:16 (1080×1920). Deliver renders/final_clone.mp4 (or renders/final.mp4).";

  return `Run a HeyGen face+script clone to completion. This is a Marketing OS Agent Video Cloning job, not a chat. Do not wait for follow-up. Do not stop until the final mp4 exists at ${opts.workdir}/renders/final_clone.mp4 (or renders/final.mp4).

${format === "longform" ? longformSkills : shortformSkills}

WORKDIR (create/use this project; all outputs land here):
${opts.workdir}

PERSONA: ${p.label} (${p.handle})
FORMAT: ${format} — ${aspect}

HeyGen constants (OVERRIDE anything in the skill files):
- MCP create_video: type "avatar", avatar_id "${lookId}" (this look id — not a group id)
- If the source is a 55/45 split (graphics on top, 1056×960 talking-head band on the bottom), use the HORIZONTAL look instead: avatar_id "${p.horizontalLookId}", aspect_ratio 16:9. Cover-crop that 16:9 take into the band with the head flush to the top (hair/cap at the cutoff — same height as the original talking head). Do not use the vertical 9:16 talking-photo for the band.
- voice_id: ${p.voiceId}
- script: the persona-swapped transcript (MCP field name is script, not input_text)
- aspect_ratio: ${format === "longform" ? "16:9" : "9:16"}
- dimension: ${JSON.stringify(dim)}
- legacy character shape (do not curl this): ${JSON.stringify(character)}
- reference image: ${path.join(CREATOR_OS, p.referenceRel)}

SOURCE VIDEO:
${clip}

Source URL (download with yt-dlp, or Apify for Instagram reels — yt-dlp cannot fetch IG):
${url}

Title / slug hint: ${opts.title}

Kevin's notes:
${notes}

Script rules:
- Transcribe the source (YouTube captions first for longform; Whisper fallback).
- ${identity}
- The clone speaks as ${p.spokenName}. Replace the original face with this HeyGen look on every talking-head / PIP webcam beat. Preserve B-roll, screen recordings, and sound design structure. Mux AVATAR audio, never source voice, for lip sync.
- Do not atempo the HeyGen take. Retime the source animation/captions onto the clone's word timestamps, overlay the look, then if the master is longer than the source, globally speed the whole mux (one atempo) to the original duration. Copy the compositor scripts from the skill's scripts/ folder and run them from the workdir.

Hard locks:
- HeyGen submits go through HeyGen MCP only (OAuth, plan credits). Tools: create_video_from_avatar, get_video. Do not curl api.heygen.com. Do not use HEYGEN_API_KEY. Do not source .env.local for HeyGen. If MCP is unauthenticated, stop and say so — never fall back to the API key.
- Dates are ET. No em/en dashes in on-screen UGC text.
- fal.ai HARD STOP: do not call fal.ai (thumbnails, face-swap frames). Skip optional fal steps. Do not widen FAL_ALLOW.
- Do not publish to Zernio / socials. Stop at the local master.
- HeyGen 4000-char limit: chunk ≤3800 at sentence boundaries for longform.
- Shortform: copy and run the skill scripts (pipeline_composite_ffmpeg.py then pipeline_fit_original_duration.py). Full-frame 9:16 → ~4x crop then scale to 1080×1920. 55/45 split band (1056×960) → horizontal 16:9 look, crop at that aspect, head flush to the top of the band (HEAD_ZOOM=0.539 HEAD_TOP=0.159 → crop=640:582:640:172, never stretch 9:16 into the band). Always overlay the avatar on the band for the full duration — never gate on face ranges. Keep the HeyGen take at 1x (no per-window atempo — it pops). Retime source animation/captions onto clone Whisper words. Mux native avatar audio. Then globally fit the finished master to the original duration (one atempo). Encode yuv420p + faststart so the dashboard player can load it.

When the master exists, print one line:
DONE ${opts.workdir}/renders/final_clone.mp4
Then stop.`;
}
