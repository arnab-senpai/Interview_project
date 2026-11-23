"""Content model v2: compiler, lint, API routes, grading versions and guest sessions."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.content import formula
from backend.app.content.compiler import compile_all, compile_topic, load_grading_lock
from backend.app.content.lint import build_lock, lint_grading_lock, lint_topic

ROOT = Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "tests" / "formula_cases.json").read_text(encoding="utf-8"))
PILOTS = {"how-to-approach-a-design-question", "one-server-to-a-million-users", "numbers-that-matter", "caching-and-stampede"}


# ---------------------------------------------------------------- formulas


@pytest.mark.parametrize("case", CASES["cases"], ids=[c["expr"] for c in CASES["cases"]])
def test_formula_cases(case: dict) -> None:
    got = formula.eval_str(case["expr"], CASES["env"])
    assert got == pytest.approx(case["value"], rel=1e-9)


def test_formula_rejects_code_and_cycles() -> None:
    for bad in ("__import__('os')", "a.b", "1 +", "foo(1)", "2 ** 3"):
        with pytest.raises(formula.FormulaError):
            formula.eval_str(bad, {"a": 1})
    with pytest.raises(formula.FormulaError, match="cycle"):
        formula.solve_values({}, [("a", "b + 1"), ("b", "a + 1")])


# ---------------------------------------------------------------- compiler and lint


def test_pilot_chapters_compile_and_pass_lint() -> None:
    topics = {t.id: t for t in compile_all()}
    assert PILOTS <= set(topics)
    for t in topics.values():
        lint_topic(t)
        assert t.errors == [], (t.id, t.errors)
    assert lint_grading_lock(list(topics.values())) == []


def test_public_bundle_has_no_answer_keys() -> None:
    for t in compile_all():
        blob = json.dumps(t.public)
        for block in t.public["blocks"]:
            assert "answer" not in block and "reveal" not in block and "modelAnswers" not in block
            for opt in block.get("options", []):
                assert set(opt) == {"text"}
        for bid, key in t.keys.items():
            for expl in key.get("explanations", []):
                assert expl not in blob, f"{t.id}/{bid} explanation leaked into the public bundle"


def test_numbers_match_the_learning_flow_example() -> None:
    """The audit's worked example: 20M DAU × 20, 3× peak, 1% writes, 500 B, 5 years, 3 copies."""
    t = next(t for t in compile_all() if t.id == "numbers-that-matter")
    d = t.defaults
    assert d["peak_rps"] == pytest.approx(20e6 * 20 / 86_400 * 3)
    assert round(d["peak_rps"]) == 13_889
    assert round(d["write_rps"]) == 139
    assert d["storage_bytes"] / 1e12 == pytest.approx(10.95, rel=1e-3)  # about 11 TB (decimal)
    assert d["cache_bytes"] == pytest.approx(1e9)  # distinct hot items × size, not reads × size


def test_figures_are_staged_and_highlight_what_changed() -> None:
    t = next(t for t in compile_all() if t.id == "one-server-to-a-million-users")
    figs = t.public["figures"]
    assert figs["fig-one-server"]["components"] == ["client", "app"]
    assert "a-client-app" not in figs["fig-load-balancer"]["arrows"]  # removed when the balancer arrives
    assert set(figs["fig-cache"]["highlight"]) == {"cache", "a-app-cache", "db", "a-app-db"}
    assert figs["fig-replica"]["overrides"]["db"]["label"] == "Database primary"
    assert len(figs["fig-replica"]["components"]) <= 8


def _topic_dir(tmp_path: Path, mutate) -> Path:
    import shutil

    src = ROOT / "content" / "hld" / "one-server-to-a-million-users"
    dst = tmp_path / "one-server-to-a-million-users"
    shutil.copytree(src, dst)
    import yaml

    data = yaml.safe_load((dst / "topic.yaml").read_text(encoding="utf-8"))
    mutate(data)
    (dst / "topic.yaml").write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8")
    return dst


def _find_block(data: dict, block_id: str) -> dict:
    for layer in data["layers"].values():
        for blocks in [*(layer.get("sections") or {}).values(), layer.get("blocks") or []]:
            for b in blocks:
                if b["id"] == block_id:
                    return b
    raise KeyError(block_id)


def test_lint_requires_a_grading_version_bump_when_a_key_changes(tmp_path: Path) -> None:
    lock = load_grading_lock()

    def change_key(data):
        _find_block(data, "check-stateless")["answer"] = 1

    changed = compile_topic(_topic_dir(tmp_path, change_key))
    errs = lint_grading_lock([changed], lock)
    assert any("check-stateless" in e and "bump it" in e for e in errs)

    def change_and_bump(data):
        b = _find_block(data, "check-stateless")
        b["answer"] = 1
        b["gradingVersion"] = 2

    bumped = compile_topic(_topic_dir(tmp_path / "b", change_and_bump))
    errs = lint_grading_lock([bumped], lock)
    assert not any("bump it" in e for e in errs)
    assert any("stale" in e for e in errs)  # the author then refreshes the lockfile
    assert lint_grading_lock([bumped], {**lock, **build_lock([bumped])}) == []


