"""Admin view of reviewer feedback. Admins are listed in SYSTEMCRAFT_ADMIN_USERNAMES."""

from __future__ import annotations

import os
from typing import Literal
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.db.database import get_conn, utc_now_iso
from backend.app.routers.feedback import serialize_feedback
from backend.app.services.auth import require_admin
from backend.app.services.curriculum_loader import get_store

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])

FeedbackStatus = Literal["open", "resolved", "wont_fix"]


class FeedbackUpdateIn(BaseModel):
    status: FeedbackStatus
    admin_note: str = Field(default="", max_length=2000, alias="adminNote")

    model_config = {"populate_by_name": True}


def _issue_url(item: dict, reporter: str) -> str | None:
    """A prefilled 'new issue' link, when SYSTEMCRAFT_ISSUES_URL (…/issues/new) is set."""
    base = os.environ.get("SYSTEMCRAFT_ISSUES_URL", "").strip()
    if not base:
        return None
    title = f"[content] {item['topicId']} / {item['blockId']}: {item['category']}"
    body = (
        f"Reported by {reporter} on {item['createdAt'][:10]}\n\n"
        f"- Topic: `{item['topicId']}`\n- Block: `{item['blockId']}`\n"
        f"- Content version: `{item['contentVersion']}`\n- Category: {item['category']}\n\n"
        f"> {item['message']}\n"
    )
    return f"{base}?{urlencode({'title': title, 'body': body})}"


@router.get("/feedback")
def list_feedback(
    status: Literal["open", "resolved", "wont_fix", "all"] = Query(default="open"),
    topic_id: str | None = Query(default=None),
) -> dict:
    clauses, params = [], []
    if status != "all":
        clauses.append("f.status = ?")
        params.append(status)
    if topic_id:
        clauses.append("f.topic_id = ?")
        params.append(topic_id)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with get_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT f.*, u.username, u.display_name
            FROM content_feedback f LEFT JOIN users u ON u.id = f.user_id
            {where}
            ORDER BY f.topic_id, f.id DESC
            """,
            params,
        ).fetchall()
        counts = conn.execute(
            "SELECT topic_id, status, COUNT(*) AS n FROM content_feedback GROUP BY topic_id, status"
        ).fetchall()

    store = get_store()
    items = []
    for r in rows:
        item = serialize_feedback(r)
        reporter = r["display_name"] or r["username"] or r["user_id"]
        item["reporter"] = reporter
        item["isCurrentVersion"] = store.content_versions.get(item["topicId"]) == item["contentVersion"]
        item["issueUrl"] = _issue_url(item, reporter)
        items.append(item)

    by_topic: dict[str, dict[str, int]] = {}
    for c in counts:
        by_topic.setdefault(c["topic_id"], {"open": 0, "resolved": 0, "wont_fix": 0})[c["status"]] = c["n"]
    return {"feedback": items, "countsByTopic": by_topic}


@router.patch("/feedback/{feedback_id}")
def update_feedback(feedback_id: int, payload: FeedbackUpdateIn) -> dict:
    resolved_at = None if payload.status == "open" else utc_now_iso()
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE content_feedback SET status = ?, admin_note = ?, resolved_at = ? WHERE id = ?",
            (payload.status, payload.admin_note.strip(), resolved_at, feedback_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Feedback not found")
        row = conn.execute("SELECT * FROM content_feedback WHERE id = ?", (feedback_id,)).fetchone()
    return {"feedback": serialize_feedback(row)}
