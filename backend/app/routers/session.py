"""Guest sessions: a signed HttpOnly cookie so visitors can study before making an account."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response, status

from backend.app.core.config import guests_allowed
from backend.app.db.database import get_streak_summary
from backend.app.services.auth import guest_from_request, serialize_user
from backend.app.services.guest import cookie_kwargs, create_guest, guest_limiter, sign_guest_id

router = APIRouter(prefix="/api/session", tags=["session"])


@router.get("/config")
def session_config() -> dict:
    """Public: tells the sign-in screen whether "Continue as guest" is offered."""
    return {"guestsAllowed": guests_allowed()}


@router.post("/guest", status_code=status.HTTP_201_CREATED)
def start_guest_session(request: Request, response: Response) -> dict:
    if not guests_allowed():
        raise HTTPException(status_code=403, detail="Guest access is turned off; please sign in")
    existing = guest_from_request(request)
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return {"user": existing, "streak": get_streak_summary(existing["id"])}
    ip = request.client.host if request.client else "unknown"
    if not guest_limiter.allow(ip):
        raise HTTPException(status_code=429, detail="Too many guest sessions from this address; try again later")
    row = create_guest()
    response.set_cookie(value=sign_guest_id(row["id"]), **cookie_kwargs())
    user = serialize_user(row)
    return {"user": user, "streak": get_streak_summary(user["id"])}