def test_lint_catches_template_and_figure_mistakes(tmp_path: Path) -> None:
    def break_things(data):
        data["layers"]["understand"]["sections"]["design"] = data["layers"]["understand"]["sections"]["design"][:4]
        _find_block(data, "check-figure-writes").pop("aboutFigure")
        data["arrows"][0]["rate"] = "peak_rps * nonsense"

    ct = compile_topic(_topic_dir(tmp_path, break_things))
    lint_topic(ct)
    joined = "\n".join(ct.errors)
    assert "unknown names ['nonsense']" in joined
    assert "Design needs 3 to 6 steps" in joined
    assert "aboutFigure" in joined or "uses a figure" in joined


# ---------------------------------------------------------------- API


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SYSTEMCRAFT_DB_PATH", str(tmp_path / "v2.db"))
    monkeypatch.setenv("SYSTEMCRAFT_JWT_SECRET", "z" * 48)
    from backend.app.main import create_app
    from backend.app.services.guest import guest_limiter

    guest_limiter.reset()
    with TestClient(create_app()) as c:
        yield c


def _signup(client: TestClient, username: str) -> dict[str, str]:
    res = client.post("/api/auth/register", json={"username": username, "password": "strongpassword123"})
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['accessToken']}"}


def test_topic_routes_list_and_strip_keys(client: TestClient) -> None:
    h = _signup(client, "reader_one")
    assert client.get("/api/tracks/hld/topics").status_code == 401
    listing = client.get("/api/tracks/hld/topics", headers=h).json()
    ids = {t["id"] for t in listing["topics"]}
    assert PILOTS <= ids
    assert any(t["id"] == "dns-and-cdn" and t["format"] == "v1" for t in listing["v1Topics"])

    res = client.get("/api/tracks/hld/topics/caching-and-stampede", headers=h)
    assert res.status_code == 200
    body = res.text
    assert '"answer"' not in body and "strongAnswer" not in body and "modelAnswers" not in body
    topic = res.json()["topic"]
    assert topic["contentVersion"] and topic["figures"]

    only_apply = client.get("/api/tracks/hld/topics/caching-and-stampede?layer=apply", headers=h).json()["topic"]
    assert {b["layer"] for b in only_apply["blocks"] if b["type"] != "figure"} == {"apply"}
    assert client.get("/api/tracks/lld/topics/caching-and-stampede", headers=h).status_code == 404

    graph = client.get("/api/graph", headers=h).json()
    assert {"from": "one-server-to-a-million-users", "to": "caching-and-stampede", "kind": "prerequisite"} in graph["edges"]


def test_attempts_grade_on_the_server_and_track_progress(client: TestClient) -> None:
    h = _signup(client, "reader_two")
    tid = "one-server-to-a-million-users"
    wrong = client.post("/api/attempts", headers=h, json={"topicId": tid, "blockId": "check-cdn", "gradingVersion": 1, "response": {"choice": 0}})
    assert wrong.status_code == 200 and wrong.json()["verdict"] == "failed"
    assert wrong.json()["reveal"]["correctIndex"] == 1
    right = client.post("/api/attempts", headers=h, json={"topicId": tid, "blockId": "check-cdn", "gradingVersion": 1, "response": {"choice": 1}})
    assert right.json()["verdict"] == "passed" and right.json()["blockStatus"]["status"] == "passed"

    stale = client.post("/api/attempts", headers=h, json={"topicId": tid, "blockId": "check-cdn", "gradingVersion": 7, "response": {"choice": 1}})
    assert stale.status_code == 409
    not_checkable = client.post("/api/attempts", headers=h, json={"topicId": tid, "blockId": "problem", "gradingVersion": 1, "response": {}})
    assert not_checkable.status_code == 400

    ws = client.post(
        "/api/attempts",
        headers=h,
        json={"topicId": tid, "blockId": "numbers-worksheet", "gradingVersion": 1,
              "response": {"answers": {"avg_rps": 300, "peak_rps": 1500, "db_queries_nocache": 2000}}},
    )
    assert ws.json()["verdict"] == "passed"  # all within 2x
    ws_bad = client.post(
        "/api/attempts",
        headers=h,
        json={"topicId": tid, "blockId": "numbers-worksheet", "gradingVersion": 1,
              "response": {"answers": {"avg_rps": 35, "peak_rps": 1000, "db_queries_nocache": 2000}}},
    )
    assert ws_bad.json()["verdict"] == "failed"
    assert [ln["withinTolerance"] for ln in ws_bad.json()["reveal"]["lines"]] == [False, True, True]

    views = client.post("/api/progress/blocks", headers=h, json={"topicId": tid, "blockIds": ["problem", "clarify-questions"]})
    assert views.json()["new"] == 2
    again = client.post("/api/progress/blocks", headers=h, json={"topicId": tid, "blockIds": ["problem"]})
    assert again.json()["new"] == 0
    assert client.post("/api/progress/blocks", headers=h, json={"topicId": tid, "blockIds": ["nope"]}).status_code == 400

    path = client.get("/api/paths/start-here", headers=h).json()
    assert path["continueTopicId"] == "how-to-approach-a-design-question"
    ch2 = path["stages"][0]["chapters"][1]
    assert ch2["topicId"] == tid and ch2["status"] == "in_progress"
    planned = [c for s in path["stages"] for c in s["chapters"] if c["format"] == "planned"]
    assert planned and all(not c["available"] for c in planned)


