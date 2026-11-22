"""Per-user Markdown study notes API scoped cleanly to lesson/case-study topics."""

from __future__ import annotations


from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.db.database import delete_user_note, get_user_note, list_user_notes, upsert_user_note
from backend.app.services.auth import require_user

router = APIRouter(prefix="/api/notes", tags=["notes"], dependencies=[Depends(require_user)])


def _uid(user: dict) -> str:
    return user["id"]


class NoteSaveIn(BaseModel):
    title: str = Field(default="", max_length=140)
    content_md: str = Field(default="", max_length=60000, alias="contentMd")
    tags: list[str] = Field(default_factory=list)
    pinned: bool = False

    model_config = {"populate_by_name": True}


@router.get("")
def list_notes(
    topic_id: str | None = Query(default=None),
    q: str = Query(default=""),
    user: dict = Depends(require_user),
) -> dict:
    return {"notes": list_user_notes(_uid(user), topic_id=topic_id, q=q)}


@router.get("/{topic_id}")
def get_note(topic_id: str, user: dict = Depends(require_user)) -> dict:
    note = get_user_note(_uid(user), topic_id)
    if note:
        return {"exists": True, "note": note}
    return {
        "exists": False,
        "note": {
            "id": 0,
            "topicId": topic_id,
            "title": topic_id,
            "contentMd": "",
            "tags": [],
            "pinned": False,
            "createdAt": "",
            "updatedAt": "",
        },
    }


@router.put("/{topic_id}")
def save_note(topic_id: str, payload: NoteSaveIn, user: dict = Depends(require_user)) -> dict:
    saved = upsert_user_note(
        user_id=_uid(user),
        topic_id=topic_id,
        title=payload.title or topic_id,
        content_md=payload.content_md,
        tags=payload.tags,
        pinned=payload.pinned,
    )
    return {"note": saved}


@router.delete("/{topic_id}")
def remove_note(topic_id: str, user: dict = Depends(require_user)) -> dict:
    deleted = delete_user_note(_uid(user), topic_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Note for topic '{topic_id}' not found")
    return {"deleted": True, "topicId": topic_id}
