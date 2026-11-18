"""Authentication helpers: scrypt password hashing, HS256 JWTs, and personal study tokens."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import Header, HTTPException, status

from backend.app.core.config import BACKEND_DIR
from backend.app.db.database import get_conn, utc_now_iso

JWT_SECRET_FILE = BACKEND_DIR / ".jwt_secret"
DEFAULT_TOKEN_TTL_HOURS = 24 * 7  # 7 days


def _get_jwt_secret() -> bytes:
    env_secret = os.environ.get("SYSTEMCRAFT_JWT_SECRET")
    if env_secret:
        return env_secret.encode("utf-8")
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
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
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


def serialize_user(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "username": row["username"],
        "displayName": row["display_name"],
        "email": row["email"] or "",
        "dailyGoal": row["daily_goal"],
        "preferredLens": row["preferred_lens"],
        "isGuest": row["id"] == "guest",
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


def resolve_optional_user(
    authorization: str | None = Header(default=None),
    x_study_token: str | None = Header(default=None),
) -> dict[str, Any]:
    """Resolve authenticated user via JWT or sc_live_* token; falls back cleanly to local guest."""
    token = _extract_raw_token(authorization, x_study_token)
    with get_conn() as conn:
        if token:
            if token.startswith("sc_live_"):
                thash = hash_personal_token(token)
                tok_row = conn.execute(
                    "SELECT * FROM personal_tokens WHERE token_hash = ? AND revoked = 0",
                    (thash,),
                ).fetchone()
                if tok_row:
                    exp = tok_row["expires_at"]
                    if not exp or exp > utc_now_iso():
                        user_row = conn.execute("SELECT * FROM users WHERE id = ?", (tok_row["user_id"],)).fetchone()
                        if user_row:
                            conn.execute(
                                "UPDATE personal_tokens SET last_used_at = ? WHERE id = ?",
                                (utc_now_iso(), tok_row["id"]),
                            )
                            return serialize_user(user_row)
            else:
                payload = decode_access_token(token)
                if payload and payload.get("sub"):
                    user_row = conn.execute("SELECT * FROM users WHERE id = ?", (payload["sub"],)).fetchone()
                    if user_row:
                        return serialize_user(user_row)

        guest_row = conn.execute("SELECT * FROM users WHERE id = 'guest'").fetchone()
        if guest_row:
            return serialize_user(guest_row)

    return {
        "id": "guest",
        "username": "guest",
        "displayName": "Local Guest",
        "email": "",
        "dailyGoal": 3,
        "preferredLens": "intuition",
        "isGuest": True,
        "createdAt": utc_now_iso(),
    }


def require_authenticated_user(
    authorization: str | None = Header(default=None),
    x_study_token: str | None = Header(default=None),
) -> dict[str, Any]:
    """Require a valid non-guest user session or personal token."""
    token = _extract_raw_token(authorization, x_study_token)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required (Bearer JWT or X-Study-Token)",
        )
    user = resolve_optional_user(authorization=authorization, x_study_token=x_study_token)
    if user["id"] == "guest":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
        )
    return user


def compute_expiry_iso(expires_days: int | None) -> str | None:
    if not expires_days or expires_days <= 0:
        return None
    return (datetime.now(timezone.utc) + timedelta(days=expires_days)).isoformat()