def test_a_pass_survives_a_grading_version_bump_as_recheck(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h = _signup(client, "reader_three")
    tid, bid = "caching-and-stampede", "check-bloom"
    ok = client.post("/api/attempts", headers=h, json={"topicId": tid, "blockId": bid, "gradingVersion": 1, "response": {"choice": 0}})
    assert ok.json()["verdict"] == "passed"

    from backend.app.services.content_store import get_content

    store = get_content()
    original = store.topics[tid].public
    bumped = copy.deepcopy(original)
    next(b for b in bumped["blocks"] if b["id"] == bid)["gradingVersion"] = 2
    monkeypatch.setattr(store.topics[tid], "public", bumped)
    status = client.get(f"/api/progress/blocks?topicId={tid}", headers=h).json()["blocks"][bid]
    assert status["status"] == "recheck"  # kept, not wiped


def test_guests_are_off_by_default(client: TestClient) -> None:
    assert client.get("/api/session/config").json() == {"guestsAllowed": False}
    assert client.post("/api/session/guest").status_code == 403


def test_guest_cookie_studies_then_merges_into_the_account(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SYSTEMCRAFT_ALLOW_GUESTS", "1")
    res = client.post("/api/session/guest")
    assert res.status_code == 201
    guest = res.json()["user"]
    assert guest["isGuest"] is True and guest["id"].startswith("anon_")
    assert "sc_guest" in client.cookies
    assert "httponly" in res.headers["set-cookie"].lower()

    tid = "one-server-to-a-million-users"
    assert client.post("/api/attempts", json={"topicId": tid, "blockId": "check-cdn", "gradingVersion": 1, "response": {"choice": 1}}).json()["verdict"] == "passed"
    client.post("/api/progress/blocks", json={"topicId": tid, "blockIds": ["problem"]})
    client.put("/api/notes/caching-and-stampede", json={"title": "n", "contentMd": "guest note", "tags": []})

    # Guests can't mint study tokens or file reports.
    assert client.post("/api/auth/tokens", json={"label": "x"}).status_code == 403

    # A tampered cookie is not accepted.
    forged = TestClient(client.app)
    forged.cookies.set("sc_guest", guest["id"] + ".deadbeef")
    assert forged.get("/api/auth/me").status_code == 401

    reg = client.post("/api/auth/register", json={"username": "was_a_guest", "password": "strongpassword123"})
    assert reg.status_code == 201
    assert reg.json()["mergedGuest"]["attempts"] == 1
    h = {"Authorization": f"Bearer {reg.json()['accessToken']}"}
    client.cookies.clear()
    prog = client.get(f"/api/progress/blocks?topicId={tid}", headers=h).json()
    assert prog["blocks"]["check-cdn"]["status"] == "passed"
    assert prog["blocks"]["problem"]["status"] == "viewed"
    assert client.get("/api/notes/caching-and-stampede", headers=h).json()["note"]["contentMd"] == "guest note"

    from backend.app.db.database import get_conn

    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM users WHERE id = ?", (guest["id"],)).scalar() == 0


def test_guest_creation_is_rate_limited(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SYSTEMCRAFT_ALLOW_GUESTS", "1")
    codes = []
    for _ in range(12):
        c = TestClient(client.app)
        codes.append(c.post("/api/session/guest").status_code)
    assert codes.count(201) == 10 and codes[-1] == 429


def test_idle_guests_are_purged(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from datetime import datetime, timedelta, timezone

    from backend.app.services.guest import create_guest, purge_idle_guests

    g = create_guest()
    assert purge_idle_guests() == 0
    assert purge_idle_guests(datetime.now(timezone.utc) + timedelta(days=31)) == 1
    from backend.app.db.database import get_conn

    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM users WHERE id = ?", (g["id"],)).scalar() == 0


def test_estimator_agrees_with_chapter_three() -> None:
    """The old Capacity Lab maths and chapter 3's formulas must give the same numbers."""
    from backend.app.services.estimator import calculate_capacity

    t = next(t for t in compile_all() if t.id == "numbers-that-matter")
    d = t.defaults
    m = calculate_capacity(
        dau=20_000_000, actions_per_user_per_day=20, peak_multiplier=3, avg_payload_bytes=500,
        retention_years=5, read_share_percent=99, replication_factor=3,
        distinct_items_read_per_day=10_000_000, hot_fraction=0.2,
    )["metrics"]
    assert m["peakQps"] == pytest.approx(d["peak_rps"], abs=0.01)
    assert m["writeQpsPeak"] == pytest.approx(d["write_rps"], abs=0.01)
    assert m["replicatedRetentionTB"] == pytest.approx(d["storage_bytes"] / 1e12, abs=0.001)
    assert m["hotCacheGB"] == pytest.approx(d["cache_bytes"] / 1e9, abs=0.001)
