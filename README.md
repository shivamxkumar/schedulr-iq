# SCHEDULR IQ — *Every slot has a reason.*

Academic scheduling & optimization OS for **PS-6: Intelligent College Timetable Optimization**,
built for the **Indian Institute of Information Technology Surat**.

> We do not just generate a timetable. We generate a **valid** timetable, **independently verify** it,
> **optimize measurable objectives**, and **explain the trade-offs**.

## Run it

```bash
./start.sh                      # first run creates the venv and installs deps
# or manually:
cd backend  && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8010
cd frontend && npm install && npx vite          # http://localhost:5180
```

The frontend proxies `/api` to `:8010` (ports chosen to avoid the common 8000/5173).

**Sign in.** Three roles exist: **admin** (edit data, optimize, publish), **viewer** (read-only) and **demo** (via *View demo*: optimize and try moves, no data edits or publishing). Development
accounts are listed in `backend/.env.example`. In production, set `ADMIN_PASSWORD`, `VIEWER_PASSWORD` and
`SCHEDULR_SECRET` as environment variables. Tokens are HMAC-signed with a 12 h expiry; every `/api` route
except health/login requires one, and every non-GET route requires the admin role.

## Admin input (Setup screen)

Administrators enter everything the problem statement asks for directly in the UI:
- **Faculty:** profile, department, daily and weekly load limits, the courses each person may teach, and a
  painted weekly availability grid. *Unavailable* is a hard constraint; *Prefers not* is a soft objective.
- **Rooms & labs:** type, seating capacity, equipment, and closed/blocked slots.
- **Batches:** size, programme and curriculum.
- **Courses:** sessions per week, duration, attending batches (combined lectures), eligible faculty,
  acceptable room types, required equipment, and optional allowed start windows.
- **Calendar:** working days, day start, slot length, slots per day, break slots, and per-day closing time
  (e.g. half-day Saturday).

Edits stay in a draft that the backend checks live as you type: data errors and feasibility risks appear
before you save. *Save & generate* replaces the dataset and builds a new independently validated baseline.
Bulk CSV import is still available under **Import**.

## Deploy (single container)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/shivamxkumar/schedulr-iq)

`Dockerfile` builds the frontend and serves it from FastAPI on `$PORT`. `render.yaml` is a Render blueprint:
on Render, choose New → Blueprint, point it at this repo, then set `ADMIN_PASSWORD` and `VIEWER_PASSWORD`.
The same image runs on any Docker host:

```bash
docker build -t schedulr-iq . && docker run -p 8000:8000 -e ADMIN_PASSWORD=... -e VIEWER_PASSWORD=... schedulr-iq
```

Tests: `cd backend && .venv/bin/pytest -q` runs 21 tests covering the engine, validator, metrics, API flows, auth/demo roles, the IIIT Surat import and the infeasible case.

## Architecture

```
frontend/ (React + TS + Vite + Tailwind + Recharts)
  views/      Overview · Studio (timetable) · Lab (optimizer) · Conflicts · Resources · DataSetup · Publish
  components/ TimetableGrid (lanes, spans, drag-to-move) · Inspector (per-session explanation + slot map)
backend/app/ (FastAPI + OR-Tools CP-SAT + Pydantic)
  models.py        typed entities: Room, Faculty, Batch, Course, Session, Assignment, Weights
  candidates.py    legal (session, day, start, room, faculty) enumeration — unary constraints filtered up front
  baseline.py      deterministic first-fit + MRV + backtracking (the honest "before")
  solver.py        CP-SAT model, weighted soft objective, infeasibility diagnostics, partial mode
  validator.py     INDEPENDENT validator — recomputes every hard rule from raw data
  metrics.py       metric definitions (below)
  explain.py       change logs, per-session "why this slot", validated fix suggestions
  dataset_check.py referential & feasibility checks on input data
  csvio.py         CSV templates/import (row-level errors) and schedule export
  main.py          REST endpoints only
```

