"""Interactive practice APIs: multi-user progress, streaks, SM-2 cards, quizzes, estimator, rubrics."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.db.database import (
    get_conn,
    get_streak_summary,
    list_lesson_progress,
    record_daily_activity,
    upsert_lesson_progress,
    utc_now_iso,
)
from backend.app.services.auth import require_user
from backend.app.services.curriculum_loader import get_store
from backend.app.services.estimator import calculate_capacity
from backend.app.services.sm2 import Rating, Sm2State, compute_next_sm2

router = APIRouter(prefix="/api", tags=["practice"], dependencies=[Depends(require_user)])


def _uid(user: dict) -> str:
    return user["id"]


def _goal(user: dict) -> int:
    return int(user.get("dailyGoal", 3))


class LessonProgressIn(BaseModel):
    kind: Literal["lesson", "case_study"] = "lesson"
    status: Literal["not_started", "in_progress", "completed"] = "in_progress"
    completed_steps: list[int] = Field(default_factory=list, alias="completedSteps")
    active_lens: Literal["intuition", "mechanics", "staffTradeoffs"] = Field(
        default="intuition", alias="activeLens"
    )

    model_config = {"populate_by_name": True}


class FlashcardReviewIn(BaseModel):
    rating: Rating


class QuizAnswerIn(BaseModel):
    selected_index: int = Field(..., ge=0, alias="selectedIndex")

    model_config = {"populate_by_name": True}


class CapacityCalcIn(BaseModel):
    title: str = "Custom Workload"
    dau: int = Field(..., gt=0)
    actions_per_user_per_day: float = Field(..., gt=0, alias="actionsPerUserPerDay")
    peak_multiplier: float = Field(default=3.0, ge=1.0, alias="peakMultiplier")
    avg_payload_bytes: int = Field(default=1024, gt=0, alias="avgPayloadBytes")
    retention_years: int = Field(default=5, ge=1, alias="retentionYears")
    read_share_percent: float = Field(default=90.0, ge=0.0, le=100.0, alias="readSharePercent")
    replication_factor: int = Field(default=3, ge=1, le=7, alias="replicationFactor")
    distinct_items_read_per_day: int | None = Field(default=None, gt=0, alias="distinctItemsReadPerDay")
    hot_fraction: float = Field(default=0.2, gt=0, le=1, alias="hotFraction")
    save_run: bool = Field(default=False, alias="saveRun")

    model_config = {"populate_by_name": True}


class RubricSaveIn(BaseModel):
    checked_criteria: list[str] = Field(default_factory=list, alias="checkedCriteria")
    notes: str = ""
    score: int = Field(default=0, ge=0, le=100)

    model_config = {"populate_by_name": True}


@router.post("/progress/lessons/{topic_id}")
def save_lesson_progress(
    topic_id: str,
    payload: LessonProgressIn,
    user: dict = Depends(require_user),
) -> dict:
    return upsert_lesson_progress(
        topic_id=topic_id,
        kind=payload.kind,
        status=payload.status,
        completed_steps=payload.completed_steps,
        active_lens=payload.active_lens,
        user_id=_uid(user),
    )


@router.get("/progress/streak")
def get_daily_streak(user: dict = Depends(require_user)) -> dict:
    return get_streak_summary(_uid(user), daily_goal=_goal(user))


@router.get("/progress/summary")
def get_progress_summary(user: dict = Depends(require_user)) -> dict:
    uid = _uid(user)
    store = get_store()
    progress = list_lesson_progress(uid)
    now_iso = datetime.now(timezone.utc).isoformat()

    with get_conn() as conn:
        reviews = {
            r["card_id"]: dict(r)
            for r in conn.execute("SELECT * FROM flashcard_reviews WHERE user_id = ?", (uid,)).fetchall()
        }
        quiz_rows = conn.execute(
            "SELECT is_correct, question_id FROM quiz_attempts WHERE user_id = ? ORDER BY id DESC",
            (uid,),
        ).fetchall()

    completed_lessons = sum(
        1 for p in progress.values() if p["kind"] == "lesson" and p["status"] == "completed"
    )
    completed_cases = sum(
        1 for p in progress.values() if p["kind"] == "case_study" and p["status"] == "completed"
    )

    due_cards = 0
    for cid in store.flashcards_by_id:
        rev = reviews.get(cid)
        if not rev or rev["next_review_date"] <= now_iso:
            due_cards += 1

    latest_by_q: dict[str, int] = {}
    for row in quiz_rows:
        if row["question_id"] not in latest_by_q:
            latest_by_q[row["question_id"]] = row["is_correct"]

    answered_unique = len(latest_by_q)
    correct_unique = sum(latest_by_q.values())
    streak = get_streak_summary(uid, daily_goal=_goal(user))

    return {
        "completedLessons": completed_lessons,
        "readyLessons": len(store.lessons_by_id),
        "completedCaseStudies": completed_cases,
        "readyCaseStudies": len(store.case_studies_by_id),
        "totalFlashcards": len(store.flashcards_by_id),
        "dueFlashcards": due_cards,
        "quizzesAnswered": answered_unique,
        "quizzesCorrect": correct_unique,
        "totalQuizzes": len(store.quizzes_by_id),
        "progressByTopic": progress,
        "streak": {
            "currentStreak": streak["currentStreak"],
            "longestStreak": streak["longestStreak"],
            "todayActions": streak["todayActions"],
            "dailyGoal": streak["dailyGoal"],
        },
    }


@router.get("/flashcards")
def list_flashcards(
    topic_id: str | None = Query(default=None),
    layer: int | None = Query(default=None),
    due_only: bool = Query(default=False),
    user: dict = Depends(require_user),
) -> dict:
    uid = _uid(user)
    store = get_store()
    now_iso = datetime.now(timezone.utc).isoformat()

    with get_conn() as conn:
        reviews = {
            r["card_id"]: dict(r)
            for r in conn.execute("SELECT * FROM flashcard_reviews WHERE user_id = ?", (uid,)).fetchall()
        }

    items = []
    for card in store.fq_bundle.flashcards:
        if topic_id and card.topic_id != topic_id:
            continue
        if layer and card.layer != layer:
            continue
        rev = reviews.get(card.id)
        is_due = (rev is None) or (rev["next_review_date"] <= now_iso)
        if due_only and not is_due:
            continue

        item = card.model_dump(by_alias=True)
        item["sm2"] = (
            {
                "repetitions": rev["repetitions"],
                "intervalDays": rev["interval_days"],
                "easinessFactor": rev["easiness_factor"],
                "nextReviewDate": rev["next_review_date"],
                "lastRating": rev["last_rating"],
            }
            if rev
            else {
                "repetitions": 0,
                "intervalDays": 0,
                "easinessFactor": 2.5,
                "nextReviewDate": now_iso,
                "lastRating": "new",
            }
        )
        item["isDue"] = is_due
        items.append(item)

    return {"flashcards": items}


@router.post("/flashcards/{card_id}/review")
def review_flashcard(
    card_id: str,
    payload: FlashcardReviewIn,
    user: dict = Depends(require_user),
) -> dict:
    uid = _uid(user)
    store = get_store()
    if card_id not in store.flashcards_by_id:
        raise HTTPException(status_code=404, detail=f"Flashcard '{card_id}' not found")

    with get_conn() as conn:
        existing = conn.execute(
            "SELECT * FROM flashcard_reviews WHERE user_id = ? AND card_id = ?", (uid, card_id)
        ).fetchone()
        prev = (
            Sm2State(
                repetitions=existing["repetitions"],
                interval_days=existing["interval_days"],
                easiness_factor=existing["easiness_factor"],
            )
            if existing
            else Sm2State()
        )
        updated = compute_next_sm2(prev, payload.rating)
        now = utc_now_iso()
        conn.execute(
            """
            INSERT INTO flashcard_reviews
                (user_id, card_id, repetitions, interval_days, easiness_factor, next_review_date, last_rating, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, card_id) DO UPDATE SET
                repetitions = excluded.repetitions,
                interval_days = excluded.interval_days,
                easiness_factor = excluded.easiness_factor,
                next_review_date = excluded.next_review_date,
                last_rating = excluded.last_rating,
                updated_at = excluded.updated_at
            """,
            (
                uid,
                card_id,
                updated["repetitions"],
                updated["intervalDays"],
                updated["easinessFactor"],
                updated["nextReviewDate"],
                updated["lastRating"],
                now,
            ),
        )
    record_daily_activity(uid, "flashcard")
    return {"cardId": card_id, "sm2": updated}


@router.get("/quizzes")
def list_quizzes(
    topic_id: str | None = Query(default=None),
    layer: int | None = Query(default=None),
    user: dict = Depends(require_user),
) -> dict:
    uid = _uid(user)
    store = get_store()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT question_id, selected_index, is_correct, answered_at FROM quiz_attempts WHERE user_id = ? ORDER BY id DESC",
            (uid,),
        ).fetchall()

    latest: dict[str, dict] = {}
    for row in rows:
        if row["question_id"] not in latest:
            latest[row["question_id"]] = {
                "selectedIndex": row["selected_index"],
                "isCorrect": bool(row["is_correct"]),
                "answeredAt": row["answered_at"],
            }

    # The answer key and explanations never leave the server for a question the
    # learner has not answered yet. After an attempt the reveal is attached,
    # exactly as POST /answer would have returned it.
    items = []
    for q in store.fq_bundle.quizzes:
        if topic_id and q.topic_id != topic_id:
            continue
        if layer and q.layer != layer:
            continue
        entry = q.public_view()
        attempt = latest.get(q.id)
        entry["lastAttempt"] = {**attempt, **q.reveal()} if attempt else None
        items.append(entry)

    return {"quizzes": items}


@router.post("/quizzes/{question_id}/answer")
def submit_quiz_answer(
    question_id: str,
    payload: QuizAnswerIn,
    user: dict = Depends(require_user),
) -> dict:
    uid = _uid(user)
    store = get_store()
    question = store.quizzes_by_id.get(question_id)
    if not question:
        raise HTTPException(status_code=404, detail=f"Quiz question '{question_id}' not found")
    if payload.selected_index >= len(question.options):
        raise HTTPException(status_code=400, detail="selectedIndex out of range")

    is_correct = payload.selected_index == question.correct_index
    now = utc_now_iso()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO quiz_attempts (user_id, question_id, topic_id, selected_index, is_correct, answered_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (uid, question_id, question.topic_id, payload.selected_index, int(is_correct), now),
        )
    record_daily_activity(uid, "quiz")

    return {
        "questionId": question_id,
        "selectedIndex": payload.selected_index,
        "isCorrect": is_correct,
        "answeredAt": now,
        **question.reveal(),
    }


@router.post("/estimator/calculate")
def run_estimator(
    payload: CapacityCalcIn,
    user: dict = Depends(require_user),
) -> dict:
    uid = _uid(user)
    result = calculate_capacity(
        dau=payload.dau,
        actions_per_user_per_day=payload.actions_per_user_per_day,
        peak_multiplier=payload.peak_multiplier,
        avg_payload_bytes=payload.avg_payload_bytes,
        retention_years=payload.retention_years,
        read_share_percent=payload.read_share_percent,
        replication_factor=payload.replication_factor,
        distinct_items_read_per_day=payload.distinct_items_read_per_day,
        hot_fraction=payload.hot_fraction,
    )
    if payload.save_run:
        now = utc_now_iso()
        with get_conn() as conn:
            conn.execute(
                """
                INSERT INTO estimation_runs
                    (user_id, title, dau, actions_per_day, peak_multiplier, avg_payload_bytes, retention_years, read_ratio, results_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    uid,
                    payload.title,
                    payload.dau,
                    payload.actions_per_user_per_day,
                    payload.peak_multiplier,
                    payload.avg_payload_bytes,
                    payload.retention_years,
                    payload.read_share_percent,
                    json.dumps(result),
                    now,
                ),
            )
    return result


