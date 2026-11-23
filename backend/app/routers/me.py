"""The learner's own plan: profile (onboarding answers), today's cards and skill states. Works for guests too."""

from __future__ import annotations

import json
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from backend.app.db.database import get_conn, utc_now_iso, valid_timezone
from backend.app.routers.topics import path_view
from backend.app.services import mastery, review
from backend.app.services.auth import require_user
from backend.app.services.content_store import get_content
from backend.app.services.planner import TRACK_PATHS, plan_today

router = APIRouter(prefix="/api/me", tags=["me"], dependencies=[Depends(require_user)])

Goal = Literal["hld", "lld", "coding"]
StartLevel = Literal["new", "built_apps", "experienced"]


class ProfileIn(BaseModel):
    goals: list[Goal] | None = Field(default=None, min_length=1, max_length=3)
    start_level: StartLevel | None = Field(default=None, alias="startLevel")
    interview_date: date | None = Field(default=None, alias="interviewDate")
    hours_per_week: float | None = Field(default=None, alias="hoursPerWeek", ge=0.5, le=60)
    timezone: str | None = Field(default=None, max_length=64)
    clear_interview_date: bool = Field(default=False, alias="clearInterviewDate")

    model_config = {"populate_by_name": True}

    @field_validator("goals")
    @classmethod
    def _unique(cls, v):
        return list(dict.fromkeys(v)) if v else v


def load_profile(user_id: str) -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM learner_profiles WHERE user_id = ?", (user_id,)).fetchone()
        user = conn.execute("SELECT timezone, onboarded_at FROM users WHERE id = ?", (user_id,)).fetchone()
        enrolled = conn.execute(
            "SELECT path_id FROM enrollments WHERE user_id = ? AND active = 1 ORDER BY started_at", (user_id,)
        ).fetchall()
    return {
        "goals": json.loads(row["goals_json"]) if row else ["hld"],
        "startLevel": row["start_level"] if row else None,
        "interviewDate": row["interview_date"] if row else None,
        "hoursPerWeek": row["hours_per_week"] if row else None,
        "timezone": (user["timezone"] if user else None) or "UTC",
        "onboarded": bool(user and user["onboarded_at"]),
        "paths": [r["path_id"] for r in enrolled],
    }


@router.get("/profile")
def get_profile(user: dict = Depends(require_user)) -> dict:
    return load_profile(user["id"])


@router.put("/profile")
def put_profile(payload: ProfileIn, user: dict = Depends(require_user)) -> dict:
    """Save onboarding answers (every field optional) and enroll in the path of each goal that has one."""
    uid = user["id"]
    tz = None
    if payload.timezone is not None:
        tz = valid_timezone(payload.timezone)
        if not tz:
            raise HTTPException(status_code=400, detail="timezone must be an IANA name such as Asia/Kolkata")
    current = load_profile(uid)
    goals = payload.goals or current["goals"]
    start = payload.start_level or current["startLevel"]
    interview = None if payload.clear_interview_date else (
        payload.interview_date.isoformat() if payload.interview_date else current["interviewDate"]
    )
    hours = payload.hours_per_week if payload.hours_per_week is not None else current["hoursPerWeek"]
    now = utc_now_iso()
    content = get_content()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO learner_profiles (user_id, goals_json, start_level, interview_date, hours_per_week, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET goals_json = excluded.goals_json,"
            " start_level = excluded.start_level, interview_date = excluded.interview_date,"
            " hours_per_week = excluded.hours_per_week, updated_at = excluded.updated_at",
            (uid, json.dumps(goals), start, interview, hours, now),
        )
        if tz:
            conn.execute("UPDATE users SET timezone = ? WHERE id = ?", (tz, uid))
        conn.execute("UPDATE users SET onboarded_at = COALESCE(onboarded_at, ?) WHERE id = ?", (now, uid))
        for g in goals:
            pid = TRACK_PATHS.get(g)
            if not pid or pid not in content.paths:
                continue  # LLD and coding paths arrive in Phase 4
            version = content.path_version(pid)
            exists = conn.execute("SELECT 1 FROM enrollments WHERE user_id = ? AND path_id = ?", (uid, pid)).fetchone()
            if exists:
                conn.execute("UPDATE enrollments SET active = 1 WHERE user_id = ? AND path_id = ?", (uid, pid))
            else:
                conn.execute(
                    "INSERT INTO enrollments (user_id, path_id, path_version, active, started_at) VALUES (?, ?, ?, 1, ?)",
                    (uid, pid, version, now),
                )
    return load_profile(uid)


@router.get("/today")
def get_today(track: Goal = Query(default="hld"), user: dict = Depends(require_user)) -> dict:
    pid = TRACK_PATHS.get(track)
    content = get_content()
    if not pid or pid not in content.paths:
        raise HTTPException(status_code=404, detail=f"No study path for track '{track}' yet")
    path = path_view(user["id"], pid)
    assert path is not None
    return plan_today(user, load_profile(user["id"]), path, content)


@router.get("/skills")
def get_skills(track: Goal = Query(default="hld"), user: dict = Depends(require_user)) -> dict:
    content = get_content()
    states = mastery.skill_states(user["id"], content, review.overdue_topics(user["id"]), track=track)
    return {"track": track, "skills": sorted(states.values(), key=lambda s: s["skill"])}
