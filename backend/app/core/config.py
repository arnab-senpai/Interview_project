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