@router.get("/estimator/runs")
def list_saved_estimations(user: dict = Depends(require_user)) -> dict:
    uid = _uid(user)
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM estimation_runs WHERE user_id = ? ORDER BY id DESC LIMIT 15",
            (uid,),
        ).fetchall()
    return {
        "runs": [
            {
                "id": r["id"],
                "title": r["title"],
                "dau": r["dau"],
                "actionsPerUserPerDay": r["actions_per_day"],
                "peakMultiplier": r["peak_multiplier"],
                "avgPayloadBytes": r["avg_payload_bytes"],
                "retentionYears": r["retention_years"],
                "readSharePercent": r["read_ratio"],
                "result": json.loads(r["results_json"]),
                "createdAt": r["created_at"],
            }
            for r in rows
        ]
    }


@router.get("/case-studies/{case_study_id}/rubric")
def get_case_study_rubric(
    case_study_id: str,
    user: dict = Depends(require_user),
) -> dict:
    uid = _uid(user)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM case_study_rubrics WHERE user_id = ? AND case_study_id = ?",
            (uid, case_study_id),
        ).fetchone()
    if not row:
        return {"caseStudyId": case_study_id, "checkedCriteria": [], "notes": "", "score": 0}
    return {
        "caseStudyId": case_study_id,
        "checkedCriteria": json.loads(row["checked_criteria_json"]),
        "notes": row["notes"],
        "score": row["score"],
        "updatedAt": row["updated_at"],
    }


@router.post("/case-studies/{case_study_id}/rubric")
def save_case_study_rubric(
    case_study_id: str,
    payload: RubricSaveIn,
    user: dict = Depends(require_user),
) -> dict:
    uid = _uid(user)
    store = get_store()
    if case_study_id not in store.case_studies_by_id:
        raise HTTPException(status_code=404, detail=f"Case study '{case_study_id}' not found")
    now = utc_now_iso()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO case_study_rubrics (user_id, case_study_id, checked_criteria_json, notes, score, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, case_study_id) DO UPDATE SET
                checked_criteria_json = excluded.checked_criteria_json,
                notes = excluded.notes,
                score = excluded.score,
                updated_at = excluded.updated_at
            """,
            (
                uid,
                case_study_id,
                json.dumps(payload.checked_criteria),
                payload.notes,
                payload.score,
                now,
            ),
        )
    record_daily_activity(uid, "lesson")
    return {
        "caseStudyId": case_study_id,
        "checkedCriteria": payload.checked_criteria,
        "notes": payload.notes,
        "score": payload.score,
        "updatedAt": now,
    }
