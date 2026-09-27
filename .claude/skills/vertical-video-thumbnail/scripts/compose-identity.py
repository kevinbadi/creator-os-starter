#!/usr/bin/env python3
"""Identity-lock Reel cover when fal.ai is gated/locked.

Kevin (or Megan) on a dark tech plate, platform logos around the head, no
video-frame screenshots. Hook text is burned by generate.mjs afterwards.
"""
from __future__ import annotations

import math
import os
import sys

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

W, H = 1080, 1920
GRID_H = 1440
GRID_TOP = (H - GRID_H) // 2  # 240


def load_rgb(path: str) -> Image.Image:
    return Image.open(path).convert("RGB")


def fit_cover(im: Image.Image, w: int, h: int, cx: float = 0.5, cy: float = 0.38) -> Image.Image:
    im = im.convert("RGB")
    src_w, src_h = im.size
    scale = max(w / src_w, h / src_h)
    nw, nh = int(src_w * scale + 0.5), int(src_h * scale + 0.5)
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = max(0, min(nw - w, int(nw * cx - w / 2)))
    top = max(0, min(nh - h, int(nh * cy - h / 2)))
    return im.crop((left, top, left + w, top + h))


def dark_bg(style_path: str | None) -> Image.Image:
    if style_path and os.path.isfile(style_path):
        bg = fit_cover(load_rgb(style_path), W, H, 0.5, 0.42)
        bg = bg.filter(ImageFilter.GaussianBlur(28))
        bg = ImageEnhance.Brightness(bg).enhance(0.28)
        bg = ImageEnhance.Color(bg).enhance(0.55)
    else:
        bg = Image.new("RGB", (W, H), (8, 8, 10))
    overlay = Image.new("RGB", (W, H), (12, 10, 8))
    return Image.blend(bg, overlay, 0.35)


def vignette(size: tuple[int, int], inner: float = 0.42) -> Image.Image:
    w, h = size
    mask = Image.new("L", (w, h), 0)
    px = mask.load()
    cx, cy = w / 2, h * 0.42
    rx, ry = w * 0.62, h * 0.58
    for y in range(h):
        for x in range(w):
            nx = (x - cx) / rx
            ny = (y - cy) / ry
            d = math.sqrt(nx * nx + ny * ny)
            if d <= inner:
                a = 255
            else:
                t = min(1.0, (d - inner) / (1.05 - inner))
                a = int(255 * (1.0 - t * t))
            px[x, y] = a
    return mask


def glyph_on_tile(logo_path: str, size: int, fill: tuple[int, int, int]) -> Image.Image:
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    r = int(size * 0.22)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=r, fill=fill)
    if fill[0] + fill[1] + fill[2] < 80:
        draw.rounded_rectangle((2, 2, size - 3, size - 3), radius=r, outline=(255, 255, 255, 220), width=3)
    if not os.path.isfile(logo_path):
        return tile
    mark = Image.open(logo_path).convert("RGBA")
    mark = ImageOps.contain(mark, (int(size * 0.58), int(size * 0.58)))
    on_white = Image.new("RGB", mark.size, (255, 255, 255))
    on_white.paste(mark, mask=mark.split()[-1])
    lum = on_white.convert("L")
    mean = sum(lum.getdata()) / max(1, lum.size[0] * lum.size[1])
    if mean >= 100:
        alpha = lum.point(lambda p: 255 if p < 90 else 0)
    else:
        on_black = Image.new("RGB", mark.size, (0, 0, 0))
        on_black.paste(mark, mask=mark.split()[-1])
        alpha = on_black.convert("L").point(lambda p: 255 if p > 40 else 0)
    glyph = Image.new("RGBA", mark.size, (255, 255, 255, 255))
    glyph.putalpha(alpha)
    x = (size - glyph.size[0]) // 2
    y = (size - glyph.size[1]) // 2
    tile.alpha_composite(glyph, (x, y))
    return tile


def paste_logo(canvas: Image.Image, tile: Image.Image, xy: tuple[int, int]) -> None:
    canvas.alpha_composite(tile, xy)


def main() -> None:
    if len(sys.argv) < 5:
        raise SystemExit("compose-identity.py identity style out logos_dir")
    identity, style, out, logos_dir = sys.argv[1:5]
    canvas = dark_bg(style).convert("RGBA")

    photo_h = GRID_TOP + GRID_H  # 1680 — fill everything above the hook plate
    face = fit_cover(load_rgb(identity), W, photo_h, 0.52, 0.34)
    face_rgba = face.convert("RGBA")
    face_rgba.putalpha(vignette((W, photo_h)))
    canvas.alpha_composite(face_rgba, (0, 0))

    tiles = [
        ("instagram.png", (70, 300), 168, (225, 48, 108)),
        ("youtube.png", (842, 320), 168, (255, 0, 0)),
        ("tiktok.png", (36, 760), 156, (16, 16, 16)),
        ("linkedin.png", (888, 790), 156, (10, 102, 194)),
    ]
    for name, xy, size, fill in tiles:
        tile = glyph_on_tile(os.path.join(logos_dir, name), size, fill)
        paste_logo(canvas, tile, xy)

    canvas.convert("RGB").save(out)


if __name__ == "__main__":
    main()
