"""Phase 2a: one content model and one progress record for the whole study path."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.content.compiler import compile_all, load_paths
from backend.app.content.lint import lint_graph, lint_topic
from backend.app.content.v1_adapter import adapt_all, ready_v1_sources

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SYSTEMCRAFT_DB_PATH", str(tmp_path / "one.db"))
    monkeypatch.setenv("SYSTEMCRAFT_JWT_SECRET", "q" * 48)
    monkeypatch.setenv("SYSTEMCRAFT_ADMIN_USERNAMES", "funnel_admin")
    from backend.app.main import create_app
    from backend.app.services.guest import guest_limiter

    guest_limiter.reset()
    with TestClient(create_app()) as c:
        yield c


def _signup(client: TestClient, username: str) -> dict[str, str]:
    res = client.post("/api/auth/register", json={"username": username, "password": "strongpassword123"})
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['accessToken']}"}


# ---------------------------------------------------------------- adapter and lint


def test_every_ready_v1_item_adapts_without_errors() -> None:
    written = {t.id for t in compile_all() if t.public and not t.errors}
    adapted = adapt_all(skip=written)
    assert len(adapted) + len(written & {s[1].stem for s in ready_v1_sources()}) >= 25
    for t in adapted:
        assert not t.errors, (t.id, t.errors[:3])
        pub = t.public
        assert pub["legacy"]["id"] == t.id
        text = json.dumps(pub)
        assert '"answer"' not in text and "correctIndex" not in text
        assert t.keys, f"{t.id} has no graded check"
        lint_topic(t)
        assert not t.errors, "adapted topics report lint findings as warnings only"


def test_hand_written_topic_wins_over_its_v1_original() -> None:
    written = {t.id for t in compile_all() if t.public and not t.errors}
    assert "caching-and-stampede" in written
    assert "caching-and-stampede" not in {t.id for t in adapt_all(skip=written)}


def test_path_lint_requires_every_ready_chapter_to_be_a_v2_topic(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    written = compile_all()
    topics = written + adapt_all(skip={t.id for t in written if t.public and not t.errors})
    v1_ids = [f.stem for _k, f in ready_v1_sources()] + [t.id for t in topics]
    assert lint_graph(topics, v1_ids) == []

    # Drop the adapted topics: the path now points at things that are not v2 topics.
    errors = lint_graph(written, v1_ids)
    adapted = sorted({t.id for t in topics} - {t.id for t in written})
    assert adapted
    assert any("not a v2 topic" in e and any(a in e for a in adapted) for e in errors)

    paths, _ = load_paths()
    planned = [e for s in paths[0].stages for e in s.chapters if e.status == "planned"]
    assert {e.topic for e in planned} >= {"cap-and-pacelc", "notification-system"}


def test_adapted_lesson_carries_module_essays_as_further_reading() -> None:
    t = next(t for t in adapt_all() if t.id == "l7-load-balancer")
    assert any(r["title"].startswith("Module 1:") for r in t.public["furtherReading"])
    assert t.public["sandboxLessonId"] == "l7-load-balancer"


# ---------------------------------------------------------------- path route


def test_path_is_one_model_with_preview_and_planned_chapters(client: TestClient) -> None:
    h = _signup(client, "path_reader")
    path = client.get("/api/paths/start-here", headers=h).json()
    chapters = {c["number"]: c for s in path["stages"] for c in s["chapters"]}
    old = next(n for n, c in sorted(chapters.items()) if c["legacy"])  # first chapter not yet rewritten
    assert chapters[old]["format"] == "v2" and chapters[old]["available"]
    assert chapters[4]["legacy"] is False and chapters[5]["legacy"] is False
    assert chapters[8]["status"] == "planned" and not chapters[8]["available"]
    assert all(c["stageId"] for c in chapters.values())
    assert path["continue"]["topicId"] == "how-to-approach-a-design-question"
    assert path["continue"]["blockId"] and path["continue"]["layer"] == "understand"
    assert path["continue"]["stepKey"] == "section-problem"
    assert path["chaptersAvailable"] == 15 and path["chaptersDone"] == 0

    legacy = client.get(f"/api/tracks/hld/topics/{chapters[old]['topicId']}", headers=h).json()
    assert legacy["topic"]["legacy"]["kind"] in ("lesson", "case_study")
    assert chapters[4]["title"] == "Load balancing" and chapters[13]["title"] == "URL shortener"
    assert legacy["topic"]["title"] == chapters[old]["title"]  # the path title, not the old one
    assert legacy["topic"]["originalTitle"] and legacy["topic"]["originalTitle"] != chapters[old]["title"]
    assert legacy["progress"]["status"] == "not_started"


def test_practice_tab_answers_count_on_the_chapter(client: TestClient) -> None:
    h = _signup(client, "practice_reader")
    topic = client.get("/api/tracks/hld/topics/consistent-hashing", headers=h).json()["topic"]
    checks = [b for b in topic["blocks"] if b.get("checkable")]
    assert checks
    from backend.app.services.content_store import get_content

    for b in checks:
        key = get_content().key("consistent-hashing", b["id"])
        res = client.post(f"/api/quizzes/{b['id']}/answer", headers=h, json={"selectedIndex": key["answer"]})
        assert res.status_code == 200 and res.json()["isCorrect"]
    prog = client.get("/api/progress/blocks?topicId=consistent-hashing", headers=h).json()
    assert prog["status"] == "completed"


def test_v1_completion_and_quiz_history_move_with_migration_0004(client: TestClient) -> None:
    h = _signup(client, "v1_veteran")
    uid = client.get("/api/auth/me", headers=h).json()["user"]["id"]
    from alembic import command

    from backend.app.db.database import alembic_config, get_conn
    from backend.app.db.engine import get_engine

    with get_conn() as conn:
        conn.execute(
            "INSERT INTO lesson_progress (user_id, topic_id, kind, status, completed_steps_json, active_lens, updated_at)"
            " VALUES (?, 'dns-and-cdn', 'lesson', 'completed', '[0,1,2]', 'intuition', '2026-11-20T10:00:00+00:00')",
            (uid,),
        )
        conn.execute(
            "INSERT INTO quiz_attempts (user_id, question_id, topic_id, selected_index, is_correct, answered_at)"
            " VALUES (?, 'q-ch-1', 'consistent-hashing', 1, 1, '2026-11-20T10:05:00+00:00')",
            (uid,),
        )
    cfg = alembic_config()
    for target in ("0003_one_model", "head", "head"):  # the second upgrade proves it is idempotent
        with get_engine().begin() as conn:
            cfg.attributes["connection"] = conn
            if target == "head":
                command.upgrade(cfg, "head")
            else:
                command.downgrade(cfg, target)
    with get_conn() as conn:
        n = conn.execute("SELECT COUNT(*) AS n FROM attempts WHERE user_id = ? AND content_version = 'v1'", (uid,)).fetchone()["n"]
    assert n == 1

    path = client.get("/api/paths/start-here", headers=h).json()
    dns = next(c for s in path["stages"] for c in s["chapters"] if c["topicId"] == "dns-and-cdn")
    assert dns["status"] == "completed"
    states = client.get("/api/progress/blocks?topicId=consistent-hashing", headers=h).json()["blocks"]
    assert states["q-ch-1"]["status"] == "passed"


# ---------------------------------------------------------------- events, funnel, time zone


def test_events_and_admin_funnel(client: TestClient) -> None:
    h = _signup(client, "event_reader")
    bad = client.post("/api/events", headers=h, json={"events": [{"kind": "clicked_everything"}]})
    assert bad.status_code == 400
    ok = client.post(
        "/api/events", headers=h,
        json={"events": [{"kind": "chapter_opened", "topicId": "dns-and-cdn"}, {"kind": "sandbox_opened", "topicId": "dns-and-cdn"}]},
    )
    assert ok.json()["recorded"] == 2

    assert client.get("/api/admin/funnel", headers=h).status_code == 403
    admin = _signup(client, "funnel_admin")
    funnel = client.get("/api/admin/funnel", headers=admin).json()
    dns = next(c for c in funnel["chapters"] if c["topicId"] == "dns-and-cdn")
    assert dns["opened"] == 1 and dns["attempted"] == 0


def test_streak_day_follows_the_learner_time_zone(client: TestClient) -> None:
    from datetime import datetime, timezone

    from backend.app.db.database import user_today

    h = _signup(client, "tz_reader")
    assert client.patch("/api/auth/preferences", headers=h, json={"timezone": "Mars/Olympus"}).status_code == 400
    res = client.patch("/api/auth/preferences", headers=h, json={"timezone": "Asia/Kolkata"})
    assert res.status_code == 200 and res.json()["user"]["timezone"] == "Asia/Kolkata"
    uid = res.json()["user"]["id"]
    late_utc = datetime(2026, 11, 23, 20, 0, tzinfo=timezone.utc)  # 01:30 on the 24th in India
    assert user_today(uid, late_utc).isoformat() == "2026-11-24"


def test_guest_unit_status_and_events_move_on_sign_up(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SYSTEMCRAFT_ALLOW_GUESTS", "1")
    from backend.app.db.database import get_conn
    from backend.app.services.guest import create_guest, merge_guest_into

    guest = create_guest()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO unit_status (user_id, topic_id, status, source, updated_at) VALUES (?, 'dns-and-cdn', 'completed', 'v1', 'x')",
            (guest["id"],),
        )
        conn.execute(
            "INSERT INTO learning_events (user_id, kind, topic_id, ref, props_json, created_at) VALUES (?, 'chapter_opened', 'dns-and-cdn', '', '{}', 'x')",
            (guest["id"],),
        )
    h = _signup(client, "merged_reader")
    uid = client.get("/api/auth/me", headers=h).json()["user"]["id"]
    merge_guest_into(guest["id"], uid)
    with get_conn() as conn:
        assert conn.execute("SELECT 1 FROM unit_status WHERE user_id = ?", (uid,)).fetchone()
        assert conn.execute("SELECT 1 FROM learning_events WHERE user_id = ?", (uid,)).fetchone()
        assert not conn.execute("SELECT 1 FROM users WHERE id = ?", (guest["id"],)).fetchone()
