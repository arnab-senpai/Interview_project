"""Stage test-out ("I already know this") and repair drills."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.app.db.database import block_states, insert_events
from backend.app.services import placement
from backend.app.services.auth import require_user
from backend.app.services.content_store import get_content

router = APIRouter(prefix="/api", tags=["placement"], dependencies=[Depends(require_user)])

DRILL_SIZE = 3


@router.post("/paths/{path_id}/stages/{stage_id}/check")
def start_stage_check(path_id: str, stage_id: str, user: dict = Depends(require_user)) -> dict:
    return placement.start(user["id"], get_content(), path_id, stage_id)


class PlacementAnswerIn(BaseModel):
    choice: int = Field(..., ge=0)


@router.post("/placement/{session_id}/answer")
def answer_stage_check(session_id: str, payload: PlacementAnswerIn, user: dict = Depends(require_user)) -> dict:
    return placement.answer(user["id"], get_content(), session_id, payload.choice)


@router.get("/drills/{topic_id}")
def get_drill(topic_id: str, user: dict = Depends(require_user)) -> dict:
    """Up to 3 checks from a chapter, the ones last answered wrong first. Answer them with POST /api/attempts, source "drill"."""
    content = get_content()
    pub = content.public(topic_id)
    if not pub:
        raise HTTPException(status_code=404, detail=f"Topic '{topic_id}' not found")
    states = block_states(user["id"], topic_id)
    blocks = placement.pool(pub)

    def rank(b: dict) -> tuple[int, int]:
        st = states.get((topic_id, b["id"]))
        if st and st["last"] and not st["last"]["passed"]:
            return (0, 0)
        return (1, 0) if not st or not st["attempts"] else (2, 0)

    chosen = sorted(blocks, key=rank)[:DRILL_SIZE]
    insert_events(user["id"], [{"kind": "drill_started", "topicId": topic_id}])
    return {
        "topicId": topic_id,
        "chapterTitle": pub["title"],
        "items": [{"blockId": b["id"], "gradingVersion": int(b.get("gradingVersion", 1)), "prompt": b["prompt"],
                   "options": [o["text"] for o in b["options"]]} for b in chosen],
    }
