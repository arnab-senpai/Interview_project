"""The review queue. Items come only from chapters the learner has finished."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.db.database import insert_attempt
from backend.app.services import review
from backend.app.services.auth import require_user
from backend.app.services.content_store import get_content
from backend.app.services.grading import grade

router = APIRouter(prefix="/api", tags=["review"], dependencies=[Depends(require_user)])

RATING_SCORE = {"again": 0.0, "hard": 0.6, "good": 0.85, "easy": 1.0}


def _resolve(item_ref: str) -> tuple[str, str]:
    topic_id, _, local = item_ref.partition(":")
    if not topic_id or not local:
        raise HTTPException(status_code=400, detail="itemRef looks like <topicId>:<id>")
    return topic_id, local


def present(item: dict[str, Any]) -> dict[str, Any] | None:
    """What the learner sees for one item; None when the content behind it is gone."""
    content = get_content()
    topic_id, local = _resolve(item["item_ref"])
    pub = content.public(topic_id)
    if not pub:
        return None
    base = {"itemRef": item["item_ref"], "topicId": topic_id, "chapterTitle": pub["title"], "kind": item["kind"],
            "dueAt": item["due_at"], "isNew": item["last_rating"] == "new"}
    block = content.block(topic_id, local)
    if item["kind"] == "choice":
        if not block or block["type"] not in ("quiz", "predict"):
            return None
        changed = int(block.get("gradingVersion", 1)) != int(item["grading_version"])
        return {**base, "prompt": block["prompt"], "options": [o["text"] for o in block["options"]], "changedSinceLastSeen": changed}
    if block and block["type"] == "rememberCard":
        back = "\n".join(f"- {f}" for f in block["facts"])
        return {**base, "prompt": f"Say the main point of “{pub['title']}” as you would in an interview.",
                "back": f"{block['sayIt']}\n\n{back}"}
    card = next((c for c in pub.get("reviewCards", []) if c["id"] == local), None)
    if card:
        return {**base, "prompt": card["front"], "back": card["back"]}
    return None


@router.get("/review/queue")
def get_queue(limit: int = Query(default=20, ge=1, le=100), user: dict = Depends(require_user)) -> dict:
    items, due = review.due_items(user["id"], limit=limit)
    shown = [p for p in (present(i) for i in items) if p]
    return {"due": due, "items": shown}


class AnswerIn(BaseModel):
    choice: int = Field(..., ge=0)


@router.post("/review/{item_ref}/answer")
def answer_item(item_ref: str, payload: AnswerIn, user: dict = Depends(require_user)) -> dict:
    item = review.get_item(user["id"], item_ref)
    if not item:
        raise HTTPException(status_code=404, detail="Not in your review queue")
    if item["kind"] != "choice":
        raise HTTPException(status_code=400, detail="This is a recall card; rate it with /grade")
    content = get_content()
    topic_id, block_id = _resolve(item_ref)
    pub, block = content.public(topic_id), content.block(topic_id, block_id)
    if not pub or not block:
        raise HTTPException(status_code=410, detail="This question was removed from the chapter")
    result = grade(block, content.key(topic_id, block_id), {"choice": payload.choice}, pub)
    insert_attempt(user["id"], topic_id, block_id, int(block.get("gradingVersion", 1)), pub["contentVersion"],
                   {"choice": payload.choice}, bool(result["passed"]), float(result["score"]), source="review")
    nxt = review.schedule(user["id"], item, "good" if result["passed"] else "again")
    reveal = result["reveal"]
    return {
        "itemRef": item_ref,
        "correct": bool(result["passed"]),
        "correctIndex": reveal["correctIndex"],
        "explanation": reveal["explanations"][payload.choice] if payload.choice < len(reveal["explanations"]) else None,
        "nextDueAt": nxt["due_at"],
    }


class GradeIn(BaseModel):
    rating: Literal["again", "hard", "good", "easy"]


@router.post("/review/{item_ref}/grade")
def grade_item(item_ref: str, payload: GradeIn, user: dict = Depends(require_user)) -> dict:
    item = review.get_item(user["id"], item_ref)
    if not item:
        raise HTTPException(status_code=404, detail="Not in your review queue")
    if item["kind"] != "recall":
        raise HTTPException(status_code=400, detail="This item is graded by answering it; use /answer")
    topic_id, local = _resolve(item_ref)
    pub = get_content().public(topic_id)
    insert_attempt(user["id"], topic_id, local, 1, pub["contentVersion"] if pub else "gone", {"rating": payload.rating},
                   payload.rating != "again", RATING_SCORE[payload.rating], source="review")
    nxt = review.schedule(user["id"], item, payload.rating)
    return {"itemRef": item_ref, "nextDueAt": nxt["due_at"], "intervalDays": nxt["interval_days"]}


@router.get("/topics/{topic_id}/review-items")
def chapter_review_items(topic_id: str, user: dict = Depends(require_user)) -> dict:
    """For the chapter end screen: what this chapter added to the queue."""
    if not get_content().public(topic_id):
        raise HTTPException(status_code=404, detail=f"Topic '{topic_id}' not found")
    items = [p for p in (present(i) for i in review.topic_items(user["id"], topic_id)) if p]
    return {"topicId": topic_id, "added": len(items), "items": items}
