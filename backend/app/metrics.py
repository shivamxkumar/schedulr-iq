"""Schedule metrics, computed purely from a dataset + assignments.

Definitions (also surfaced in the UI):
  student_idle_minutes  Σ over batches & days of teachable minutes between the first class
                        start and last class end that are not occupied by a class. Breaks
                        (e.g. lunch) and non-operating hours are excluded.      [minimize]
  faculty_idle_minutes  Same definition per faculty member.                    [minimize]
  room_time_utilization occupied room-slots ÷ available room-slots (teachable slots minus
                        each room's unavailable windows), all rooms.           [maximize]
  seat_utilization      Σ enrollment×duration ÷ Σ capacity×duration over scheduled
                        sessions — how well rooms fit their classes.           [maximize]
  wasted_seat_hours     Σ (capacity − enrollment) × duration in hours.         [minimize]
  workload_imbalance_hours  Σ over batches & faculty of (busiest-day hours − ceil(weekly
                        hours ÷ operating days)), i.e. peak-day excess over an even spread.
                                                                               [minimize]
  preference_misses     sessions overlapping a faculty "prefers not to teach" window. [minimize]
  soft_score            Σ_k ŵ_k · term_k / ref_k with ŵ the normalized weights and ref the
                        baseline's term values (min 1). Baseline ≈ 1.000; lower is better.
                        Relative to baseline — not a percentage of optimality.
"""
from __future__ import annotations

import math
from collections import defaultdict
from typing import Optional

from pydantic import BaseModel

from .models import Assignment, Dataset, Weights, expand_sessions
from .timegrid import in_windows, is_teaching_slot, teaching_slots

TERM_KEYS = ["student_idle", "faculty_idle", "room_fit", "workload_balance", "preferences"]


class EntityLoad(BaseModel):
    id: str
    name: str
    weekly_slots: int
    daily_slots: list[int]
    idle_minutes: int


class RoomUse(BaseModel):
    id: str
    occupied_slots: int
    available_slots: int
    utilization: float
    seat_utilization: Optional[float]


class Metrics(BaseModel):
    scheduled_sessions: int
    required_sessions: int
    unscheduled_sessions: int
    student_idle_minutes: int
    faculty_idle_minutes: int
    room_time_utilization: float
    seat_utilization: float
    wasted_seat_hours: float
    workload_imbalance_hours: float
    preference_misses: int
    preference_satisfaction: float
    terms: dict[str, float]
    faculty: list[EntityLoad]
    batches: list[EntityLoad]
    rooms: list[RoomUse]


def _idle_slots(tc, day: int, occupied: set[int]) -> int:
    if not occupied:
        return 0
    lo, hi = min(occupied), max(occupied)
    return sum(1 for t in range(lo, hi + 1) if t not in occupied and is_teaching_slot(tc, day, t))


def compute_metrics(ds: Dataset, assignments: list[Assignment]) -> Metrics:
    tc = ds.time
    sessions = {s.id: s for s in expand_sessions(ds)}
    rooms = {r.id: r for r in ds.rooms}
    fac = {f.id: f for f in ds.faculty}
    nd = len(tc.days)
    valid = [a for a in assignments if a.session_id in sessions and a.room_id in rooms and a.faculty_id in fac]
    seen = set()
    uniq = []
    for a in valid:
        if a.session_id not in seen:
            seen.add(a.session_id)
            uniq.append(a)

    batch_occ: dict[tuple[str, int], set[int]] = defaultdict(set)
    fac_occ: dict[tuple[str, int], set[int]] = defaultdict(set)
    room_occ: dict[str, set[tuple[int, int]]] = defaultdict(set)
    enroll_slots = cap_slots = 0
    room_enroll: dict[str, int] = defaultdict(int)
    room_cap: dict[str, int] = defaultdict(int)
    pref_miss = 0
    for a in uniq:
        s = sessions[a.session_id]
        span = range(a.start, a.start + s.duration)
        for b in s.batch_ids:
            batch_occ[(b, a.day)].update(span)
        fac_occ[(a.faculty_id, a.day)].update(span)
        room_occ[a.room_id].update((a.day, t) for t in span)
        cap = rooms[a.room_id].capacity
        enroll_slots += min(s.enrollment, cap) * s.duration
        cap_slots += cap * s.duration
        room_enroll[a.room_id] += min(s.enrollment, cap) * s.duration
        room_cap[a.room_id] += cap * s.duration
        if any(in_windows(fac[a.faculty_id].dispreferred, a.day, t) for t in span):
            pref_miss += 1

    def loads(ids_names, occ):
        out, idle_total, excess = [], 0, 0
        for eid, name in ids_names:
            daily = [len(occ.get((eid, d), ())) for d in range(nd)]
            idle = sum(_idle_slots(tc, d, occ.get((eid, d), set())) for d in range(nd))
            idle_total += idle
            wk = sum(daily)
            if wk:
                excess += max(daily) - math.ceil(wk / nd)
            out.append(EntityLoad(id=eid, name=name, weekly_slots=wk, daily_slots=daily,
                                  idle_minutes=idle * tc.slot_minutes))
        return out, idle_total, excess

    bl, b_idle, b_exc = loads([(b.id, b.name) for b in ds.batches], batch_occ)
    fl, f_idle, f_exc = loads([(f.id, f.name) for f in ds.faculty], fac_occ)

    room_uses, occ_total, avail_total = [], 0, 0
    teach = [(d, t) for d in range(nd) for t in teaching_slots(tc, d)]
    for r in ds.rooms:
        avail = sum(1 for d, t in teach if not in_windows(r.unavailable, d, t))
        occ = len(room_occ.get(r.id, ()))
        occ_total += occ
        avail_total += avail
        room_uses.append(RoomUse(id=r.id, occupied_slots=occ, available_slots=avail,
                                 utilization=round(occ / avail, 4) if avail else 0.0,
                                 seat_utilization=round(room_enroll[r.id] / room_cap[r.id], 4) if room_cap[r.id] else None))

    hours = tc.slot_minutes / 60
    wasted_slots = cap_slots - enroll_slots
    terms = {
        "student_idle": float(b_idle),
        "faculty_idle": float(f_idle),
        "room_fit": float(wasted_slots),
        "workload_balance": float(b_exc + f_exc),
        "preferences": float(pref_miss),
    }
    return Metrics(
        scheduled_sessions=len(uniq), required_sessions=len(sessions), unscheduled_sessions=len(sessions) - len(uniq),
        student_idle_minutes=b_idle * tc.slot_minutes, faculty_idle_minutes=f_idle * tc.slot_minutes,
        room_time_utilization=round(occ_total / avail_total, 4) if avail_total else 0.0,
        seat_utilization=round(enroll_slots / cap_slots, 4) if cap_slots else 0.0,
        wasted_seat_hours=round(wasted_slots * hours, 1),
        workload_imbalance_hours=round((b_exc + f_exc) * hours, 1),
        preference_misses=pref_miss,
        preference_satisfaction=round(1 - pref_miss / len(uniq), 4) if uniq else 1.0,
        terms=terms, faculty=fl, batches=bl, rooms=room_uses,
    )


def term_refs(baseline_terms: dict[str, float]) -> dict[str, float]:
    return {k: max(1.0, baseline_terms.get(k, 0.0)) for k in TERM_KEYS}


def soft_score(terms: dict[str, float], weights: Weights, refs: dict[str, float]) -> float:
    w = weights.normalized()
    return round(sum(w[k] * terms[k] / refs[k] for k in TERM_KEYS), 4)
