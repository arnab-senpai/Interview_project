"""Guest learners: a signed HttpOnly cookie, a real user row, and a merge at sign-in.

A guest id looks like ``anon_<32 hex>``. The cookie holds ``<id>.<hmac>`` signed
with the same server secret as access tokens, so a visitor cannot pick someone
else's id. Each guest gets its own row, so guests never share progress.

Merge rule at sign-in (from the curriculum plan review): every attempt is
appended to the account, and pass/fail is recomputed from the combined log, so a
block counts as passed if any attempt at its current grading version passed.
Other rows keep the account's value when both sides have one.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import threading
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.app.core.config import GUEST_IDLE_DAYS, GUESTS_PER_IP_PER_HOUR, is_production
from backend.app.db.database import get_conn, utc_now_iso

GUEST_COOKIE = "sc_guest"
GUEST_ID_RE = re.compile(r"^anon_[0-9a-f]{32}$")
COOKIE_MAX_AGE = GUEST_IDLE_DAYS * 24 * 3600


def _secret() -> bytes:
    from backend.app.services.auth import _get_jwt_secret

    return _get_jwt_secret()


def sign_guest_id(guest_id: str) -> str:
    sig = hmac.new(_secret(), f"guest:{guest_id}".encode(), hashlib.sha256).hexdigest()[:32]
    return f"{guest_id}.{sig}"


def verify_guest_cookie(value: str | None) -> str | None:
    if not value or "." not in value:
        return None
    guest_id, sig = value.rsplit(".", 1)
    if not GUEST_ID_RE.match(guest_id):
        return None
    expected = sign_guest_id(guest_id).rsplit(".", 1)[1]
    return guest_id if hmac.compare_digest(sig, expected) else None


def cookie_kwargs() -> dict[str, Any]:
    return {
        "key": GUEST_COOKIE,
        "max_age": COOKIE_MAX_AGE,
        "httponly": True,
        "samesite": "lax",
        "secure": is_production(),
        "path": "/",
    }


class _IpRateLimiter:
    """Small in-process sliding window; enough for one VM. Swap for Redis if we scale out."""

    def __init__(self, limit: int, window_s: int) -> None:
        self.limit = limit
        self.window_s = window_s
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window_s:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


guest_limiter = _IpRateLimiter(GUESTS_PER_IP_PER_HOUR, 3600)


def create_guest() -> dict[str, Any]:
    guest_id = f"anon_{uuid.uuid4().hex}"
    now = utc_now_iso()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO users (id, username, display_name, email, password_hash, daily_goal,
                               preferred_lens, created_at, is_guest, last_seen_at)
            VALUES (?, ?, 'Guest', '', '', 3, 'intuition', ?, 1, ?)
            """,
            (guest_id, guest_id, now, now),
        )
        row = conn.execute("SELECT * FROM users WHERE id = ?", (guest_id,)).fetchone()
    return dict(row)


