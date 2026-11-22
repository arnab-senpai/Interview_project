"""End-to-end backend tests for SystemCraft Studio FastAPI routes, Pydantic models & SQLite."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi import HTTPException

from backend.app.routers import curriculum, practice
from backend.app.services.curriculum_loader import get_store


@pytest.fixture()
def isolated_db(tmp_path: Path):
    db_file = tmp_path / "test_systemcraft.db"
    os.environ["SYSTEMCRAFT_DB_PATH"] = str(db_file)

    from backend.app.db.database import init_db
    from backend.app.main import create_app

    init_db(db_file)
    app = create_app()
    yield app
    os.environ.pop("SYSTEMCRAFT_DB_PATH", None)


def _register(username: str, password: str = "strongpassword123", **extra) -> dict:
    """Register a learner and return (user dict, bearer header)."""
    from backend.app.routers import auth as auth_router

    reg = auth_router.register_user(
        auth_router.RegisterIn.model_validate({"username": username, "password": password, **extra})
    )
    return {"user": reg["user"], "header": f"Bearer {reg['accessToken']}", "token": reg["accessToken"]}


@pytest.fixture()
def learner(isolated_db) -> dict:
    return _register("learner_one")["user"]


def test_fastapi_routes_registered_and_curriculum_loads(isolated_db, learner) -> None:
    paths = set(isolated_db.openapi()["paths"].keys())
    expected = {
        "/api/health",
        "/api/tracks",
        "/api/hld/overview",
        "/api/hld/modules",
        "/api/hld/modules/{module_id}",
        "/api/hld/lessons/{lesson_id}",
        "/api/hld/case-studies/{case_study_id}",
        "/api/hld/patterns",
        "/api/hld/foundations",
        "/api/hld/reference",
        "/api/hld/search",
        "/api/progress/lessons/{topic_id}",
        "/api/progress/summary",
        "/api/flashcards",
        "/api/flashcards/{card_id}/review",
        "/api/quizzes",
        "/api/quizzes/{question_id}/answer",
        "/api/estimator/calculate",
        "/api/estimator/runs",
        "/api/case-studies/{case_study_id}/rubric",
        "/api/auth/register",
        "/api/auth/login",
        "/api/auth/me",
        "/api/auth/preferences",
        "/api/auth/tokens",
        "/api/auth/tokens/{token_id}",
        "/api/progress/streak",
        "/api/notes",
        "/api/notes/{topic_id}",
        "/api/feedback",
        "/api/feedback/mine",
        "/api/admin/feedback",
        "/api/admin/feedback/{feedback_id}",
    }
    assert expected.issubset(paths)

    health = curriculum.health_check()
    assert health["status"] == "ok"
    assert health["readyLessons"] == 17
    assert health["readyCaseStudies"] == 13
    assert health["flashcards"] >= 55
    assert health["quizzes"] >= 55

    mods = curriculum.list_hld_modules()["modules"]
    assert len(mods) == 6
    assert mods[0]["moduleNumber"] == 1
    assert mods[5]["candidateRubric"]["staffPrincipal"]["signals"]

    ov = curriculum.get_hld_overview(user=learner)
    assert len(ov["layers"]) == 7

    for entry in ov["lessons"]:
        if entry["status"] == "ready":
            lesson = curriculum.get_hld_lesson(entry["id"])
            assert lesson["adaptiveLenses"]["intuition"]
            assert lesson["firstPrinciplesStory"]

    for entry in ov["caseStudies"]:
        if entry["status"] == "ready":
            cs = curriculum.get_hld_case_study(entry["id"])
            assert len(cs["deepDives"]) >= 2

    with pytest.raises(HTTPException) as exc:
        curriculum.get_hld_lesson("non-existent-lesson")
    assert exc.value.status_code == 404


def test_search_patterns_foundations_and_reference(isolated_db) -> None:
    assert len(curriculum.get_tracks()["tracks"]) == 3
    assert len(curriculum.get_patterns()["patterns"]) == 12
    assert len(curriculum.get_foundations()["ddiaChapterMap"]) == 12
    reference = curriculum.get_reference()
    assert len(reference["latencyBenchmarks"]) == 13
    assert reference["latencyBenchmarksMeta"]["asOf"]
    assert [row["level"] for row in reference["levelMapping"]["rows"]] == ["Junior", "Mid", "Senior", "Staff"]

    hits = curriculum.search_curriculum(q="raft")["results"]
    assert any(item["id"] == "replication-and-consensus" for item in hits)

    lsm_hits = curriculum.search_curriculum(q="lsm")["results"]
    assert any(item["id"] == "btrees-vs-lsm-trees" for item in lsm_hits)


def test_progress_sm2_quiz_estimator_and_rubric_persistence(isolated_db, learner) -> None:
    user = learner
    p = practice.save_lesson_progress(
        "caching-and-stampede",
        practice.LessonProgressIn.model_validate(
            {
                "kind": "lesson",
                "status": "completed",
                "completedSteps": [1, 2, 3, 4],
                "activeLens": "mechanics",
            }
        ),
        user=user,
    )
    assert p["status"] == "completed"
    assert p["activeLens"] == "mechanics"

    cards = practice.list_flashcards(topic_id="caching-and-stampede", layer=None, due_only=False, user=user)["flashcards"]
    assert len(cards) >= 2
    card_id = cards[0]["id"]

    rev1 = practice.review_flashcard(card_id, practice.FlashcardReviewIn(rating="good"), user=user)
    assert rev1["sm2"]["repetitions"] == 1
    assert rev1["sm2"]["intervalDays"] == 1

    rev2 = practice.review_flashcard(card_id, practice.FlashcardReviewIn(rating="easy"), user=user)
    assert rev2["sm2"]["repetitions"] == 2
    assert rev2["sm2"]["intervalDays"] >= 6

    quizzes = practice.list_quizzes(topic_id="caching-and-stampede", layer=None, user=user)["quizzes"]
    assert len(quizzes) >= 2
    q0 = quizzes[0]
    # The browser never receives the answer key or explanations before answering.
    for q in quizzes:
        assert "correctIndex" not in q
        assert "explanation" not in q
        assert "optionExplanations" not in q
        assert q["lastAttempt"] is None
    key = get_store().quizzes_by_id[q0["id"]].correct_index
    wrong = (key + 1) % len(q0["options"])
    miss = practice.submit_quiz_answer(
        q0["id"],
        practice.QuizAnswerIn.model_validate({"selectedIndex": wrong}),
        user=user,
    )
    assert miss["isCorrect"] is False
    assert miss["correctIndex"] == key
    assert len(miss["optionExplanations"]) == len(q0["options"])
    ans = practice.submit_quiz_answer(
        q0["id"],
        practice.QuizAnswerIn.model_validate({"selectedIndex": key}),
        user=user,
    )
    assert ans["isCorrect"] is True
    answered = practice.list_quizzes(topic_id="caching-and-stampede", layer=None, user=user)["quizzes"]
    revealed = next(q for q in answered if q["id"] == q0["id"])
    assert revealed["lastAttempt"]["isCorrect"] is True
    assert revealed["lastAttempt"]["correctIndex"] == key
    assert all(q["lastAttempt"] is None for q in answered if q["id"] != q0["id"])

    calc = practice.run_estimator(
        practice.CapacityCalcIn.model_validate(
            {
                "title": "URL Shortener Check",
                "dau": 20000000,
                "actionsPerUserPerDay": 20.0,
                "peakMultiplier": 3.0,
                "avgPayloadBytes": 500,
                "retentionYears": 5,
                "readSharePercent": 99.0,
                "replicationFactor": 3,
                "saveRun": True,
            }
        ),
        user=user,
    )
    assert calc["metrics"]["avgQps"] == 4000.0
    assert len(calc["workedSteps"]) == 6

    runs = practice.list_saved_estimations(user=user)["runs"]
    assert len(runs) == 1

    practice.save_case_study_rubric(
        "url-shortener",
        practice.RubricSaveIn.model_validate(
            {"checkedCriteria": ["Identifies 100:1 read/write ratio"], "notes": "Nailed KGS", "score": 85}
        ),
        user=user,
    )
    assert practice.get_case_study_rubric("url-shortener", user=user)["score"] == 85

    summary = practice.get_progress_summary(user=user)
    assert summary["completedLessons"] == 1
    assert summary["quizzesCorrect"] == 1


def test_built_frontend_dist_served_and_api_404_guarded(isolated_db) -> None:
    from backend.app.core.config import FRONTEND_DIST_DIR

    assert (FRONTEND_DIST_DIR / "index.html").exists()
    spa_routes = [r for r in isolated_db.routes if getattr(r, "path", None) == "/{full_path:path}"]
    assert len(spa_routes) == 1
    serve_fn = spa_routes[0].endpoint

    index_resp = serve_fn("")
    assert index_resp.path.name == "index.html"

    with pytest.raises(HTTPException) as exc:
        serve_fn("api/unknown-route")
    assert exc.value.status_code == 404


def test_user_auth_tokens_isolation_streak_and_notes(isolated_db) -> None:
    from backend.app.routers import auth as auth_router
    from backend.app.routers import notes as notes_router
    from backend.app.services.auth import require_user

    reg = auth_router.register_user(
        auth_router.RegisterIn.model_validate(
            {
                "username": "alice_dev",
                "password": "strongpassword123",
                "displayName": "Alice Dev",
                "dailyGoal": 4,
            }
        )
    )
    assert reg["accessToken"]
    assert reg["user"]["username"] == "alice_dev"

    login = auth_router.login_user(auth_router.LoginIn(username="alice_dev", password="strongpassword123"))
    jwt_header = f"Bearer {login['accessToken']}"
    alice = require_user(authorization=jwt_header, x_study_token=None)
    assert alice["username"] == "alice_dev"
    assert alice["isGuest"] is False

    # Progress & Notes stay strictly isolated per user
    practice.save_lesson_progress(
        "outbox-and-cdc",
        practice.LessonProgressIn.model_validate(
            {"kind": "lesson", "status": "completed", "completedSteps": [1, 2], "activeLens": "mechanics"}
        ),
        user=alice,
    )
    bob = _register("bob_dev")["user"]
    alice_sum = practice.get_progress_summary(user=alice)
    bob_sum = practice.get_progress_summary(user=bob)
    assert alice_sum["completedLessons"] == 1
    assert bob_sum["completedLessons"] == 0

    # Personal sc_live_* token creation, auth resolution, and revocation
    created_tok = auth_router.create_personal_token(
        auth_router.CreateTokenIn.model_validate({"label": "CLI Notebook Sync", "expiresDays": 30}),
        user=alice,
    )
    raw_tok = created_tok["rawToken"]
    assert raw_tok.startswith("sc_live_")
    tok_user = require_user(authorization=f"Bearer {raw_tok}", x_study_token=None)
    assert tok_user["id"] == alice["id"]

    auth_router.revoke_personal_token(created_tok["token"]["id"], user=alice)
    with pytest.raises(HTTPException) as revoked:
        require_user(authorization=f"Bearer {raw_tok}", x_study_token=None)
    assert revoked.value.status_code == 401

    # Per-user Markdown notes CRUD & streak updates
    saved = notes_router.save_note(
        "outbox-and-cdc",
        notes_router.NoteSaveIn.model_validate(
            {
                "title": "Outbox WAL Notes",
                "contentMd": "# Outbox\n- Atomic `COMMIT` + `outbox` table.",
                "tags": ["DDIA Ch. 11", "CDC"],
                "pinned": True,
            }
        ),
        user=alice,
    )
    assert saved["note"]["pinned"] is True
    assert len(notes_router.list_notes(topic_id=None, q="WAL", user=alice)["notes"]) == 1
    assert len(notes_router.list_notes(topic_id=None, q="WAL", user=bob)["notes"]) == 0

    streak = practice.get_daily_streak(user=alice)
    assert streak["currentStreak"] >= 1
    assert streak["todayActions"] >= 2
    assert len(streak["heatmap"]) == 84

    assert notes_router.remove_note("outbox-and-cdc", user=alice)["deleted"] is True


def test_legacy_db_migration_preserves_guest_progress(tmp_path: Path) -> None:
    import sqlite3
    from backend.app.db.database import init_db, list_lesson_progress

    legacy_db = tmp_path / "legacy.db"
    os.environ["SYSTEMCRAFT_DB_PATH"] = str(legacy_db)
    try:
        with sqlite3.connect(legacy_db) as conn:
            conn.executescript(
                """
                CREATE TABLE lesson_progress (
                    topic_id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    status TEXT NOT NULL,
                    completed_steps_json TEXT NOT NULL,
                    active_lens TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO lesson_progress VALUES ('dns-and-cdn', 'lesson', 'completed', '[1,2,3]', 'intuition', '2026-01-01T00:00:00Z');
                """
            )
        init_db(legacy_db)
        migrated = list_lesson_progress("guest")
        assert migrated["dns-and-cdn"]["status"] == "completed"
    finally:
        os.environ.pop("SYSTEMCRAFT_DB_PATH", None)