The scheduling engine does not depend on HTTP or the UI. Every endpoint that stores a schedule runs it
through `validator.validate()` first, and solver output that fails validation is discarded (HTTP 500), never stored.

## Algorithm

1. **Candidate filtering.** Every placement that breaks a unary hard rule is removed before modelling: time bounds, breaks, eligible start windows, room type, equipment, capacity, room and faculty availability, eligibility, and pinned sessions.
2. **Baseline.** Deterministic first-fit. It takes the most-constrained session first, places it at the earliest legal slot in the first listed room, and backtracks when stuck. It is valid, but it front-loads the week. If it exhausts its budget, a CP-SAT feasibility search takes over.
3. **CP-SAT optimization.** One Boolean per candidate. Hard constraints:
   - `ExactlyOne` placement per session.
   - `AtMostOne` per (room | faculty | batch, day, slot). This time-indexed form is exact for no-overlap on a discrete grid and covers every slot of a multi-slot session.
   - Faculty daily and weekly load limits.
   - At most one session of a course per day.
   - Teacher consistency: one faculty member per course, through implication to `y[course, faculty]`.
   - Symmetry breaking between interchangeable sessions.

   The objective minimizes Σₖ round(10⁴·ŵₖ/refₖ)·termₖ. The search is warm-started from the baseline, with a 10 s default time limit and 8 workers.
4. **Status honesty.** `OPTIMAL` means proven optimal for the weighted objective. `FEASIBLE` means the best incumbent at the time limit, reported with its remaining gap. `INFEASIBLE` returns diagnostics plus a max-coverage *partial* schedule, which is never publishable.

Hard constraints are never weighted penalties.

## Metric definitions (all computed from stored assignments)

| Metric | Definition | Goal |
|---|---|---|
| Student idle | Σ batches·days: teachable minutes between first class start and last class end not in class. Lunch excluded. | ↓ |
| Faculty idle | same, per faculty | ↓ |
| Room-time utilization | occupied room-slots ÷ available room-slots (minus room closures) | ↑ (constant once every session is placed) |
| Seat utilization | Σ enrollment×h ÷ Σ capacity×h of used rooms | ↑ |
| Wasted seat-hours | Σ (capacity − enrollment) × h | ↓ |
| Workload imbalance | Σ batches+faculty: busiest-day hours − ceil(weekly ÷ days) | ↓ |
| Preference satisfaction | share of sessions outside faculty "prefers not to teach" windows | ↑ |
| Soft score | Σ ŵₖ·termₖ / baselineₖ (each ref ≥ 1). Baseline ≈ 1.000. Relative to the baseline, **not** a % of optimality | ↓ |

## Demo data: IIIT Surat official timetable

**View demo** on the login page opens a demo session, with no account needed. That session loads the IIIT Surat
odd-semester timetable, transcribed from the Timetable Committee's `all_class_v4.pdf` (aSc Timetables) into
[`backend/data_src/iiit_surat_all_class_v4.txt`](backend/data_src/iiit_surat_all_class_v4.txt). The timetable covers 14 classes:
B.Tech Sem 1 (ECE A, CSE B/C/D), Sem 3 (ECE, CSE A/B), Sem 5 (ECE, CSE), Sem 7 (ECE, CSE), and M.Tech
ECE / CSE / DS & Comm. It totals 281 weekly sessions, Mon–Fri 09:00–18:00.

`scripts/build_iiits.py` turns the transcription into `app/iiits_official.json`:
- **Batches.** Each class is split into atomic batches by lab group (G1/G2) and elective division (D1–D3). A
  whole-class lecture attends every atom; a group lab attends half. Strict batch no-overlap therefore also
  covers labs running in parallel.
- **Shared sessions.** Sessions printed on several class sheets are merged into one session with all their
  batches: cross-listed electives (e.g. CS 9117/CS 743), M.Tech/B.Tech pairs, and the common HS 911.
  Back-to-back hours of the same course are merged into one block.
