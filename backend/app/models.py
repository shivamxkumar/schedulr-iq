"""Typed domain model for SCHEDULR IQ.

Time is discrete: a week is `len(days)` days, each day has `slots_per_day` slots of
`slot_minutes` minutes starting at `day_start`. Slot indices listed in `break_slots`
are never teachable (e.g. lunch). `day_slots[d]` truncates operating hours for day d
(e.g. Saturday half-day). Windows are half-open: [start, end).
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

RoomType = Literal["lecture", "lab", "seminar"]
CourseType = Literal["lecture", "lab", "tutorial"]


class Window(BaseModel):
    day: int = Field(ge=0)
    start: int = Field(ge=0)
    end: int = Field(ge=1)


class TimeConfig(BaseModel):
    days: list[str] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    day_start: str = "09:00"
    slot_minutes: int = Field(default=60, ge=15, le=180)
    slots_per_day: int = Field(default=8, ge=1, le=16)
    break_slots: list[int] = [4]
    day_slots: list[int] = [8, 8, 8, 8, 8, 4]


class Room(BaseModel):
    id: str
    name: str
    capacity: int = Field(ge=1)
    room_type: RoomType
    equipment: list[str] = []
    unavailable: list[Window] = []


class Faculty(BaseModel):
    id: str
    name: str
    department: str = ""
    courses: list[str] = []  # course ids this person is qualified/eligible to teach
    unavailable: list[Window] = []  # hard
    dispreferred: list[Window] = []  # soft: "prefers not to teach"
    max_daily_slots: int = Field(default=4, ge=1)
    max_weekly_slots: int = Field(default=16, ge=1)


class Batch(BaseModel):
    id: str
    name: str
    size: int = Field(ge=1)
    program: str = ""
    section: str = ""  # groups atomic batches (lab groups / elective divisions) of one class


class Course(BaseModel):
    id: str
    code: str
    name: str
    course_type: CourseType
    category: str = "core"
    batch_ids: list[str]
    sessions_per_week: int = Field(ge=1, le=6)
    duration_slots: int = Field(ge=1, le=4)
    room_types: list[RoomType]
    equipment: list[str] = []
    eligible_starts: list[Window] = []  # empty = any start in operating hours


class FixedAssignment(BaseModel):
    session_id: str
    day: int
    start: int
    room_id: Optional[str] = None


class Dataset(BaseModel):
    name: str = "Untitled dataset"
    time: TimeConfig = TimeConfig()
    rooms: list[Room] = []
    faculty: list[Faculty] = []
    batches: list[Batch] = []
    courses: list[Course] = []
    fixed: list[FixedAssignment] = []


class Session(BaseModel):
    id: str
    course_id: str
    index: int
    batch_ids: list[str]
    duration: int
    enrollment: int


class Assignment(BaseModel):
    session_id: str
    day: int
    start: int
    room_id: str
    faculty_id: str


class Weights(BaseModel):
    student_idle: float = Field(default=5, ge=0, le=10)
    faculty_idle: float = Field(default=3, ge=0, le=10)
    room_fit: float = Field(default=2, ge=0, le=10)
    workload_balance: float = Field(default=3, ge=0, le=10)
    preferences: float = Field(default=4, ge=0, le=10)

    def normalized(self) -> dict[str, float]:
        raw = self.model_dump()
        total = sum(raw.values())
        if total <= 0:
            raise ValueError("At least one objective weight must be greater than zero.")
        return {k: v / total for k, v in raw.items()}


def expand_sessions(ds: Dataset) -> list[Session]:
    sizes = {b.id: b.size for b in ds.batches}
    out: list[Session] = []
    for c in ds.courses:
        enrollment = sum(sizes.get(b, 0) for b in c.batch_ids)
        for k in range(c.sessions_per_week):
            out.append(Session(
                id=f"{c.id}-S{k + 1}", course_id=c.id, index=k, batch_ids=list(c.batch_ids),
                duration=c.duration_slots, enrollment=enrollment,
            ))
    return out


def section_atoms(ds: Dataset) -> dict[str, list[str]]:
    """Class section → its atomic batches (lab groups / elective divisions). A batch with no
    section is its own one-atom section."""
    out: dict[str, list[str]] = {}
    for b in ds.batches:
        out.setdefault(b.section or b.id, []).append(b.id)
    return out


def batch_weight(ds: Dataset) -> dict[str, float]:
    """Share of its class each atomic batch represents (1/n atoms), so per-class metrics are
    averages over the class's groups instead of sums that double-count a whole-class gap."""
    atoms = section_atoms(ds)
    return {b: 1 / len(lst) for lst in atoms.values() for b in lst}


def describe_batches(ds: Dataset, ids: list[str]) -> str:
    """Human label for a set of atomic batches: whole classes by name, otherwise the lab group
    (G1) or elective division (D2) they form."""
    atoms = section_atoms(ds)
    sec_of = {b: s for s, lst in atoms.items() for b in lst}
    chosen = set(ids)
    parts = []
    for sec in dict.fromkeys(sec_of.get(b, b) for b in ids):
        members = atoms.get(sec, [sec])
        have = [b for b in members if b in chosen]
        if len(have) == len(members):
            parts.append(sec)
            continue
        tags = [b[len(sec) + 1:] for b in have]  # e.g. G1D2
        label = None
        for key in ("G1", "G2", "D1", "D2", "D3"):
            full = [m for m in members if key in m[len(sec) + 1:]]
            if full and set(full) == set(have):
                label = f"{sec} · {'lab group ' + key if key[0] == 'G' else 'elective div ' + key[1]}"
        parts.append(label or f"{sec} · {'/'.join(tags)}")
    return " + ".join(parts)
