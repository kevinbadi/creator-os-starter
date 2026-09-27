/**
 * reel-thumbnail — branded Instagram Reels cover generator (Kevin 2026-07-12).
 *
 * Layout (inspired by the viral AI-creator covers, re-themed silver/black/
 * cyan): Creator OS app icon in a tile on the LEFT, persona avatar big in
 * the MIDDLE, Claude logo in a tile on the RIGHT, two bold text lines at the
 * BOTTOM — line 1 white caps, line 2 black-on-cyan band (the reference used
 * red; cyan is the Creator OS accent).
 *
 * Usage:
 *   const { buildReelThumbnail } = require("../../lib/reel-thumbnail");
 *   await buildReelThumbnail({ persona: "megan", line1: "SCHEDULE A WEEK",
 *                              line2: "IN 20 MINUTES", out: "/tmp/cover.png" });
 *
 * Output: 1080x1920 PNG (Reels cover). Key content sits in the center-safe
 * zone so the 1:1 grid crop keeps the face + text badge.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const CLAUDE_DIR = path.join(__dirname, "..");
const BRAND = path.join(CLAUDE_DIR, "assets", "brand");
const FONTS = path.join(CLAUDE_DIR, "assets", "fonts");
const HEAD = path.join(FONTS, "Manrope-ExtraBold.ttf");
const CYAN = "0x22d3ee";

const AVATARS = {
  megan: path.join(BRAND, "creatoros", "..", "..", "..", "public", "avatars", "megan.jpg"),
  danny: path.join(CLAUDE_DIR, "..", "public", "avatars", "danny.jpg"),
  kev: path.join(CLAUDE_DIR, "..", "public", "avatars", "kev.jpg"),
  creatoros: path.join(BRAND, "creatoros", "app-icon.png"),
};
AVATARS.megan = path.join(CLAUDE_DIR, "..", "public", "avatars", "megan.jpg");

const APP_ICON = path.join(BRAND, "creatoros", "app-icon.png");
const CLAUDE_LOGO = path.join(BRAND, "claude-logo.png");
const BG_STOCK = path.join(BRAND, "creatoros", "bg-stock");

const wrap = (text, max) => {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= max) line += " " + w;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
};

function pickBg(seed = 0) {
  const files = fs.existsSync(BG_STOCK)
    ? fs.readdirSync(BG_STOCK).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort()
    : [];
  if (!files.length) return null;
  return path.join(BG_STOCK, files[seed % files.length]);
}

/** Compose the cover. line1 = white caps kicker, line2 = cyan-band payoff. */
async function buildReelThumbnail({ persona = "creatoros", line1, line2, out, bgSeed = 0 }) {
  const avatar = AVATARS[persona] ?? AVATARS.creatoros;
  if (!fs.existsSync(avatar)) throw new Error(`no avatar for ${persona}: ${avatar}`);
  const bg = pickBg(bgSeed);

  const tmp = [];
  const tf = (text) => {
    const f = path.join(os.tmpdir(), `thumb-${Date.now()}-${tmp.length}.txt`);
    fs.writeFileSync(f, text);
    tmp.push(f);
    return f;
  };

  // Text block: bottom-anchored, centered.
  const l1 = wrap((line1 || "").toUpperCase(), 16);
  const l2 = wrap((line2 || "").toUpperCase(), 14);
  const L1_SIZE = 92, L2_SIZE = 96, L1_LH = 108, L2_LH = 128;
  const blockH = l1.length * L1_LH + l2.length * L2_LH + 20;
  const textY0 = 1560 - blockH; // bottom text zone, above the ~1560 caption overlay area
  const filters = [];

  // Background: brand stock (dark teal wireframe) cover-cropped + darkened,
  // else a plain black-to-charcoal gradient.
  const inputs = ["-i", bg ?? "color=c=0x0a0a0c:s=1080x1920", "-i", avatar, "-i", APP_ICON, "-i", CLAUDE_LOGO];
  const bgChain = bg
    ? "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=brightness=-0.08:saturation=1.1,drawbox=x=0:y=0:w=1080:h=1920:color=black@0.35:t=fill"
    : "scale=1080:1920";

  // Avatar: big centered circle with a cyan ring behind it.
  const AV = 560, AVX = (1080 - AV) / 2, AVY = 360;
  // Tiles: white rounded squares carrying the logos, flanking the avatar.
  const TILE = 240, LOGO = 180;
  const LX = 60, RX = 1080 - 60 - TILE, TY = 300;

  const fc = [
    `[0:v]${bgChain}[bg]`,
    // cyan ring = filled circle slightly larger than the avatar
    `color=c=0x22d3ee:s=${AV + 24}x${AV + 24},format=rgba,geq=a='if(lte(hypot(X-${(AV + 24) / 2},Y-${(AV + 24) / 2}),${(AV + 24) / 2}),255,0)':r='r(X,Y)':g='g(X,Y)':b='b(X,Y)'[ring]`,
    `[1:v]scale=${AV}:${AV}:force_original_aspect_ratio=increase,crop=${AV}:${AV},format=rgba,geq=a='if(lte(hypot(X-${AV / 2},Y-${AV / 2}),${AV / 2}),255,0)':r='r(X,Y)':g='g(X,Y)':b='b(X,Y)'[av]`,
    // white tiles with soft rounding (alpha via superellipse-ish corner mask)
    `color=c=white:s=${TILE}x${TILE},format=rgba,geq=a='if(lte(hypot(max(abs(X-${TILE / 2})-${TILE / 2 - 44},0),max(abs(Y-${TILE / 2})-${TILE / 2 - 44},0)),44),255,0)':r=255:g=255:b=255[tileL]`,
    `color=c=white:s=${TILE}x${TILE},format=rgba,geq=a='if(lte(hypot(max(abs(X-${TILE / 2})-${TILE / 2 - 44},0),max(abs(Y-${TILE / 2})-${TILE / 2 - 44},0)),44),255,0)':r=255:g=255:b=255[tileR]`,
    `[2:v]scale=${LOGO}:${LOGO}:force_original_aspect_ratio=decrease[iconL]`,
    `[3:v]scale=${LOGO}:${LOGO}:force_original_aspect_ratio=decrease[iconR]`,
    `[bg][tileL]overlay=${LX}:${TY}[a]`,
    `[a][iconL]overlay=${LX + (TILE - LOGO) / 2}:${TY + (TILE - LOGO) / 2}[b]`,
    `[b][tileR]overlay=${RX}:${TY}[c]`,
    `[c][iconR]overlay=${RX + (TILE - LOGO) / 2}:${TY + (TILE - LOGO) / 2}[d]`,
    `[d][ring]overlay=${AVX - 12}:${AVY - 12}[e]`,
    `[e][av]overlay=${AVX}:${AVY}[f]`,
  ];

  // Text: line1 white with black outline; line2 black on cyan boxes.
  let cursor = textY0;
  const textFilters = [];
  for (const l of l1) {
    textFilters.push(
      `drawtext=fontfile='${HEAD}':textfile='${tf(l)}':fontsize=${L1_SIZE}:fontcolor=white:borderw=8:bordercolor=black:x=(w-text_w)/2:y=${cursor}`,
    );
    cursor += L1_LH;
  }
  cursor += 8;
  for (const l of l2) {
    textFilters.push(
      `drawtext=fontfile='${HEAD}':textfile='${tf(l)}':fontsize=${L2_SIZE}:fontcolor=black:box=1:boxcolor=${CYAN}:boxborderw=18:x=(w-text_w)/2:y=${cursor}`,
    );
    cursor += L2_LH;
  }
  fc.push(`[f]${textFilters.join(",")}[outv]`);

  const args = bg
    ? ["-y", ...inputs, "-filter_complex", fc.join(";"), "-map", "[outv]", "-frames:v", "1", out]
    : ["-y", "-f", "lavfi", ...inputs, "-filter_complex", fc.join(";"), "-map", "[outv]", "-frames:v", "1", out];
  execFileSync("ffmpeg", args, { stdio: "pipe", timeout: 120000 });
  for (const t of tmp) fs.unlinkSync(t);
  return out;
}

module.exports = { buildReelThumbnail };
