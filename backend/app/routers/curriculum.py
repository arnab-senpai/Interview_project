"""Read-only curriculum, lesson, case study, and search API endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.app.db.database import list_lesson_progress
from backend.app.services.auth import resolve_optional_user
from backend.app.services.curriculum_loader import get_store

router = APIRouter(prefix="/api", tags=["curriculum"])


def _uid(user: Any) -> str:
    return user["id"] if isinstance(user, dict) else "guest"


@router.get("/health")
def health_check() -> dict:
    store = get_store()
    return {
        "status": "ok",
        "readyLessons": len(store.lessons_by_id),
        "readyCaseStudies": len(store.case_studies_by_id),
        "flashcards": len(store.flashcards_by_id),
        "quizzes": len(store.quizzes_by_id),
    }


@router.get("/tracks")
def get_tracks() -> dict:
    return get_store().tracks


@router.get("/hld/overview")
def get_hld_overview(user: dict = Depends(resolve_optional_user)) -> dict:
    store = get_store()
    progress = list_lesson_progress(_uid(user))
    return {
        "layers": store.index.layers,
        "lessons": store.index.lessons,
        "caseStudies": store.index.case_studies,
        "progressByTopic": progress,
    }


@router.get("/hld/lessons/{lesson_id}")
def get_hld_lesson(lesson_id: str) -> dict:
    store = get_store()
    lesson = store.lessons_by_id.get(lesson_id)
    if not lesson:
        raise HTTPException(status_code=404, detail=f"Lesson '{lesson_id}' not found or still planned")
    return lesson.model_dump(by_alias=True)


@router.get("/hld/case-studies/{case_study_id}")
def get_hld_case_study(case_study_id: str) -> dict:
    store = get_store()
    cs = store.case_studies_by_id.get(case_study_id)
    if not cs:
        raise HTTPException(
            status_code=404, detail=f"Case study '{case_study_id}' not found or still planned"
        )
    return cs.model_dump(by_alias=True)


@router.get("/hld/patterns")
def get_patterns() -> dict:
    return get_store().patterns.model_dump(by_alias=True)


@router.get("/hld/foundations")
def get_foundations() -> dict:
    return get_store().foundations


@router.get("/hld/reference")
def get_reference() -> dict:
    return get_store().reference.model_dump(by_alias=True)


@router.get("/hld/search")
def search_curriculum(q: str = Query(default="", min_length=0)) -> dict:
    return {"query": q, "results": get_store().search(q)}


@router.get("/hld/modules")
def list_hld_modules() -> dict:
    return get_store().modules.model_dump(by_alias=True)


@router.get("/hld/modules/{module_id}")
def get_hld_module(module_id: str) -> dict:
    mod = get_store().modules_by_id.get(module_id)
    if not mod:
        raise HTTPException(status_code=404, detail=f"HLD module '{module_id}' not found")
    return mod.model_dump(by_alias=True)
