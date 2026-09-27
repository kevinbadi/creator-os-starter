#!/usr/bin/env python3
"""Neon-blue contact sheet for a Jev vault answer, popped in Quick Look.

Claude Code paints hook answers in its own colour and cannot show images, so
the jev-router hook hands the media rows to this script (JSON on stdin) and it
renders the actual files (images, video poster frames) into one PNG and opens
it with Quick Look over the terminal (Kevin 2026-09-20: "it would be so sick
if the terminal can show the image / first frame of the video").

stdin: {"title": str, "vault": "/abs/vault/dir", "rows": [{name, brand, kind, file, poster, duration}]}
"""
import json
import os
import subprocess
import sys
import time

from PIL import Image, ImageDraw, ImageFont

BLUE = (57, 220, 255)
INK = (8, 14, 20)
CARD = (12, 26, 36)
SILVER = (190, 205, 215)
TILE = 300
PAD = 22
COLS = 4
MAX = 16


def font(size, bold=False):
    for p in [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def load_media(vault, row):
    rel = row.get("poster") or row.get("file") or ""
    p = os.path.join(vault, rel)
    if rel.lower().endswith((".mp4", ".mov", ".m4v", ".webm")):
        # no poster filed: grab the first frame now
        tmp = f"/tmp/vault-sheet-{abs(hash(rel))}.jpg"
        if not os.path.exists(tmp):
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "1", "-i", p, "-frames:v", "1", "-vf", "scale=640:-2", tmp], capture_output=True)
        p = tmp
    try:
        return Image.open(p).convert("RGBA")
    except Exception:
        return None


def main():
    data = json.load(sys.stdin)
    vault = data.get("vault", "")
    rows = (data.get("rows") or [])[:MAX]
    if not rows or not vault:
        return
    cols = min(COLS, len(rows))
    rws = (len(rows) + cols - 1) // cols
    W = PAD + cols * (TILE + PAD)
    H = 96 + rws * (TILE + 64 + PAD) + PAD
    img = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 6], fill=BLUE)
    d.text((PAD, 22), "OBSIDIAN  ·  MARKETING OS BROLL", font=font(15, True), fill=BLUE)
    title = data.get("title", "")
    d.text((PAD, 46), title[:110], font=font(22, True), fill=(235, 245, 250))
    y0 = 96
    for i, row in enumerate(rows):
        cx = PAD + (i % cols) * (TILE + PAD)
        cy = y0 + (i // cols) * (TILE + 64 + PAD)
        d.rounded_rectangle([cx, cy, cx + TILE, cy + TILE + 60], 18, fill=CARD, outline=BLUE + (), width=2)
        im = load_media(vault, row)
        if im is not None:
            im.thumbnail((TILE - 24, TILE - 24))
            # checker for transparent logos so white marks stay visible
            bg = Image.new("RGBA", im.size, (28, 44, 56, 255))
            bg.alpha_composite(im)
            img.paste(bg.convert("RGB"), (cx + (TILE - im.width) // 2, cy + 12 + (TILE - 24 - im.height) // 2))
        else:
            d.text((cx + 20, cy + TILE // 2), "(no preview)", font=font(16), fill=SILVER)
        name = str(row.get("name", ""))
        if len(name) > 30:
            name = name[:29] + "…"
        d.text((cx + 14, cy + TILE + 8), name, font=font(16, True), fill=BLUE)
        sub = f"{row.get('brand', '')} · {row.get('kind', '')}"
        if row.get("duration"):
            sub += f" · video {row['duration']}"
        d.text((cx + 14, cy + TILE + 32), sub[:44], font=font(13), fill=SILVER)
    out = f"/tmp/jev-vault-sheet-{int(time.time())}.png"
    img.save(out)
    # Quick Look floats over the terminal; space closes it
    subprocess.Popen(["qlmanage", "-p", out], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # never break the hook
        sys.stderr.write(f"vault-sheet: {e}\n")
