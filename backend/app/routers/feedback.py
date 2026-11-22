"""'Report an issue' on any content block: reviewers flag wrong or unclear content."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from backend.app.db.database import get_conn, utc_now_iso
from backend.app.services.auth import require_user
from backend.app.services.curriculum_loader import get_store

router = APIRouter(prefix="/api/feedback", tags=["feedback"], dependencies=[Depends(require_user)])

FeedbackCategory = Literal["wrong", "unclear", "outdated", "typo", "other"]


class FeedbackIn(BaseModel):
    topic_id: str = Field(..., min_length=1, max_length=120, alias="topicId")
    # Which block on the page, e.g. "overview", "lens:mechanics", "step:3",
    # "chaos:hot-key-stampede:step:2", "quiz:q-cache-1", "flashcard:fc-dns-1".
    block_id: str = Field(..., min_length=1, max_length=160, alias="blockId")
    category: FeedbackCategory = "other"
    message: str = Field(..., min_length=3, max_length=4000)
    page_url: str = Field(default="", max_length=500, alias="pageUrl")

    model_config = {"populate_by_name": True}


def serialize_feedback(row) -> dict:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "topicId": row["topic_id"],
        "blockId": row["block_id"],
        "contentVersion": row["content_version"],
        "category": row["category"],
        "message": row["message"],
        "pageUrl": row["page_url"],
        "status": row["status"],
        "adminNote": row["admin_note"],
        "createdAt": row["created_at"],
        "resolvedAt": row["resolved_at"],
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def report_issue(payload: FeedbackIn, user: dict = Depends(require_user)) -> dict:
    store = get_store()
    version = store.content_versions.get(payload.topic_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"Unknown topic '{payload.topic_id}'")
    now = utc_now_iso()
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO content_feedback
                (user_id, topic_id, block_id, content_version, category, message, page_url, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)
            """,
            (
                user["id"],
                payload.topic_id,
                payload.block_id.strip(),
                version,
                payload.category,
                payload.message.strip(),
                payload.page_url.strip(),
                now,
            ),
        )
        row = conn.execute("SELECT * FROM content_feedback WHERE id = ?", (cur.lastrowid,)).fetchone()
    return {"feedback": serialize_feedback(row)}


@router.get("/mine")
def list_my_reports(user: dict = Depends(require_user)) -> dict:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM content_feedback WHERE user_id = ? ORDER BY id DESC LIMIT 100",
            (user["id"],),
        ).fetchall()
    return {"feedback": [serialize_feedback(r) for r in rows]}
