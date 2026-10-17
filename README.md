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

**Sign in.** Two roles exist: **admin** (edit data, optimize, publish) and **viewer** (read-only). Development
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

`Dockerfile` builds the frontend and serves it from FastAPI on `$PORT`. `render.yaml` is a Render blueprint:
on Render, choose New → Blueprint, point it at this repo, then set `ADMIN_PASSWORD` and `VIEWER_PASSWORD`.
The same image runs on any Docker host:

```bash
docker build -t schedulr-iq . && docker run -p 8000:8000 -e ADMIN_PASSWORD=... -e VIEWER_PASSWORD=... schedulr-iq
```

Tests: `cd backend && .venv/bin/pytest -q` runs 18 tests covering the engine, validator, metrics, API flows, auth and the infeasible case.

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

## Demo dataset (IIIT Surat, fictional faculty names)

The dataset has 4 batches (204 students), 7 rooms (2 labs), 8 faculty and 16 course offerings with 40 weekly sessions (1 h lectures and tutorials, 2–3 h labs). Built-in challenges:

- The combined MA201 lecture (118 students) fits only LH-101.
- The visiting professor is available only Mon/Wed/Fri, and MA211 needs 3 distinct days.
- Three 3-hour labs share one computing lab, which is closed on Saturday.
- The electronics lab runs afternoons only.
- Saturday is a half day.
- Faculty preferences compete with gap-free student days.

**Diagnostic examples** are explicitly labelled and never presented as real data:
- A corrupted schedule copy for the Conflict Inspector.
- "Hall closed": MA201 has no room, so it is rejected as a dataset error.
- "Visiting overload": MA211 becomes infeasible, which returns diagnostics and a partial schedule.

## 3-minute demo script

0. **Sign in** as admin. The IIIT Surat login page explains the admin and viewer roles.
1. **Overview.** The verdict panel answers "feasible / optimized / publishable" from the validator. The baseline crowds Monday (see the batch heat strip).
2. **Optimization Lab.** Explain hard constraints (left) vs the 5 weighted soft objectives. Click **Optimize**: the run takes about 10 s and the result is re-validated. Show the baseline vs optimized table: student idle 480 → 0 min, wasted seat-hours 1742 → 402, preference satisfaction 52.5% → 100%, workload imbalance 21 → 3 h, hard violations 0 → 0.
3. Switch the preset to **Space-efficient** and run again. Seat waste drops further while other terms trade off. Point at the solver status (`OPTIMAL` vs `FEASIBLE (limit)`).
4. **Timetable.** Toggle *Compare to baseline* to show ghosts of the old positions. Click a block. The Inspector shows the 12 per-session hard checks, "why this slot" (feasible alternatives, local optimality, blocked-start reasons) and the slot map.
5. Click a grey cell (e.g. Tue for MA211): **rejected** with `FACULTY_UNAVAILABLE`. Click a lime cell: it is accepted, saved as a new version, and Undo is available.
6. **Conflicts → Load diagnostic example.** Nine violations appear with corrective actions. Apply a validated fix and the count drops. Publishing it is refused (409).
7. **Publish.** The 19-check verification runs, then mark as final, export CSV, print per batch.
8. **Setup:** paint a faculty member's availability and watch the live feasibility check react, then save to regenerate.
9. `pytest -q`: 18 passing tests.

## Known limitations

- **Single shared workspace.** State lives in `backend/data/state.json`, so editing the dataset clears existing schedules. On free hosting tiers the disk is ephemeral: a redeploy restores the demo.
- **Accounts.** There are exactly two (admin and viewer) and they are configured through environment variables. There is no user management UI.
- **Reproducibility.** The baseline is fully deterministic. CP-SAT runs with a fixed seed and 8 workers, but when it stops at the time limit (not proven optimal), the incumbent can differ between runs. Proven-optimal objective values are reproducible.
- **Explanations are observational.** They come from diffs, measured effects, and enumerating alternatives. They do not claim to reveal solver internals.
- **Not modelled:** consecutive-hour caps, student electives at the individual level, and splitting a batch into lab groups.
- **Testing coverage.** The UI was tested at desktop width. The mobile layout (bottom navigation, drawer inspector) is implemented but not extensively tested.
- **Time model.** The grid is discrete (default 60-minute slots), and CSV time windows must align to slot boundaries.
