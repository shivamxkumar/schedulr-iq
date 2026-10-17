"""Deterministic first-fit baseline with backtracking.

This mimics how a timetable is commonly built by hand: take the hardest-to-place session
first (fewest currently legal placements - MRV), drop it into the earliest legal slot in the
first suitable room listed, and backtrack when stuck. It is hard-constraint aware but makes no
attempt to optimise soft objectives, which is what makes it a fair "before" picture.
"""
from __future__ import annotations

import time
from collections import defaultdict
from typing import Optional

from .candidates import Cand, build_candidates
from .models import Assignment, Dataset


class _State:
    def __init__(self, ds: Dataset, sessions):
        self.ds = ds
        self.sess = {s.id: s for s in sessions}
        self.fac = {f.id: f for f in ds.faculty}
        self.busy: set[tuple[str, str, int, int]] = set()  # (kind, id, day, slot)
        self.fday: dict[tuple[str, int], int] = defaultdict(int)
        self.fweek: dict[str, int] = defaultdict(int)
        self.cday: set[tuple[str, int]] = set()
        self.cfac: dict[str, str] = {}
        self.cfac_count: dict[str, int] = defaultdict(int)

    def keys(self, c: Cand):
        s = self.sess[c.sid]
        for t in c.span:
            yield ("room", c.room, c.day, t)
            yield ("fac", c.fac, c.day, t)
            for b in s.batch_ids:
                yield ("batch", b, c.day, t)

    def ok(self, c: Cand) -> bool:
        s = self.sess[c.sid]
        f = self.fac[c.fac]
        if (s.course_id, c.day) in self.cday:
            return False
        if self.cfac.get(s.course_id, c.fac) != c.fac:
            return False
        if self.fday[(c.fac, c.day)] + c.dur > f.max_daily_slots or self.fweek[c.fac] + c.dur > f.max_weekly_slots:
            return False
        if any(k in self.busy for k in self.keys(c)):
            return False
        tc = self.ds.time
        if tc.lunch_window and any(t in tc.lunch_window for t in c.span):
            cap = len(tc.lunch_window) - min(tc.lunch_slots, len(tc.lunch_window))
            for b in s.batch_ids:
                used = sum(1 for t in tc.lunch_window if ("batch", b, c.day, t) in self.busy or t in c.span)
                if used > cap:
                    return False
        return True

    def place(self, c: Cand):
        s = self.sess[c.sid]
        self.busy.update(self.keys(c))
        self.fday[(c.fac, c.day)] += c.dur
        self.fweek[c.fac] += c.dur
        self.cday.add((s.course_id, c.day))
        self.cfac[s.course_id] = c.fac
        self.cfac_count[s.course_id] += 1

    def unplace(self, c: Cand):
        s = self.sess[c.sid]
        self.busy.difference_update(set(self.keys(c)))
        self.fday[(c.fac, c.day)] -= c.dur
        self.fweek[c.fac] -= c.dur
        self.cday.discard((s.course_id, c.day))
        self.cfac_count[s.course_id] -= 1
        if self.cfac_count[s.course_id] == 0:
            del self.cfac[s.course_id]


def first_fit(ds: Dataset, node_limit: int = 20_000, time_budget: float = 3.0) -> Optional[list[Assignment]]:
    sessions, cands = build_candidates(ds)
    if any(not v for v in cands.values()):
        return None
    room_order = {r.id: i for i, r in enumerate(ds.rooms)}
    fac_order = {f.id: i for i, f in enumerate(ds.faculty)}
    for sid in cands:
        cands[sid].sort(key=lambda c: (c.day, c.start, room_order[c.room], fac_order[c.fac]))
    st = _State(ds, sessions)
    chosen: dict[str, Cand] = {}
    nodes = 0
    deadline = time.time() + time_budget

    def dfs() -> bool:
        nonlocal nodes
        open_ids = [s.id for s in sessions if s.id not in chosen]
        if not open_ids:
            return True
        best_id, best_opts = None, None
        for sid in open_ids:
            opts = [c for c in cands[sid] if st.ok(c)]
            if best_opts is None or len(opts) < len(best_opts):
                best_id, best_opts = sid, opts
                if not opts:
                    return False
        for c in best_opts:
            nodes += 1
            if nodes > node_limit or time.time() > deadline:
                return False
            st.place(c)
            chosen[best_id] = c
            if dfs():
                return True
            st.unplace(c)
            del chosen[best_id]
        return False

    if not dfs():
        return None
    return [Assignment(session_id=c.sid, day=c.day, start=c.start, room_id=c.room, faculty_id=c.fac)
            for c in sorted(chosen.values(), key=lambda c: (c.day, c.start, c.sid))]
