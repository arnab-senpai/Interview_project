"""Application configuration and workspace paths."""

from __future__ import annotations

import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[3]
DATA_DIR = ROOT_DIR / "data"
HLD_DIR = DATA_DIR / "hld"
PRACTICE_DIR = HLD_DIR / "practice"
BACKEND_DIR = ROOT_DIR / "backend"
DEFAULT_DB_PATH = BACKEND_DIR / "systemcraft.db"
FRONTEND_DIST_DIR = ROOT_DIR / "frontend" / "dist"


def get_db_path() -> Path:
    """Resolve SQLite database path, allowing override in tests."""
    override = os.environ.get("SYSTEMCRAFT_DB_PATH")
    return Path(override) if override else DEFAULT_DB_PATH


# Origins allowed to call the API from a browser. The default covers the Vite dev
# servers. Set SYSTEMCRAFT_CORS_ORIGINS to a comma-separated list for another
# frontend origin, or to an empty string when FastAPI serves the built frontend
# itself (same origin, no CORS needed), which is the recommended alpha setup.
DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
)


def get_cors_origins() -> list[str]:
    raw = os.environ.get("SYSTEMCRAFT_CORS_ORIGINS")
    if raw is None:
        return list(DEFAULT_CORS_ORIGINS)
    return [o.strip() for o in raw.split(",") if o.strip()]


def is_production() -> bool:
    """SYSTEMCRAFT_ENV=production turns missing required settings into startup errors."""
    return os.environ.get("SYSTEMCRAFT_ENV", "").strip().lower() in {"prod", "production"}


def get_admin_usernames() -> set[str]:
    """Usernames (comma-separated in SYSTEMCRAFT_ADMIN_USERNAMES) that can open the feedback admin view."""
    raw = os.environ.get("SYSTEMCRAFT_ADMIN_USERNAMES", "")
    return {u.strip().lower() for u in raw.split(",") if u.strip()}
