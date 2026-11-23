"""Authentication helpers: scrypt password hashing, HS256 JWTs, and personal study tokens."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, Header, HTTPException, Request, status

from backend.app.core.config import BACKEND_DIR, get_admin_usernames, guests_allowed, is_production
from backend.app.db.database import get_conn, utc_now_iso

JWT_SECRET_FILE = BACKEND_DIR / ".jwt_secret"
DEFAULT_TOKEN_TTL_HOURS = 24 * 7  # 7 days
MIN_JWT_SECRET_LENGTH = 32

logger = logging.getLogger("systemcraft.auth")


def check_jwt_secret_config() -> None:
    """Fail fast in production when SYSTEMCRAFT_JWT_SECRET is missing or weak.

    Without the variable, the dev fallback writes a random secret to
    backend/.jwt_secret. On a rebuilt container that file is gone, the secret
    changes, and every colleague is signed out, so production refuses to start.
    """
    secret = os.environ.get("SYSTEMCRAFT_JWT_SECRET", "")
    if secret and len(secret) < MIN_JWT_SECRET_LENGTH:
        raise RuntimeError(f"SYSTEMCRAFT_JWT_SECRET must be at least {MIN_JWT_SECRET_LENGTH} characters")
    if not secret:
        if is_production():
            raise RuntimeError("SYSTEMCRAFT_JWT_SECRET must be set when SYSTEMCRAFT_ENV=production")
        logger.warning("SYSTEMCRAFT_JWT_SECRET is not set; using a local dev secret in %s", JWT_SECRET_FILE)


def _get_jwt_secret() -> bytes:
    env_secret = os.environ.get("SYSTEMCRAFT_JWT_SECRET")
    if env_secret:
        return env_secret.encode("utf-8")
    if is_production():
        raise RuntimeError("SYSTEMCRAFT_JWT_SECRET must be set when SYSTEMCRAFT_ENV=production")
    if JWT_SECRET_FILE.exists():
        secret = JWT_SECRET_FILE.read_text(encoding="utf-8").strip()
        if secret:
            return secret.encode("utf-8")
    generated = secrets.token_urlsafe(48)
    JWT_SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
    JWT_SECRET_FILE.write_text(generated, encoding="utf-8")
    return generated.encode("utf-8")


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(encoded: str) -> bytes:
    pad = "=" * ((4 - len(encoded) % 4) % 4)
    return base64.urlsafe_b64decode(encoded + pad)


def hash_password(password: str) -> str:
    """Hash a password with per-user random salt via memory-hard scrypt."""
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${_b64url_encode(salt)}${_b64url_encode(digest)}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Constant-time verification against a stored scrypt digest."""
    if not stored_hash or not stored_hash.startswith("scrypt$"):
        return False
    parts = stored_hash.split("$")
    if len(parts) != 3:
        return False
    try:
        salt = _b64url_decode(parts[1])
        expected = _b64url_decode(parts[2])
    except Exception:
        return False
    computed = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=len(expected))
    return hmac.compare_digest(computed, expected)


