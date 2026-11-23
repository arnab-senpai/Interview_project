"""Authentication, user preferences, and personal study token management routes."""

from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from backend.app.db.database import get_conn, get_streak_summary, utc_now_iso
from backend.app.services.auth import (
    compute_expiry_iso,
    create_access_token,
    generate_personal_token,
    hash_password,
    require_authenticated_user,
    require_user,
    serialize_user,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_.-]{3,32}$")


class RegisterIn(BaseModel):
    username: str = Field(..., min_length=3, max_length=32)
    password: str = Field(..., min_length=6, max_length=128)
    display_name: str = Field(default="", max_length=60, alias="displayName")
    email: str = Field(default="", max_length=120)
    daily_goal: int = Field(default=3, ge=1, le=50, alias="dailyGoal")

    model_config = {"populate_by_name": True}


class LoginIn(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class PreferencesIn(BaseModel):
    display_name: str | None = Field(default=None, max_length=60, alias="displayName")
    daily_goal: int | None = Field(default=None, ge=1, le=50, alias="dailyGoal")
    preferred_lens: str | None = Field(default=None, alias="preferredLens")

    model_config = {"populate_by_name": True}


class CreateTokenIn(BaseModel):
    label: str = Field(..., min_length=1, max_length=64)
    expires_days: int | None = Field(default=90, ge=1, le=3650, alias="expiresDays")

    model_config = {"populate_by_name": True}


def _adopt_guest(request: Request, response: Response, result: dict) -> dict:
    """If this browser studied as a guest, move that history into the account and drop the cookie."""
    from backend.app.services.guest import GUEST_COOKIE, merge_guest_into, verify_guest_cookie

    guest_id = verify_guest_cookie(request.cookies.get(GUEST_COOKIE))
    if guest_id:
        result["mergedGuest"] = merge_guest_into(guest_id, result["user"]["id"])
        result["streak"] = get_streak_summary(result["user"]["id"], daily_goal=result["user"]["dailyGoal"])
    if GUEST_COOKIE in request.cookies:
        response.delete_cookie(GUEST_COOKIE, path="/")
    return result


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register_route(payload: RegisterIn, request: Request, response: Response) -> dict:
    return _adopt_guest(request, response, register_user(payload))


@router.post("/login")
def login_route(payload: LoginIn, request: Request, response: Response) -> dict:
    return _adopt_guest(request, response, login_user(payload))


def register_user(payload: RegisterIn) -> dict:
    uname = payload.username.strip().lower()
    if uname == "guest" or not USERNAME_RE.match(uname):
        raise HTTPException(
            status_code=400,
            detail="Username must be 3-32 characters (letters, digits, _ . -) and cannot be 'guest'",
        )

    uid = f"usr_{uuid.uuid4().hex[:14]}"
    display = payload.display_name.strip() or payload.username.strip()
    now = utc_now_iso()
    pw_hash = hash_password(payload.password)

    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM users WHERE lower(username) = ?", (uname,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Username is already taken")

        conn.execute(
            """
            INSERT INTO users (id, username, display_name, email, password_hash, daily_goal, preferred_lens, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'intuition', ?)
            """,
            (uid, uname, display, payload.email.strip(), pw_hash, payload.daily_goal, now),
        )
        row = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()

    assert row is not None
    user_obj = serialize_user(row)
    token, expires_at = create_access_token(uid, uname, display)
    streak = get_streak_summary(uid, daily_goal=user_obj["dailyGoal"])
    return {
        "accessToken": token,
        "tokenType": "bearer",
        "expiresAt": expires_at,
        "user": user_obj,
        "streak": streak,
    }


def login_user(payload: LoginIn) -> dict:
    uname = payload.username.strip().lower()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE lower(username) = ?", (uname,)).fetchone()

    if not row or row["id"] == "guest" or row["is_guest"] or not verify_password(payload.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    user_obj = serialize_user(row)
    token, expires_at = create_access_token(user_obj["id"], user_obj["username"], user_obj["displayName"])
    streak = get_streak_summary(user_obj["id"], daily_goal=user_obj["dailyGoal"])
    return {
        "accessToken": token,
        "tokenType": "bearer",
        "expiresAt": expires_at,
        "user": user_obj,
        "streak": streak,
    }


@router.get("/me")
def get_me(user: dict = Depends(require_user)) -> dict:
    uid = user["id"]
    goal = user.get("dailyGoal", 3)
    return {
        "authenticated": True,
        "user": user,
        "streak": get_streak_summary(uid, daily_goal=goal),
    }


@router.patch("/preferences")
def update_preferences(payload: PreferencesIn, user: dict = Depends(require_user)) -> dict:
    uid = user["id"]
    allowed_lenses = {"intuition", "mechanics", "staffTradeoffs"}
    if payload.preferred_lens and payload.preferred_lens not in allowed_lenses:
        raise HTTPException(status_code=400, detail="Invalid preferredLens")

    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        next_display = (payload.display_name.strip() if payload.display_name is not None else row["display_name"]) or row["username"]
        next_goal = payload.daily_goal if payload.daily_goal is not None else row["daily_goal"]
        next_lens = payload.preferred_lens if payload.preferred_lens is not None else row["preferred_lens"]

        conn.execute(
            "UPDATE users SET display_name = ?, daily_goal = ?, preferred_lens = ? WHERE id = ?",
            (next_display, next_goal, next_lens, uid),
        )
        updated = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()

    assert updated is not None
    user_obj = serialize_user(updated)
    return {
        "user": user_obj,
        "streak": get_streak_summary(uid, daily_goal=user_obj["dailyGoal"]),
    }


@router.get("/tokens")
def list_personal_tokens(user: dict = Depends(require_authenticated_user)) -> dict:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, label, token_prefix, last_used_at, expires_at, revoked, created_at FROM personal_tokens WHERE user_id = ? ORDER BY id DESC",
            (user["id"],),
        ).fetchall()
    return {
        "tokens": [
            {
                "id": r["id"],
                "label": r["label"],
                "tokenPrefix": r["token_prefix"],
                "lastUsedAt": r["last_used_at"],
                "expiresAt": r["expires_at"],
                "revoked": bool(r["revoked"]),
                "createdAt": r["created_at"],
            }
            for r in rows
        ]
    }


@router.post("/tokens", status_code=status.HTTP_201_CREATED)
def create_personal_token(payload: CreateTokenIn, user: dict = Depends(require_authenticated_user)) -> dict:
    raw, prefix, thash = generate_personal_token()
    now = utc_now_iso()
    exp_iso = compute_expiry_iso(payload.expires_days)
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO personal_tokens (user_id, label, token_prefix, token_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (user["id"], payload.label.strip(), prefix, thash, exp_iso, now),
        )
        tok_id = cur.scalar()
    return {
        "rawToken": raw,
        "token": {
            "id": tok_id,
            "label": payload.label.strip(),
            "tokenPrefix": prefix,
            "lastUsedAt": None,
            "expiresAt": exp_iso,
            "revoked": False,
            "createdAt": now,
        },
    }


@router.delete("/tokens/{token_id}")
def revoke_personal_token(token_id: int, user: dict = Depends(require_authenticated_user)) -> dict:
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE personal_tokens SET revoked = 1 WHERE id = ? AND user_id = ?",
            (token_id, user["id"]),
        )
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Token not found")
    return {"revoked": True, "id": token_id}
