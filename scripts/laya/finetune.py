#!/usr/bin/env python3
"""Fine-tune Laya on the Marketing OS tool catalog (same questions Jev answers).

Needs a GPU (Kaggle 2x T4 is what Convai published). CPU will load and dry-run.

  python3 scripts/laya/build_tool_dataset.mjs   # if jsonl missing
  python3 scripts/laya/finetune.py              # writes scripts/laya/weights/

Dataset: scripts/laya/data/mos-tools.jsonl
Recipe follows Laya's typed-decisions fine-tune (RLCD / labeled choices):
https://huggingface.co/convaiinnovations/laya
Official GPU notebook (2x T4, ~4-5h):
https://github.com/NandhaKishorM/laya/blob/main/notebooks/laya_finetune_typed_decisions_2xT4_kaggle.ipynb
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "mos-tools.jsonl"
OUT = Path(os.environ.get("LAYA_ADAPTER", ROOT / "weights"))


def load_rows():
    if not DATA.is_file():
        sys.exit(f"missing {DATA} — run: node scripts/laya/build_tool_dataset.mjs")
    rows = [json.loads(l) for l in DATA.read_text().splitlines() if l.strip()]
    print(f"dataset {len(rows)} rows from {DATA}")
    return rows


def main():
    rows = load_rows()
    os.environ.setdefault("USE_TF", "0")
    try:
        import laya
    except ImportError:
        sys.exit("pip install laya  (and a GPU torch build for a real train)")

    repo = os.environ.get("LAYA_HF_REPO", "convaiinnovations/laya")
    sub = os.environ.get("LAYA_SUBFOLDER", "typed-decisions")
    device = os.environ.get("LAYA_DEVICE", "cuda" if _cuda() else "cpu")
    print(f"base {repo}/{sub} device={device}")

    try:
        agent = laya.load(repo, subfolder=sub, device=device)
    except TypeError:
        agent = laya.load(repo, device=device)
    except Exception as e:
        print(f"typed-decisions load failed ({e}); falling back to repo root")
        agent = laya.load(repo, device=device)

    train = getattr(agent, "train", None) or getattr(agent, "finetune", None) or getattr(agent, "fit", None)
    if not callable(train) and hasattr(laya, "train"):
        train = lambda rows, **kw: laya.train(agent, rows, **kw)
    if not callable(train):
        # Official path is the published Kaggle notebook (RLCD on labeled decisions).
        # Keep the gold set + a baseline score so we can swap weights in later.
        print("this laya build has no agent.train — scoring zero-shot, then writing the set for the notebook")
        hits = 0
        n = 0
        for row in rows:
            n += 1
            try:
                pred = agent.predict(row["state"], row["questions"])
                gold = row["answers"]["tool"]["choice"]
                got = (pred.get("answers") or pred).get("tool", {}).get("choice")
                hits += int(got == gold)
            except Exception as e:
                print(f"  skip: {e}")
        print(f"zero-shot tool accuracy {hits}/{n}" + (f" = {hits/n:.2f}" if n else ""))
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / "README.txt").write_text(
            "Drop a fine-tuned checkpoint here (Laya RLCD notebook on mos-tools.jsonl).\n"
            "Then: LAYA_ADAPTER=scripts/laya/weights python3 scripts/laya/server.py\n"
        )
        (OUT / "mos-tools.jsonl").write_text(DATA.read_text())
        print(f"copied dataset → {OUT / 'mos-tools.jsonl'}")
        return

    print("training via agent.train ...")
    train(rows)
    OUT.mkdir(parents=True, exist_ok=True)
    save = getattr(agent, "save", None) or getattr(agent, "save_pretrained", None)
    if callable(save):
        save(str(OUT))
        print(f"saved weights → {OUT}")
    else:
        print("trained but no save(); keep the process alive and export manually")


def _cuda() -> bool:
    try:
        import torch
        return bool(torch.cuda.is_available())
    except Exception:
        return False


if __name__ == "__main__":
    main()
