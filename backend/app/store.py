"""In-memory application state persisted to a JSON file (single-user hackathon scope)."""
from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel

from .demos import DEFAULT, load
from .models import Assignment, Dataset

STATE_PATH = Path(__file__).resolve().parent.parent / "data" / "state.json"


class ScheduleRecord(BaseModel):
    id: str
    label: str
    kind: str  # baseline | optimized | manual | draft | diagnostic | partial
    parent_id: Optional[str] = None
    created_at: str
    assignments: list[Assignment]
    solver: dict[str, Any] = {}
    weights: Optional[dict[str, float]] = None
    published: bool = False
    published_at: Optional[str] = None
    changes: list[dict[str, Any]] = []


class State(BaseModel):
    dataset: Dataset
    dataset_version: int = 1
    schedules: dict[str, ScheduleRecord] = {}
    baseline_id: Optional[str] = None
    active_id: Optional[str] = None
    counter: int = 0


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, path: Path = STATE_PATH):
        self.path = path
        self.lock = threading.RLock()
        self.state = self._load()

    def _load(self) -> State:
        if self.path.exists():
            try:
                return State.model_validate_json(self.path.read_text())
            except Exception:
                pass
        return State(dataset=load(DEFAULT).dataset)

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(self.state.model_dump_json())
        tmp.replace(self.path)

    def next_id(self) -> str:
        self.state.counter += 1
        return f"SCH-{self.state.counter:04d}"

    def add(self, rec: ScheduleRecord, activate: bool = True) -> ScheduleRecord:
        self.state.schedules[rec.id] = rec
        if activate:
            self.state.active_id = rec.id
        self.save()
        return rec

    def get(self, sid: str) -> Optional[ScheduleRecord]:
        return self.state.schedules.get(sid)

    def set_dataset(self, ds: Dataset) -> None:
        self.state.dataset = ds
        self.state.dataset_version += 1
        self.state.schedules = {}
        self.state.baseline_id = None
        self.state.active_id = None
        self.save()

    def reset(self, ds: Dataset) -> None:
        self.state = State(dataset=ds, counter=self.state.counter)
        self.save()


def to_json(obj: Any) -> str:
    return json.dumps(obj, default=str)
