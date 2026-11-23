"""Alpha readiness: required sign-in, JWT secret config, CORS, SQLite WAL, feedback reports."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SYSTEMCRAFT_DB_PATH", str(tmp_path / "alpha.db"))
    monkeypatch.setenv("SYSTEMCRAFT_JWT_SECRET", "x" * 48)
    monkeypatch.setenv("SYSTEMCRAFT_ADMIN_USERNAMES", "arnab_admin")
    monkeypatch.setenv("SYSTEMCRAFT_ISSUES_URL", "https://github.com/example/repo/issues/new")
    from backend.app.main import create_app

    with TestClient(create_app()) as c:
        yield c


def _signup(client: TestClient, username: str) -> dict[str, str]:
    res = client.post("/api/auth/register", json={"username": username, "password": "strongpassword123"})
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['accessToken']}"}


def test_health_is_public_but_content_and_progress_need_sign_in(client: TestClient) -> None:
    assert client.get("/api/health").status_code == 200
    for path in ("/api/hld/overview", "/api/hld/lessons/caching-and-stampede", "/api/quizzes",
                 "/api/progress/summary", "/api/notes", "/api/auth/me"):
        res = client.get(path)
        assert res.status_code == 401, f"{path} -> {res.status_code}"
    assert client.put("/api/notes/dns-and-cdn", json={"contentMd": "x"}).status_code == 401


def test_bad_token_returns_401_instead_of_a_shared_guest(client: TestClient) -> None:
    for header in ("Bearer not-a-jwt", "Bearer a.b.c", "Bearer sc_live_doesnotexist"):
        res = client.get("/api/progress/summary", headers={"Authorization": header})
        assert res.status_code == 401
    assert client.get("/api/auth/me", headers={"X-Study-Token": "sc_live_nope"}).status_code == 401


def test_signed_in_users_get_separate_progress(client: TestClient) -> None:
    alice, bob = _signup(client, "alice_alpha"), _signup(client, "bob_alpha")
    me = client.get("/api/auth/me", headers=alice).json()
    assert me["authenticated"] is True and me["user"]["isAdmin"] is False
    client.post("/api/progress/lessons/dns-and-cdn", headers=alice,
                json={"kind": "lesson", "status": "completed", "completedSteps": [1], "activeLens": "intuition"})
    assert client.get("/api/progress/summary", headers=alice).json()["completedLessons"] == 1
    assert client.get("/api/progress/summary", headers=bob).json()["completedLessons"] == 0


def test_quiz_list_hides_answer_keys_over_http(client: TestClient) -> None:
    alice = _signup(client, "quiz_alpha")
    quizzes = client.get("/api/quizzes", headers=alice).json()["quizzes"]
    assert len(quizzes) >= 55
    assert not any({"correctIndex", "explanation", "optionExplanations"} & q.keys() for q in quizzes)
    res = client.post(f"/api/quizzes/{quizzes[0]['id']}/answer", headers=alice, json={"selectedIndex": 0}).json()
    assert {"isCorrect", "correctIndex", "explanation", "optionExplanations"} <= res.keys()


def test_feedback_report_and_admin_view(client: TestClient) -> None:
    reviewer = _signup(client, "reviewer_alpha")
    admin = _signup(client, "arnab_admin")

    res = client.post("/api/feedback", headers=reviewer, json={
        "topicId": "caching-and-stampede", "blockId": "chaos:hot-key-stampede:step:2",
        "category": "wrong", "message": "Is 40 queries right for 40 pods?",
    })
    assert res.status_code == 201, res.text
    report = res.json()["feedback"]
    assert len(report["contentVersion"]) == 12 and report["status"] == "open"

    assert client.post("/api/feedback", headers=reviewer, json={
        "topicId": "not-a-topic", "blockId": "overview", "message": "hello there"}).status_code == 404
    assert client.post("/api/feedback", json={
        "topicId": "caching-and-stampede", "blockId": "overview", "message": "no auth"}).status_code == 401

    assert client.get("/api/admin/feedback", headers=reviewer).status_code == 403
    listing = client.get("/api/admin/feedback", headers=admin).json()
    assert [f["id"] for f in listing["feedback"]] == [report["id"]]
    item = listing["feedback"][0]
    assert item["reporter"] == "reviewer_alpha" and item["isCurrentVersion"] is True
    assert item["issueUrl"].startswith("https://github.com/example/repo/issues/new?title=")
    assert listing["countsByTopic"]["caching-and-stampede"]["open"] == 1

    upd = client.patch(f"/api/admin/feedback/{report['id']}", headers=admin,
                       json={"status": "resolved", "adminNote": "Fixed in Phase 0"})
    assert upd.json()["feedback"]["status"] == "resolved"
    assert client.get("/api/admin/feedback", headers=admin).json()["feedback"] == []
    assert len(client.get("/api/admin/feedback?status=resolved", headers=admin).json()["feedback"]) == 1


def test_sqlite_runs_in_wal_mode_with_busy_timeout(client: TestClient) -> None:
    from backend.app.db.database import get_conn

    with get_conn() as conn:
        if conn.dialect != "sqlite":
            pytest.skip("SQLite fallback only; this run uses Postgres")
        assert conn.execute("PRAGMA journal_mode").scalar() == "wal"
        assert conn.execute("PRAGMA busy_timeout").scalar() >= 5000
    db_file = os.environ["SYSTEMCRAFT_DB_PATH"]
    with sqlite3.connect(db_file) as raw:  # WAL is a property of the file, not the connection
        assert raw.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_production_refuses_to_start_without_a_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.app.services.auth import check_jwt_secret_config

    monkeypatch.setenv("SYSTEMCRAFT_ENV", "production")
    monkeypatch.delenv("SYSTEMCRAFT_JWT_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="SYSTEMCRAFT_JWT_SECRET"):
        check_jwt_secret_config()
    monkeypatch.setenv("SYSTEMCRAFT_JWT_SECRET", "too-short")
    with pytest.raises(RuntimeError, match="at least"):
        check_jwt_secret_config()
    monkeypatch.setenv("SYSTEMCRAFT_JWT_SECRET", "y" * 40)
    check_jwt_secret_config()


def test_cors_origins_come_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.app.core.config import DEFAULT_CORS_ORIGINS, get_cors_origins

    monkeypatch.delenv("SYSTEMCRAFT_CORS_ORIGINS", raising=False)
    assert get_cors_origins() == list(DEFAULT_CORS_ORIGINS)
    monkeypatch.setenv("SYSTEMCRAFT_CORS_ORIGINS", "https://prep.office.lan, https://alt.office.lan")
    assert get_cors_origins() == ["https://prep.office.lan", "https://alt.office.lan"]
    monkeypatch.setenv("SYSTEMCRAFT_CORS_ORIGINS", "")
    assert get_cors_origins() == []


def test_cors_header_only_for_configured_origin(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SYSTEMCRAFT_DB_PATH", str(tmp_path / "cors.db"))
    monkeypatch.setenv("SYSTEMCRAFT_CORS_ORIGINS", "https://prep.office.lan")
    from backend.app.main import create_app

    with TestClient(create_app()) as c:
        ok = c.get("/api/health", headers={"Origin": "https://prep.office.lan"})
        assert ok.headers.get("access-control-allow-origin") == "https://prep.office.lan"
        other = c.get("/api/health", headers={"Origin": "http://localhost:5173"})
        assert "access-control-allow-origin" not in other.headers
