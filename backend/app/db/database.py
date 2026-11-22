"""SQLite persistence for multi-user auth, tokens, daily streaks, notes, and HLD practice."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

from backend.app.core.config import get_db_path


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_date_iso() -> str:
    return datetime.now().date().isoformat()


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


# Several colleagues share one SQLite file during the alpha. WAL lets readers run
# while one writer commits, and busy_timeout makes a second writer wait for the
# lock instead of failing at once with "database is locked".
SQLITE_BUSY_TIMEOUT_MS = 5000


def _connect(target: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(target, timeout=SQLITE_BUSY_TIMEOUT_MS / 1000)
    conn.execute(f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA synchronous = NORMAL")  # safe with WAL: a crash can lose the last commit, never corrupt the file
    return conn


def init_db(db_path: Path | None = None) -> None:
    target = db_path or get_db_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    with _connect(target) as conn:
        conn.execute("PRAGMA journal_mode = WAL")  # persistent: stored in the database file
        _migrate_single_user_tables(conn)
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL,
                email TEXT NOT NULL DEFAULT '',
                password_hash TEXT NOT NULL,
                daily_goal INTEGER NOT NULL DEFAULT 3,
                preferred_lens TEXT NOT NULL DEFAULT 'intuition',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS personal_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                label TEXT NOT NULL,
                token_prefix TEXT NOT NULL,
                token_hash TEXT UNIQUE NOT NULL,
                last_used_at TEXT,
                expires_at TEXT,
                revoked INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS daily_activity (
                user_id TEXT NOT NULL,
                activity_date TEXT NOT NULL,
                lessons_touched INTEGER NOT NULL DEFAULT 0,
                flashcards_reviewed INTEGER NOT NULL DEFAULT 0,
                quizzes_answered INTEGER NOT NULL DEFAULT 0,
                notes_saved INTEGER NOT NULL DEFAULT 0,
                total_actions INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, activity_date)
            );

            CREATE TABLE IF NOT EXISTS user_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                topic_id TEXT NOT NULL,
                title TEXT NOT NULL,
                content_md TEXT NOT NULL DEFAULT '',
                tags_json TEXT NOT NULL DEFAULT '[]',
                pinned INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE (user_id, topic_id)
            );

            CREATE TABLE IF NOT EXISTS lesson_progress (
                user_id TEXT NOT NULL DEFAULT 'guest',
                topic_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'not_started',
                completed_steps_json TEXT NOT NULL DEFAULT '[]',
                active_lens TEXT NOT NULL DEFAULT 'intuition',
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, topic_id)
            );

            CREATE TABLE IF NOT EXISTS flashcard_reviews (
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

            CREATE TABLE IF NOT EXISTS quiz_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL DEFAULT 'guest',
                question_id TEXT NOT NULL,
                topic_id TEXT NOT NULL,
                selected_index INTEGER NOT NULL,
                is_correct INTEGER NOT NULL,
                answered_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS estimation_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL DEFAULT 'guest',
                title TEXT NOT NULL,
                dau INTEGER NOT NULL,
                actions_per_day REAL NOT NULL,
                peak_multiplier REAL NOT NULL,
                avg_payload_bytes INTEGER NOT NULL,
                retention_years INTEGER NOT NULL,
                read_ratio REAL NOT NULL,
                results_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS content_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                topic_id TEXT NOT NULL,
                block_id TEXT NOT NULL,
                content_version TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'other',
                message TEXT NOT NULL,
                page_url TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                admin_note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                resolved_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_content_feedback_topic ON content_feedback (topic_id, status);

            CREATE TABLE IF NOT EXISTS case_study_rubrics (
                user_id TEXT NOT NULL DEFAULT 'guest',
                case_study_id TEXT NOT NULL,
                checked_criteria_json TEXT NOT NULL DEFAULT '[]',
                notes TEXT NOT NULL DEFAULT '',
                score INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, case_study_id)
            );
            """
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO users (id, username, display_name, email, password_hash, daily_goal, preferred_lens, created_at)
            VALUES ('guest', 'guest', 'Local Guest', '', '', 3, 'intuition', ?)
            """,
            (utc_now_iso(),),
        )
        conn.commit()


@contextmanager
def get_conn(db_path: Path | None = None) -> Iterator[sqlite3.Connection]:
    target = db_path or get_db_path()
    conn = _connect(target)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def record_daily_activity(user_id: str, category: str, activity_date: str | None = None) -> None:
    """Increment user's daily study activity counter for heatmap & streaks."""
    day_key = activity_date or today_date_iso()
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

    today = datetime.now().date()
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


def _serialize_note(r: sqlite3.Row) -> dict[str, Any]:
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