- **Faculty.** Initials are decoded with the public faculty lists for CSE, ECE, MSA and PSA. Matches based
  only on initials are tagged `inferred` (RRP, DN, TG, SA, RP), and two sets of initials not on those pages
  are kept as-is (`SR`, `SRS`). Placeholders such as `PAS F1` and `HSS F2` stay placeholders, one per
  course. Teaching assistants and scholars (PG25…, RS25…) are not modelled.
- **Course names.** These come from the public 2025 and 2023 curricula. M.Tech-only codes whose names are
  not public are labelled as such.
- **Assumptions (not public data).** Class sizes, room capacities (raised to the largest class actually seated
  there), faculty availability (always available; 17:00–18:00 marked "prefers not") and load limits (actual + 4 h).

The **official timetable is the baseline**: it is imported, not generated, and passes all 19 hard checks
with 0 violations. One CP-SAT run (30 s, default weights) is precomputed at build time. Against the official
timetable it brings student idle time from 12,660 to 3,300 min/week, faculty idle from 8,640 to
1,080 min/week, workload imbalance from 55 to 53 h, and preference misses from 7 to 0. Seat utilization falls 0.5 points, a reported
trade-off. Visitors can re-run the optimizer and try moves, but cannot edit data or publish.

A small **synthetic campus** (fictional names) is kept for the unit tests and the two infeasible diagnostic
scenarios.

## 3-minute demo script

0. **Login page → View demo.** This opens IIIT Surat's official v4 timetable, with no account needed.
1. **Overview.** The validator's verdict on the *official* timetable: 19/19 hard checks pass, 281/281 sessions, 0 conflicts. Student idle time is 12,660 min/week.
2. **Timetable.** One lane per class. Lab groups G1/G2 run side by side, and cross-listed electives span the S7 ECE, S7 CSE and M.Tech lanes. Click a block: the inspector shows its hard checks, why it sits there, and a slot map of every alternative.
3. **Optimization Lab.** Explain hard constraints vs soft objectives. *Viewing* switches to the precomputed run, which shows the comparison: student idle down 74%, faculty idle down 88%, preferences 7 → 0, and a 0.5-point seat-utilization trade-off. You can also re-run it live: 20 s, with honest `FEASIBLE (time limit)` status.
4. **Moves.** Drag a block to a clash: the move is rejected with the reason (e.g. `BATCH_OVERLAP`). Drop it on a lime slot: it is accepted, saved as a new version, and Undo is available.
5. **Conflicts → Load diagnostic example.** You get 9 violations, each with corrective actions and validated fixes. Apply one and the count drops. Publishing the example is refused.
6. **Sign in as admin → Setup.** Paint a faculty member's availability and watch the live feasibility check react. Save to regenerate. Then **Publish**: 19-check verification, CSV export and print.
7. `pytest -q`: 21 passing tests.

## Known limitations

- **Single shared workspace.** State lives in `backend/data/state.json`, so editing the dataset clears existing schedules. On free hosting tiers the disk is ephemeral: a redeploy restores the demo.
- **Accounts.** There are exactly two (admin and viewer) and they are configured through environment variables. There is no user management UI.
- **Reproducibility.** The baseline is fully deterministic. CP-SAT runs with a fixed seed and 8 workers, but when it stops at the time limit (not proven optimal), the incumbent can differ between runs. Proven-optimal objective values are reproducible.
- **IIIT Surat data.** The data is transcribed by hand from the PDF and checked by the validator (0 conflicts), but transcription slips are possible. Sizes, capacities and availability are assumed. Co-teachers on a session are not modelled; only the first-listed teacher is assigned.
- **Explanations are observational.** They come from diffs, measured effects, and enumerating alternatives. They do not claim to reveal solver internals.
- **Not modelled:** consecutive-hour caps, student electives at the individual level, and splitting a batch into lab groups.
- **Testing coverage.** The UI was tested at desktop width. The mobile layout (bottom navigation, drawer inspector) is implemented but not extensively tested.
- **Time model.** The grid is discrete (default 60-minute slots), and CSV time windows must align to slot boundaries.
