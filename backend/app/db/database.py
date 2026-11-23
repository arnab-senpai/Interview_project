"""Persistence for auth, tokens, streaks, notes, practice and Phase 1 block progress.

Postgres in production and CI, SQLite as the zero-setup local fallback (see
backend/app/db/engine.py). Alembic owns the schema: init_db() runs
"upgrade head" on startup, so every deploy migrates itself.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from alembic import command
from alembic.config import Config

from backend.app.core.config import BACKEND_DIR
from backend.app.db.engine import DbConn, connect, get_engine, is_sqlite


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_date_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def valid_timezone(name: str | None) -> str | None:
    """The IANA name if Python knows it, else None."""
    if not name or len(name) > 64:
        return None
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return None
    return name


def user_today(user_id: str, now: datetime | None = None) -> date:
    """Today's date in the learner's own time zone (users.timezone, UTC when unset or unknown)."""
    with get_conn() as conn:
        row = conn.execute("SELECT timezone FROM users WHERE id = ?", (user_id,)).fetchone()
    tz = ZoneInfo(valid_timezone(row["timezone"] if row else None) or "UTC")
    return (now or datetime.now(timezone.utc)).astimezone(tz).date()


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {r[1] for r in rows}

def _migrate_single_user_tables(conn: sqlite3.Connection) -> None:
    """Safely upgrade legacy single-user tables to user_id-scoped schemas without losing data."""
    if _table_columns(conn, "lesson_progress") and "user_id" not in _table_columns(conn, "lesson_progress"):
        conn.executescript(
            """
            ALTER TABLE lesson_progress RENAME TO _legacy_lesson_progress;
            CREATE TABLE lesson_progress (
                user_id TEXT NOT NULL DEFAULT 'guest',
                topic_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'not_started',
                completed_steps_json TEXT NOT NULL DEFAULT '[]',
                active_lens TEXT NOT NULL DEFAULT 'intuition',
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, topic_id)
            );
            INSERT INTO lesson_progress (user_id, topic_id, kind, status, completed_steps_json, active_lens, updated_at)
            SELECT 'guest', topic_id, kind, status, completed_steps_json, active_lens, updated_at FROM _legacy_lesson_progress;
            DROP TABLE _legacy_lesson_progress;
            """
        )

    if _table_columns(conn, "flashcard_reviews") and "user_id" not in _table_columns(conn, "flashcard_reviews"):
        conn.executescript(
            """
            ALTER TABLE flashcard_reviews RENAME TO _legacy_flashcard_reviews;
            CREATE TABLE flashcard_reviews (
                user_id TEXT NOT NULL DEFAULT 'guest',
                card_id TEXT NOT NULL,
                repetitions INTEGER NOT NULL DEFAULT 0,
                interval_days INTEGER NOT NULL DEFAULT 0,
                easiness_factor REAL NOT NULL DEFAULT 2.5,
                next_review_date TEXT NOT NULL,
                last_rating TEXT NOT NULL DEFAULT 'new',
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, card_id)
            );
            INSERT INTO flashcard_reviews (user_id, card_id, repetitions, interval_days, easiness_factor, next_review_date, last_rating, updated_at)
            SELECT 'guest', card_id, repetitions, interval_days, easiness_factor, next_review_date, last_rating, updated_at FROM _legacy_flashcard_reviews;
            DROP TABLE _legacy_flashcard_reviews;
            """
        )

    if _table_columns(conn, "quiz_attempts") and "user_id" not in _table_columns(conn, "quiz_attempts"):
        conn.execute("ALTER TABLE quiz_attempts ADD COLUMN user_id TEXT NOT NULL DEFAULT 'guest'")

    if _table_columns(conn, "estimation_runs") and "user_id" not in _table_columns(conn, "estimation_runs"):
        conn.execute("ALTER TABLE estimation_runs ADD COLUMN user_id TEXT NOT NULL DEFAULT 'guest'")

    if _table_columns(conn, "case_study_rubrics") and "user_id" not in _table_columns(conn, "case_study_rubrics"):
        conn.executescript(
            """
            ALTER TABLE case_study_rubrics RENAME TO _legacy_case_study_rubrics;
            CREATE TABLE case_study_rubrics (
                user_id TEXT NOT NULL DEFAULT 'guest',
                case_study_id TEXT NOT NULL,
                checked_criteria_json TEXT NOT NULL DEFAULT '[]',
                notes TEXT NOT NULL DEFAULT '',
                score INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, case_study_id)
            );
            INSERT INTO case_study_rubrics (user_id, case_study_id, checked_criteria_json, notes, score, updated_at)
            SELECT 'guest', case_study_id, checked_criteria_json, notes, score, updated_at FROM _legacy_case_study_rubrics;
            DROP TABLE _legacy_case_study_rubrics;
            """
        )



def _upgrade_pre_alembic_sqlite(db_file: Path) -> None:
    """Very old single-user SQLite files predate user_id columns; fix them before Alembic adopts the file."""
    if not db_file.exists():
        return
    conn = sqlite3.connect(db_file)
    try:
        _migrate_single_user_tables(conn)
        conn.commit()
    finally:
        conn.close()


def alembic_config() -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    return cfg


def init_db(db_path: Path | None = None) -> None:
    """Bring the database to the latest Alembic revision."""
    engine = get_engine(db_path)
    if is_sqlite(str(engine.url)) and engine.url.database:
        _upgrade_pre_alembic_sqlite(Path(engine.url.database))
    cfg = alembic_config()
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")


@contextmanager
def get_conn(db_path: Path | None = None) -> Iterator[DbConn]:
    """One transaction; commits when the block exits without an exception."""
    with connect(db_path) as conn:
        yield conn


def record_daily_activity(user_id: str, category: str, activity_date: str | None = None) -> None:
    """Increment user's daily study activity counter for heatmap & streaks."""
    day_key = activity_date or user_today(user_id).isoformat()
    now = utc_now_iso()
    col_map = {
        "lesson": "lessons_touched",
        "flashcard": "flashcards_reviewed",
        "quiz": "quizzes_answered",
        "note": "notes_saved",
    }
    col = col_map.get(category)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO daily_activity (user_id, activity_date, total_actions, updated_at)
            VALUES (?, ?, 0, ?)
            ON CONFLICT(user_id, activity_date) DO NOTHING
            """,
            (user_id, day_key, now),
        )
        if col:
            conn.execute(
                f"""
                UPDATE daily_activity
                SET {col} = {col} + 1, total_actions = total_actions + 1, updated_at = ?
                WHERE user_id = ? AND activity_date = ?
                """,
                (now, user_id, day_key),
            )


def get_streak_summary(user_id: str, daily_goal: int = 3, days: int = 84) -> dict[str, Any]:
    """Compute current/longest streak and a 12-week activity heatmap."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM daily_activity WHERE user_id = ? ORDER BY activity_date ASC",
            (user_id,),
        ).fetchall()

    by_date: dict[str, dict[str, int]] = {
        r["activity_date"]: {
            "count": int(r["total_actions"]),
            "lessons": int(r["lessons_touched"]),
            "flashcards": int(r["flashcards_reviewed"]),
            "quizzes": int(r["quizzes_answered"]),
            "notes": int(r["notes_saved"]),
        }
        for r in rows
    }

    today = user_today(user_id)
    today_iso = today.isoformat()
    today_actions = by_date.get(today_iso, {}).get("count", 0)

    # Current streak continues if active today or yesterday
    cursor = today if today_actions > 0 else today - timedelta(days=1)
    current_streak = 0
    while by_date.get(cursor.isoformat(), {}).get("count", 0) > 0:
        current_streak += 1
        cursor -= timedelta(days=1)

    # Longest historical streak across sorted active dates
    longest_streak = 0
    running = 0
    prev_day: date | None = None
    for d_iso, stats in sorted(by_date.items()):
        if stats["count"] <= 0:
            continue
        cur_day = date.fromisoformat(d_iso)
        if prev_day and (cur_day - prev_day).days == 1:
            running += 1
        else:
            running = 1
        longest_streak = max(longest_streak, running)
        prev_day = cur_day

    heatmap = []
    start_day = today - timedelta(days=days - 1)
    goal = max(1, daily_goal)
    for offset in range(days):
        d = start_day + timedelta(days=offset)
        d_iso = d.isoformat()
        info = by_date.get(d_iso)
        count = info["count"] if info else 0
        if count == 0:
            level = 0
        elif count < max(2, goal // 2):
            level = 1
        elif count < goal:
            level = 2
        elif count < goal * 2:
            level = 3
        else:
            level = 4
        heatmap.append(
            {
                "date": d_iso,
                "count": count,
                "level": level,
                "lessons": info["lessons"] if info else 0,
                "flashcards": info["flashcards"] if info else 0,
                "quizzes": info["quizzes"] if info else 0,
                "notes": info["notes"] if info else 0,
            }
        )

    return {
        "currentStreak": current_streak,
        "longestStreak": max(longest_streak, current_streak),
        "todayActions": today_actions,
        "dailyGoal": goal,
        "activeDays": sum(1 for v in by_date.values() if v["count"] > 0),
        "heatmap": heatmap,
    }


def upsert_lesson_progress(
    topic_id: str,
    kind: str,
    status: str,
    completed_steps: list[int],
    active_lens: str,
    user_id: str = "guest",
) -> dict[str, Any]:
    now = utc_now_iso()
    steps = sorted(set(completed_steps))
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT status, completed_steps_json FROM lesson_progress WHERE user_id = ? AND topic_id = ?",
            (user_id, topic_id),
        ).fetchone()
        prev_steps = set(json.loads(existing["completed_steps_json"])) if existing else set()
        # Only real progress counts toward the daily goal: a new step or a status change.
        # Replays and repeated saves of the same state must not inflate the streak counter.
        advanced = existing is None or existing["status"] != status or not set(steps) <= prev_steps
        conn.execute(
            """
            INSERT INTO lesson_progress (user_id, topic_id, kind, status, completed_steps_json, active_lens, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, topic_id) DO UPDATE SET
                kind = excluded.kind,
                status = excluded.status,
                completed_steps_json = excluded.completed_steps_json,
                active_lens = excluded.active_lens,
                updated_at = excluded.updated_at
            """,
            (user_id, topic_id, kind, status, json.dumps(steps), active_lens, now),
        )
    if advanced:
        record_daily_activity(user_id, "lesson")
    return {
        "topicId": topic_id,
        "kind": kind,
        "status": status,
        "completedSteps": steps,
        "activeLens": active_lens,
        "updatedAt": now,
    }


