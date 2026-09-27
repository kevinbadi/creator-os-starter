#!/usr/bin/env python3
"""Native-speed HeyGen avatar. Retime the source animation/captions onto it.

Never atempo/setpts the HeyGen take — that pops the voice. Crop locked.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from difflib import SequenceMatcher
from pathlib import Path

def _workdir() -> Path:
    if len(sys.argv) > 1 and not str(sys.argv[1]).startswith("-"):
        return Path(sys.argv[1]).resolve()
    cwd = Path.cwd().resolve()
    if (cwd / "source").is_dir() or (cwd / "avatar").is_dir():
        return cwd
    return Path(__file__).resolve().parent


WORKDIR = _workdir()
SRC = WORKDIR / "source" / "video.mp4"
AVATAR_IN = WORKDIR / "avatar" / "avatar_full.mp4"
SRC_WORDS = WORKDIR / "source" / "source.json"
AV_WORDS = WORKDIR / "audio" / "avatar_full.json"
OUT = WORKDIR / "renders" / "final_clone.mp4"

import os

# Default 55/45 lock (Kevin 2026-09-14). Override per edit when the
# talking-head card starts above y=960 (e.g. Fable recut card @ ~790).
BAND_X = int(os.environ.get("CLONE_BAND_X", "12"))
BAND_Y = int(os.environ.get("CLONE_BAND_Y", "960"))
BAND_W = int(os.environ.get("CLONE_BAND_W", "1056"))
BAND_H = int(os.environ.get("CLONE_BAND_H", "960"))
BAND_ASPECT = BAND_W / BAND_H

# Hair/cap flush with the band cutoff. Override when the look sits too low.
HEAD_ZOOM = float(os.environ.get("CLONE_HEAD_ZOOM", "0.539"))
HEAD_TOP = float(os.environ.get("CLONE_HEAD_TOP", "0.159"))
WORD_WINDOW = 1


def sh(cmd: list[str]) -> None:
    if not try_sh(cmd):
        sys.exit("ffmpeg failed")


def try_sh(cmd: list[str]) -> bool:
    print("+", " ".join(str(c) for c in cmd[:8]), "..." if len(cmd) > 8 else "", flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print((r.stderr or r.stdout or "")[-1200:], flush=True)
        return False
    return True


def has_video(path: Path) -> bool:
    if not path.exists() or path.stat().st_size < 200:
        return False
    r = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
    )
    return "video" in (r.stdout or "")


def probe_dur(path: Path) -> float:
    r = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def probe_wh(path: Path) -> tuple[int, int]:
    r = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    w, h = r.stdout.strip().split(",")[:2]
    return int(w), int(h)


def cover_crop(src_w: int, src_h: int) -> tuple[int, int, int, int]:
    crop_h = max(2, int(round(src_h * HEAD_ZOOM)) & ~1)
    crop_w = max(2, int(round(crop_h * BAND_ASPECT)) & ~1)
    if crop_w > src_w:
        crop_w = src_w & ~1
        crop_h = max(2, int(round(crop_w / BAND_ASPECT)) & ~1)
    if crop_h > src_h:
        crop_h = src_h & ~1
        crop_w = max(2, int(round(crop_h * BAND_ASPECT)) & ~1)
    x0 = max(0, (src_w - crop_w) // 2) & ~1
    y0 = max(0, min(src_h - crop_h, int(round(src_h * HEAD_TOP)))) & ~1
    return crop_w, crop_h, x0, y0


def load_words(path: Path) -> list[dict]:
    data = json.loads(path.read_text())
    words: list[dict] = []
    for seg in data.get("segments") or []:
        for w in seg.get("words") or []:
            tok = re.sub(r"[^a-z0-9']", "", str(w.get("word") or "").lower())
            if not tok:
                continue
            words.append(
                {
                    "word": tok,
                    "start": float(w["start"]),
                    "end": float(w["end"]),
                    "raw": w.get("word"),
                }
            )
    return words


def align_words(src: list[dict], av: list[dict]) -> list[tuple[dict, dict]]:
    a = [w["word"] for w in src]
    b = [w["word"] for w in av]
    sm = SequenceMatcher(a=a, b=b, autojunk=False)
    pairs: list[tuple[dict, dict]] = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                pairs.append((src[i1 + k], av[j1 + k]))
        elif tag == "replace":
            n = min(i2 - i1, j2 - j1)
            for k in range(n):
                pairs.append((src[i1 + k], av[j1 + k]))
    return pairs


def windows(pairs: list[tuple[dict, dict]], orig_dur: float, av_dur: float) -> list[dict]:
    """Contiguous src/avatar spans. Output timeline is the native avatar."""
    if not pairs:
        return [{"as": 0.0, "ae": av_dur, "ss": 0.0, "se": orig_dur}]
    src_pts = [0.0]
    av_pts = [0.0]
    for i in range(0, len(pairs), WORD_WINDOW):
        s, a = pairs[i]
        if a["start"] > av_pts[-1] + 0.01 and s["start"] > src_pts[-1] + 0.01:
            src_pts.append(s["start"])
            av_pts.append(a["start"])
    if av_pts[-1] < av_dur:
        src_pts.append(orig_dur)
        av_pts.append(av_dur)
    chunks: list[dict] = []
    for i in range(len(src_pts) - 1):
        ss, se = src_pts[i], src_pts[i + 1]
        a0, a1 = av_pts[i], av_pts[i + 1]
        if se - ss < 0.04 or a1 - a0 < 0.04:
            if chunks:
                chunks[-1]["se"] = se
                chunks[-1]["ae"] = a1
            continue
        chunks.append({"ss": ss, "se": se, "as": a0, "ae": a1})
    if chunks:
        chunks[-1]["se"] = orig_dur
        chunks[-1]["ae"] = av_dur
    return chunks


def encode_v(extra: list[str], out: Path) -> bool:
    return try_sh(
        [
            "ffmpeg",
            "-y",
            *extra,
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-an",
            str(out),
        ]
    )


def hold_clip(src: Path, t: float, dur: float, vout: Path) -> None:
    if not encode_v(
        [
            "-ss",
            f"{max(0.0, t):.4f}",
            "-i",
            str(src),
            "-vf",
            "fps=30,tpad=stop_mode=clone:stop=-1",
            "-t",
            f"{dur:.4f}",
        ],
        vout,
    ) or not has_video(vout):
        sys.exit(f"hold-frame failed {vout}")


def warp_source_chunk(src: Path, chunk: dict, idx: int, tmp: Path, prev_v: Path | None) -> Path:
    """Play source [ss,se] so it fills native avatar [as,ae]. Video only."""
    sd = max(0.05, chunk["se"] - chunk["ss"])
    ad = max(0.05, chunk["ae"] - chunk["as"])
    # setpts=PTS*(out/in): in=sd of source, out=ad of avatar timeline
    rate = ad / sd
    vout = tmp / f"anim{idx:03d}.mp4"
    ok = encode_v(
        [
            "-ss",
            f"{chunk['ss']:.4f}",
            "-t",
            f"{sd:.4f}",
            "-i",
            str(src),
            "-vf",
            f"setpts=(PTS-STARTPTS)*{rate:.6f},fps=30,tpad=stop_mode=clone:stop=-1",
            "-t",
            f"{ad:.4f}",
        ],
        vout,
    )
    if not ok or not has_video(vout) or probe_dur(vout) < 0.02:
        print(f"  chunk {idx} empty after warp — holding last frame", flush=True)
        hold_src = prev_v if prev_v and has_video(prev_v) else src
        hold_t = 0.0 if hold_src == prev_v else chunk["ss"]
        hold_clip(hold_src, hold_t, ad, vout)
    return vout


def concat_list(paths: list[Path], list_path: Path) -> None:
    lines = [f"file '{p.resolve()}'" for p in paths]
    list_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def retime_animation(orig_dur: float, av_dur: float) -> Path:
    src_w = load_words(SRC_WORDS)
    av_w = load_words(AV_WORDS)
    pairs = align_words(src_w, av_w)
    chunks = windows(pairs, orig_dur, av_dur)
    print(f"anim-sync pairs={len(pairs)} chunks={len(chunks)}", flush=True)
    (WORKDIR / "source").mkdir(exist_ok=True)
    (WORKDIR / "source" / "word_sync.json").write_text(
        json.dumps(
            {"mode": "retime_source_to_avatar", "pairs": len(pairs), "chunks": chunks},
            indent=2,
        ),
        encoding="utf-8",
    )
    tmp = WORKDIR / "segments" / "anim_sync"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    parts: list[Path] = []
    for i, c in enumerate(chunks):
        print(
            f"  chunk {i} src={c['ss']:.2f}-{c['se']:.2f} -> av={c['as']:.2f}-{c['ae']:.2f}",
            flush=True,
        )
        parts.append(warp_source_chunk(SRC, c, i, tmp, parts[-1] if parts else None))
    vlist = tmp / "v.txt"
    concat_list(parts, vlist)
    timed = WORKDIR / "segments" / "source_timed_to_avatar.mp4"
    sh(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(vlist),
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-an",
            str(timed),
        ]
    )
    got = probe_dur(timed)
    if abs(got - av_dur) > 0.04:
        padded = WORKDIR / "segments" / "source_timed_to_avatar.pad.mp4"
        sh(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(timed),
                "-vf",
                "fps=30,tpad=stop_mode=clone:stop=-1",
                "-t",
                f"{av_dur:.4f}",
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-an",
                str(padded),
            ]
        )
        padded.replace(timed)
        got = probe_dur(timed)
    print(f"anim-sync out {got:.3f}s (target {av_dur:.3f}s)", flush=True)
    return timed


def main() -> None:
    if not AVATAR_IN.exists():
        sys.exit(f"missing {AVATAR_IN}")
    (WORKDIR / "audio").mkdir(exist_ok=True)
    (WORKDIR / "segments").mkdir(exist_ok=True)
    (WORKDIR / "renders").mkdir(exist_ok=True)

    orig_dur = probe_dur(SRC)
    avatar_dur = probe_dur(AVATAR_IN)
    print(f"ORIG={orig_dur:.3f} AVATAR={avatar_dur:.3f} (avatar stays 1x)", flush=True)

    timed_src = retime_animation(orig_dur, avatar_dur)

    aw, ah = probe_wh(AVATAR_IN)
    crop_w, crop_h, x0, y0 = cover_crop(aw, ah)
    print(
        f"avatar={aw}x{ah} crop=({x0},{y0},{crop_w},{crop_h}) -> {BAND_W}x{BAND_H}",
        flush=True,
    )

    zoomed = WORKDIR / "segments" / "avatar_zoomed_band.mp4"
    sh(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(AVATAR_IN),
            "-vf",
            f"crop={crop_w}:{crop_h}:{x0}:{y0},scale={BAND_W}:{BAND_H}:flags=lanczos",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-an",
            str(zoomed),
        ]
    )

    native_aac = WORKDIR / "audio" / "avatar_audio_native.aac"
    sh(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(AVATAR_IN),
            "-vn",
            "-acodec",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "44100",
            str(native_aac),
        ]
    )

    video_only = WORKDIR / "renders" / "video_only.mp4"
    r = 56
    geq_a = (
        f"if(lt(X,{r})*lt(Y,{r}),if(gt(hypot({r}-X,{r}-Y),{r}),0,255),"
        f"if(gt(X,W-{r})*lt(Y,{r}),if(gt(hypot(X-(W-{r}),{r}-Y),{r}),0,255),255))"
    )
    # Black-fill the band on the source first so the original speaker can never
    # peek through above the look (taller cards, rounded-corner alpha, etc.).
    fc = (
        f"[0:v]drawbox=x={BAND_X}:y={BAND_Y}:w={BAND_W}:h={BAND_H}:color=black:t=fill[base];"
        f"[1:v]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{geq_a}'[av];"
        f"[base][av]overlay={BAND_X}:{BAND_Y}:eof_action=repeat:format=auto"
    )
    sh(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(timed_src),
            "-i",
            str(zoomed),
            "-filter_complex",
            fc,
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-color_range",
            "tv",
            "-an",
            "-t",
            f"{avatar_dur:.4f}",
            str(video_only),
        ]
    )

    sh(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(video_only),
            "-i",
            str(native_aac),
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-t",
            f"{avatar_dur:.4f}",
            "-movflags",
            "+faststart",
            str(OUT),
        ]
    )
    print(f"DONE {OUT}", flush=True)


if __name__ == "__main__":
    main()
