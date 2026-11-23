"""Run the suite against Postgres when SYSTEMCRAFT_TEST_DATABASE_URL is set (CI does).

Every test starts from an empty public schema, then the app's own startup runs
the Alembic migrations, so the migrations themselves are exercised each time.
Without the variable, tests use a throwaway SQLite file per test.
"""

from __future__ import annotations

import os

import pytest

TEST_PG_URL = os.environ.get("SYSTEMCRAFT_TEST_DATABASE_URL", "").strip()


@pytest.fixture(autouse=True)
def _database(monkeypatch: pytest.MonkeyPatch):
    from backend.app.db.engine import dispose_engines

    if TEST_PG_URL:
        from sqlalchemy import create_engine, text

        monkeypatch.setenv("SYSTEMCRAFT_DATABASE_URL", TEST_PG_URL)
        url = TEST_PG_URL.replace("postgresql://", "postgresql+psycopg://", 1)
        eng = create_engine(url)
        with eng.begin() as conn:
            conn.execute(text("DROP SCHEMA public CASCADE"))
            conn.execute(text("CREATE SCHEMA public"))
        eng.dispose()
    else:
        monkeypatch.delenv("SYSTEMCRAFT_DATABASE_URL", raising=False)
    dispose_engines()
    yield
    dispose_engines()
