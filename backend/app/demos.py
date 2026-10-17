"""Demo datasets.

* `iiit-surat` (default): the IIIT Surat odd-semester timetable transcribed from the Timetable
  Committee's all_class_v4.pdf, with the official timetable as the reference baseline and one
  precomputed CP-SAT run (see scripts/build_iiits.py).
* `synthetic`: the small fictional college used by the unit tests and diagnostic scenarios.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import BaseModel

from .demo import demo_dataset
from .models import Assignment, Dataset

IIITS_PATH = Path(__file__).resolve().parent / "iiits_official.json"


class DemoBundle(BaseModel):
    dataset: Dataset
    official: Optional[list[Assignment]] = None
    optimized: Optional[dict] = None
    source: str = ""


@lru_cache(maxsize=1)
def _iiits_raw() -> dict:
    return json.loads(IIITS_PATH.read_text())


def load(name: str) -> DemoBundle:
    if name == "synthetic":
        return DemoBundle(dataset=demo_dataset())
    if name == "iiit-surat":
        raw = _iiits_raw()
        return DemoBundle(dataset=Dataset.model_validate(raw["dataset"]),
                          official=[Assignment(**a) for a in raw["official"]],
                          optimized=raw.get("optimized"), source=raw.get("source", ""))
    raise KeyError(name)


DEFAULT = "iiit-surat"
