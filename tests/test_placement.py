"""Phase 2c: stage test-out and repair drills."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.services import placement


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SYSTEMCRAFT_DB_PATH", str(tmp_path / "placement.db"))
    monkeypatch.setenv("SYSTEMCRAFT_JWT_SECRET", "p" * 48)
    from backend.app.main import create_app
    from backend.app.services.guest import guest_limiter

    guest_limiter.reset()
    with TestClient(create_app()) as c:
        yield c


def _signup(client: TestClient, username: str) -> dict[str, str]:
    res = client.post("/api/auth/register", json={"username": username, "password": "strongpassword123"})
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['accessToken']}"}


def _key(topic_id: str, block_id: str) -> int:
    from backend.app.services.content_store import get_content

    return get_content().key(topic_id, block_id)["answer"]


def _run(client: TestClient, h: dict, start: dict, wrong_topics: set[str] = frozenset(), wrong_count: int = 99) -> dict:
    """Answer a stage check: right, except the first `wrong_count` questions from `wrong_topics`."""
    q = start["question"]
    misses = 0
    while True:
        right = _key(q["topicId"], q["blockId"])
        choice = right
        if q["topicId"] in wrong_topics and misses < wrong_count:
            choice = (right + 1) % len(q["options"])
            misses += 1
        res = client.post(f"/api/placement/{start['sessionId']}/answer", headers=h, json={"choice": choice})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["correct"] == (choice == right)
        if body["finished"]:
            return body["result"]
        q = body["question"]


def test_every_test_out_stage_has_questions_for_each_chapter() -> None:
    from backend.app.services.content_store import get_content

    content = get_content()
    stages = [s for p in content.paths.values() for s in p.stages if s.stageCheck]
    assert stages
    for s in stages:
        for e in s.chapters:
            if e.status == "ready":
                assert placement.pool(content.public(e.topic)), e.topic


def test_per_unit_question_budget() -> None:
    assert placement.per_unit(1) == 3
    assert placement.per_unit(3) == 3
    assert placement.per_unit(8) == 1
    assert placement.per_unit(20) == 1


def test_path_offers_test_out_and_rejects_stage_without_one(client: TestClient) -> None:
    h = _signup(client, "offer")
    path = client.get("/api/paths/start-here", headers=h).json()
    by_id = {s["id"]: s for s in path["stages"]}
    assert by_id["stage-0"]["stageCheck"] and by_id["stage-0"]["testOutAvailable"]
    no_check = [s for s in path["stages"] if not s["stageCheck"]]
    if no_check:
        res = client.post(f"/api/paths/start-here/stages/{no_check[0]['id']}/check", headers=h)
        assert res.status_code == 400
    assert client.post("/api/paths/start-here/stages/nope/check", headers=h).status_code == 404


def test_all_right_places_stage_out(client: TestClient) -> None:
    h = _signup(client, "knows_it")
    start = client.post("/api/paths/start-here/stages/stage-0/check", headers=h).json()
    assert "correctIndex" not in start["question"] and "answer" not in start["question"]
    assert 0 < start["total"] <= len(start["chapters"]) * placement.per_unit(len(start["chapters"]))
    result = _run(client, h, start)
    assert result["placedOut"] == start["chapters"]
    assert result["needsStudy"] == [] and not result["stoppedEarly"]

    path = client.get("/api/paths/start-here", headers=h).json()
    chapters = {c["topicId"]: c for s in path["stages"] for c in s["chapters"]}
    for t in start["chapters"]:
        assert chapters[t]["status"] == "placed_out"
    stage0 = next(s for s in path["stages"] if s["id"] == "stage-0")
    assert not stage0["testOutAvailable"]
    assert client.post("/api/paths/start-here/stages/stage-0/check", headers=h).status_code == 409

    today = client.get("/api/me/today", headers=h).json()
    assert today["continue"]["topicId"] not in start["chapters"]
    states = {c["topicId"]: c["state"] for c in today["chapters"]}
    assert all(states[t] == "placed_out" for t in start["chapters"])
    assert today["review"]["due"] == 0  # placed items come back in 14 days, not now

    skills = client.get("/api/me/skills", headers=h).json()
    placed_skills = [s for s in skills["skills"] if set(s["topics"]) <= set(start["chapters"])]
    assert placed_skills and all(s["state"] == "practiced" for s in placed_skills)

    items = client.get(f"/api/topics/{start['chapters'][0]}/review-items", headers=h).json()["items"]
    assert items
    now = datetime.now(timezone.utc)
    for it in items:
        due = datetime.fromisoformat(it["dueAt"])
        assert timedelta(days=13) < due - now <= timedelta(days=14, minutes=1)


def test_second_miss_stops_and_missed_chapter_stays_open(client: TestClient) -> None:
    h = _signup(client, "unsure")
    start = client.post("/api/paths/start-here/stages/stage-1/check", headers=h).json()
    first = start["chapters"][0]
    result = _run(client, h, start, wrong_topics={first}, wrong_count=2)
    assert first in result["needsStudy"]
    assert first not in result["placedOut"]
    assert result["answered"] <= start["total"]
    if result["stoppedEarly"]:
        assert result["notChecked"]
    path = client.get("/api/paths/start-here", headers=h).json()
    chapters = {c["topicId"]: c for s in path["stages"] for c in s["chapters"]}
    assert chapters[first]["status"] != "placed_out"
    for t in result["notChecked"]:
        assert chapters[t]["status"] != "placed_out"

    res = client.post(f"/api/placement/{start['sessionId']}/answer", headers=h, json={"choice": 0})
    assert res.status_code == 409


def test_wrong_answer_on_placed_skill_is_not_promoted(client: TestClient) -> None:
    h = _signup(client, "one_slip")
    start = client.post("/api/paths/start-here/stages/stage-0/check", headers=h).json()
    target = start["chapters"][-1]
    result = _run(client, h, start, wrong_topics={target}, wrong_count=1)
    assert target in result["needsStudy"]
    skills = client.get("/api/me/skills", headers=h).json()["skills"]
    for s in skills:
        if target in s["topics"]:
            assert s["state"] != "practiced" or s["score"] >= 0.6


def test_session_belongs_to_its_user(client: TestClient) -> None:
    a = _signup(client, "owner")
    b = _signup(client, "other")
    start = client.post("/api/paths/start-here/stages/stage-0/check", headers=a).json()
    res = client.post(f"/api/placement/{start['sessionId']}/answer", headers=b, json={"choice": 0})
    assert res.status_code == 404


def test_drill_items_and_drill_attempts(client: TestClient) -> None:
    h = _signup(client, "driller")
    topic = "how-to-approach-a-design-question"
    drill = client.get(f"/api/drills/{topic}", headers=h).json()
    assert 1 <= len(drill["items"]) <= 3
    assert all("answer" not in it for it in drill["items"])
    target = drill["items"][-1]
    wrong = (_key(topic, target["blockId"]) + 1) % len(target["options"])
    res = client.post("/api/attempts", headers=h, json={"topicId": topic, "blockId": target["blockId"],
                                                       "gradingVersion": target["gradingVersion"],
                                                       "response": {"choice": wrong}, "source": "drill"})
    assert res.status_code == 200, res.text
    again = client.get(f"/api/drills/{topic}", headers=h).json()
    assert again["items"][0]["blockId"] == target["blockId"]  # last answered wrong comes first

    from backend.app.db.database import get_conn

    with get_conn() as conn:
        row = conn.execute("SELECT source FROM attempts WHERE block_id = ? ORDER BY id DESC", (target["blockId"],)).fetchone()
    assert row["source"] == "drill"
    bad = client.post("/api/attempts", headers=h, json={"topicId": topic, "blockId": target["blockId"],
                                                       "gradingVersion": target["gradingVersion"],
                                                       "response": {"choice": wrong}, "source": "placement"})
    assert bad.status_code == 422
    assert client.get("/api/drills/no-such-topic", headers=h).status_code == 404


def test_guest_stage_check_moves_on_signup(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SYSTEMCRAFT_ALLOW_GUESTS", "1")
    from backend.app.services.content_store import get_content
    from backend.app.services.guest import create_guest, merge_guest_into

    guest = create_guest()
    content = get_content()
    start = placement.start(guest["id"], content, "start-here", "stage-0")
    total = start["total"]
    for i in range(total):
        q = placement._load(guest["id"], start["sessionId"])
        cur = json.loads(q["questions_json"])[i]
        placement.answer(guest["id"], content, start["sessionId"], _key(cur["topicId"], cur["blockId"]))
    h = _signup(client, "was_guest")
    uid = client.get("/api/auth/me", headers=h).json()["user"]["id"]
    merge_guest_into(guest["id"], uid)
    path = client.get("/api/paths/start-here", headers=h).json()
    chapters = {c["topicId"]: c for s in path["stages"] for c in s["chapters"]}
    assert all(chapters[t]["status"] == "placed_out" for t in start["chapters"])
    from backend.app.db.database import get_conn

    with get_conn() as conn:
        assert conn.execute("SELECT 1 FROM placement_sessions WHERE user_id = ?", (uid,)).fetchone()
