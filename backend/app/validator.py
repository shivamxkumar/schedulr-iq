"""Independent schedule validator.

Deliberately does NOT reuse the solver's candidate generation: it recomputes every hard
constraint directly from the raw dataset and the list of assignments. Soft preference
misses are reported separately and never counted as hard violations.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Literal, Optional

from pydantic import BaseModel

from .models import Assignment, Dataset, expand_sessions
from .timegrid import in_windows, is_teaching_slot, where

HARD_CHECKS = [
    ("FACULTY_OVERLAP", "Faculty never teach two sessions at once"),
    ("ROOM_OVERLAP", "Rooms never host two sessions at once"),
    ("BATCH_OVERLAP", "Student batches never attend two sessions at once"),
    ("ROOM_CAPACITY", "Room capacity ≥ session enrollment"),
    ("ROOM_TYPE", "Room type matches course requirement"),
    ("ROOM_EQUIPMENT", "Room has all required equipment"),
    ("FACULTY_NOT_ELIGIBLE", "Faculty is qualified for the course"),
    ("FACULTY_UNAVAILABLE", "Faculty available for the full session"),
    ("ROOM_UNAVAILABLE", "Room available for the full session"),
    ("INVALID_TIME", "Session fits operating hours and avoids breaks"),
    ("INELIGIBLE_START", "Session starts in a course-eligible window"),
    ("MISSING_SESSION", "Every required session is scheduled"),
    ("DUPLICATE_SESSION", "No session is scheduled twice"),
    ("UNKNOWN_REFERENCE", "All session, room and faculty IDs exist"),
    ("FACULTY_DAILY_LOAD", "Faculty daily teaching load ≤ maximum"),
    ("FACULTY_WEEKLY_LOAD", "Faculty weekly teaching load ≤ maximum"),
    ("COURSE_SAME_DAY", "At most one session of a course per day"),
    ("TEACHER_CONSISTENCY", "One faculty member teaches all sessions of a course"),
    ("FIXED_VIOLATED", "Fixed (pinned) assignments are respected"),
]


class Violation(BaseModel):
    code: str
    severity: Literal["hard", "soft"]
    message: str
    session_ids: list[str] = []
    resource_kind: Optional[str] = None
    resource_id: Optional[str] = None
    day: Optional[int] = None
    start: Optional[int] = None
    end: Optional[int] = None


class CheckResult(BaseModel):
    code: str
    label: str
    violations: int
    passed: bool


class ValidationReport(BaseModel):
    feasible: bool
    complete: bool
    hard_count: int
    soft_count: int
    scheduled: int
    required: int
    checks: list[CheckResult]
    violations: list[Violation]


def validate(ds: Dataset, assignments: list[Assignment]) -> ValidationReport:
    tc = ds.time
    sessions = {s.id: s for s in expand_sessions(ds)}
    courses = {c.id: c for c in ds.courses}
    rooms = {r.id: r for r in ds.rooms}
    faculty = {f.id: f for f in ds.faculty}
    v: list[Violation] = []

    def add(code, msg, sids, kind=None, rid=None, day=None, start=None, end=None, severity="hard"):
        v.append(Violation(code=code, severity=severity, message=msg, session_ids=sids, resource_kind=kind,
                           resource_id=rid, day=day, start=start, end=end))

    seen: dict[str, Assignment] = {}
    good: list[Assignment] = []
    for a in assignments:
        if a.session_id in seen:
            add("DUPLICATE_SESSION", f"{a.session_id} is scheduled more than once.", [a.session_id])
            continue
        seen[a.session_id] = a
        missing = [label for label, ok in (("session", a.session_id in sessions), ("room", a.room_id in rooms),
                                            ("faculty", a.faculty_id in faculty)) if not ok]
        if missing:
            add("UNKNOWN_REFERENCE", f"{a.session_id} references unknown {', '.join(missing)} "
                f"(room={a.room_id}, faculty={a.faculty_id}).", [a.session_id])
            continue
        good.append(a)

    for sid in sessions:
        if sid not in seen:
            s = sessions[sid]
            add("MISSING_SESSION", f"{sid} ({courses[s.course_id].code} {courses[s.course_id].name}) "
                f"is required but not scheduled.", [sid], "course", s.course_id)

    for a in good:
        s, c, r, f = sessions[a.session_id], courses[sessions[a.session_id].course_id], rooms[a.room_id], faculty[a.faculty_id]
        span = range(a.start, a.start + s.duration)
        loc = where(tc, a.day, a.start, s.duration) if 0 <= a.day < len(tc.days) else f"day {a.day}"
        bad = [t for t in span if not is_teaching_slot(tc, a.day, t)]
        if bad:
            add("INVALID_TIME", f"{a.session_id} at {loc} falls outside operating hours or overlaps a break.",
                [a.session_id], day=a.day, start=a.start, end=a.start + s.duration)
        if c.eligible_starts and not in_windows(c.eligible_starts, a.day, a.start):
            add("INELIGIBLE_START", f"{c.code} may only start in its configured windows; {loc} is not one.",
                [a.session_id], "course", c.id, a.day, a.start, a.start + s.duration)
        if r.capacity < s.enrollment:
            add("ROOM_CAPACITY", f"{r.id} seats {r.capacity} but {a.session_id} enrolls {s.enrollment}.",
                [a.session_id], "room", r.id, a.day, a.start, a.start + s.duration)
        if r.room_type not in c.room_types:
            add("ROOM_TYPE", f"{c.code} needs a {' / '.join(c.room_types)} room; {r.id} is a {r.room_type}.",
                [a.session_id], "room", r.id, a.day, a.start, a.start + s.duration)
        lacking = [e for e in c.equipment if e not in r.equipment]
        if lacking:
            add("ROOM_EQUIPMENT", f"{r.id} lacks {', '.join(lacking)} required by {c.code}.",
                [a.session_id], "room", r.id, a.day, a.start, a.start + s.duration)
        if c.id not in f.courses:
            add("FACULTY_NOT_ELIGIBLE", f"{f.name} is not listed as eligible to teach {c.code} ({c.id}).",
                [a.session_id], "faculty", f.id)
        if any(in_windows(f.unavailable, a.day, t) for t in span):
            add("FACULTY_UNAVAILABLE", f"{f.name} is unavailable during {loc}.",
                [a.session_id], "faculty", f.id, a.day, a.start, a.start + s.duration)
        if any(in_windows(r.unavailable, a.day, t) for t in span):
            add("ROOM_UNAVAILABLE", f"{r.id} is unavailable during {loc}.",
                [a.session_id], "room", r.id, a.day, a.start, a.start + s.duration)
        if any(in_windows(f.dispreferred, a.day, t) for t in span):
            add("PREFERENCE", f"{f.name} prefers not to teach during {loc}.",
                [a.session_id], "faculty", f.id, a.day, a.start, a.start + s.duration, severity="soft")

    # Pairwise interval overlaps on every shared resource.
    for i in range(len(good)):
        a = good[i]
        sa = sessions[a.session_id]
        for j in range(i + 1, len(good)):
            b = good[j]
            if a.day != b.day:
                continue
            sb = sessions[b.session_id]
            lo, hi = max(a.start, b.start), min(a.start + sa.duration, b.start + sb.duration)
            if lo >= hi:
                continue
            loc = where(tc, a.day, lo, hi - lo)
            pair = [a.session_id, b.session_id]
            if a.faculty_id == b.faculty_id:
                add("FACULTY_OVERLAP", f"{faculty[a.faculty_id].name} is double-booked {loc}: {pair[0]} and {pair[1]}.",
                    pair, "faculty", a.faculty_id, a.day, lo, hi)
            if a.room_id == b.room_id:
                add("ROOM_OVERLAP", f"{a.room_id} is double-booked {loc}: {pair[0]} and {pair[1]}.",
                    pair, "room", a.room_id, a.day, lo, hi)
            for bid in sorted(set(sa.batch_ids) & set(sb.batch_ids)):
                add("BATCH_OVERLAP", f"Batch {bid} has overlapping classes {loc}: {pair[0]} and {pair[1]}.",
                    pair, "batch", bid, a.day, lo, hi)

    daily: dict[tuple[str, int], int] = defaultdict(int)
    weekly: dict[str, int] = defaultdict(int)
    course_days: dict[tuple[str, int], list[str]] = defaultdict(list)
    course_fac: dict[str, set[str]] = defaultdict(set)
    for a in good:
        s = sessions[a.session_id]
        daily[(a.faculty_id, a.day)] += s.duration
        weekly[a.faculty_id] += s.duration
        course_days[(s.course_id, a.day)].append(a.session_id)
        course_fac[s.course_id].add(a.faculty_id)
    for (fid, d), load in daily.items():
        if load > faculty[fid].max_daily_slots:
            add("FACULTY_DAILY_LOAD", f"{faculty[fid].name} teaches {load} slots on {tc.days[d] if d < len(tc.days) else d} "
                f"(max {faculty[fid].max_daily_slots}).", [], "faculty", fid, d)
    for fid, load in weekly.items():
        if load > faculty[fid].max_weekly_slots:
            add("FACULTY_WEEKLY_LOAD", f"{faculty[fid].name} teaches {load} slots per week "
                f"(max {faculty[fid].max_weekly_slots}).", [], "faculty", fid)
    for (cid, d), sids in course_days.items():
        if len(sids) > 1:
            add("COURSE_SAME_DAY", f"{courses[cid].code} has {len(sids)} sessions on "
                f"{tc.days[d] if d < len(tc.days) else d}; at most one per day is allowed.", sids, "course", cid, d)
    for cid, fids in course_fac.items():
        if len(fids) > 1:
            add("TEACHER_CONSISTENCY", f"{courses[cid].code} ({cid}) is split across {len(fids)} faculty: "
                f"{', '.join(sorted(fids))}.", [a.session_id for a in good if sessions[a.session_id].course_id == cid],
                "course", cid)
    for fx in ds.fixed:
        a = seen.get(fx.session_id)
        if a and (a.day != fx.day or a.start != fx.start or (fx.room_id and a.room_id != fx.room_id)):
            add("FIXED_VIOLATED", f"{fx.session_id} is pinned to {where(tc, fx.day, fx.start, 1)[:-6]}"
                f"{' in ' + fx.room_id if fx.room_id else ''} but was moved.", [fx.session_id])

    hard = [x for x in v if x.severity == "hard"]
    counts = defaultdict(int)
    for x in hard:
        counts[x.code] += 1
    checks = [CheckResult(code=c, label=l, violations=counts[c], passed=counts[c] == 0) for c, l in HARD_CHECKS]
    complete = counts["MISSING_SESSION"] == 0
    return ValidationReport(feasible=not hard, complete=complete, hard_count=len(hard),
                            soft_count=len(v) - len(hard), scheduled=len(good), required=len(sessions),
                            checks=checks, violations=v)


def placement_violations(ds: Dataset, assignments: list[Assignment], cand: Assignment) -> list[Violation]:
    """Hard violations that `cand` would cause/suffer if it replaced its session's current
    assignment. Runs the full validator on the hypothetical schedule and keeps only issues
    that involve this session, so the logic is identical to whole-schedule validation."""
    others = [a for a in assignments if a.session_id != cand.session_id]
    rep = validate(ds, others + [cand])
    return [v for v in rep.violations if v.severity == "hard" and v.code != "MISSING_SESSION"
            and (cand.session_id in v.session_ids or _load_issue_for(v, cand))]


def _load_issue_for(v: Violation, cand: Assignment) -> bool:
    if v.code in ("FACULTY_DAILY_LOAD", "FACULTY_WEEKLY_LOAD"):
        return v.resource_id == cand.faculty_id and (v.day is None or v.day == cand.day)
    return False
