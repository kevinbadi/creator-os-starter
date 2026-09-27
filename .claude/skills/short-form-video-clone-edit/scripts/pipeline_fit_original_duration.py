#!/usr/bin/env python3
"""Global 1x-ratio fit: speed the finished clone to the original duration.

Does not retouch the pre-fit keep file. Revert with:
  cp renders/final_clone.pre-fit.mp4 renders/final_clone.mp4
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

def _workdir() -> Path:
    if len(sys.argv) > 1 and not str(sys.argv[1]).startswith("-"):
        return Path(sys.argv[1]).resolve()
    cwd = Path.cwd().resolve()
    if (cwd / "source").is_dir() or (cwd / "renders").is_dir():
        return cwd
    return Path(__file__).resolve().parent


WORKDIR = _workdir()
SRC = WORKDIR / "source" / "video.mp4"
KEEP = WORKDIR / "renders" / "final_clone.pre-fit.mp4"
OUT = WORKDIR / "renders" / "final_clone.mp4"


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
    return float(r.stdout.strip())


def main() -> None:
    if not KEEP.exists():
        if not OUT.exists():
            sys.exit(f"missing {OUT}")
        shutil.copy2(OUT, KEEP)
        print(f"kept {KEEP}", flush=True)
    orig = probe_dur(SRC)
    cur = probe_dur(KEEP)
    print(f"KEEP={cur:.3f} ORIG={orig:.3f}", flush=True)
    if cur <= orig + 0.04:
        shutil.copy2(KEEP, OUT)
        print("already at or under original duration — copied keep as-is", flush=True)
        return
    speed = cur / orig
    tmp = OUT.with_suffix(".fit.tmp.mp4")
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(KEEP),
        "-filter_complex",
        (
            f"[0:v]setpts=(PTS-STARTPTS)*{orig / cur:.8f},fps=30,format=yuv420p[v];"
            f"[0:a]atempo={speed:.6f}[a]"
        ),
        "-map",
        "[v]",
        "-map",
        "[a]",
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
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "44100",
        "-t",
        f"{orig:.4f}",
        "-movflags",
        "+faststart",
        str(tmp),
    ]
    print("+", " ".join(cmd[:8]), "...", flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit((r.stderr or r.stdout or "")[-2000:])
    tmp.replace(OUT)
    print(f"DONE {OUT} {probe_dur(OUT):.3f}s  speed={speed:.4f}x  keep={KEEP}", flush=True)


if __name__ == "__main__":
    main()
