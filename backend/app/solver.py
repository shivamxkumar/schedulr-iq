"""CP-SAT timetable model.

Decision variables: one Boolean x per legal candidate (session, day, start, room, faculty);
illegal combinations are filtered out before the model is built (see candidates.py).
Time-indexed resource constraints (Σ x covering a slot ≤ 1 per room/faculty/batch) are an
exact formulation of optional-interval no-overlap on a discrete grid, and give us occupancy
expressions to model idle gaps directly.

Hard constraints are constraints, never penalties. Soft objectives are combined as
Σ_k round(SCALE · ŵ_k / ref_k) · term_k so that each weight expresses relative importance
after normalising every term by its baseline magnitude.
"""
from __future__ import annotations

import os
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

from ortools.sat.python import cp_model

from .candidates import Cand, build_candidates, explain_no_candidates
from .metrics import TERM_KEYS
from .models import Assignment, Dataset, Weights, expand_sessions, section_atoms
from .timegrid import in_windows, is_teaching_slot

SCALE = 10_000


def _workers() -> int:
    """CPU workers for CP-SAT. Render's free plan reports the host's CPUs but grants ~0.1 CPU."""
    if os.environ.get("SOLVER_WORKERS"):
        return int(os.environ["SOLVER_WORKERS"])
    return 1 if os.environ.get("RENDER") else min(8, os.cpu_count() or 1)


@dataclass
class SolveResult:
    status: str  # optimal | feasible | infeasible | partial | error
    assignments: list[Assignment] = field(default_factory=list)
    message: str = ""
    wall_seconds: float = 0.0
    objective: Optional[float] = None
    best_bound: Optional[float] = None
    num_candidates: int = 0
    num_variables: int = 0
    num_constraints: int = 0
    diagnostics: list[str] = field(default_factory=list)
    log: list[str] = field(default_factory=list)


def presolve_diagnostics(ds: Dataset) -> list[str]:
    sessions, cands = build_candidates(ds)
    out = []
    for s in sessions:
        if not cands[s.id]:
            out.append(f"{s.id}: no legal placement. {explain_no_candidates(ds, s)}")
    courses = {c.id: c for c in ds.courses}
    for c in ds.courses:
        days = {cd.day for s in sessions if s.course_id == c.id for cd in cands[s.id]}
        if 0 < len(days) < c.sessions_per_week:
            out.append(f"{c.code} ({c.id}) needs {c.sessions_per_week} sessions on distinct days but only "
                       f"{len(days)} day(s) have any legal placement.")
    for f in ds.faculty:
        if not f.courses:
            continue
        sole = [c for c in ds.courses if [x.id for x in ds.faculty if c.id in x.courses] == [f.id]]
        need = sum(c.sessions_per_week * c.duration_slots for c in sole)
        if need > f.max_weekly_slots:
            out.append(f"{f.name} is the only eligible teacher for {', '.join(c.code for c in sole)} "
                       f"({need} slots/week) but max weekly load is {f.max_weekly_slots}.")
    for b in ds.batches:
        need = sum(courses[c.id].sessions_per_week * courses[c.id].duration_slots for c in ds.courses if b.id in c.batch_ids)
        cap = sum(1 for d in range(len(ds.time.days)) for t in range(ds.time.slots_per_day) if is_teaching_slot(ds.time, d, t))
        if need > cap:
            out.append(f"Batch {b.id} needs {need} teaching slots/week but only {cap} exist.")
    return out


