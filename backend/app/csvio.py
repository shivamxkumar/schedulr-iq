"""CSV import/export for dataset entities and schedules, with row-level error reporting."""
from __future__ import annotations

import csv
import io
from typing import Any

from pydantic import ValidationError

from .models import Assignment, Batch, Course, Dataset, Faculty, Room, TimeConfig, Window, expand_sessions
from .timegrid import minutes_of, slot_label

COLUMNS = {
    "rooms": ["id", "name", "capacity", "room_type", "equipment", "unavailable"],
    "faculty": ["id", "name", "department", "courses", "unavailable", "dispreferred", "max_daily_slots", "max_weekly_slots"],
    "batches": ["id", "name", "size", "program"],
    "courses": ["id", "code", "name", "course_type", "category", "batch_ids", "sessions_per_week", "duration_slots",
                "room_types", "equipment", "eligible_starts"],
}
LIST_FIELDS = {"equipment", "courses", "batch_ids", "room_types"}
WINDOW_FIELDS = {"unavailable", "dispreferred", "eligible_starts"}
MODEL = {"rooms": Room, "faculty": Faculty, "batches": Batch, "courses": Course}


def windows_to_text(tc: TimeConfig, ws: list[Window]) -> str:
    return " | ".join(f"{tc.days[w.day]} {slot_label(tc, w.start)}-{slot_label(tc, w.end)}" for w in ws)


def text_to_windows(tc: TimeConfig, text: str) -> list[Window]:
    out = []
    for part in [p.strip() for p in text.split("|") if p.strip()]:
        try:
            day, rng = part.split(None, 1)
            a, b = [x.strip() for x in rng.split("-")]
        except ValueError:
            raise ValueError(f"'{part}' should look like 'Wed 14:00-17:00'")
        names = [d.lower() for d in tc.days]
        if day.lower()[:3] not in [n[:3] for n in names]:
            raise ValueError(f"unknown day '{day}' (use {', '.join(tc.days)})")
        d = [n[:3] for n in names].index(day.lower()[:3])
        slots = []
        for hhmm in (a, b):
            h, m = hhmm.split(":")
            mins = int(h) * 60 + int(m) - minutes_of(tc, 0)
            if mins % tc.slot_minutes:
                raise ValueError(f"time {hhmm} is not aligned to {tc.slot_minutes}-minute slots")
            slots.append(mins // tc.slot_minutes)
        if not (0 <= slots[0] < slots[1] <= tc.slots_per_day):
            raise ValueError(f"'{part}' is outside operating hours or empty")
        out.append(Window(day=d, start=slots[0], end=slots[1]))
    return out


def export_entity(ds: Dataset, entity: str) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    cols = COLUMNS[entity]
    w.writerow(cols)
    for item in getattr(ds, entity):
        row = []
        for c in cols:
            v = getattr(item, c)
            if c in LIST_FIELDS:
                v = ";".join(v)
            elif c in WINDOW_FIELDS:
                v = windows_to_text(ds.time, v)
            row.append(v)
        w.writerow(row)
    return buf.getvalue()


def template(entity: str) -> str:
    from .demo import demo_dataset
    ds = demo_dataset()
    ds_small = ds.model_copy(update={entity: getattr(ds, entity)[:2]})
    return export_entity(ds_small, entity)


def parse_entity(tc: TimeConfig, entity: str, text: str) -> tuple[list[Any], list[dict]]:
    if entity not in COLUMNS:
        raise ValueError(f"Unknown entity '{entity}'")
    reader = csv.DictReader(io.StringIO(text.strip()))
    if reader.fieldnames is None:
        return [], [{"row": 0, "field": "-", "message": "File is empty."}]
    headers = [h.strip() for h in reader.fieldnames]
    required = [c for c in COLUMNS[entity] if c not in WINDOW_FIELDS | {"equipment", "department", "program", "category"}]
    missing = [c for c in required if c not in headers]
    if missing:
        return [], [{"row": 1, "field": ",".join(missing), "message": f"Missing required column(s): {', '.join(missing)}."}]
    items, errors = [], []
    for n, raw in enumerate(reader, start=2):
        row = {k.strip(): (v or "").strip() for k, v in raw.items() if k}
        if not any(row.values()):
            continue
        data: dict[str, Any] = {}
        bad = False
        for k, v in row.items():
            if k not in COLUMNS[entity]:
                continue
            if k in LIST_FIELDS:
                data[k] = [x.strip() for x in v.split(";") if x.strip()]
            elif k in WINDOW_FIELDS:
                try:
                    data[k] = text_to_windows(tc, v)
                except ValueError as e:
                    errors.append({"row": n, "field": k, "message": str(e)})
                    bad = True
            elif v != "":
                data[k] = v
        if bad:
            continue
        try:
            items.append(MODEL[entity](**data))
        except ValidationError as e:
            for er in e.errors():
                errors.append({"row": n, "field": ".".join(str(x) for x in er["loc"]), "message": er["msg"]})
    return items, errors


def export_schedule(ds: Dataset, assignments: list[Assignment]) -> str:
    tc = ds.time
    sess = {s.id: s for s in expand_sessions(ds)}
    courses = {c.id: c for c in ds.courses}
    rooms = {r.id: r for r in ds.rooms}
    fac = {f.id: f for f in ds.faculty}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["session_id", "course_code", "course_name", "type", "day", "start", "end", "room_id", "room_name",
                "faculty_id", "faculty_name", "batches", "enrollment"])
    for a in sorted(assignments, key=lambda a: (a.day, a.start, a.session_id)):
        s = sess.get(a.session_id)
        if not s:
            continue
        c = courses[s.course_id]
        w.writerow([a.session_id, c.code, c.name, c.course_type, tc.days[a.day], slot_label(tc, a.start),
                    slot_label(tc, a.start + s.duration), a.room_id, rooms[a.room_id].name if a.room_id in rooms else "",
                    a.faculty_id, fac[a.faculty_id].name if a.faculty_id in fac else "", ";".join(s.batch_ids),
                    s.enrollment])
    return buf.getvalue()
