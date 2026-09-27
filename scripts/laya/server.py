#!/usr/bin/env python3
"""Laya evaluate sidecar — same /evaluate contract as laya-decision-brain.

Loads the Apache-2.0 checkpoint (typed-decisions if present, else English root)
and optional fine-tuned weights from scripts/laya/weights/.

  cd creator-os && python3 -m pip install 'laya' fastapi uvicorn
  LAYA_DEVICE=cpu python3 scripts/laya/server.py          # local
  LAYA_DEVICE=cuda python3 scripts/laya/server.py         # GPU

Hugging Face: https://huggingface.co/convaiinnovations/laya
Lab: https://github.com/kevinbadi/laya-decision-brain
"""
from __future__ import annotations

import os
import threading
from typing import Any

import laya
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

REPO = os.environ.get("LAYA_HF_REPO", "convaiinnovations/laya")
SUB = os.environ.get("LAYA_SUBFOLDER", "typed-decisions")
DEVICE = os.environ.get("LAYA_DEVICE", "cpu")
ADAPTER = os.environ.get("LAYA_ADAPTER", "")
HOST = os.environ.get("LAYA_HOST", "127.0.0.1")
PORT = int(os.environ.get("LAYA_PORT", "8000"))

os.environ.setdefault("USE_TF", "0")

app = FastAPI(title="Laya · Marketing OS tools")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

_lock = threading.Lock()
_agent = None
_label = REPO


def load_agent():
    global _agent, _label
    kwargs: dict[str, Any] = {}
    if DEVICE:
        kwargs["device"] = DEVICE
    if SUB:
        try:
            _agent = laya.load(REPO, subfolder=SUB, **kwargs)
            _label = f"{REPO}/{SUB}"
        except TypeError:
            _agent = laya.load(REPO, **kwargs)
            _label = REPO
        except Exception:
            _agent = laya.load(REPO, **kwargs)
            _label = REPO
    else:
        _agent = laya.load(REPO, **kwargs)
        _label = REPO
    # Stay under Laya's option-token budget for 12 tools + 22 ranges.
    cfg = getattr(_agent, "cfg", None)
    if isinstance(cfg, dict):
        cfg["head_max_len"] = int(os.environ.get("LAYA_HEAD_MAX_LEN", "256"))
        cfg["max_len"] = int(os.environ.get("LAYA_MAX_LEN", "1024"))
    if ADAPTER and os.path.isdir(ADAPTER):
        load_fn = getattr(_agent, "load_adapter", None) or getattr(_agent, "load", None)
        if callable(load_fn) and load_fn is not laya.load:
            try:
                load_fn(ADAPTER)
                _label = f"{_label}+adapter"
            except Exception as e:
                print(f"[laya] adapter not applied: {e}")
    print(f"[laya] ready {_label} device={getattr(_agent, 'device', DEVICE)}")


class EvaluateReq(BaseModel):
    state: Any
    questions: dict[str, dict[str, Any]]


@app.on_event("startup")
def _startup():
    load_agent()


@app.get("/health")
def health():
    return {"status": "ok" if _agent is not None else "loading", "model": _label}


@app.post("/evaluate")
def evaluate(req: EvaluateReq):
    if _agent is None:
        raise HTTPException(status_code=503, detail="model not loaded")
    try:
        with _lock:
            out = _agent.predict(req.state, req.questions)
    except (KeyError, ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"{type(e).__name__}: {e}")
    if isinstance(out, dict):
        out.setdefault("model", _label)
    return out


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, reload=False)
