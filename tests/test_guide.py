"""Phase 2b: profile, today's plan, the review queue and per-skill mastery."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.services import mastery


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SYSTEMCRAFT_DB_PATH", str(tmp_path / "guide.db"))
    monkeypatch.setenv("SYSTEMCRAFT_JWT_SECRET", "g" * 48)
    from backend.app.main import create_app
    from backend.app.services.guest import guest_limiter

    guest_limiter.reset()
    with TestClient(create_app()) as c:
        yield c


def _signup(client: TestClient, username: str) -> dict[str, str]:
    res = client.post("/api/auth/register", json={"username": username, "password": "strongpassword123"})
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['accessToken']}"}


def _finish_chapter(client: TestClient, h: dict, topic_id: str, wrong_first: str | None = None) -> dict:
    from backend.app.services.content_store import get_content

    content = get_content()
    topic = content.public(topic_id)
    last = {}
    for b in topic["blocks"]:
        if not b.get("checkable"):
            continue
        key = content.key(topic_id, b["id"])
        if b["type"] not in ("quiz", "predict"):
            pytest.skip(f"{topic_id} has a {b['type']} check; this helper only answers choice checks")
        if b["id"] == wrong_first:
            wrong = (key["answer"] + 1) % len(b["options"])
            client.post("/api/attempts", headers=h, json={"topicId": topic_id, "blockId": b["id"], "gradingVersion": b["gradingVersion"],
                                                          "response": {"choice": wrong}})
        last = client.post("/api/attempts", headers=h, json={"topicId": topic_id, "blockId": b["id"],
                                                             "gradingVersion": b["gradingVersion"], "response": {"choice": key["answer"]}}).json()
    return last


def test_new_account_has_one_plan_card_and_nothing_due(client: TestClient) -> None:
    h = _signup(client, "brand_new")
    today = client.get("/api/me/today", headers=h).json()
    assert today["review"] == {"due": 0, "newToday": 0}
    assert [c["kind"] for c in today["cards"]][:1] == ["continue"]
    assert all(c["reason"] for c in today["cards"])
    assert today["continue"]["topicId"] == "how-to-approach-a-design-question"
    first = today["chapters"][0]
    assert first["state"] == "current" and first["stageId"] == "stage-0" and first["stageTitle"].startswith("Stage 0")
    states = {c["number"]: c["state"] for c in today["chapters"]}
    assert states[4] == "preview" and states[8] == "soon" and states[5] == "open"
    assert client.get("/api/review/queue", headers=h).json() == {"due": 0, "items": []}


def test_profile_round_trip_enrolls_and_sets_pace(client: TestClient) -> None:
    h = _signup(client, "planner")
    assert client.get("/api/me/profile", headers=h).json()["onboarded"] is False
    bad = client.put("/api/me/profile", headers=h, json={"timezone": "Nowhere/Land"})
    assert bad.status_code == 400
    soon = (datetime.now(timezone.utc).date() + timedelta(days=14)).isoformat()
    res = client.put("/api/me/profile", headers=h, json={"goals": ["hld"], "startLevel": "built_apps", "interviewDate": soon,
                                                          "hoursPerWeek": 2, "timezone": "Asia/Kolkata"})
    prof = res.json()
    assert prof["onboarded"] and prof["paths"] == ["start-here"] and prof["timezone"] == "Asia/Kolkata"
    pace = client.get("/api/me/today", headers=h).json()["pace"]
    assert pace["interviewDate"] == soon and pace["onTrack"] is False  # 15 chapters at 2 h a week takes longer than 2 weeks
    cleared = client.put("/api/me/profile", headers=h, json={"clearInterviewDate": True}).json()
    assert cleared["interviewDate"] is None and cleared["startLevel"] == "built_apps"


def test_finishing_a_chapter_fills_the_queue_and_review_works(client: TestClient) -> None:
    h = _signup(client, "reviewer")
    tid = "consistent-hashing"
    last = _finish_chapter(client, h, tid, wrong_first="q-ch-1")
    assert last["progress"]["status"] == "completed" and last["reviewItemsAdded"] >= 3
    added = client.get(f"/api/topics/{tid}/review-items", headers=h).json()
    assert added["added"] == last["reviewItemsAdded"]
    kinds = {i["kind"] for i in added["items"]}
    assert kinds == {"choice", "recall"}
    assert all("answer" not in i and "correctIndex" not in i for i in added["items"])

    # Nothing is due yet; travel to tomorrow by pulling due dates back.
    assert client.get("/api/review/queue", headers=h).json()["due"] == 0
    from backend.app.db.database import get_conn

    with get_conn() as conn:
        due_rows = conn.execute("SELECT item_ref, due_at FROM review_items ORDER BY due_at").fetchall()
        first_due = {r["item_ref"]: r["due_at"] for r in due_rows}
        assert first_due[f"{tid}:q-ch-1"] < first_due[f"{tid}:q-ch-2"]  # wrong first answer comes back sooner
        conn.execute("UPDATE review_items SET due_at = '2000-01-01T00:00:00+00:00'")
    queue = client.get("/api/review/queue", headers=h).json()
    assert queue["due"] == added["added"]
    choice = next(i for i in queue["items"] if i["kind"] == "choice")
    recall = next(i for i in queue["items"] if i["kind"] == "recall")

    from backend.app.services.content_store import get_content

    answer = get_content().key(tid, choice["itemRef"].split(":")[1])["answer"]
    res = client.post(f"/api/review/{choice['itemRef']}/answer", headers=h, json={"choice": answer}).json()
    assert res["correct"] and res["nextDueAt"] > datetime.now(timezone.utc).isoformat()
    assert client.post(f"/api/review/{choice['itemRef']}/grade", headers=h, json={"rating": "good"}).status_code == 400
    g = client.post(f"/api/review/{recall['itemRef']}/grade", headers=h, json={"rating": "again"}).json()
    assert g["intervalDays"] == 1
    assert client.get("/api/review/queue", headers=h).json()["due"] == added["added"] - 2

    today = client.get("/api/me/today", headers=h).json()
    assert today["cards"][0]["kind"] == "review"

    skills = client.get("/api/me/skills", headers=h).json()["skills"]
    ch = next(s for s in skills if s["skill"] == f"hld.{tid}")
    # Other items from this chapter are still years overdue (we pulled them back), so the skill reads as rusty.
    assert ch["state"] == "rusty" and ch["evidence"] >= 4 and ch["topics"] == [tid]


def test_mastery_rules() -> None:
    now = datetime.now(timezone.utc)

    def ev(r, days, source="check"):
        return {"r": r, "w": mastery.WEIGHTS[source], "age": days, "at": now - timedelta(days=days), "source": source, "topic": "t"}

    assert mastery.state_for([], False) == "new"
    assert mastery.state_for([ev(1, 0)], False) == "learning"  # one piece is not enough
    assert mastery.state_for([ev(1, 1), ev(1, 0)], False) == "practiced"
    assert mastery.state_for([ev(1, 10), ev(1, 5), ev(1, 0, "review")], False) == "mastered"
    assert mastery.state_for([ev(1, 2), ev(1, 1), ev(1, 0, "review")], False) == "practiced"  # not spread over a week
    assert mastery.state_for([ev(1, 1), ev(1, 0)], True) == "rusty"
    # Old failures fade: a fail 90 days ago weighs 1/8 of today's pass.
    assert mastery.score([ev(0, 90), ev(1, 0)]) == pytest.approx(1 / (1 + 0.125), rel=1e-3)


def test_guest_profile_and_queue_move_on_sign_up(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SYSTEMCRAFT_ALLOW_GUESTS", "1")
    from backend.app.db.database import get_conn
    from backend.app.services.guest import create_guest, merge_guest_into

    guest = create_guest()
    with get_conn() as conn:
        conn.execute("INSERT INTO learner_profiles (user_id, goals_json, start_level, updated_at) VALUES (?, '[\"hld\"]', 'new', 'x')",
                     (guest["id"],))
        conn.execute("UPDATE users SET onboarded_at = 'x', timezone = 'Asia/Kolkata' WHERE id = ?", (guest["id"],))
        conn.execute("INSERT INTO review_items (user_id, item_ref, topic_id, kind, due_at, created_at, updated_at)"
                     " VALUES (?, 'dns-and-cdn:x', 'dns-and-cdn', 'recall', 'x', 'x', 'x')", (guest["id"],))
    h = _signup(client, "after_guest")
    uid = client.get("/api/auth/me", headers=h).json()["user"]["id"]
    merge_guest_into(guest["id"], uid)
    prof = client.get("/api/me/profile", headers=h).json()
    assert prof["startLevel"] == "new" and prof["onboarded"] and prof["timezone"] == "Asia/Kolkata"
    with get_conn() as conn:
        assert conn.execute("SELECT 1 FROM review_items WHERE user_id = ?", (uid,)).fetchone()


def test_migration_0005_keeps_flashcard_schedules(client: TestClient) -> None:
    h = _signup(client, "card_veteran")
    uid = client.get("/api/auth/me", headers=h).json()["user"]["id"]
    from alembic import command

    from backend.app.db.database import alembic_config, get_conn
    from backend.app.db.engine import get_engine

    cfg = alembic_config()
    with get_engine().begin() as conn:
        cfg.attributes["connection"] = conn
        command.downgrade(cfg, "0004_v1_progress")
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO flashcard_reviews (user_id, card_id, repetitions, interval_days, easiness_factor, next_review_date, last_rating, updated_at)"
            " VALUES (?, 'fc-ch-1', 2, 6, 2.6, '2026-12-01T00:00:00+00:00', 'good', '2026-11-20T00:00:00+00:00')",
            (uid,),
        )
    with get_engine().begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM review_items WHERE user_id = ?", (uid,)).fetchone()
    assert row["item_ref"] == "consistent-hashing:fc-ch-1" and row["interval_days"] == 6 and row["kind"] == "recall"
    item = client.get("/api/topics/consistent-hashing/review-items", headers=h).json()["items"][0]
    assert item["prompt"].startswith("How many keys move")
