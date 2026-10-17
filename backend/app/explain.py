"""Explanations grounded in observable data.

Nothing here guesses at solver internals. Change logs describe what moved and the
*measured* effect on the affected batches/faculty; session explanations enumerate every
alternative slot and room and report which hard constraint rules it out, plus the measured
soft-score difference of each feasible alternative.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from .candidates import room_ok
from .metrics import compute_metrics, soft_score
from .models import Assignment, Dataset, Weights, describe_batches, expand_sessions, section_atoms
from .timegrid import in_windows, is_teaching_slot, slot_label, valid_start, where
from .validator import placement_violations

REASON_LABEL = {
    "INVALID_TIME": "Outside operating hours / crosses a break",
    "INELIGIBLE_START": "Outside the course's eligible start windows",
    "FACULTY_UNAVAILABLE": "Faculty unavailable",
    "NO_ROOM": "No suitable room free",
    "BATCH_OVERLAP": "Batch already has a class",
    "FACULTY_OVERLAP": "Faculty already teaching",
    "ROOM_OVERLAP": "Room occupied",
    "COURSE_SAME_DAY": "Course already meets that day",
    "FACULTY_DAILY_LOAD": "Faculty daily load limit",
    "FACULTY_WEEKLY_LOAD": "Faculty weekly load limit",
    "FIXED_VIOLATED": "Session is pinned elsewhere",
}
REASON_PRIORITY = ["INVALID_TIME", "INELIGIBLE_START", "FIXED_VIOLATED", "FACULTY_UNAVAILABLE", "COURSE_SAME_DAY",
                   "BATCH_OVERLAP", "FACULTY_OVERLAP", "FACULTY_DAILY_LOAD", "FACULTY_WEEKLY_LOAD", "ROOM_OVERLAP",
                   "NO_ROOM"]


class Change(BaseModel):
    session_id: str
    course_code: str
    kind: list[str]
    headline: str
    effects: list[str]
    before: Optional[Assignment]
    after: Optional[Assignment]


def _idx(assignments):
    return {a.session_id: a for a in assignments}


def diff_schedules(ds: Dataset, before: list[Assignment], after: list[Assignment]) -> list[Change]:
    tc = ds.time
    sess = {s.id: s for s in expand_sessions(ds)}
    courses = {c.id: c for c in ds.courses}
    rooms = {r.id: r for r in ds.rooms}
    fac = {f.id: f for f in ds.faculty}
    A, B = _idx(before), _idx(after)

    def occ(assigns, kind, eid, day):
        out = set()
        for a in assigns:
            s = sess.get(a.session_id)
            if not s or a.day != day:
                continue
            if (kind == "batch" and eid in s.batch_ids) or (kind == "fac" and a.faculty_id == eid):
                out.update(range(a.start, a.start + s.duration))
        return out

    def idle(assigns, kind, eid, day):
        o = occ(assigns, kind, eid, day)
        if not o:
            return 0
        return sum(1 for t in range(min(o), max(o) + 1) if t not in o and is_teaching_slot(tc, day, t)) * tc.slot_minutes

    changes: list[Change] = []
    for sid in sorted(set(A) | set(B)):
        a, b = A.get(sid), B.get(sid)
        s = sess.get(sid)
        if not s:
            continue
        c = courses[s.course_id]
        if a and b and (a.day, a.start, a.room_id, a.faculty_id) == (b.day, b.start, b.room_id, b.faculty_id):
            continue
        kinds, effects = [], []
        if a is None or b is None:
            kinds.append("scheduled" if b else "unscheduled")
            headline = (f"{c.code} {sid} newly scheduled at {where(tc, b.day, b.start, s.duration)}" if b
                        else f"{c.code} {sid} is no longer scheduled")
            changes.append(Change(session_id=sid, course_code=c.code, kind=kinds, headline=headline,
                                  effects=effects, before=a, after=b))
            continue
        moved = (a.day, a.start) != (b.day, b.start)
        if moved:
            kinds.append("time")
            headline = f"Moved {c.code} ({sid}) {where(tc, a.day, a.start, s.duration)} → {where(tc, b.day, b.start, s.duration)}"
            # Report per class (mean over its lab groups) or per group for group sessions.
            atoms = section_atoms(ds)
            sec_of = {x: k for k, lst in atoms.items() for x in lst}
            for sec in dict.fromkeys(sec_of.get(x, x) for x in s.batch_ids):
                members = [x for x in atoms.get(sec, [sec]) if x in s.batch_ids]
                label = describe_batches(ds, members)
                for d in sorted({a.day, b.day}):
                    i0 = round(sum(idle(before, "batch", x, d) for x in members) / len(members))
                    i1 = round(sum(idle(after, "batch", x, d) for x in members) / len(members))
                    if i0 != i1:
                        effects.append(f"{label} idle time on {tc.days[d]}: {i0} → {i1} min")
            f_old, f_new = fac[a.faculty_id], fac[b.faculty_id]
            pa = any(in_windows(f_old.dispreferred, a.day, t) for t in range(a.start, a.start + s.duration))
            pb = any(in_windows(f_new.dispreferred, b.day, t) for t in range(b.start, b.start + s.duration))
            if pa and not pb:
                effects.append(f"Old slot was in {f_old.name}'s “prefers not to teach” window; new slot is not")
            elif pb and not pa:
                effects.append(f"Trade-off: new slot falls in {f_new.name}'s “prefers not to teach” window")
            if a.faculty_id == b.faculty_id:
                for d in sorted({a.day, b.day}):
                    i0, i1 = idle(before, "fac", a.faculty_id, d), idle(after, "fac", a.faculty_id, d)
                    if i0 != i1:
                        effects.append(f"{f_old.name} idle time on {tc.days[d]}: {i0} → {i1} min")
        else:
            headline = f"{c.code} ({sid}) stays at {where(tc, b.day, b.start, s.duration)}"
        if a.room_id != b.room_id:
            kinds.append("room")
            ra, rb = rooms[a.room_id], rooms[b.room_id]
            wa, wb = ra.capacity - s.enrollment, rb.capacity - s.enrollment
            effects.append(f"Room {ra.id} ({ra.capacity} seats) → {rb.id} ({rb.capacity} seats) for {s.enrollment} "
                           f"students: empty seats {wa} → {wb}")
            if not moved:
                headline = f"Re-roomed {c.code} ({sid}) {ra.id} → {rb.id}"
        if a.faculty_id != b.faculty_id:
            kinds.append("faculty")
            effects.append(f"Taught by {fac[b.faculty_id].name} instead of {fac[a.faculty_id].name} (both eligible)")
            if not moved and a.room_id == b.room_id:
                headline = f"Reassigned {c.code} ({sid}) to {fac[b.faculty_id].name}"
        if not effects:
            effects.append("No measurable change for this session's own batch/faculty on the affected days; "
                           "the move frees or reshapes slots used by other sessions.")
        changes.append(Change(session_id=sid, course_code=c.code, kind=kinds, headline=headline,
                              effects=effects, before=a, after=b))
    return changes


class SlotCell(BaseModel):
    day: int
    start: int
    status: str  # current | feasible | blocked
    reason: Optional[str] = None
    reason_label: Optional[str] = None
    room_id: Optional[str] = None
    score_delta: Optional[float] = None


class RoomCheck(BaseModel):
    room_id: str
    suitable: bool
    reasons: list[str]


class SessionExplanation(BaseModel):
    session_id: str
    course: dict
    assignment: Optional[Assignment]
    enrollment: int
    batches: list[str]
    requirements: list[str]
    checks: list[dict]
    rooms: list[RoomCheck]
    slots: list[SlotCell]
    summary: list[str]
    preference: Optional[str]


def explain_session(ds: Dataset, assignments: list[Assignment], sid: str, weights: Weights,
                    refs: dict[str, float]) -> SessionExplanation:
    tc = ds.time
    sess = {s.id: s for s in expand_sessions(ds)}
    s = sess[sid]
    c = next(x for x in ds.courses if x.id == s.course_id)
    cur = _idx(assignments).get(sid)
    fac = {f.id: f for f in ds.faculty}
    f = fac.get(cur.faculty_id) if cur else next((x for x in ds.faculty if c.id in x.courses), None)

    reqs = [f"{s.duration} × {tc.slot_minutes} min block",
            f"Room type: {' or '.join(c.room_types)}",
            f"Capacity ≥ {s.enrollment} ({describe_batches(ds, s.batch_ids)})"]
    if c.equipment:
        reqs.append("Equipment: " + ", ".join(c.equipment))
    if c.eligible_starts:
        reqs.append("Eligible starts: " + "; ".join(f"{tc.days[w.day]} {slot_label(tc, w.start)}–{slot_label(tc, w.end)}"
                                                     for w in c.eligible_starts))
    reqs.append("Eligible faculty: " + ", ".join(x.name for x in ds.faculty if c.id in x.courses))

    room_checks = []
    for r in ds.rooms:
        why = []
        if r.room_type not in c.room_types:
            why.append(f"is a {r.room_type} room")
        lacking = [e for e in c.equipment if e not in r.equipment]
        if lacking:
            why.append("lacks " + ", ".join(lacking))
        if r.capacity < s.enrollment:
            why.append(f"only {r.capacity} seats")
        if not why:
            why.append(f"{r.room_type}, {r.capacity} seats ({r.capacity - s.enrollment} spare)")
        room_checks.append(RoomCheck(room_id=r.id, suitable=room_ok(c, s, r), reasons=why))

    base_score = soft_score(compute_metrics(ds, assignments).terms, weights, refs)
    suitable = [r for r in ds.rooms if room_ok(c, s, r)]
    cells: list[SlotCell] = []
    feasible_scores = []
    for d in range(len(tc.days)):
        for t in range(tc.slots_per_day):
            if cur and (d, t) == (cur.day, cur.start):
                cells.append(SlotCell(day=d, start=t, status="current", room_id=cur.room_id, score_delta=0.0))
                continue
            if not valid_start(tc, d, t, s.duration):
                cells.append(SlotCell(day=d, start=t, status="blocked", reason="INVALID_TIME",
                                      reason_label=REASON_LABEL["INVALID_TIME"]))
                continue
            if f is None:
                continue
            found, codes = None, set()
            for r in suitable:
                cand = Assignment(session_id=sid, day=d, start=t, room_id=r.id, faculty_id=f.id)
                vs = placement_violations(ds, assignments, cand)
                if not vs:
                    found = cand
                    break
                codes.update(v.code for v in vs)
            if found:
                trial = [a for a in assignments if a.session_id != sid] + [found]
                delta = round(soft_score(compute_metrics(ds, trial).terms, weights, refs) - base_score, 4)
                feasible_scores.append(delta)
                cells.append(SlotCell(day=d, start=t, status="feasible", room_id=found.room_id, score_delta=delta))
            else:
                codes = {"NO_ROOM" if x in ("ROOM_OVERLAP", "ROOM_UNAVAILABLE") else x for x in codes}
                code = next((p for p in REASON_PRIORITY if p in codes), "NO_ROOM")
                cells.append(SlotCell(day=d, start=t, status="blocked", reason=code,
                                      reason_label=REASON_LABEL.get(code, code)))

    summary = []
    starts = [x for x in cells if x.status != "blocked" or x.reason != "INVALID_TIME"]
    nfeas = sum(1 for x in cells if x.status == "feasible")
    summary.append(f"{len(starts)} valid start times exist for a {s.duration}-slot block; "
                   f"{nfeas} other(s) are feasible given the rest of this timetable.")
    if cur:
        better = sum(1 for d in feasible_scores if d < -1e-9)
        if feasible_scores:
            best = min(feasible_scores)
            if better == 0:
                summary.append("No feasible single move of this session lowers the weighted soft score — "
                               f"the current slot is locally best (smallest increase elsewhere: +{best:.3f}).")
            else:
                summary.append(f"{better} alternative slot(s) would lower the soft score (best {best:+.3f}); "
                               "this timetable has not been optimized for the current weights.")
        else:
            summary.append("This is the only feasible slot for the session given the rest of the timetable.")
        r = next(x for x in ds.rooms if x.id == cur.room_id)
        rej = [rc for rc in room_checks if not rc.suitable]
        summary.append(f"Room {r.id} satisfies type, equipment and capacity ({r.capacity} ≥ {s.enrollment}). "
                       f"{len(rej)} of {len(ds.rooms)} rooms are unsuitable regardless of time.")
    counts: dict[str, int] = {}
    for x in cells:
        if x.status == "blocked" and x.reason != "INVALID_TIME":
            counts[x.reason_label] = counts.get(x.reason_label, 0) + 1
    if counts:
        summary.append("Blocked starts: " + "; ".join(f"{k} ×{v}" for k, v in sorted(counts.items(), key=lambda kv: -kv[1])))

    pref = None
    if cur and f:
        inside = any(in_windows(f.dispreferred, cur.day, t) for t in range(cur.start, cur.start + s.duration))
        pref = (f"Inside {f.name}'s “prefers not to teach” window (soft)." if inside
                else f"Respects {f.name}'s teaching preferences.")
    checks = []
    if cur:
        rep_v = placement_violations(ds, assignments, cur)
        bad = {v.code for v in rep_v}
        for code, label in [("FACULTY_OVERLAP", "Faculty free"), ("ROOM_OVERLAP", "Room free"),
                            ("BATCH_OVERLAP", "Batches free"), ("ROOM_CAPACITY", "Capacity"),
                            ("ROOM_TYPE", "Room type"), ("ROOM_EQUIPMENT", "Equipment"),
                            ("FACULTY_NOT_ELIGIBLE", "Faculty eligible"), ("FACULTY_UNAVAILABLE", "Faculty available"),
                            ("ROOM_UNAVAILABLE", "Room available"), ("INVALID_TIME", "Operating hours"),
                            ("COURSE_SAME_DAY", "One per day"), ("FACULTY_DAILY_LOAD", "Daily load")]:
            checks.append({"code": code, "label": label, "passed": code not in bad,
                           "detail": next((v.message for v in rep_v if v.code == code), None)})
    return SessionExplanation(session_id=sid, course=c.model_dump(), assignment=cur, enrollment=s.enrollment,
                              batches=[describe_batches(ds, s.batch_ids)], requirements=reqs, checks=checks, rooms=room_checks, slots=cells,
                              summary=summary, preference=pref)


class Suggestion(BaseModel):
    session_id: str
    assignment: Assignment
    label: str
    score_delta: float


def suggest_fixes(ds: Dataset, assignments: list[Assignment], sid: str, weights: Weights, refs: dict[str, float],
                  limit: int = 3) -> list[Suggestion]:
    """Validated alternative placements for a session (same faculty first, then other eligible faculty)."""
    tc = ds.time
    sess = {s.id: s for s in expand_sessions(ds)}
    s = sess.get(sid)
    if not s:
        return []
    c = next(x for x in ds.courses if x.id == s.course_id)
    cur = _idx(assignments).get(sid)
    facs = [x for x in ds.faculty if c.id in x.courses]
    if cur:
        facs.sort(key=lambda x: x.id != cur.faculty_id)
    suitable = sorted([r for r in ds.rooms if room_ok(c, s, r)], key=lambda r: r.capacity)
    base_score = soft_score(compute_metrics(ds, assignments).terms, weights, refs)
    found: list[tuple[int, Suggestion]] = []
    for f in facs[:2]:
        for d in range(len(tc.days)):
            for t in range(tc.slots_per_day):
                if not valid_start(tc, d, t, s.duration):
                    continue
                for r in suitable:
                    cand = Assignment(session_id=sid, day=d, start=t, room_id=r.id, faculty_id=f.id)
                    if cur and cand == cur:
                        continue
                    if not placement_violations(ds, assignments, cand):
                        trial = [a for a in assignments if a.session_id != sid] + [cand]
                        delta = round(soft_score(compute_metrics(ds, trial).terms, weights, refs) - base_score, 4)
                        same_time = bool(cur and (cur.day, cur.start) == (d, t))
                        label = (f"Keep {where(tc, d, t, s.duration)}, switch to {r.id} ({r.capacity} seats)" if same_time
                                 else f"{where(tc, d, t, s.duration)} · {r.id} · {f.name}")
                        found.append((0 if same_time else 1, Suggestion(session_id=sid, assignment=cand,
                                                                         score_delta=delta, label=label)))
                        break
        if found:
            break
    found.sort(key=lambda x: (x[0], x[1].score_delta))
    out, days = [], set()
    for rank, sg in found:
        if rank == 1 and sg.assignment.day in days:
            continue
        days.add(sg.assignment.day)
        out.append(sg)
        if len(out) == limit:
            break
    return out
