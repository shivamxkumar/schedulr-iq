from app.baseline import first_fit
from app.demo import demo_dataset
from app.metrics import compute_metrics, soft_score, term_refs
from app.models import Assignment, Course, Weights
from app.solver import solve
from app.timegrid import valid_start
from app.validator import validate


def codes(rep):
    return {v.code for v in rep.violations if v.severity == "hard"}


def baseline():
    ds = demo_dataset()
    return ds, first_fit(ds)


def test_demo_baseline_is_feasible_and_complete():
    ds, base = baseline()
    assert base is not None
    rep = validate(ds, base)
    assert rep.feasible and rep.complete and rep.hard_count == 0
    assert rep.scheduled == rep.required == 40


def test_optimizer_output_is_valid_and_not_worse():
    ds, base = baseline()
    refs = term_refs(compute_metrics(ds, base).terms)
    w = Weights()
    res = solve(ds, w, refs, hint=base, time_limit=10)
    assert res.status in ("optimal", "feasible")
    rep = validate(ds, res.assignments)
    assert rep.feasible and rep.complete
    assert rep.hard_count <= validate(ds, base).hard_count
    assert soft_score(compute_metrics(ds, res.assignments).terms, w, refs) <= soft_score(
        compute_metrics(ds, base).terms, w, refs) + 1e-9


def test_weights_change_the_optimum():
    ds, base = baseline()
    refs = term_refs(compute_metrics(ds, base).terms)
    only_rooms = solve(ds, Weights(student_idle=0, faculty_idle=0, room_fit=10, workload_balance=0, preferences=0),
                       refs, hint=base, time_limit=10)
    m = compute_metrics(ds, only_rooms.assignments)
    assert m.wasted_seat_hours <= compute_metrics(ds, base).wasted_seat_hours
    assert validate(ds, only_rooms.assignments).feasible


def test_zero_weights_rejected():
    import pytest
    with pytest.raises(ValueError):
        Weights(student_idle=0, faculty_idle=0, room_fit=0, workload_balance=0, preferences=0).normalized()


def test_multislot_overlap_detected_across_interval():
    ds, base = baseline()
    by = {a.session_id: a for a in base}
    lab = by["CS291-A-S1"]  # 3-slot lab for CSE-2A
    other = next(a for a in base if a.session_id.startswith("CS201-A"))
    moved = other.model_copy(update={"day": lab.day, "start": lab.start + 2})  # overlaps only the lab's last hour
    rep = validate(ds, [lab, moved])
    assert "BATCH_OVERLAP" in codes(rep)
    adjacent = other.model_copy(update={"day": lab.day, "start": lab.start + 3})
    assert "BATCH_OVERLAP" not in codes(validate(ds, [lab, adjacent]))


def test_duration_cannot_cross_break_or_day_end():
    ds = demo_dataset()
    tc = ds.time
    assert valid_start(tc, 0, 0, 3)
    assert not valid_start(tc, 0, 2, 3)  # 11:00-14:00 crosses lunch (slot 4)
    assert not valid_start(tc, 0, 6, 3)  # runs past 17:00
    assert not valid_start(tc, 5, 3, 2)  # Saturday is a half day


def test_invalid_schedule_rejected_with_structured_reasons():
    ds, base = baseline()
    bad = [a.model_copy() for a in base]
    by = {a.session_id: a for a in bad}
    by["EC201-S1"].room_id = "SR-301"  # 40 seats, seminar room, 48 students
    by["MA211-S1"].day = 1  # visiting professor unavailable Tuesday
    bad.append(Assignment(session_id="NOPE", day=0, start=0, room_id="LH-101", faculty_id="F01"))
    rep = validate(ds, bad)
    assert not rep.feasible
    assert {"ROOM_CAPACITY", "ROOM_TYPE", "FACULTY_UNAVAILABLE", "UNKNOWN_REFERENCE"} <= codes(rep)
    assert all(v.message for v in rep.violations)


def test_missing_and_double_booking_and_eligibility():
    ds, base = baseline()
    rep = validate(ds, base[1:])
    assert "MISSING_SESSION" in codes(rep) and not rep.complete
    a, b = base[0], next(x for x in base if x.session_id != base[0].session_id)
    clash = b.model_copy(update={"day": a.day, "start": a.start, "room_id": a.room_id, "faculty_id": "F05"})
    rep = validate(ds, [x for x in base if x.session_id != b.session_id] + [clash])
    assert "ROOM_OVERLAP" in codes(rep)
    assert "FACULTY_NOT_ELIGIBLE" in codes(rep) or b.session_id.startswith("EC")


def test_preferences_are_soft_only():
    ds, base = baseline()
    rep = validate(ds, base)
    assert rep.soft_count >= 0
    assert all(v.code == "PREFERENCE" for v in rep.violations if v.severity == "soft")
    assert "PREFERENCE" not in codes(rep)


