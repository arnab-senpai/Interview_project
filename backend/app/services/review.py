"""The review queue: one queue for everything a learner has met and should see again.

Items enter only when the learner finishes a chapter (every check passed), so a
new account has nothing due. Three kinds of item, addressed ``<topic>:<id>``:

- a quiz or predict block (kind ``choice``): graded on the server again;
- a recall card (kind ``recall``): a topic's ``reviewCards``, or its Remember
  card as "say the main point", rated again/hard/good/easy by the learner.

Scheduling sits behind ``Scheduler`` (SM-2 today) so FSRS can replace it later;
everything else only reads ``due_at``.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

from backend.app.db.database import get_conn, utc_now_iso
from backend.app.services.sm2 import Rating, Sm2State, compute_next_sm2

NEW_ITEMS_PER_QUEUE = 15
FIRST_DUE_DAYS = {"failed_first": 1, "passed_first": 3, "recall": 1}


class Scheduler(Protocol):
    def next(self, state: dict[str, Any], rating: Rating, now: datetime) -> dict[str, Any]: ...


class Sm2Scheduler:
    def next(self, state: dict[str, Any], rating: Rating, now: datetime) -> dict[str, Any]:
        out = compute_next_sm2(
            Sm2State(repetitions=state["repetitions"], interval_days=state["interval_days"], easiness_factor=state["easiness_factor"]),
            rating,
            now,
        )
        return {
            "repetitions": out["repetitions"],
            "interval_days": out["intervalDays"],
            "easiness_factor": out["easinessFactor"],
            "due_at": out["nextReviewDate"],
            "last_rating": rating,
        }


SCHEDULER: Scheduler = Sm2Scheduler()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def candidate_items(topic: dict[str, Any]) -> list[dict[str, Any]]:
    """What a finished chapter adds to the queue, in reading order."""
    tid = topic["id"]
    out: list[dict[str, Any]] = []
    for b in topic["blocks"]:
        if b["type"] in ("quiz", "predict"):
            out.append({"itemRef": f"{tid}:{b['id']}", "blockId": b["id"], "kind": "choice",
                        "gradingVersion": int(b.get("gradingVersion", 1))})
        elif b["type"] == "rememberCard":
            out.append({"itemRef": f"{tid}:{b['id']}", "blockId": b["id"], "kind": "recall", "gradingVersion": 1})
    for c in topic.get("reviewCards", []):
        out.append({"itemRef": f"{tid}:{c['id']}", "blockId": c["id"], "kind": "recall", "gradingVersion": 1})
    return out


def enroll_topic(user_id: str, topic: dict[str, Any], first_results: dict[str, bool] | None = None,
                 now: datetime | None = None) -> int:
    """Add a finished chapter's items. A check first answered wrong is due tomorrow, one answered right in 3 days."""
    now = now or _now()
    first_results = first_results or {}
    added = 0
    with get_conn() as conn:
        for it in candidate_items(topic):
            if conn.execute(
                "SELECT 1 FROM review_items WHERE user_id = ? AND item_ref = ?", (user_id, it["itemRef"])
            ).fetchone():
                continue
            if it["kind"] == "recall":
                days = FIRST_DUE_DAYS["recall"]
            else:
                days = FIRST_DUE_DAYS["passed_first" if first_results.get(it["blockId"], True) else "failed_first"]
            stamp = now.isoformat()
            conn.execute(
                "INSERT INTO review_items (user_id, item_ref, topic_id, kind, grading_version, repetitions, interval_days,"
                " easiness_factor, due_at, last_rating, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, 0, 0, 2.5, ?, 'new', ?, ?)",
                (user_id, it["itemRef"], topic["id"], it["kind"], it["gradingVersion"], (now + timedelta(days=days)).isoformat(),
                 stamp, stamp),
            )
            added += 1
    return added


def get_item(user_id: str, item_ref: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM review_items WHERE user_id = ? AND item_ref = ?", (user_id, item_ref)).fetchone()
    return dict(row) if row else None


def topic_items(user_id: str, topic_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM review_items WHERE user_id = ? AND topic_id = ? ORDER BY created_at, item_ref", (user_id, topic_id)
        ).fetchall()
    return [dict(r) for r in rows]


def due_items(user_id: str, now: datetime | None = None, limit: int = 20) -> tuple[list[dict[str, Any]], int]:
    """(items to show, total due). Most overdue first; at most NEW_ITEMS_PER_QUEUE never-reviewed items."""
    now_iso = (now or _now()).isoformat()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM review_items WHERE user_id = ? AND due_at <= ? ORDER BY due_at, item_ref", (user_id, now_iso)
        ).fetchall()
    total = len(rows)
    out: list[dict[str, Any]] = []
    new = 0
    for r in rows:
        if r["last_rating"] == "new":
            if new >= NEW_ITEMS_PER_QUEUE:
                continue
            new += 1
        out.append(dict(r))
        if len(out) >= limit:
            break
    return out, total


def overdue_topics(user_id: str, days: int = 7, now: datetime | None = None) -> set[str]:
    cutoff = ((now or _now()) - timedelta(days=days)).isoformat()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT topic_id FROM review_items WHERE user_id = ? AND due_at <= ?", (user_id, cutoff)
        ).fetchall()
    return {r["topic_id"] for r in rows}


def schedule(user_id: str, item: dict[str, Any], rating: Rating, now: datetime | None = None) -> dict[str, Any]:
    now = now or _now()
    nxt = SCHEDULER.next(item, rating, now)
    with get_conn() as conn:
        conn.execute(
            "UPDATE review_items SET repetitions = ?, interval_days = ?, easiness_factor = ?, due_at = ?, last_rating = ?,"
            " updated_at = ? WHERE user_id = ? AND item_ref = ?",
            (nxt["repetitions"], nxt["interval_days"], nxt["easiness_factor"], nxt["due_at"], nxt["last_rating"],
             utc_now_iso(), user_id, item["item_ref"]),
        )
    return nxt
