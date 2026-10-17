"""Static dataset validation: referential integrity and obviously impossible requirements."""
from __future__ import annotations

from collections import Counter
from typing import Literal

from pydantic import BaseModel

from .candidates import room_ok
from .models import Dataset, Window, expand_sessions
from .timegrid import teaching_slots


class DataIssue(BaseModel):
    level: Literal["error", "warning"]
    entity: str
    id: str
    field: str
    message: str


def check_dataset(ds: Dataset) -> list[DataIssue]:
    out: list[DataIssue] = []
    tc = ds.time

    def err(entity, id_, field, msg, level="error"):
        out.append(DataIssue(level=level, entity=entity, id=id_, field=field, message=msg))

    if len(tc.day_slots) != len(tc.days):
        err("time", "-", "day_slots", f"day_slots has {len(tc.day_slots)} entries but there are {len(tc.days)} days.")
    for name, items in (("room", ds.rooms), ("faculty", ds.faculty), ("batch", ds.batches), ("course", ds.courses)):
        for k, n in Counter(x.id for x in items).items():
            if n > 1:
                err(name, k, "id", f"Duplicate {name} id '{k}' appears {n} times.")
    batch_ids = {b.id for b in ds.batches}
    course_ids = {c.id for c in ds.courses}

    def check_windows(entity, id_, field, ws: list[Window]):
        for w in ws:
            if w.day >= len(tc.days) or w.end > tc.slots_per_day or w.start >= w.end:
                err(entity, id_, field, f"Window day={w.day} {w.start}-{w.end} is outside the {len(tc.days)}-day × "
                    f"{tc.slots_per_day}-slot grid or empty.")

    for r in ds.rooms:
        check_windows("room", r.id, "unavailable", r.unavailable)
    for f in ds.faculty:
        check_windows("faculty", f.id, "unavailable", f.unavailable)
        check_windows("faculty", f.id, "dispreferred", f.dispreferred)
        for cid in f.courses:
            if cid not in course_ids:
                err("faculty", f.id, "courses", f"References unknown course '{cid}'.")
        if f.max_daily_slots > f.max_weekly_slots:
            err("faculty", f.id, "max_daily_slots", "Daily maximum exceeds weekly maximum.", "warning")
    sessions = expand_sessions(ds)
    longest = max((len(teaching_slots(tc, d)) for d in range(len(tc.days))), default=0)
    for c in ds.courses:
        check_windows("course", c.id, "eligible_starts", c.eligible_starts)
        if not c.batch_ids:
            err("course", c.id, "batch_ids", "Course has no batch assigned.")
        for b in c.batch_ids:
            if b not in batch_ids:
                err("course", c.id, "batch_ids", f"References unknown batch '{b}'.")
        if not c.room_types:
            err("course", c.id, "room_types", "At least one acceptable room type is required.")
        if not any(c.id in f.courses for f in ds.faculty):
            err("course", c.id, "faculty", f"No faculty member lists {c.id} among their eligible courses.")
        if c.duration_slots > longest:
            err("course", c.id, "duration_slots", f"Duration {c.duration_slots} slots exceeds the longest teachable block.")
        if c.sessions_per_week > len(tc.days):
            err("course", c.id, "sessions_per_week", "More weekly sessions than days (max one per day).")
        s = next((x for x in sessions if x.course_id == c.id), None)
        if s and c.room_types and not any(room_ok(c, s, r) for r in ds.rooms):
            err("course", c.id, "room", f"No room satisfies type {'/'.join(c.room_types)}, equipment "
                f"[{', '.join(c.equipment) or 'none'}] and capacity ≥ {s.enrollment}.")
    sids = {s.id for s in sessions}
    for fx in ds.fixed:
        if fx.session_id not in sids:
            err("fixed", fx.session_id, "session_id", "Pinned session does not exist.")
    for b in ds.batches:
        if not any(b.id in c.batch_ids for c in ds.courses):
            err("batch", b.id, "curriculum", "Batch has no courses.", "warning")
    return out
