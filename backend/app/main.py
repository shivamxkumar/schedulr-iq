"""SCHEDULR IQ REST API. HTTP concerns only - all scheduling logic lives in sibling modules."""
from __future__ import annotations

from typing import Optional

import os
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field, ValidationError

from . import auth, csvio
from .baseline import first_fit
from .dataset_check import check_dataset
from . import demos
from .demo import demo_dataset
from .explain import diff_schedules, explain_session, suggest_fixes
from .metrics import TERM_KEYS, compute_metrics, soft_score, term_refs
from .models import Assignment, Dataset, Weights, expand_sessions
from .solver import max_partial, presolve_diagnostics, solve
from .store import ScheduleRecord, Store, now
from .timegrid import slot_label
from .candidates import room_ok
from .validator import HARD_CHECKS, placement_violations, validate

app = FastAPI(title="SCHEDULR IQ", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
store = Store()

PUBLIC = {"/api/health", "/api/auth/login", "/api/auth/demo"}
# What a "View demo" visitor may change: run the optimizer and try moves on schedule copies.
DEMO_WRITES = re.compile(r"^/api/(schedule/optimize|schedule/[^/]+/(move|diagnostic|activate)|dataset/validate|auth/me)$")


@app.middleware("http")
async def require_auth(request: Request, call_next):
    """Every /api route needs a valid token; anything that is not a GET needs the admin role."""
    path = request.url.path
    if not path.startswith("/api") or path in PUBLIC or request.method == "OPTIONS":
        return await call_next(request)
    header = request.headers.get("authorization", "")
    token = header[7:] if header.lower().startswith("bearer ") else request.query_params.get("token", "")
    user = auth.verify(token) if token else None
    if not user:
        return JSONResponse({"detail": "Not signed in or session expired."}, status_code=401)
    if request.method != "GET" and user["role"] != "admin" and path != "/api/auth/me":
        if not (user["role"] == "demo" and DEMO_WRITES.match(path)):
            msg = ("Demo mode: you can optimize and try moves, but editing data, importing, resetting and "
                   "publishing need an administrator account.") if user["role"] == "demo" else \
                "Read-only account: only administrators can change data or schedules."
            return JSONResponse({"detail": msg}, status_code=403)
    request.state.user = user
    return await call_next(request)


class LoginBody(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login")
def login(body: LoginBody):
    user = auth.authenticate(body.username, body.password)
    if not user:
        raise HTTPException(401, "Incorrect username or password.")
    return {"token": auth.issue(user), "user": user}


@app.post("/api/auth/demo")
def demo_login():
    user = {"username": "demo", "role": "demo", "name": "Demo visitor"}
    return {"token": auth.issue(user), "user": user}


@app.get("/api/auth/me")
def me(request: Request):
    return request.state.user


# ---------- helpers ----------

def ds() -> Dataset:
    return store.state.dataset


def refs() -> dict[str, float]:
    b = store.get(store.state.baseline_id) if store.state.baseline_id else None
    return term_refs(compute_metrics(ds(), b.assignments).terms if b else {})


def view(rec: ScheduleRecord) -> dict:
    d = ds()
    rep = validate(d, rec.assignments)
    met = compute_metrics(d, rec.assignments)
    w = Weights(**rec.weights) if rec.weights else Weights()
    return {
        "record": rec.model_dump(),
        "validation": rep.model_dump(),
        "metrics": met.model_dump(),
        "score": soft_score(met.terms, w, refs()),
        "score_weights": w.model_dump(),
        "publishable": rep.feasible and rep.complete and rec.kind not in ("diagnostic", "partial", "draft"),
    }


def require(sid: str) -> ScheduleRecord:
    rec = store.get(sid)
    if not rec:
        raise HTTPException(404, f"Schedule {sid} not found.")
    return rec


def ensure_dataset_ok() -> None:
    errors = [i for i in check_dataset(ds()) if i.level == "error"]
    if errors:
        raise HTTPException(422, {"message": "The dataset has errors that must be fixed before scheduling.",
                                  "issues": [e.model_dump() for e in errors]})


def generate_baseline() -> dict:
    ensure_dataset_ok()
    d = ds()
    assigns = first_fit(d)
    method = "First-fit heuristic (most-constrained session first, earliest legal slot, first suitable room) with backtracking"
    solver_info: dict = {"method": method, "status": "feasible"}
    if assigns is None:
        res = solve(d, weights=None, time_limit=float(os.environ.get("GENERATE_TIME_LIMIT", 30)))
        if res.status in ("optimal", "feasible"):
            assigns = res.assignments
            solver_info = {"method": "First-fit failed within its search budget; CP-SAT feasibility search",
                           "status": "feasible", "log": res.log}
        elif res.status != "infeasible":
            # Timed out without a proof either way: say so instead of claiming infeasibility.
            return {"status": "timeout", "message": f"No timetable found within the time limit ({res.message}). "
                    "This is not a proof of infeasibility; try again or allow more time.",
                    "diagnostics": presolve_diagnostics(d), "partial": None}
        else:
            partial = max_partial(d)
            diags = res.diagnostics or presolve_diagnostics(d)
            rec = None
            if partial.assignments:
                rec = store.add(ScheduleRecord(
                    id=store.next_id(), label="Partial (infeasible instance)", kind="partial", created_at=now(),
                    assignments=partial.assignments,
                    solver={"method": "CP-SAT: maximise number of placed sessions", "status": "partial",
                            "message": partial.message, "log": partial.log}))
            return {"status": "infeasible", "message": res.message or "No feasible timetable exists.",
                    "diagnostics": diags, "partial": view(rec) if rec else None}
    rep = validate(d, assigns)
    if not rep.feasible:
        raise HTTPException(500, {"message": "Generated baseline failed independent validation; not stored.",
                                  "violations": [v.model_dump() for v in rep.violations if v.severity == "hard"]})
    rec = store.add(ScheduleRecord(id=store.next_id(), label="Baseline", kind="baseline", created_at=now(),
                                   assignments=assigns, solver=solver_info))
    store.state.baseline_id = rec.id
    store.save()
    return {"status": "ok", "schedule": view(rec)}


def seed_demo(name: str) -> None:
    """Load a demo dataset. With an official timetable it becomes the (validated) baseline."""
    bundle = demos.load(name)
    store.reset(bundle.dataset)
    d = ds()
    if not bundle.official:
        generate_baseline()
        return
    rep = validate(d, bundle.official)
    base = store.add(ScheduleRecord(
        id=store.next_id(), label="Official timetable v4 (imported)", kind="baseline", created_at=now(),
        assignments=bundle.official,
        solver={"method": f"Imported, not generated: {bundle.source}. Independently validated: "
                          f"{rep.hard_count} hard violations, {rep.scheduled}/{rep.required} sessions.",
                "status": "imported"}))
    store.state.baseline_id = base.id
    opt = bundle.optimized
    if opt:
        assigns = [Assignment(**a) for a in opt["assignments"]]
        orep = validate(d, assigns)
        if orep.feasible and orep.complete:
            store.add(ScheduleRecord(
                id=store.next_id(), label="Optimized run 1 (precomputed)", kind="optimized", parent_id=base.id,
                created_at=now(), assignments=assigns, weights=opt["weights"], solver=opt["solver"],
                changes=[c.model_dump() for c in diff_schedules(d, bundle.official, assigns)]), activate=False)
    store.state.active_id = base.id
    store.save()


@app.on_event("startup")
def _startup():
    if not store.state.schedules:
        try:
            seed_demo(demos.DEFAULT)
        except HTTPException:
            pass


# ---------- meta & dataset ----------

@app.get("/api/health")
def health():
    return {"ok": True, "solver": "OR-Tools CP-SAT", "dataset_version": store.state.dataset_version}


@app.get("/api/meta")
def meta():
    return {"hard_checks": [{"code": c, "label": l} for c, l in HARD_CHECKS], "objectives": TERM_KEYS,
            "default_weights": Weights().model_dump()}


@app.get("/api/demo")
def get_demo():
    return demo_dataset().model_dump()


def dataset_payload():
    d = ds()
    sessions = expand_sessions(d)
    return {"dataset": d.model_dump(), "version": store.state.dataset_version,
            "issues": [i.model_dump() for i in check_dataset(d)],
            "sessions": [s.model_dump() for s in sessions],
            "slot_labels": [slot_label(d.time, t) for t in range(d.time.slots_per_day + 1)]}


@app.get("/api/dataset")
def get_dataset():
    return dataset_payload()


@app.put("/api/dataset")
def put_dataset(body: Dataset):
    issues = [i for i in check_dataset(body) if i.level == "error"]
    if issues:
        raise HTTPException(422, {"message": "Dataset rejected.", "issues": [i.model_dump() for i in issues]})
    store.set_dataset(body)
    return dataset_payload()


@app.post("/api/dataset/validate")
def validate_dataset(body: Dataset):
    return {"issues": [i.model_dump() for i in check_dataset(body)],
            "diagnostics": presolve_diagnostics(body) if not [i for i in check_dataset(body) if i.level == "error"] else []}


@app.post("/api/dataset/reset")
def reset_dataset(demo: str = demos.DEFAULT):
    try:
        seed_demo(demo)
    except KeyError:
        raise HTTPException(404, f"Unknown demo '{demo}'.")
    return dataset_payload()


@app.post("/api/dataset/scenario/{name}")
def scenario(name: str):
    d = demo_dataset()
    if name == "hall-closed":
        d.name = "Diagnostic · synthetic campus, Main Lecture Hall closed (infeasible)"
        d.rooms = [r for r in d.rooms if r.id != "LH-101"]
    elif name == "visiting-overload":
        d.name = "Diagnostic · synthetic campus, visiting faculty also unavailable Wednesday (infeasible)"
        f = next(x for x in d.faculty if x.id == "F08")
        f.unavailable.append(f.unavailable[0].model_copy(update={"day": 2}))
    else:
        raise HTTPException(404, f"Unknown scenario '{name}'.")
    store.set_dataset(d)
    return dataset_payload()


class CsvBody(BaseModel):
    csv: str
    apply: bool = True


@app.get("/api/dataset/template/{entity}", response_class=PlainTextResponse)
def csv_template(entity: str):
    if entity not in csvio.COLUMNS:
        raise HTTPException(404, f"Unknown entity '{entity}'.")
    return csvio.template(entity)


@app.get("/api/dataset/export/{entity}", response_class=PlainTextResponse)
def csv_export_entity(entity: str):
    if entity not in csvio.COLUMNS:
        raise HTTPException(404, f"Unknown entity '{entity}'.")
    return csvio.export_entity(ds(), entity)


@app.post("/api/dataset/import/{entity}")
def csv_import(entity: str, body: CsvBody):
    if entity not in csvio.COLUMNS:
        raise HTTPException(404, f"Unknown entity '{entity}'.")
    items, errors = csvio.parse_entity(ds().time, entity, body.csv)
    if errors:
        return {"ok": False, "rows": len(items), "errors": errors, "issues": []}
    candidate = ds().model_copy(update={entity: items})
    try:
        candidate = Dataset.model_validate(candidate.model_dump())
    except ValidationError as e:
        return {"ok": False, "rows": len(items), "errors": [{"row": 0, "field": str(x["loc"]), "message": x["msg"]}
                                                           for x in e.errors()], "issues": []}
    issues = check_dataset(candidate)
    blocking = [i for i in issues if i.level == "error"]
    if blocking or not body.apply:
        return {"ok": not blocking, "rows": len(items), "errors": [], "issues": [i.model_dump() for i in issues],
                "applied": False}
    store.set_dataset(candidate)
    return {"ok": True, "rows": len(items), "errors": [], "issues": [i.model_dump() for i in issues], "applied": True}


# ---------- schedules ----------

@app.get("/api/schedules")
def list_schedules():
    out = []
    for r in store.state.schedules.values():
        rep = validate(ds(), r.assignments)
        out.append({"id": r.id, "label": r.label, "kind": r.kind, "created_at": r.created_at, "parent_id": r.parent_id,
                    "published": r.published, "hard_count": rep.hard_count, "status": r.solver.get("status")})
    return {"schedules": out, "baseline_id": store.state.baseline_id, "active_id": store.state.active_id}


@app.post("/api/schedule/generate")
def api_generate():
    return generate_baseline()


class OptimizeBody(BaseModel):
    weights: Weights = Weights()
    time_limit: float = Field(default=10, ge=1, le=60)
    base_id: Optional[str] = None


@app.post("/api/schedule/optimize")
def api_optimize(body: OptimizeBody):
    ensure_dataset_ok()
    try:
        body.weights.normalized()
    except ValueError as e:
        raise HTTPException(422, str(e))
    if not store.state.baseline_id:
        g = generate_baseline()
        if g["status"] != "ok":
            return {"status": "infeasible", "message": g["message"], "diagnostics": g["diagnostics"]}
    base = require(body.base_id or store.state.baseline_id)
    d = ds()
    base_rep = validate(d, base.assignments)
    hint = base.assignments if base_rep.feasible and base_rep.complete else None
    r = refs()
    if os.environ.get("SOLVER_MODE") == "lns" and hint:
        # Small hosts (e.g. a 0.1-CPU free instance): improve the base timetable neighbourhood by
        # neighbourhood instead of solving the whole model at once.
        from .solver import solve_lns
        res = solve_lns(d, body.weights, r, hint, time_limit=body.time_limit)
    else:
        res = solve(d, body.weights, r, hint=hint, time_limit=body.time_limit)
    if res.status not in ("optimal", "feasible"):
        return {"status": res.status, "message": res.message, "diagnostics": res.diagnostics, "log": res.log}
    rep = validate(d, res.assignments)
    if not rep.feasible or not rep.complete:
        raise HTTPException(500, {"message": "Optimizer output failed independent validation and was discarded.",
                                  "violations": [v.model_dump() for v in rep.violations if v.severity == "hard"]})
    changes = diff_schedules(d, base.assignments, res.assignments)
    n = sum(1 for x in store.state.schedules.values() if x.kind == "optimized") + 1
    rec = store.add(ScheduleRecord(
        id=store.next_id(), label=f"Optimized run {n}", kind="optimized", parent_id=base.id, created_at=now(),
        assignments=res.assignments, weights=body.weights.model_dump(),
        solver={"method": ("OR-Tools CP-SAT large-neighbourhood search (warm-started from base)" if os.environ.get("SOLVER_MODE") == "lns" else "OR-Tools CP-SAT (weighted soft objective, warm-started from base)"), "status": res.status,
                "message": res.message, "wall_seconds": res.wall_seconds, "objective": res.objective,
                "best_bound": res.best_bound, "variables": res.num_variables, "constraints": res.num_constraints,
                "candidates": res.num_candidates, "time_limit": body.time_limit, "log": res.log},
        changes=[c.model_dump() for c in changes]))
    before, after = view(base), view(rec)
    sb = soft_score(compute_metrics(d, base.assignments).terms, body.weights, r)
    sa = after["score"]
    note = ("No improvement found: the base schedule already scores best for these weights."
            if sa >= sb - 1e-9 else f"Weighted soft score {sb:.3f} → {sa:.3f} (lower is better).")
    return {"status": "ok", "schedule": after, "base": before, "base_score_same_weights": sb, "note": note}


class AssignmentsBody(BaseModel):
    assignments: list[Assignment]


@app.post("/api/schedule/validate")
def api_validate(body: AssignmentsBody):
    return validate(ds(), body.assignments).model_dump()


@app.get("/api/schedule/{sid}")
def api_get(sid: str):
    return view(require(sid))


@app.post("/api/schedule/{sid}/activate")
def api_activate(sid: str):
    require(sid)
    store.state.active_id = sid
    store.save()
    return {"active_id": sid}


@app.get("/api/schedule/{sid}/metrics")
def api_metrics(sid: str):
    return compute_metrics(ds(), require(sid).assignments).model_dump()


@app.get("/api/schedule/{sid}/validate")
def api_validate_id(sid: str):
    return validate(ds(), require(sid).assignments).model_dump()


class MoveBody(BaseModel):
    session_id: str
    day: int
    start: int
    room_id: Optional[str] = None
    faculty_id: Optional[str] = None
    commit: bool = False
    force: bool = False


@app.post("/api/schedule/{sid}/move")
def api_move(sid: str, body: MoveBody):
    rec = require(sid)
    d = ds()
    cur = next((a for a in rec.assignments if a.session_id == body.session_id), None)
    if body.session_id not in {s.id for s in expand_sessions(d)}:
        raise HTTPException(404, f"Unknown session {body.session_id}.")
    facu = body.faculty_id or (cur.faculty_id if cur else None)
    room = body.room_id if body.room_id != "auto" else None
    if body.room_id == "auto" and facu:
        # Smallest suitable room that is valid at the target time; fall back to the current room.
        sess = next(s for s in expand_sessions(d) if s.id == body.session_id)
        course = next(c for c in d.courses if c.id == sess.course_id)
        for r in sorted((r for r in d.rooms if room_ok(course, sess, r)), key=lambda r: r.capacity):
            trial_a = Assignment(session_id=body.session_id, day=body.day, start=body.start, room_id=r.id, faculty_id=facu)
            if not placement_violations(d, rec.assignments, trial_a):
                room = r.id
                break
    room = room or (cur.room_id if cur else None)
    if not room or not facu:
        raise HTTPException(422, "room_id and faculty_id are required for an unscheduled session.")
    cand = Assignment(session_id=body.session_id, day=body.day, start=body.start, room_id=room, faculty_id=facu)
    trial = [a for a in rec.assignments if a.session_id != body.session_id] + [cand]
    before_rep = validate(d, rec.assignments)
    rep = validate(d, trial)
    introduced = [v for v in rep.violations if v.severity == "hard" and body.session_id in v.session_ids]
    ok = rep.hard_count <= before_rep.hard_count and not introduced
    result = {"valid": ok, "introduced": [v.model_dump() for v in introduced], "validation": rep.model_dump(),
              "committed": False, "schedule": None}
    if body.commit and (ok or body.force):
        kind = "manual" if rep.feasible else "draft"
        new = store.add(ScheduleRecord(
            id=store.next_id(), label=("Manual edit" if kind == "manual" else "Draft with conflicts"), kind=kind,
            parent_id=rec.id, created_at=now(), assignments=sorted(trial, key=lambda a: (a.day, a.start, a.session_id)),
            weights=rec.weights, solver={"method": "Manual move validated by independent validator",
                                         "status": "feasible" if rep.feasible else "invalid"},
            changes=[c.model_dump() for c in diff_schedules(d, rec.assignments, trial)]))
        result.update(committed=True, schedule=view(new))
    return result


@app.get("/api/schedule/{sid}/session/{session_id}")
def api_explain(sid: str, session_id: str):
    rec = require(sid)
    if session_id not in {s.id for s in expand_sessions(ds())}:
        raise HTTPException(404, f"Unknown session {session_id}.")
    w = Weights(**rec.weights) if rec.weights else Weights()
    return explain_session(ds(), rec.assignments, session_id, w, refs()).model_dump()


@app.get("/api/schedule/{sid}/conflicts")
def api_conflicts(sid: str):
    rec = require(sid)
    d = ds()
    rep = validate(d, rec.assignments)
    w = Weights(**rec.weights) if rec.weights else Weights()
    r = refs()
    sugg_cache: dict[str, list] = {}
    items = []
    for v in rep.violations:
        sug = []
        if v.severity == "hard":
            for s_id in v.session_ids[-1:] if v.code.endswith("OVERLAP") else v.session_ids[:1]:
                if s_id not in sugg_cache:
                    sugg_cache[s_id] = [x.model_dump() for x in suggest_fixes(d, rec.assignments, s_id, w, r)]
                sug.extend(sugg_cache[s_id])
        items.append({**v.model_dump(), "suggestions": sug})
    return {"hard": [i for i in items if i["severity"] == "hard"], "soft": [i for i in items if i["severity"] == "soft"],
            "checks": [c.model_dump() for c in rep.checks]}


@app.post("/api/schedule/{sid}/publish")
def api_publish(sid: str):
    rec = require(sid)
    v = view(rec)
    if not v["publishable"]:
        rep = v["validation"]
        raise HTTPException(409, {"message": f"Cannot publish {sid}: {rep['hard_count']} hard violation(s), "
                                             f"{rep['required'] - rep['scheduled']} unscheduled session(s)"
                                             + (f", kind '{rec.kind}' is not publishable." if rec.kind in ("diagnostic", "partial", "draft") else "."),
                                  "checks": rep["checks"]})
    for r in store.state.schedules.values():
        r.published = False
    rec.published = True
    rec.published_at = now()
    store.save()
    return view(rec)


@app.get("/api/schedule/{sid}/export", response_class=PlainTextResponse)
def api_export(sid: str):
    return PlainTextResponse(csvio.export_schedule(ds(), require(sid).assignments), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{sid}.csv"'})


@app.post("/api/schedule/{sid}/diagnostic")
def api_diagnostic(sid: str):
    """Create a clearly-labelled teaching example by corrupting a copy of a valid schedule."""
    rec = require(sid)
    d = ds()
    assigns = [a.model_copy() for a in rec.assignments]
    by = {a.session_id: a for a in assigns}
    sess = {s.id: s for s in expand_sessions(d)}
    notes = []
    tc = d.time
    ordered = sorted(assigns, key=lambda a: (a.day, a.start, a.session_id))
    touched: set[str] = set()
    # 1. Batch overlap: move a 1-slot session onto another session of the same batch.
    for x in ordered:
        sx = sess[x.session_id]
        y = next((y for y in ordered if y.session_id not in touched | {x.session_id} and sess[y.session_id].duration == 1
                  and set(sess[y.session_id].batch_ids) & set(sx.batch_ids) and y.day != x.day), None)
        if y:
            y.day, y.start = x.day, x.start
            touched |= {x.session_id, y.session_id}
            notes.append(f"{y.session_id} moved onto {x.session_id}'s slot (batch overlap)")
            break
    # 2. Capacity / room type: put the largest lecture into the smallest room.
    small = min(d.rooms, key=lambda r: r.capacity)
    big = max((a for a in ordered if a.session_id not in touched and sess[a.session_id].enrollment > small.capacity),
              key=lambda a: sess[a.session_id].enrollment, default=None)
    if big:
        big.room_id = small.id
        touched.add(big.session_id)
        notes.append(f"{big.session_id} ({sess[big.session_id].enrollment} students) assigned to {small.id} "
                     f"({small.capacity} seats, {small.room_type})")
    # 3. Faculty: move a session into its teacher's unavailability, or onto another of their classes.
    fac = {f.id: f for f in d.faculty}
    done = False
    for a in ordered:
        if a.session_id in touched:
            continue
        f = fac.get(a.faculty_id)
        if f and f.unavailable:
            w = f.unavailable[0]
            a.day, a.start = w.day, w.start
            notes.append(f"{a.session_id} moved into {f.name}'s unavailable window ({tc.days[w.day]})")
            done = True
            break
    if not done:
        for a in ordered:
            other = next((b for b in ordered if b.faculty_id == a.faculty_id and b.session_id != a.session_id
                          and b.session_id not in touched and a.session_id not in touched and b.day != a.day), None)
            if other:
                other.day, other.start = a.day, a.start
                notes.append(f"{other.session_id} moved onto {a.session_id} — same teacher (faculty double-booking)")
                break
    new = store.add(ScheduleRecord(
        id=store.next_id(), label=f"Diagnostic example (corrupted copy of {sid})", kind="diagnostic", parent_id=sid,
        created_at=now(), assignments=assigns,
        solver={"method": "Deliberately corrupted for demonstration: " + "; ".join(notes), "status": "invalid"}))
    return view(new)


# ---------- static frontend (single-service deployment) ----------

DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"


@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str):
    if full_path.startswith("api/") or not DIST.exists():
        raise HTTPException(404, "Not found")
    target = (DIST / full_path).resolve()
    if full_path and target.is_file() and DIST in target.parents:
        return FileResponse(target)
    return FileResponse(DIST / "index.html")
