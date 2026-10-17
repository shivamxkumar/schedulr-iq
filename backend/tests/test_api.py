import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app import main, store as store_mod
    monkeypatch.setattr(main, "store", store_mod.Store(tmp_path / "state.json"))
    with TestClient(main.app) as c:
        tok = c.post("/api/auth/login", json={"username": "admin", "password": "admin@iiits"}).json()["token"]
        c.headers["Authorization"] = f"Bearer {tok}"
        c.post("/api/dataset/reset")
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
