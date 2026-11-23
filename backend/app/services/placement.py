"""Stage test-out: an optional, adaptive check that lets a learner skip chapters they already know.

Rules (kept simple so the result can be explained in one sentence):
- Questions come from the stage's chapters in path order, skipping chapters already
  done. Each chapter gets max(1, min(3, 12 // chapters)) questions, so a check runs
  about 8 to 12 questions.
- A chapter's questions are its checks marked ``placement: true``; when it marks
  none, the quiz/predict checks of its Check section (else any quiz/predict check).
- The check stops at the second wrong answer. A chapter whose questions were all
  answered right is placed out; the rest stay open.
- Placed-out chapters count as done on the path. Their skills read as Practiced
  until real evidence says otherwise, and their review items come back in 14 days
  so a lucky guess is caught.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from backend.app.content.placement_pool import pool  # noqa: F401 (re-exported)
from backend.app.db.database import get_conn, insert_attempt, insert_events, unit_statuses, utc_now_iso
from backend.app.services import review
from backend.app.services.grading import grade

MAX_QUESTIONS = 12
MISSES_TO_STOP = 2
PLACED_FIRST_REVIEW_DAYS = 14


def per_unit(n_units: int) -> int:
    return max(1, min(3, MAX_QUESTIONS // max(1, n_units)))


def _done_topics(user_id: str, content: Any, topic_ids: list[str]) -> set[str]:
    from backend.app.routers.topics import topic_progress  # local import: routers import this module

    done = {t for t, u in unit_statuses(user_id).items() if u["status"] in ("completed", "placed_out")}
    for tid in topic_ids:
        pub = content.public(tid)
        if pub and topic_progress(user_id, pub)["status"] == "completed":
            done.add(tid)
    return done


def start(user_id: str, content: Any, path_id: str, stage_id: str) -> dict[str, Any]:
    path = content.paths.get(path_id)
    if not path:
        raise HTTPException(status_code=404, detail=f"Path '{path_id}' not found")
    stage = next((s for s in path.stages if s.id == stage_id), None)
    if not stage:
        raise HTTPException(status_code=404, detail=f"Stage '{stage_id}' not found")
    if not stage.stageCheck:
        raise HTTPException(status_code=400, detail="This stage has no test-out")
    units = [e.topic for e in stage.chapters if e.status == "ready" and content.public(e.topic)]
    done = _done_topics(user_id, content, units)
    todo = [t for t in units if t not in done]
    if not todo:
        raise HTTPException(status_code=409, detail="Every chapter in this stage is already done")
    k = per_unit(len(todo))
    questions = [{"topicId": t, "blockId": b["id"]} for t in todo for b in pool(content.public(t))[:k]]
    sid = uuid.uuid4().hex
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO placement_sessions (id, user_id, path_id, stage_id, questions_json, answers_json, status, created_at)"
            " VALUES (?, ?, ?, ?, ?, '[]', 'active', ?)",
            (sid, user_id, path_id, stage_id, json.dumps(questions), utc_now_iso()),
        )
    insert_events(user_id, [{"kind": "placement_started", "topicId": "", "ref": f"{path_id}/{stage_id}"}])
    return {"sessionId": sid, "stageId": stage_id, "total": len(questions), "chapters": todo,
            "question": _question(content, questions[0], 0, len(questions))}


def _question(content: Any, q: dict[str, str], index: int, total: int) -> dict[str, Any]:
    block = content.block(q["topicId"], q["blockId"])
    pub = content.public(q["topicId"])
    return {"index": index, "total": total, "topicId": q["topicId"], "chapterTitle": pub["title"] if pub else q["topicId"],
            "blockId": q["blockId"], "prompt": block["prompt"], "options": [o["text"] for o in block["options"]]}


def _load(user_id: str, session_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM placement_sessions WHERE id = ? AND user_id = ?", (session_id, user_id)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No such stage check")
    return dict(row)


def answer(user_id: str, content: Any, session_id: str, choice: int) -> dict[str, Any]:
    sess = _load(user_id, session_id)
    if sess["status"] != "active":
        raise HTTPException(status_code=409, detail="This stage check is finished")
    questions = json.loads(sess["questions_json"])
    answers = json.loads(sess["answers_json"])
    q = questions[len(answers)]
    pub, block = content.public(q["topicId"]), content.block(q["topicId"], q["blockId"])
    if not pub or not block:
        raise HTTPException(status_code=410, detail="This question was removed; start the check again")
    result = grade(block, content.key(q["topicId"], q["blockId"]), {"choice": choice}, pub)
    correct = bool(result["passed"])
    insert_attempt(user_id, q["topicId"], q["blockId"], int(block.get("gradingVersion", 1)), pub["contentVersion"],
                   {"choice": choice}, correct, 1.0 if correct else 0.0, source="placement")
    answers.append({**q, "choice": choice, "correct": correct})
    misses = sum(1 for a in answers if not a["correct"])
    finished = misses >= MISSES_TO_STOP or len(answers) == len(questions)
    reveal = result["reveal"]
    out: dict[str, Any] = {
        "correct": correct,
        "correctIndex": reveal["correctIndex"],
        "explanation": reveal["explanations"][choice] if choice < len(reveal["explanations"]) else None,
        "finished": finished,
    }
    with get_conn() as conn:
        conn.execute("UPDATE placement_sessions SET answers_json = ? WHERE id = ?", (json.dumps(answers), session_id))
    if finished:
        out["result"] = _finish(user_id, content, sess, questions, answers)
    else:
        out["question"] = _question(content, questions[len(answers)], len(answers), len(questions))
    return out


def _finish(user_id: str, content: Any, sess: dict[str, Any], questions: list[dict], answers: list[dict]) -> dict[str, Any]:
    order = list(dict.fromkeys(q["topicId"] for q in questions))
    asked = {t: [q for q in questions if q["topicId"] == t] for t in order}
    got = {t: [a for a in answers if a["topicId"] == t] for t in order}
    placed = [t for t in order if len(got[t]) == len(asked[t]) and all(a["correct"] for a in got[t])]
    study = [t for t in order if any(not a["correct"] for a in got[t])]
    unchecked = [t for t in order if t not in placed and t not in study]
    now = datetime.now(timezone.utc)
    stamp = now.isoformat()
    with get_conn() as conn:
        for t in placed:
            exists = conn.execute("SELECT status FROM unit_status WHERE user_id = ? AND topic_id = ?", (user_id, t)).fetchone()
            if exists is None:
                conn.execute(
                    "INSERT INTO unit_status (user_id, topic_id, status, source, updated_at) VALUES (?, ?, 'placed_out', 'placement', ?)",
                    (user_id, t, stamp),
                )
    for t in placed:
        pub = content.public(t)
        if pub:
            review.enroll_topic(user_id, pub, now=now, first_due_days=PLACED_FIRST_REVIEW_DAYS)
    result = {"placedOut": placed, "needsStudy": study, "notChecked": unchecked,
              "stoppedEarly": len(answers) < len(questions),
              "correct": sum(1 for a in answers if a["correct"]), "answered": len(answers)}
    with get_conn() as conn:
        conn.execute(
            "UPDATE placement_sessions SET status = 'finished', result_json = ?, finished_at = ? WHERE id = ?",
            (json.dumps(result), stamp, sess["id"]),
        )
    insert_events(user_id, [{"kind": "placement_finished", "topicId": "", "ref": f"{sess['path_id']}/{sess['stage_id']}",
                             "props": {"placed": len(placed), "answered": len(answers)}}])
    return result


def placed_topics(user_id: str) -> set[str]:
    return {t for t, u in unit_statuses(user_id).items() if u["status"] == "placed_out"}