def test_idle_time_metric_definition():
    ds = demo_dataset()
    ds.courses = [Course(id="X", code="X", name="X", course_type="lecture", batch_ids=["DS-3"], sessions_per_week=2,
                         duration_slots=1, room_types=["lecture"])]
    ds.faculty[0].courses = ["X"]
    # Mon 09:00 and Mon 15:00 -> gap 10,11,12 teachable, 13 is lunch (excluded), 14 teachable = 4 slots = 240 min
    a = [Assignment(session_id="X-S1", day=0, start=0, room_id="CR-201", faculty_id="F01"),
         Assignment(session_id="X-S2", day=0, start=6, room_id="CR-201", faculty_id="F01")]
    m = compute_metrics(ds, a)
    dsb = next(b for b in m.batches if b.id == "DS-3")
    assert dsb.idle_minutes == 240
    assert m.student_idle_minutes == 240


def test_room_utilization_definition():
    ds, base = baseline()
    m = compute_metrics(ds, base)
    occ = sum(r.occupied_slots for r in m.rooms)
    avail = sum(r.available_slots for r in m.rooms)
    assert occ == sum(next(c for c in ds.courses if a.session_id.startswith(c.id + "-S")).duration_slots for a in base)
    assert abs(m.room_time_utilization - occ / avail) < 1e-3


def test_infeasible_instance_reported():
    ds = demo_dataset()
    f08 = next(f for f in ds.faculty if f.id == "F08")
    f08.unavailable.append(f08.unavailable[0].model_copy(update={"day": 2}))  # now only Mon/Fri; MA211 needs 3 days
    res = solve(ds, weights=None, time_limit=5)
    assert res.status == "infeasible"
    assert any("MA211" in d for d in res.diagnostics)


def test_reproducible_baseline():
    ds = demo_dataset()
    assert first_fit(ds) == first_fit(ds)


def test_fast_placement_check_matches_full_validator():
    import random
    from app.validator import placement_violations, placement_violations_full
    ds, base = baseline()
    rng = random.Random(3)
    rooms = [r.id for r in ds.rooms]
    for _ in range(150):
        a = rng.choice(base)
        cand = a.model_copy(update={"day": rng.randrange(6), "start": rng.randrange(8), "room_id": rng.choice(rooms)})
        fast = {v.code for v in placement_violations(ds, base, cand)}
        full = {v.code for v in placement_violations_full(ds, base, cand)}
        # Pre-existing load issues are attributed identically; weekly-load only differs when the
        # baseline itself is over the limit, which a valid baseline never is.
        assert fast == full, (cand, fast, full)


def test_lab_groups_only_split_labs_and_clashes_count_once():
    from app.demos import load
    from app.models import describe_batches, expand_sessions
    b = load("iiit-surat")
    ds, off = b.dataset, b.official
    sess = {s.id: s for s in expand_sessions(ds)}
    courses = {c.id: c for c in ds.courses}
    # Every group-restricted session is a lab; lectures/tutorials attend whole classes or divisions.
    for s in sess.values():
        label = describe_batches(ds, s.batch_ids)
        if "lab group" in label:
            assert courses[s.course_id].course_type == "lab", (s.id, label)
    lec = sess["CS101-S1ECEA-S1"]
    assert describe_batches(ds, lec.batch_ids) == "S1-ECEA"
    # Put two whole-class S1-ECEA lectures on top of each other: exactly one BATCH_OVERLAP.
    by = {a.session_id: a for a in off}
    a, other = by["CS101-S1ECEA-S1"], by["AS102-S1ECEA-S1"]
    moved = other.model_copy(update={"day": a.day, "start": a.start, "room_id": "CR-1"})
    rep = validate(ds, [x for x in off if x.session_id != other.session_id] + [moved])
    clashes = [v for v in rep.violations if v.code == "BATCH_OVERLAP"]
    assert len(clashes) == 1 and "S1-ECEA has overlapping" in clashes[0].message


def test_lns_mode_improves_and_stays_valid():
    from app.demos import load
    from app.solver import solve_lns
    b = load("iiit-surat")
    refs = term_refs(compute_metrics(b.dataset, b.official).terms)
    start = validate(b.dataset, b.official).hard_count
    res = solve_lns(b.dataset, Weights(), refs, b.official, time_limit=10)
    rep = validate(b.dataset, res.assignments)
    assert rep.complete and rep.hard_count < start  # repairs missing lunch hours first


def test_lunch_window_enforced():
    ds, base = baseline()
    ds.time.lunch_window = [2, 3]  # 11:00-13:00 on the synthetic campus
    res = solve(ds, Weights(), term_refs(compute_metrics(ds, base).terms), time_limit=10)
    rep = validate(ds, res.assignments)
    assert rep.feasible and not any(v.code == "LUNCH_BREAK" for v in rep.violations)
    # Filling both lunch slots of a batch is reported.
    a = next(x for x in res.assignments if x.session_id.startswith("CS201-A"))
    b = next(x for x in res.assignments if x.session_id.startswith("CS202-A"))
    bad = [x for x in res.assignments if x.session_id not in (a.session_id, b.session_id)]
    bad += [a.model_copy(update={"day": 0, "start": 2}), b.model_copy(update={"day": 0, "start": 3})]
    assert any(v.code == "LUNCH_BREAK" for v in validate(ds, bad).violations)