def list_lesson_progress(user_id: str = "guest") -> dict[str, dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM lesson_progress WHERE user_id = ?", (user_id,)).fetchall()
    return {
        r["topic_id"]: {
            "topicId": r["topic_id"],
            "kind": r["kind"],
            "status": r["status"],
            "completedSteps": json.loads(r["completed_steps_json"]),
            "activeLens": r["active_lens"],
            "updatedAt": r["updated_at"],
        }
        for r in rows
    }


def _serialize_note(r: Any) -> dict[str, Any]:
    return {
        "id": r["id"],
        "topicId": r["topic_id"],
        "title": r["title"],
        "contentMd": r["content_md"],
        "tags": json.loads(r["tags_json"]),
        "pinned": bool(r["pinned"]),
        "createdAt": r["created_at"],
        "updatedAt": r["updated_at"],
    }


def list_user_notes(user_id: str, topic_id: str | None = None, q: str = "") -> list[dict[str, Any]]:
    with get_conn() as conn:
        if topic_id:
            rows = conn.execute(
                "SELECT * FROM user_notes WHERE user_id = ? AND topic_id = ? ORDER BY pinned DESC, updated_at DESC",
                (user_id, topic_id),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM user_notes WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC",
                (user_id,),
            ).fetchall()
    notes = [_serialize_note(r) for r in rows]
    query = q.strip().lower()
    if query:
        notes = [
            n
            for n in notes
            if query in n["title"].lower()
            or query in n["contentMd"].lower()
            or any(query in t.lower() for t in n["tags"])
        ]
    return notes


def get_user_note(user_id: str, topic_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM user_notes WHERE user_id = ? AND topic_id = ?",
            (user_id, topic_id),
        ).fetchone()
    return _serialize_note(row) if row else None


def upsert_user_note(
    user_id: str,
    topic_id: str,
    title: str,
    content_md: str,
    tags: list[str],
    pinned: bool = False,
) -> dict[str, Any]:
    now = utc_now_iso()
    clean_tags = sorted({t.strip() for t in tags if t.strip()})
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO user_notes (user_id, topic_id, title, content_md, tags_json, pinned, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, topic_id) DO UPDATE SET
                title = excluded.title,
                content_md = excluded.content_md,
                tags_json = excluded.tags_json,
                pinned = excluded.pinned,
                updated_at = excluded.updated_at
            """,
            (user_id, topic_id, title.strip() or topic_id, content_md, json.dumps(clean_tags), int(pinned), now, now),
        )
        row = conn.execute(
            "SELECT * FROM user_notes WHERE user_id = ? AND topic_id = ?",
            (user_id, topic_id),
        ).fetchone()
    record_daily_activity(user_id, "note")
    assert row is not None
    return _serialize_note(row)


def delete_user_note(user_id: str, topic_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM user_notes WHERE user_id = ? AND topic_id = ?",
            (user_id, topic_id),
        )
    return cur.rowcount > 0


# ---------------------------------------------------------------- Phase 1: blocks and attempts


def record_block_views(user_id: str, topic_id: str, content_version: str, block_ids: list[str]) -> int:
    """Mark blocks as seen. Returns how many were new for this learner."""
    now = utc_now_iso()
    new = 0
    with get_conn() as conn:
        for bid in dict.fromkeys(block_ids):
            cur = conn.execute(
                "UPDATE block_progress SET last_viewed_at = ?, content_version = ?"
                " WHERE user_id = ? AND topic_id = ? AND block_id = ?",
                (now, content_version, user_id, topic_id, bid),
            )
            if cur.rowcount == 0:
                conn.execute(
                    "INSERT INTO block_progress (user_id, topic_id, block_id, content_version, first_viewed_at, last_viewed_at)"
                    " VALUES (?, ?, ?, ?, ?, ?)",
                    (user_id, topic_id, bid, content_version, now, now),
                )
                new += 1
    if new:
        record_daily_activity(user_id, "lesson")
    return new


def insert_attempt(
    user_id: str,
    topic_id: str,
    block_id: str,
    grading_version: int,
    content_version: str,
    response: Any,
    passed: bool,
    score: float,
) -> dict[str, Any]:
    now = utc_now_iso()
    with get_conn() as conn:
        attempt_id = conn.execute(
            "INSERT INTO attempts (user_id, topic_id, block_id, grading_version, content_version, response_json, passed, score, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            (user_id, topic_id, block_id, grading_version, content_version, json.dumps(response), int(passed), score, now),
        ).scalar()
    record_daily_activity(user_id, "quiz")
    return {"id": attempt_id, "createdAt": now}


def block_states(user_id: str, topic_id: str | None = None) -> dict[tuple[str, str], dict[str, Any]]:
    """Per (topic, block): seen?, attempts, and the grading versions that were passed."""
    params: list[Any] = [user_id]
    where = "WHERE user_id = ?"
    if topic_id:
        where += " AND topic_id = ?"
        params.append(topic_id)
    with get_conn() as conn:
        views = conn.execute(f"SELECT topic_id, block_id, last_viewed_at FROM block_progress {where}", params).fetchall()
        tries = conn.execute(
            f"SELECT topic_id, block_id, grading_version, passed, response_json, created_at FROM attempts {where} ORDER BY id",
            params,
        ).fetchall()
    out: dict[tuple[str, str], dict[str, Any]] = {}
    for v in views:
        out.setdefault((v["topic_id"], v["block_id"]), {"viewed": False, "attempts": 0, "passedVersions": set(), "last": None})[
            "viewed"
        ] = True
    for t in tries:
        st = out.setdefault((t["topic_id"], t["block_id"]), {"viewed": False, "attempts": 0, "passedVersions": set(), "last": None})
        st["attempts"] += 1
        if t["passed"]:
            st["passedVersions"].add(int(t["grading_version"]))
        st["last"] = {"gradingVersion": int(t["grading_version"]), "passed": bool(t["passed"]),
                      "response": json.loads(t["response_json"]), "at": t["created_at"]}
    return out


# ---------------------------------------------------------------- Phase 2a: unit status and events


def unit_statuses(user_id: str) -> dict[str, dict[str, Any]]:
    """Path units finished outside the reader: under v1, or placed out (Phase 2c)."""
    with get_conn() as conn:
        rows = conn.execute("SELECT topic_id, status, source, updated_at FROM unit_status WHERE user_id = ?", (user_id,)).fetchall()
    return {r["topic_id"]: {"status": r["status"], "source": r["source"], "updatedAt": r["updated_at"]} for r in rows}


EVENT_KINDS = {
    "chapter_opened",
    "layer_finished",
    "chapter_finished",
    "step_viewed",
    "sandbox_opened",
    "preview_opened",
    "chapter_skipped",
    "onboarding_started",
    "onboarding_finished",
    "review_session",
}


def insert_events(user_id: str, events: list[dict[str, Any]]) -> int:
    now = utc_now_iso()
    with get_conn() as conn:
        for e in events:
            conn.execute(
                "INSERT INTO learning_events (user_id, kind, topic_id, ref, props_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, e["kind"], e.get("topicId") or "", e.get("ref") or "", json.dumps(e.get("props") or {}), now),
            )
    return len(events)


def funnel_counts(since_iso: str | None = None) -> dict[str, dict[str, int]]:
    """Per topic: distinct learners who opened it, made an attempt, and passed at least one check.

    Guests count too: the alpha wants to see where anyone stops."""
    since = " AND created_at >= ?" if since_iso else ""
    params: list[Any] = [since_iso] if since_iso else []
    out: dict[str, dict[str, int]] = {}
    with get_conn() as conn:
        opened = conn.execute(
            "SELECT topic_id, COUNT(DISTINCT user_id) AS n FROM ("
            " SELECT topic_id, user_id, first_viewed_at AS created_at FROM block_progress"
            " UNION ALL SELECT topic_id, user_id, created_at FROM learning_events WHERE kind = 'chapter_opened'"
            f") t WHERE 1 = 1{since} GROUP BY topic_id",
            params,
        ).fetchall()
        tried = conn.execute(
            f"SELECT topic_id, COUNT(DISTINCT user_id) AS n FROM attempts WHERE 1 = 1{since} GROUP BY topic_id",
            params,
        ).fetchall()
        passed = conn.execute(
            f"SELECT topic_id, COUNT(DISTINCT user_id) AS n FROM attempts WHERE passed = 1{since} GROUP BY topic_id",
            params,
        ).fetchall()
    for name, rows in (("opened", opened), ("attempted", tried), ("passedACheck", passed)):
        for r in rows:
            out.setdefault(r["topic_id"], {"opened": 0, "attempted": 0, "passedACheck": 0})[name] = int(r["n"])
    return out
