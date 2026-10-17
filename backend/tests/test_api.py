import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app import main, store as store_mod
    monkeypatch.setattr(main, "store", store_mod.Store(tmp_path / "state.json"))
    with TestClient(main.app) as c:
        tok = c.post("/api/auth/login", json={"username": "admin", "password": "admin@iiits"}).json()["token"]
        c.headers["Authorization"] = f"Bearer {tok}"
        c.post("/api/dataset/reset?demo=synthetic")
        yield c


def test_generate_optimize_move_publish(client):
    s = client.get("/api/schedules").json()
    assert s["baseline_id"]
    r = client.post("/api/schedule/optimize", json={"time_limit": 8}).json()
    assert r["status"] == "ok"
    sch = r["schedule"]
    assert sch["validation"]["hard_count"] == 0 and sch["publishable"]
    oid = sch["record"]["id"]
    # Illegal move: visiting professor on Tuesday -> rejected, nothing committed.
    m = client.post(f"/api/schedule/{oid}/move", json={"session_id": "MA211-S1", "day": 1, "start": 0, "commit": True}).json()
    assert not m["valid"] and not m["committed"]
    assert any(v["code"] == "FACULTY_UNAVAILABLE" for v in m["introduced"])
    assert client.post(f"/api/schedule/{oid}/publish").status_code == 200
    csv = client.get(f"/api/schedule/{oid}/export").text
    assert csv.startswith("session_id,") and csv.count("\n") == 41


def test_diagnostic_cannot_publish_and_has_suggestions(client):
    bid = client.get("/api/schedules").json()["baseline_id"]
    d = client.post(f"/api/schedule/{bid}/diagnostic").json()
    assert d["validation"]["hard_count"] > 0 and not d["publishable"]
    did = d["record"]["id"]
    assert client.post(f"/api/schedule/{did}/publish").status_code == 409
    cf = client.get(f"/api/schedule/{did}/conflicts").json()
    assert cf["hard"] and any(h["suggestions"] for h in cf["hard"])


def test_bad_weights_and_bad_csv(client):
    zero = {k: 0 for k in ["student_idle", "faculty_idle", "room_fit", "workload_balance", "preferences"]}
    assert client.post("/api/schedule/optimize", json={"weights": zero}).status_code == 422
    assert client.post("/api/schedule/optimize", json={"weights": {"student_idle": 99}}).status_code == 422
    r = client.post("/api/dataset/import/rooms", json={"csv": "id,name,capacity,room_type\nX,Y,-3,lab"}).json()
    assert not r["ok"] and r["errors"][0]["row"] == 2


def test_infeasible_scenario_explained(client):
    client.post("/api/dataset/scenario/visiting-overload")
    g = client.post("/api/schedule/generate").json()
    assert g["status"] == "infeasible" and g["diagnostics"]
    assert g["partial"] is None or not g["partial"]["publishable"]


def test_auth_required_and_viewer_is_read_only(client):
    from fastapi.testclient import TestClient
    from app import main
    anon = TestClient(main.app)
    assert anon.get("/api/schedules").status_code == 401
    assert anon.post("/api/auth/login", json={"username": "admin", "password": "wrong"}).status_code == 401
    tok = anon.post("/api/auth/login", json={"username": "viewer", "password": "viewer@iiits"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert anon.get("/api/schedules", headers=h).status_code == 200
    assert anon.post("/api/schedule/generate", headers=h).status_code == 403
    assert anon.get("/api/schedules", headers={"Authorization": "Bearer forged.sig"}).status_code == 401


def test_iiit_surat_demo_official_timetable_is_valid(client):
    r = client.post("/api/dataset/reset?demo=iiit-surat").json()
    assert "IIIT Surat" in r["dataset"]["name"]
    lst = client.get("/api/schedules").json()
    base = client.get(f"/api/schedule/{lst['baseline_id']}").json()
    # The official sheet places all 281 sessions conflict-free, but 18 class-days have no free hour
    # in the 12:00–14:00 lunch window; the only hard violations are those lunch breaks.
    assert base["validation"]["scheduled"] == 281
    assert {v["code"] for v in base["validation"]["violations"] if v["severity"] == "hard"} == {"LUNCH_BREAK"}
    opt = [s for s in lst["schedules"] if s["kind"] == "optimized"]
    assert opt and opt[0]["hard_count"] == 0
    om = client.get(f"/api/schedule/{opt[0]['id']}").json()["metrics"]
    assert om["student_idle_minutes"] < base["metrics"]["student_idle_minutes"]


def test_demo_visitor_permissions(client):
    from fastapi.testclient import TestClient
    from app import main
    anon = TestClient(main.app)
    tok = anon.post("/api/auth/demo").json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    sid = anon.get("/api/schedules", headers=h).json()["baseline_id"]
    assert anon.post(f"/api/schedule/{sid}/activate", headers=h).status_code == 200
    assert anon.post("/api/dataset/reset", headers=h).status_code == 403
    assert anon.post(f"/api/schedule/{sid}/publish", headers=h).status_code == 403
