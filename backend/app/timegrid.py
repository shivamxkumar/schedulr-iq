"""Time-grid helpers shared by solver, validator and metrics."""
from __future__ import annotations

from .models import TimeConfig, Window


def minutes_of(tc: TimeConfig, slot: int) -> int:
    h, m = tc.day_start.split(":")
    return int(h) * 60 + int(m) + slot * tc.slot_minutes


def slot_label(tc: TimeConfig, slot: int) -> str:
    t = minutes_of(tc, slot)
    return f"{t // 60:02d}:{t % 60:02d}"


def where(tc: TimeConfig, day: int, start: int, duration: int) -> str:
    dname = tc.days[day] if 0 <= day < len(tc.days) else f"Day{day}"
    return f"{dname} {slot_label(tc, start)}–{slot_label(tc, start + duration)}"


def in_windows(windows: list[Window], day: int, slot: int) -> bool:
    return any(w.day == day and w.start <= slot < w.end for w in windows)


def is_teaching_slot(tc: TimeConfig, day: int, slot: int) -> bool:
    if day < 0 or day >= len(tc.days):
        return False
    limit = tc.day_slots[day] if day < len(tc.day_slots) else tc.slots_per_day
    return 0 <= slot < min(limit, tc.slots_per_day) and slot not in tc.break_slots


def valid_start(tc: TimeConfig, day: int, start: int, duration: int) -> bool:
    """A session occupies [start, start+duration); every slot must be teachable."""
    return all(is_teaching_slot(tc, day, s) for s in range(start, start + duration))


def teaching_slots(tc: TimeConfig, day: int) -> list[int]:
    return [s for s in range(tc.slots_per_day) if is_teaching_slot(tc, day, s)]


def total_teaching_slots(tc: TimeConfig) -> int:
    return sum(len(teaching_slots(tc, d)) for d in range(len(tc.days)))
