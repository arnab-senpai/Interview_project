"""Content model v2 routes, written for any track. Responses never include answer keys."""

from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.db.database import EVENT_KINDS, block_states, insert_attempt, insert_events, record_block_views, unit_statuses
from backend.app.services import review
from backend.app.services.auth import require_user
from backend.app.services.content_store import get_content
from backend.app.services.grading import grade

router = APIRouter(prefix="/api", tags=["topics"], dependencies=[Depends(require_user)])

Track = Literal["hld", "lld", "coding"]


def _block_status(st: dict[str, Any] | None, block: dict[str, Any]) -> dict[str, Any]:
    current = int(block.get("gradingVersion", 1))
    if not st:
        return {"status": "new", "attempts": 0}
    out: dict[str, Any] = {"attempts": st["attempts"]}
    if block.get("checkable"):
        if current in st["passedVersions"]:
            out["status"] = "passed"
        elif st["passedVersions"]:
            # Passed before the key or prompt changed: keep the pass, suggest a re-check.
            out["status"] = "recheck"
        elif st["attempts"]:
            out["status"] = "attempted"
        else:
            out["status"] = "viewed" if st["viewed"] else "new"
        if st["last"] and st["last"]["gradingVersion"] == current:
            out["lastResponse"] = st["last"]["response"]
            out["lastPassed"] = st["last"]["passed"]
    else:
        out["status"] = "viewed" if st["viewed"] else "new"
    return out


def topic_progress(user_id: str, topic: dict[str, Any], states=None) -> dict[str, Any]:
    states = block_states(user_id, topic["id"]) if states is None else states
    blocks = {b["id"]: b for b in topic["blocks"]}
    per_block = {bid: _block_status(states.get((topic["id"], bid)), b) for bid, b in blocks.items()}
    layers = []
    for layer in topic["layers"]:
        checks = [i for i in layer["blockIds"] if blocks[i].get("checkable")]
        passed = [i for i in checks if per_block[i]["status"] in ("passed", "recheck")]
        seen = [i for i in layer["blockIds"] if per_block[i]["status"] != "new"]
        layers.append(
            {
                "name": layer["name"],
                "checks": len(checks),
                "checksPassed": len(passed),
                "blocksSeen": len(seen),
                "blocks": len(layer["blockIds"]),
                "passed": bool(checks) and len(passed) == len(checks),
                "recheckSuggested": any(per_block[i]["status"] == "recheck" for i in checks),
            }
        )
    any_seen = any(s["status"] != "new" for s in per_block.values())
    all_layers = [l for l in layers if l["checks"]]
    status = "completed" if all_layers and all(l["passed"] for l in all_layers) else ("in_progress" if any_seen else "not_started")
    return {"status": status, "layers": layers, "blocks": per_block}


@router.get("/tracks/{track}/topics")
def list_topics(track: Track, user: dict = Depends(require_user)) -> dict:
    content = get_content()
    states = block_states(user["id"])
    units = unit_statuses(user["id"])
    topics = []
    for summary in content.summaries(track):
        pub = content.public(summary["id"])
        assert pub is not None
        prog = topic_progress(user["id"], pub, {k: v for k, v in states.items() if k[0] == summary["id"]})
        status = overlay_unit_status(prog["status"], units.get(summary["id"]))
        topics.append({**summary, "progress": {"status": status, "layers": prog["layers"]}})
    return {"track": track, "topics": topics, "v1Topics": content.v1_summaries(track)}


@router.get("/tracks/{track}/topics/{topic_id}")
def get_topic(
    track: Track,
    topic_id: str,
    layer: str | None = Query(default=None),
    user: dict = Depends(require_user),
) -> dict:
    pub = get_content().public(topic_id)
    if not pub or pub["track"] != track:
        raise HTTPException(status_code=404, detail=f"Topic '{topic_id}' not found in track '{track}'")
    topic = pub
    if layer:
        if layer not in {l["name"] for l in pub["layers"]}:
            raise HTTPException(status_code=404, detail=f"Topic '{topic_id}' has no layer '{layer}'")
        keep = {b for l in pub["layers"] if l["name"] == layer for b in l["blockIds"]}
        # Figures stay available: later layers' checks and the Remember card point at design figures.
        topic = {**pub, "blocks": [b for b in pub["blocks"] if b["id"] in keep or b["type"] == "figure"]}
    prog = topic_progress(user["id"], pub)
    prog["status"] = overlay_unit_status(prog["status"], unit_statuses(user["id"]).get(topic_id))
    return {"topic": topic, "progress": prog}