def create_access_token(
    user_id: str,
    username: str,
    display_name: str,
    expires_hours: int = DEFAULT_TOKEN_TTL_HOURS,
) -> tuple[str, str]:
    """Create a compact HS256-signed JWT and return (token, expires_at_iso)."""
    now_ts = int(time.time())
    exp_ts = now_ts + expires_hours * 3600
    exp_iso = datetime.fromtimestamp(exp_ts, tz=timezone.utc).isoformat()

    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode("utf-8"))
    payload = _b64url_encode(
        json.dumps(
            {
                "sub": user_id,
                "username": username,
                "displayName": display_name,
                "iat": now_ts,
                "exp": exp_ts,
            },
            separators=(",", ":"),
        ).encode("utf-8")
    )
    signing_input = f"{header}.{payload}".encode("ascii")
    sig = _b64url_encode(hmac.new(_get_jwt_secret(), signing_input, hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}", exp_iso


def decode_access_token(token: str) -> dict[str, Any] | None:
    """Validate JWT signature and expiry; returns payload dict or None."""
    parts = token.strip().split(".")
    if len(parts) != 3:
        return None
    header_b64, payload_b64, sig_b64 = parts
    try:
        signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    except UnicodeEncodeError:
        return None
    expected_sig = _b64url_encode(hmac.new(_get_jwt_secret(), signing_input, hashlib.sha256).digest())
    if not hmac.compare_digest(sig_b64, expected_sig):
        return None
    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except Exception:
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    return payload


def generate_personal_token() -> tuple[str, str, str]:
    """Generate a revocable personal API/study token: (raw_token, prefix, sha256_hex)."""
    raw = f"sc_live_{secrets.token_urlsafe(28)}"
    prefix = raw[:14]
    return raw, prefix, hash_personal_token(raw)


def hash_personal_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _row_is_guest(row: Any) -> bool:
    try:
        return bool(row["is_guest"])
    except (KeyError, IndexError):
        return False


def serialize_user(row: Any) -> dict[str, Any]:
    is_guest = _row_is_guest(row)
    return {
        "id": row["id"],
        "username": row["username"],
        "displayName": row["display_name"],
        "email": row["email"] or "",
        "dailyGoal": row["daily_goal"],
        "preferredLens": row["preferred_lens"],
        "isGuest": is_guest,
        "isAdmin": (not is_guest) and row["username"].lower() in get_admin_usernames(),
        "createdAt": row["created_at"],
    }


def _extract_raw_token(authorization: Any, x_study_token: Any) -> str | None:
    if isinstance(x_study_token, str) and x_study_token.strip():
        return x_study_token.strip()
    if isinstance(authorization, str):
        val = authorization.strip()
        if val.lower().startswith("bearer "):
            return val[7:].strip()
        if val:
            return val
    return None


def _user_for_token(token: str) -> dict[str, Any] | None:
    """Return the user a JWT or sc_live_* token belongs to, or None if it is not valid."""
    with get_conn() as conn:
        if token.startswith("sc_live_"):
            tok_row = conn.execute(
                "SELECT * FROM personal_tokens WHERE token_hash = ? AND revoked = 0",
                (hash_personal_token(token),),
            ).fetchone()
            if not tok_row:
                return None
            exp = tok_row["expires_at"]
            if exp and exp <= utc_now_iso():
                return None
            user_row = conn.execute("SELECT * FROM users WHERE id = ?", (tok_row["user_id"],)).fetchone()
            if not user_row or user_row["id"] == "guest" or _row_is_guest(user_row):
                return None
            conn.execute("UPDATE personal_tokens SET last_used_at = ? WHERE id = ?", (utc_now_iso(), tok_row["id"]))
            return serialize_user(user_row)

        payload = decode_access_token(token)
        if not payload or not payload.get("sub"):
            return None
        user_row = conn.execute("SELECT * FROM users WHERE id = ?", (payload["sub"],)).fetchone()
        if not user_row or user_row["id"] == "guest" or _row_is_guest(user_row):
            return None
        return serialize_user(user_row)


def guest_from_request(request: Request | None) -> dict[str, Any] | None:
    """The guest behind a valid signed cookie, when guests are switched on."""
    if request is None or not guests_allowed():
        return None
    from backend.app.services.guest import GUEST_COOKIE, load_guest, verify_guest_cookie

    guest_id = verify_guest_cookie(request.cookies.get(GUEST_COOKIE))
    if not guest_id:
        return None
    row = load_guest(guest_id)
    return serialize_user(row) if row else None


def require_user(
    request: Request = None,  # type: ignore[assignment]  # FastAPI injects it; direct callers may omit it
    authorization: str | None = Header(default=None),
    x_study_token: str | None = Header(default=None),
) -> dict[str, Any]:
    """Every learner-facing route needs a signed-in user or, if enabled, a signed guest cookie.

    There is no shared guest row. A missing token and an invalid, expired or revoked
    token both return 401, so the browser can send the person back to sign in.
    """
    token = _extract_raw_token(authorization, x_study_token)
    if token:
        user = _user_for_token(token)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired authentication token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return user
    guest = guest_from_request(request)
    if guest is not None:
        return guest
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Sign in required (Bearer JWT or X-Study-Token)",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_member(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    """Routes that need a real account: study tokens, issue reports, admin."""
    if user.get("isGuest"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Create an account to use this")
    return user


# Kept for routes and callers written against the older name; it never admits guests.
require_authenticated_user = require_member


def require_admin(user: dict[str, Any] = Depends(require_member)) -> dict[str, Any]:
    if not user.get("isAdmin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def compute_expiry_iso(expires_days: int | None) -> str | None:
    if not expires_days or expires_days <= 0:
        return None
    return (datetime.now(timezone.utc) + timedelta(days=expires_days)).isoformat()
