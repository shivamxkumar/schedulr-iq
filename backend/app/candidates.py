"""Legal-placement enumeration used by the baseline heuristic and the CP-SAT model.

A candidate is (session, day, start, room, faculty) that passes every *unary* hard
constraint: time bounds/breaks, eligible start windows, room type/equipment/capacity,
room and faculty availability, faculty eligibility and pinned assignments. Pairwise
constraints (overlaps, loads, one-per-day, teacher consistency) are left to the search.
"""
from __future__ import annotations

from dataclasses import dataclass

from .models import Course, Dataset, Faculty, Room, Session, expand_sessions
from .timegrid import in_windows, valid_start


@dataclass(frozen=True)
class Cand:
    sid: str
    day: int
    start: int
    room: str
    fac: str
    dur: int

    @property
    def span(self) -> range:
        return range(self.start, self.start + self.dur)


def room_ok(c: Course, s: Session, r: Room) -> bool:
    return r.room_type in c.room_types and all(e in r.equipment for e in c.equipment) and r.capacity >= s.enrollment


def build_candidates(ds: Dataset, only: set[str] | None = None) -> tuple[list[Session], dict[str, list[Cand]]]:
    tc = ds.time
    sessions = expand_sessions(ds)
    courses = {c.id: c for c in ds.courses}
    fixed = {f.session_id: f for f in ds.fixed}
    out: dict[str, list[Cand]] = {}
    for s in sessions:
        if only is not None and s.id not in only:
            continue
        c = courses[s.course_id]
        rooms = [r for r in ds.rooms if room_ok(c, s, r)]
        facs = [f for f in ds.faculty if c.id in f.courses]
        fx = fixed.get(s.id)
        lst: list[Cand] = []
        for d in range(len(tc.days)):
            for t in range(tc.slots_per_day):
                if not valid_start(tc, d, t, s.duration):
                    continue
                if c.eligible_starts and not in_windows(c.eligible_starts, d, t):
                    continue
                if fx and (fx.day != d or fx.start != t):
                    continue
                span = range(t, t + s.duration)
                for r in rooms:
                    if fx and fx.room_id and r.id != fx.room_id:
                        continue
                    if any(in_windows(r.unavailable, d, x) for x in span):
                        continue
                    for f in facs:
                        if any(in_windows(f.unavailable, d, x) for x in span):
                            continue
                        lst.append(Cand(s.id, d, t, r.id, f.id, s.duration))
        out[s.id] = lst
    return sessions, out


def explain_no_candidates(ds: Dataset, s: Session) -> str:
    """Human-readable reason why a session has zero legal placements."""
    tc = ds.time
    c = next(x for x in ds.courses if x.id == s.course_id)
    typed = [r for r in ds.rooms if r.room_type in c.room_types]
    if not typed:
        return f"No room of type {' / '.join(c.room_types)} exists."
    equipped = [r for r in typed if all(e in r.equipment for e in c.equipment)]
    if not equipped:
        return f"No {' / '.join(c.room_types)} room has the required equipment ({', '.join(c.equipment)})."
    big = [r for r in equipped if r.capacity >= s.enrollment]
    if not big:
        best = max(equipped, key=lambda r: r.capacity)
        return (f"Needs {s.enrollment} seats, but the largest suitable room is {best.id} with {best.capacity}.")
    facs = [f for f in ds.faculty if c.id in f.courses]
    if not facs:
        return f"No faculty member is eligible to teach {c.code} ({c.id})."
    if s.duration > max(len([t for t in range(tc.slots_per_day) if valid_start(tc, d, t, 1)]) for d in range(len(tc.days))):
        return f"Duration {s.duration} slots exceeds every day's teachable block."
    return ("Every start time is blocked by room or faculty availability, eligible-start windows, "
            "breaks, or a pinned assignment.")


def faculty_for(ds: Dataset, f_id: str) -> Faculty:
    return next(f for f in ds.faculty if f.id == f_id)