@router.get("/graph")
def get_graph() -> dict:
    return get_content().graph()


def overlay_unit_status(status: str, unit: dict[str, Any] | None) -> str:
    """A chapter finished under v1 or placed out stays done even before its checks are passed here."""
    if status == "completed" or not unit:
        return status
    return "placed_out" if unit["status"] == "placed_out" else "completed"


def resume_point(topic: dict[str, Any], prog: dict[str, Any]) -> dict[str, Any]:
    """Where Continue should land: the first block not yet seen, else the first unpassed check."""
    blocks = topic["blocks"]
    per = prog["blocks"]
    target = next((b for b in blocks if b["type"] != "figure" and per[b["id"]]["status"] == "new"), None)
    if target is None:
        target = next((b for b in blocks if b.get("checkable") and per[b["id"]]["status"] not in ("passed", "recheck")), None)
    if target is None:
        target = blocks[0] if blocks else None
    if target is None:
        return {"layer": None, "section": None, "blockId": None, "stepKey": None}
    return {"layer": target.get("layer"), "section": target.get("section"), "blockId": target["id"],
            "stepKey": step_keys(topic).get(target["id"])}


def step_keys(topic: dict[str, Any]) -> dict[str, str]:
    """Block id -> the reader's step key ("design-3", "section-check", "layer-apply").

    Mirrors buildSteps() in frontend/src/components/chapter/ChapterView.tsx so Continue
    can land on the right step."""
    keys: dict[str, str] = {}
    design_n = 0
    current = ""
    for b in topic["blocks"]:
        if b.get("section") == "design":
            if b["type"] == "prose" or not current.startswith("design-"):
                design_n += 1
                current = f"design-{design_n}"
        else:
            current = f"section-{b['section']}" if b.get("section") else f"layer-{b.get('layer')}"
        keys[b["id"]] = current
    return keys


def path_view(user_id: str, path_id: str) -> dict[str, Any] | None:
    content = get_content()
    path = content.paths.get(path_id)
    if not path:
        return None
    states = block_states(user_id)
    units = unit_statuses(user_id)
    cont: dict[str, Any] | None = None
    stages = []
    done = total = 0
    for stage in path.stages:
        chapters = []
        for entry in stage.chapters:
            pub = content.public(entry.topic) if entry.status == "ready" else None
            row: dict[str, Any] = {
                "number": entry.number,
                "topicId": entry.topic,
                "stageId": stage.id,
                "title": entry.title,
                "note": entry.note,
            }
            if pub is None:
                row.update({"summary": None, "format": "planned", "legacy": False, "available": False, "minutes": None,
                            "status": "planned"})
                chapters.append(row)
                continue
            prog = topic_progress(user_id, pub, {k: v for k, v in states.items() if k[0] == entry.topic})
            status = overlay_unit_status(prog["status"], units.get(entry.topic))
            total += 1
            done += status in ("completed", "placed_out")
            row.update(
                {
                    "summary": entry.summary or pub["summary"],
                    "format": "v2",
                    "legacy": bool(pub.get("legacy")),
                    "available": True,
                    "minutes": sum(l["minutes"] for l in pub["layers"]),
                    "status": status,
                    "layers": prog["layers"],
                }
            )
            chapters.append(row)
            if cont is None and stage.fixedOrder and status not in ("completed", "placed_out"):
                cont = {"topicId": entry.topic, "number": entry.number, "title": entry.title, "stageId": stage.id,
                        **resume_point(pub, prog)}
        stages.append({"id": stage.id, "title": stage.title, "summary": stage.summary, "fixedOrder": stage.fixedOrder,
                       "chapters": chapters})
    return {
        "id": path.id,
        "title": path.title,
        "summary": path.summary,
        "stages": stages,
        "chaptersDone": done,
        "chaptersAvailable": total,
        "continue": cont,
        "continueTopicId": cont["topicId"] if cont else None,
    }


@router.get("/paths/{path_id}")
def get_path(path_id: str, user: dict = Depends(require_user)) -> dict:
    view = path_view(user["id"], path_id)
    if view is None:
        raise HTTPException(status_code=404, detail=f"Path '{path_id}' not found")
    return view


class BlockViewsIn(BaseModel):
    topic_id: str = Field(..., alias="topicId", min_length=1, max_length=120)
    block_ids: list[str] = Field(..., alias="blockIds", min_length=1, max_length=200)

    model_config = {"populate_by_name": True}