def load_guest(guest_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ? AND is_guest = 1", (guest_id,)).fetchone()
        if not row:
            return None
        conn.execute("UPDATE users SET last_seen_at = ? WHERE id = ?", (utc_now_iso(), guest_id))
    return dict(row)


_USER_TABLES = (
    "block_progress",
    "unit_status",
    "learning_events",
    "attempts",
    "lesson_progress",
    "flashcard_reviews",
    "quiz_attempts",
    "estimation_runs",
    "user_notes",
    "daily_activity",
    "case_study_rubrics",
    "content_feedback",
    "personal_tokens",
)


def _delete_user_rows(conn, user_id: str) -> None:
    for table in _USER_TABLES:
        conn.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM users WHERE id = ? AND is_guest = 1", (user_id,))


def merge_guest_into(guest_id: str, user_id: str) -> dict[str, int]:
    """Move a guest's study history into an account, then delete the guest row."""
    if not GUEST_ID_RE.match(guest_id) or guest_id == user_id:
        return {}
    moved: dict[str, int] = {}
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM users WHERE id = ? AND is_guest = 1", (guest_id,)).fetchone():
            return {}

        # Append-only logs: every guest row moves over.
        for table in ("attempts", "quiz_attempts", "estimation_runs", "learning_events"):
            moved[table] = conn.execute(
                f"UPDATE {table} SET user_id = ? WHERE user_id = ?", (user_id, guest_id)
            ).rowcount

        # Block views: keep the earliest first view and the latest last view.
        for g in conn.execute("SELECT * FROM block_progress WHERE user_id = ?", (guest_id,)).fetchall():
            mine = conn.execute(
                "SELECT * FROM block_progress WHERE user_id = ? AND topic_id = ? AND block_id = ?",
                (user_id, g["topic_id"], g["block_id"]),
            ).fetchone()
            if mine is None:
                conn.execute(
                    "INSERT INTO block_progress (user_id, topic_id, block_id, content_version, first_viewed_at, last_viewed_at)"
                    " VALUES (?, ?, ?, ?, ?, ?)",
                    (user_id, g["topic_id"], g["block_id"], g["content_version"], g["first_viewed_at"], g["last_viewed_at"]),
                )
            else:
                conn.execute(
                    "UPDATE block_progress SET first_viewed_at = ?, last_viewed_at = ?, content_version = ?"
                    " WHERE user_id = ? AND topic_id = ? AND block_id = ?",
                    (
                        min(mine["first_viewed_at"], g["first_viewed_at"]),
                        max(mine["last_viewed_at"], g["last_viewed_at"]),
                        g["content_version"] if g["last_viewed_at"] > mine["last_viewed_at"] else mine["content_version"],
                        user_id,
                        g["topic_id"],
                        g["block_id"],
                    ),
                )
        moved["block_progress"] = len(
            conn.execute("SELECT 1 FROM block_progress WHERE user_id = ?", (guest_id,)).fetchall()
        )

        # v1 lesson progress: union of completed steps, furthest status wins.
        rank = {"not_started": 0, "in_progress": 1, "completed": 2}
        for g in conn.execute("SELECT * FROM lesson_progress WHERE user_id = ?", (guest_id,)).fetchall():
            mine = conn.execute(
                "SELECT * FROM lesson_progress WHERE user_id = ? AND topic_id = ?", (user_id, g["topic_id"])
            ).fetchone()
            if mine is None:
                conn.execute(
                    "INSERT INTO lesson_progress (user_id, topic_id, kind, status, completed_steps_json, active_lens, updated_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (user_id, g["topic_id"], g["kind"], g["status"], g["completed_steps_json"], g["active_lens"], g["updated_at"]),
                )
                continue
            steps = sorted(set(json.loads(mine["completed_steps_json"])) | set(json.loads(g["completed_steps_json"])))
            status = max(mine["status"], g["status"], key=lambda s: rank.get(s, 0))
            conn.execute(
                "UPDATE lesson_progress SET status = ?, completed_steps_json = ? WHERE user_id = ? AND topic_id = ?",
                (status, json.dumps(steps), user_id, g["topic_id"]),
            )

        # Streak days: add the guest's counts to the account's.
        for g in conn.execute("SELECT * FROM daily_activity WHERE user_id = ?", (guest_id,)).fetchall():
            mine = conn.execute(
                "SELECT 1 FROM daily_activity WHERE user_id = ? AND activity_date = ?", (user_id, g["activity_date"])
            ).fetchone()
            if mine is None:
                conn.execute(
                    "INSERT INTO daily_activity (user_id, activity_date, lessons_touched, flashcards_reviewed,"
                    " quizzes_answered, notes_saved, total_actions, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (user_id, g["activity_date"], g["lessons_touched"], g["flashcards_reviewed"], g["quizzes_answered"],
                     g["notes_saved"], g["total_actions"], g["updated_at"]),
                )
            else:
                conn.execute(
                    "UPDATE daily_activity SET lessons_touched = lessons_touched + ?, flashcards_reviewed = flashcards_reviewed + ?,"
                    " quizzes_answered = quizzes_answered + ?, notes_saved = notes_saved + ?, total_actions = total_actions + ?"
                    " WHERE user_id = ? AND activity_date = ?",
                    (g["lessons_touched"], g["flashcards_reviewed"], g["quizzes_answered"], g["notes_saved"],
                     g["total_actions"], user_id, g["activity_date"]),
                )

        # Notes: a guest note on a topic the account already has is appended, not dropped.
        for g in conn.execute("SELECT * FROM user_notes WHERE user_id = ?", (guest_id,)).fetchall():
            mine = conn.execute(
                "SELECT * FROM user_notes WHERE user_id = ? AND topic_id = ?", (user_id, g["topic_id"])
            ).fetchone()
            if mine is None:
                conn.execute("UPDATE user_notes SET user_id = ? WHERE id = ?", (user_id, g["id"]))
            elif g["content_md"].strip() and g["content_md"].strip() not in mine["content_md"]:
                merged = f"{mine['content_md'].rstrip()}\n\n---\n_Added while signed out:_\n\n{g['content_md'].strip()}\n"
                conn.execute("UPDATE user_notes SET content_md = ?, updated_at = ? WHERE id = ?", (merged, utc_now_iso(), mine["id"]))

        # Spaced-repetition state and rubric drafts: keep the account's where both exist.
        for table, key in (("flashcard_reviews", "card_id"), ("case_study_rubrics", "case_study_id"), ("unit_status", "topic_id")):
            for g in conn.execute(f"SELECT {key} FROM {table} WHERE user_id = ?", (guest_id,)).fetchall():
                exists = conn.execute(
                    f"SELECT 1 FROM {table} WHERE user_id = ? AND {key} = ?", (user_id, g[key])
                ).fetchone()
                if exists is None:
                    conn.execute(
                        f"UPDATE {table} SET user_id = ? WHERE user_id = ? AND {key} = ?", (user_id, guest_id, g[key])
                    )

        _delete_user_rows(conn, guest_id)
    return moved


def purge_idle_guests(now: datetime | None = None) -> int:
    """Delete guest rows (and their data) with no activity for GUEST_IDLE_DAYS."""
    cutoff = ((now or datetime.now(timezone.utc)) - timedelta(days=GUEST_IDLE_DAYS)).isoformat()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id FROM users WHERE is_guest = 1 AND COALESCE(last_seen_at, created_at) < ?", (cutoff,)
        ).fetchall()
        for r in rows:
            _delete_user_rows(conn, r["id"])
    return len(rows)