def solve(ds: Dataset, weights: Optional[Weights], refs: Optional[dict[str, float]] = None,
          hint: Optional[list[Assignment]] = None, time_limit: float = 12.0, partial: bool = False,
          seed: int = 7) -> SolveResult:
    t0 = time.time()
    tc = ds.time
    sessions, cands = build_candidates(ds)
    sess = {s.id: s for s in sessions}
    courses = {c.id: c for c in ds.courses}
    rooms = {r.id: r for r in ds.rooms}
    fac = {f.id: f for f in ds.faculty}
    nd = len(tc.days)
    log = [f"Sessions: {len(sessions)} · legal candidates: {sum(len(v) for v in cands.values())}"]

    if not partial:
        empty = [s for s in sessions if not cands[s.id]]
        if empty:
            return SolveResult(status="infeasible", message="Some sessions have no legal placement at all.",
                               diagnostics=presolve_diagnostics(ds), wall_seconds=time.time() - t0, log=log)

    m = cp_model.CpModel()
    allc: list[Cand] = [c for s in sessions for c in cands[s.id]]
    x = [m.NewBoolVar(f"x{i}") for i in range(len(allc))]
    by_sess: dict[str, list[int]] = defaultdict(list)
    cover: dict[tuple[str, str, int, int], list[int]] = defaultdict(list)
    fday: dict[tuple[str, int], list[tuple[int, int]]] = defaultdict(list)
    fweek: dict[str, list[tuple[int, int]]] = defaultdict(list)
    cday: dict[tuple[str, int], list[int]] = defaultdict(list)
    cfac: dict[tuple[str, str], list[int]] = defaultdict(list)
    for i, c in enumerate(allc):
        s = sess[c.sid]
        by_sess[c.sid].append(i)
        for t in c.span:
            cover[("room", c.room, c.day, t)].append(i)
            cover[("fac", c.fac, c.day, t)].append(i)
            for b in s.batch_ids:
                cover[("batch", b, c.day, t)].append(i)
        fday[(c.fac, c.day)].append((i, c.dur))
        fweek[c.fac].append((i, c.dur))
        cday[(s.course_id, c.day)].append(i)
        cfac[(s.course_id, c.fac)].append(i)

    placed = {}
    for s in sessions:
        if not by_sess[s.id]:
            continue
        e = sum(x[i] for i in by_sess[s.id])
        placed[s.id] = e
        if partial:
            m.Add(e <= 1)
        else:
            m.AddExactlyOne(x[i] for i in by_sess[s.id])
    for key, idx in cover.items():
        if len(idx) > 1:
            m.AddAtMostOne(x[i] for i in idx)
    if tc.lunch_window:
        cap = len(tc.lunch_window) - min(tc.lunch_slots, len(tc.lunch_window))
        for b in ds.batches:
            for d in range(nd):
                idx = [i for t in tc.lunch_window for i in cover.get(("batch", b.id, d, t), [])]
                if idx:
                    m.Add(sum(x[i] for i in idx) <= cap)
    for (fid, d), lst in fday.items():
        m.Add(sum(x[i] * w for i, w in lst) <= fac[fid].max_daily_slots)
    for fid, lst in fweek.items():
        m.Add(sum(x[i] * w for i, w in lst) <= fac[fid].max_weekly_slots)
    for idx in cday.values():
        if len(idx) > 1:
            m.AddAtMostOne(x[i] for i in idx)
    # Teacher consistency: each course is taught by exactly one faculty member.
    y: dict[tuple[str, str], cp_model.IntVar] = {}
    for (cid, fid), idx in cfac.items():
        y[(cid, fid)] = m.NewBoolVar(f"y_{cid}_{fid}")
        for i in idx:
            m.AddImplication(x[i], y[(cid, fid)])
    for c in ds.courses:
        ys = [v for (cid, _), v in y.items() if cid == c.id]
        if ys:
            m.AddAtMostOne(ys)
    # Symmetry breaking: interchangeable sessions of a course are ordered by day.
    pinned = {f.session_id for f in ds.fixed}
    for c in ds.courses:
        sids = [s.id for s in sessions if s.course_id == c.id]
        if len(sids) > 1 and not pinned.intersection(sids) and not partial:
            dv = [sum(x[i] * allc[i].day for i in by_sess[sid]) for sid in sids]
            for a, b in zip(dv, dv[1:]):
                m.Add(a < b)

    if partial:
        m.Maximize(sum(placed.values()))
    elif weights is not None:
        w = weights.normalized()
        refs = refs or {k: 1.0 for k in TERM_KEYS}
        coef = {k: (SCALE * w[k] / refs[k]) for k in TERM_KEYS}
        terms = []

        def occ_expr(kind, eid, d, t):
            idx = cover.get((kind, eid, d, t), [])
            return sum(x[i] for i in idx) if idx else 0, bool(idx)

        # Integer weights: a batch that is 1 of n groups of its class weighs 60/n, everything else
        # 60, so the objective equals 60 × the per-class metrics reported by metrics.py.
        bw = {b: 60 // len(lst) for lst in section_atoms(ds).values() for b in lst}
        U = 60

        def idle_terms(kind, ids) -> list:
            out = []
            for eid in ids:
                for d in range(nd):
                    slots = [t for t in range(tc.slots_per_day) if is_teaching_slot(tc, d, t) or t in tc.break_slots]
                    occ = {t: occ_expr(kind, eid, d, t) for t in slots}
                    if sum(1 for t in slots if occ[t][1]) < 2:
                        continue
                    A, B = {}, {}
                    prev = None
                    for t in slots:
                        A[t] = m.NewBoolVar("")
                        if prev is not None:
                            m.Add(A[t] >= A[prev])
                        if occ[t][1]:
                            m.Add(A[t] >= occ[t][0])
                        prev = t
                    prev = None
                    for t in reversed(slots):
                        B[t] = m.NewBoolVar("")
                        if prev is not None:
                            m.Add(B[t] >= B[prev])
                        if occ[t][1]:
                            m.Add(B[t] >= occ[t][0])
                        prev = t
                    for t in slots:
                        if not is_teaching_slot(tc, d, t) or t in tc.lunch_window:
                            continue  # breaks and the lunch window are never idle time
                        g = m.NewBoolVar("")
                        m.Add(g >= A[t] + B[t] - 1 - (occ[t][0] if occ[t][1] else 0))
                        out.append(g * (bw.get(eid, U) if kind == "batch" else U))
            return out

        if coef["student_idle"] > 0:
            g = idle_terms("batch", [b.id for b in ds.batches])
            terms.append((coef["student_idle"], sum(g)))
        if coef["faculty_idle"] > 0:
            g = idle_terms("fac", [f.id for f in ds.faculty])
            terms.append((coef["faculty_idle"], sum(g)))
        if coef["room_fit"] > 0:
            terms.append((coef["room_fit"], sum(
                x[i] * ((rooms[c.room].capacity - sess[c.sid].enrollment) * c.dur * U) for i, c in enumerate(allc))))
        if coef["workload_balance"] > 0:
            peaks = []
            for kind, ids in (("batch", [b.id for b in ds.batches]), ("fac", [f.id for f in ds.faculty])):
                for eid in ids:
                    daily = []
                    for d in range(nd):
                        lst = [i for t in range(tc.slots_per_day) for i in cover.get((kind, eid, d, t), [])]
                        if lst:
                            daily.append(sum(x[i] for i in lst))
                    if daily:
                        p = m.NewIntVar(0, tc.slots_per_day, "")
                        for e in daily:
                            m.Add(p >= e)
                        peaks.append(p * (bw.get(eid, U) if kind == "batch" else U))
            terms.append((coef["workload_balance"], sum(peaks)))
        if coef["preferences"] > 0:
            miss = [i for i, c in enumerate(allc) if any(in_windows(fac[c.fac].dispreferred, c.day, t) for t in c.span)]
            terms.append((coef["preferences"], sum(x[i] * U for i in miss)))
        # Integer coefficients: scale up by a common factor so small weights keep resolution.
        m.Minimize(sum(int(round(k)) * e for k, e in terms if int(round(k)) > 0))
        log.append("Objective weights (normalized): " + ", ".join(f"{k}={w[k]:.2f}" for k in TERM_KEYS))

    if hint:
        hs = {(a.session_id, a.day, a.start, a.room_id, a.faculty_id) for a in hint}
        for i, c in enumerate(allc):
            m.AddHint(x[i], 1 if (c.sid, c.day, c.start, c.room, c.fac) in hs else 0)
        log.append("Warm start: baseline schedule supplied as solution hint.")

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_workers = _workers()
    solver.parameters.random_seed = seed
    st = solver.Solve(m)
    name = solver.StatusName(st)
    proto = m.Proto()
    res = SolveResult(status="error", wall_seconds=round(time.time() - t0, 2), num_candidates=len(allc),
                      num_variables=len(proto.variables), num_constraints=len(proto.constraints), log=log)
    log.append(f"Model: {res.num_variables} variables · {res.num_constraints} constraints")
    log.append(f"CP-SAT status {name} after {solver.WallTime():.2f}s · {solver.NumBranches()} branches · "
               f"{solver.NumConflicts()} conflicts")
    if st in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        res.assignments = [Assignment(session_id=c.sid, day=c.day, start=c.start, room_id=c.room, faculty_id=c.fac)
                           for i, c in enumerate(allc) if solver.Value(x[i])]
        res.assignments.sort(key=lambda a: (a.day, a.start, a.session_id))
        res.objective = solver.ObjectiveValue()
        res.best_bound = solver.BestObjectiveBound()
        if partial:
            res.status = "partial"
            res.message = (f"No complete timetable exists under the current constraints. Best partial: "
                           f"{len(res.assignments)}/{len(sessions)} sessions placed (not publishable).")
        elif st == cp_model.OPTIMAL:
            res.status = "optimal"
            res.message = "Proven optimal for the weighted soft objective under all hard constraints."
        else:
            gap = abs(res.objective - res.best_bound) / max(1.0, abs(res.objective))
            res.status = "feasible"
            res.message = (f"Time limit reached: best feasible timetable found, optimality not proven "
                           f"(remaining gap to bound ≈ {gap:.0%}).")
    elif st == cp_model.INFEASIBLE:
        res.status = "infeasible"
        res.message = "No feasible timetable exists under the current hard constraints."
        res.diagnostics = presolve_diagnostics(ds)
    else:
        res.status = "error"
        res.message = f"Solver returned {name} without a solution within {time_limit:.0f}s."
    log.append(res.message)
    return res


def find_feasible(ds: Dataset, time_limit: float = 10.0) -> SolveResult:
    return solve(ds, weights=None, time_limit=time_limit)


def max_partial(ds: Dataset, time_limit: float = 8.0) -> SolveResult:
    return solve(ds, weights=None, partial=True, time_limit=time_limit)



def solve_lns(ds: Dataset, weights: Weights, refs: dict[str, float], hint: list[Assignment], time_limit: float = 20.0,
              seed: int = 7, neighbourhood: Optional[int] = None) -> SolveResult:
    """Large-neighbourhood search for small hosts (e.g. a 0.1-CPU free instance).

    Each round frees the sessions of a few class sections (plus their teachers' other sessions),
    pins everything else to the incumbent via `Dataset.fixed`, and lets CP-SAT re-optimize that
    small model. A round is accepted only if the independent validator passes and the weighted
    score strictly improves, so the incumbent is always a valid timetable."""
    import random

    from .metrics import compute_metrics, soft_score
    from .models import FixedAssignment, section_atoms
    from .validator import validate

    t0 = time.time()
    small_host = bool(os.environ.get("RENDER"))
    neighbourhood = neighbourhood or (1 if small_host else 2)
    rng = random.Random(seed)
    sess = {s.id: s for s in expand_sessions(ds)}
    sec_of = {b: sec for sec, lst in section_atoms(ds).items() for b in lst}
    sections = sorted(set(sec_of.values()))
    current = list(hint)
    best = soft_score(compute_metrics(ds, current).terms, weights, refs)
    best_hard = validate(ds, current).hard_count
    start_score = best
    log = [f"LNS mode · {len(sess)} sessions · start score {best:.3f}"]
    rounds = accepted = 0
    while time.time() - t0 < time_limit - 1.0:
        rounds += 1
        # Repair first: free classes that still break a hard rule (e.g. no lunch hour).
        broken = sorted({v.resource_id for v in validate(ds, current).violations
                         if v.severity == "hard" and v.resource_kind == "batch" and v.resource_id in sections})
        pool = broken or sections
        chosen = set(rng.sample(pool, min(neighbourhood, len(pool))))
        free = {a.session_id for a in current if any(sec_of.get(b) in chosen for b in sess[a.session_id].batch_ids)}
        per_round = 4.0 if small_host else min(6.0, max(1.0, time_limit / 6))
        budget = min(per_round, max(0.5, time_limit - (time.time() - t0) - 0.5))
        cand_list = solve_focus(ds, weights, refs, current, free, budget, seed=seed + rounds)
        if cand_list is None:
            continue
        res = SolveResult(status="feasible", assignments=cand_list)
        rep = validate(ds, res.assignments)
        score = soft_score(compute_metrics(ds, res.assignments).terms, weights, refs)
        if rep.complete and (rep.hard_count < best_hard or (rep.hard_count == best_hard and score < best - 1e-9)):
            current, best, best_hard = res.assignments, score, rep.hard_count
            accepted += 1
            log.append(f"round {rounds}: freed {len(free)} sessions ({', '.join(sorted(chosen))}) → score {best:.3f}")
    msg = (f"Large-neighbourhood search: {accepted} improving rounds of {rounds} in {time.time() - t0:.1f}s, "
           f"score {start_score:.3f} → {best:.3f}"
           + (f", {best_hard} hard violation(s) remain" if best_hard else "") + ". Optimality not proven.")
    log.append(msg)
    return SolveResult(status="feasible", assignments=sorted(current, key=lambda a: (a.day, a.start, a.session_id)),
                       message=msg, wall_seconds=round(time.time() - t0, 2), log=log)


def solve_focus(ds: Dataset, weights: Weights, refs: dict[str, float], current: list[Assignment], focus: set[str],
                time_limit: float, seed: int = 7) -> Optional[list[Assignment]]:
    """Re-optimize only the `focus` sessions; every other session is a constant taken from
    `current`. Builds a small model whose soft terms cover only the batches and teachers the focus
    sessions touch (all other terms are constant). Returns the full assignment list or None."""
    from .candidates import build_candidates

    tc = ds.time
    sessions, cands = build_candidates(ds, only=focus)
    sess = {s.id: s for s in sessions}
    fac = {f.id: f for f in ds.faculty}
    rooms = {r.id: r for r in ds.rooms}
    consts = [a for a in current if a.session_id not in focus]
    busy: set[tuple[str, str, int, int]] = set()
    fday: dict[tuple[str, int], int] = defaultdict(int)
    fweek: dict[str, int] = defaultdict(int)
    cday: set[tuple[str, int]] = set()
    cfac: dict[str, str] = {}
    for a in consts:
        s = sess[a.session_id]
        for t in range(a.start, a.start + s.duration):
            busy.add(("room", a.room_id, a.day, t))
            busy.add(("fac", a.faculty_id, a.day, t))
            for b in s.batch_ids:
                busy.add(("batch", b, a.day, t))
        fday[(a.faculty_id, a.day)] += s.duration
        fweek[a.faculty_id] += s.duration
        cday.add((s.course_id, a.day))
        cfac[s.course_id] = a.faculty_id

    def free_ok(c: Cand) -> bool:
        s = sess[c.sid]
        if (s.course_id, c.day) in cday or cfac.get(s.course_id, c.fac) != c.fac:
            return False
        for t in c.span:
            if ("room", c.room, c.day, t) in busy or ("fac", c.fac, c.day, t) in busy:
                return False
            if any(("batch", b, c.day, t) in busy for b in s.batch_ids):
                return False
        return True

    m = cp_model.CpModel()
    allc = [c for sid in sorted(focus) for c in cands.get(sid, []) if free_ok(c)]
    if any(not any(c.sid == sid for c in allc) for sid in focus):
        return None
    x = [m.NewBoolVar("") for _ in allc]
    by_sess: dict[str, list[int]] = defaultdict(list)
    cover: dict[tuple[str, str, int, int], list[int]] = defaultdict(list)
    for i, c in enumerate(allc):
        by_sess[c.sid].append(i)
        for t in c.span:
            cover[("room", c.room, c.day, t)].append(i)
            cover[("fac", c.fac, c.day, t)].append(i)
            for b in sess[c.sid].batch_ids:
                cover[("batch", b, c.day, t)].append(i)
    for sid in focus:
        m.AddExactlyOne(x[i] for i in by_sess[sid])
    for idx in cover.values():
        if len(idx) > 1:
            m.AddAtMostOne(x[i] for i in idx)
    lday: dict[tuple[str, int], list[int]] = defaultdict(list)
    lweek: dict[str, list[int]] = defaultdict(list)
    sday: dict[tuple[str, int], list[int]] = defaultdict(list)
    yfac: dict[tuple[str, str], list[int]] = defaultdict(list)
    for i, c in enumerate(allc):
        lday[(c.fac, c.day)].append(i)
        lweek[c.fac].append(i)
        sday[(sess[c.sid].course_id, c.day)].append(i)
        yfac[(sess[c.sid].course_id, c.fac)].append(i)
    for (fid, d), idx in lday.items():
        m.Add(sum(x[i] * allc[i].dur for i in idx) + fday[(fid, d)] <= fac[fid].max_daily_slots)
    for fid, idx in lweek.items():
        m.Add(sum(x[i] * allc[i].dur for i in idx) + fweek[fid] <= fac[fid].max_weekly_slots)
    for idx in sday.values():
        if len(idx) > 1:
            m.AddAtMostOne(x[i] for i in idx)
    if tc.lunch_window:
        cap = len(tc.lunch_window) - min(tc.lunch_slots, len(tc.lunch_window))
        for b in {b for sid in focus for b in sess[sid].batch_ids}:
            for d in range(len(tc.days)):
                fixed_n = sum(1 for t in tc.lunch_window if ("batch", b, d, t) in busy)
                idx = [i for t in tc.lunch_window for i in cover.get(("batch", b, d, t), [])]
                if idx and fixed_n <= cap:  # cannot repair a day the constants already break
                    m.Add(sum(x[i] for i in idx) + fixed_n <= cap)
    ys: dict[str, list] = defaultdict(list)
    for (cid, fid), idx in yfac.items():
        y = m.NewBoolVar("")
        ys[cid].append(y)
        for i in idx:
            m.AddImplication(x[i], y)
    for lst in ys.values():
        m.AddAtMostOne(lst)

    w = weights.normalized()
    U = 60
    bw = {b: U // len(lst) for lst in section_atoms(ds).values() for b in lst}
    coef = {k: SCALE * w[k] / refs[k] for k in TERM_KEYS}
    touched_b = {b for sid in focus for b in sess[sid].batch_ids}
    touched_f = {c.fac for c in allc}
    terms = []

    def occ(kind, eid, d, t):
        if (kind, eid, d, t) in busy:
            return 1
        idx = cover.get((kind, eid, d, t), [])
        return sum(x[i] for i in idx) if idx else 0

    def idle(kind, eid, wgt):
        out = []
        for d in range(len(tc.days)):
            slots = [t for t in range(tc.slots_per_day) if is_teaching_slot(tc, d, t) or t in tc.break_slots]
            o = {t: occ(kind, eid, d, t) for t in slots}
            if all(isinstance(v, int) and v == 0 for v in o.values()):
                continue
            A, B, prev = {}, {}, None
            for t in slots:
                A[t] = m.NewBoolVar("")
                if prev is not None:
                    m.Add(A[t] >= A[prev])
                m.Add(A[t] >= o[t])
                prev = t
            prev = None
            for t in reversed(slots):
                B[t] = m.NewBoolVar("")
                if prev is not None:
                    m.Add(B[t] >= B[prev])
                m.Add(B[t] >= o[t])
                prev = t
            for t in slots:
                if is_teaching_slot(tc, d, t) and t not in tc.lunch_window:
                    g = m.NewBoolVar("")
                    m.Add(g >= A[t] + B[t] - 1 - o[t])
                    out.append(g * wgt)
        return out

    def peak(kind, eid, wgt):
        p = m.NewIntVar(0, tc.slots_per_day, "")
        for d in range(len(tc.days)):
            m.Add(p >= sum(occ(kind, eid, d, t) for t in range(tc.slots_per_day)))
        return p * wgt

    if coef["student_idle"] > 0:
        terms.append((coef["student_idle"], sum(g for b in touched_b for g in idle("batch", b, bw.get(b, U)))))
    if coef["faculty_idle"] > 0:
        terms.append((coef["faculty_idle"], sum(g for f in touched_f for g in idle("fac", f, U))))
    if coef["room_fit"] > 0:
        terms.append((coef["room_fit"], sum(x[i] * ((rooms[c.room].capacity - sess[c.sid].enrollment) * c.dur * U)
                                            for i, c in enumerate(allc))))
    if coef["workload_balance"] > 0:
        terms.append((coef["workload_balance"], sum([peak("batch", b, bw.get(b, U)) for b in touched_b] +
                                                    [peak("fac", f, U) for f in touched_f])))
    if coef["preferences"] > 0:
        terms.append((coef["preferences"], sum(x[i] * U for i, c in enumerate(allc)
                                               if any(in_windows(fac[c.fac].dispreferred, c.day, t) for t in c.span))))
    m.Minimize(sum(int(round(k)) * e for k, e in terms if int(round(k)) > 0))
    hs = {(a.session_id, a.day, a.start, a.room_id, a.faculty_id) for a in current}
    for i, c in enumerate(allc):
        m.AddHint(x[i], 1 if (c.sid, c.day, c.start, c.room, c.fac) in hs else 0)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_workers = _workers()
    solver.parameters.random_seed = seed
    st = solver.Solve(m)
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None
    new = [Assignment(session_id=c.sid, day=c.day, start=c.start, room_id=c.room, faculty_id=c.fac)
           for i, c in enumerate(allc) if solver.Value(x[i])]
    return consts + new