@router.post("/progress/blocks")
def save_block_views(payload: BlockViewsIn, user: dict = Depends(require_user)) -> dict:
    pub = get_content().public(payload.topic_id)
    if not pub:
        raise HTTPException(status_code=404, detail=f"Topic '{payload.topic_id}' not found")
    known = {b["id"] for b in pub["blocks"]}
    unknown = [b for b in payload.block_ids if b not in known]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown block ids: {unknown[:5]}")
    new = record_block_views(user["id"], payload.topic_id, pub["contentVersion"], payload.block_ids)
    return {"recorded": len(payload.block_ids), "new": new, "progress": topic_progress(user["id"], pub)}


@router.get("/progress/blocks")
def get_block_progress(topic_id: str = Query(..., alias="topicId"), user: dict = Depends(require_user)) -> dict:
    pub = get_content().public(topic_id)
    if not pub:
        raise HTTPException(status_code=404, detail=f"Topic '{topic_id}' not found")
    return topic_progress(user["id"], pub)


class AttemptIn(BaseModel):
    topic_id: str = Field(..., alias="topicId")
    block_id: str = Field(..., alias="blockId")
    grading_version: int = Field(..., alias="gradingVersion", ge=1)
    response: dict[str, Any]

    model_config = {"populate_by_name": True}


@router.post("/attempts")
def submit_attempt(payload: AttemptIn, user: dict = Depends(require_user)) -> dict:
    content = get_content()
    pub = content.public(payload.topic_id)
    block = content.block(payload.topic_id, payload.block_id)
    if not pub or not block:
        raise HTTPException(status_code=404, detail="Block not found")
    if not block.get("checkable"):
        raise HTTPException(status_code=400, detail="This block has nothing to check")
    current = int(block.get("gradingVersion", 1))
    if payload.grading_version != current:
        raise HTTPException(status_code=409, detail="This question changed since the page loaded; reload to get the new version")
    result = grade(block, content.key(payload.topic_id, payload.block_id), payload.response, pub)
    saved = insert_attempt(
        user["id"], payload.topic_id, payload.block_id, current, pub["contentVersion"], payload.response,
        bool(result["passed"]), float(result["score"]),
    )
    prog = topic_progress(user["id"], pub)
    added = 0
    if prog["status"] == "completed":
        # Finishing a chapter fills the review queue with what it taught. First answers set the first due date.
        states = block_states(user["id"], payload.topic_id)
        first = {}
        for (_, bid), st in states.items():
            if st["attempts"]:
                first[bid] = st["firstPassed"]
        added = review.enroll_topic(user["id"], pub, first)
    return {
        "reviewItemsAdded": added,
        "attemptId": saved["id"],
        "topicId": payload.topic_id,
        "blockId": payload.block_id,
        "gradingVersion": current,
        "verdict": "passed" if result["passed"] else "failed",
        **result,
        "blockStatus": prog["blocks"][payload.block_id],
        "progress": {"status": prog["status"], "layers": prog["layers"]},
    }


@router.get("/attempts")
def list_attempts(topic_id: str = Query(..., alias="topicId"), user: dict = Depends(require_user)) -> dict:
    from backend.app.db.database import get_conn

    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, block_id, grading_version, passed, score, created_at FROM attempts"
            " WHERE user_id = ? AND topic_id = ? ORDER BY id DESC LIMIT 200",
            (user["id"], topic_id),
        ).fetchall()
    return {
        "attempts": [
            {"id": r["id"], "blockId": r["block_id"], "gradingVersion": r["grading_version"],
             "passed": bool(r["passed"]), "score": r["score"], "createdAt": r["created_at"]}
            for r in rows
        ]
    }


class EventIn(BaseModel):
    kind: str = Field(..., max_length=40)
    topic_id: str | None = Field(default=None, alias="topicId", max_length=120)
    ref: str | None = Field(default=None, max_length=120)
    props: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class EventsIn(BaseModel):
    events: list[EventIn] = Field(..., min_length=1, max_length=50)


@router.post("/events")
def post_events(payload: EventsIn, user: dict = Depends(require_user)) -> dict:
    """Batched client events for the alpha funnel. Unknown kinds are rejected so the log stays queryable."""
    bad = sorted({e.kind for e in payload.events} - EVENT_KINDS)
    if bad:
        raise HTTPException(status_code=400, detail=f"Unknown event kinds: {bad}; allowed: {sorted(EVENT_KINDS)}")
    for e in payload.events:
        if len(json.dumps(e.props)) > 2000:
            raise HTTPException(status_code=400, detail="props must stay under 2,000 characters")
    n = insert_events(user["id"], [{"kind": e.kind, "topicId": e.topic_id, "ref": e.ref, "props": e.props} for e in payload.events])
    return {"recorded": n}
