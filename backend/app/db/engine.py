"""SQLAlchemy engine for Postgres (hosted, CI) and SQLite (zero-setup local dev).

Set SYSTEMCRAFT_DATABASE_URL to a Postgres URL such as
``postgresql+psycopg://systemcraft:secret@localhost:5432/systemcraft``. When it is
unset the app falls back to the SQLite file at SYSTEMCRAFT_DB_PATH (or
backend/systemcraft.db), so ``uvicorn`` still works without Docker. Production
(SYSTEMCRAFT_ENV=production) refuses to start without a Postgres URL.

The routers were written against sqlite3, so ``get_conn()`` hands out a thin
wrapper with the same surface: ``conn.execute(sql, params)`` with ``?``
placeholders, rows that read like dicts, ``fetchone``/``fetchall`` and
``rowcount``. Schema changes go through Alembic, never through ad hoc ALTERs.
"""

from __future__ import annotations

import os
import re
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Sequence

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Connection, Engine

from backend.app.core.config import get_db_path, is_production

SQLITE_BUSY_TIMEOUT_MS = 5000

_engines: dict[str, Engine] = {}


def get_database_url(db_path: Path | None = None) -> str:
    url = os.environ.get("SYSTEMCRAFT_DATABASE_URL", "").strip()
    if url:
        # Accept the common "postgres://" and plain "postgresql://" spellings.
        if url.startswith("postgres://"):
            url = "postgresql+psycopg://" + url[len("postgres://"):]
        elif url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://"):]
        return url
    if is_production():
        raise RuntimeError("SYSTEMCRAFT_DATABASE_URL must point at Postgres when SYSTEMCRAFT_ENV=production")
    target = db_path or get_db_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{target}"


def is_sqlite(url: str) -> bool:
    return url.startswith("sqlite")


def get_engine(db_path: Path | None = None) -> Engine:
    url = get_database_url(db_path)
    engine = _engines.get(url)
    if engine is None:
        if is_sqlite(url):
            engine = create_engine(url, connect_args={"timeout": SQLITE_BUSY_TIMEOUT_MS / 1000})

            @event.listens_for(engine, "connect")
            def _sqlite_pragmas(dbapi_conn, _record):  # pragma: no cover - trivial
                cur = dbapi_conn.cursor()
                # Several colleagues can share one file: WAL lets readers run while one
                # writer commits, busy_timeout makes a second writer wait for the lock.
                cur.execute("PRAGMA journal_mode = WAL")
                cur.execute(f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")
                cur.execute("PRAGMA synchronous = NORMAL")
                cur.close()
        else:
            engine = create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=10)
        _engines[url] = engine
    return engine


def dispose_engines() -> None:
    for engine in _engines.values():
        engine.dispose()
    _engines.clear()


_QMARK = re.compile(r"\?")


def _to_named(sql: str, params: Sequence[Any] | dict[str, Any] | None) -> tuple[str, dict[str, Any]]:
    if params is None:
        return sql, {}
    if isinstance(params, dict):
        return sql, params
    values = list(params)
    counter = iter(range(len(values)))
    named = _QMARK.sub(lambda _m: f":p{next(counter)}", sql)
    return named, {f"p{i}": v for i, v in enumerate(values)}


class _Result:
    def __init__(self, result) -> None:
        self._result = result
        self.rowcount = result.rowcount

    def fetchone(self):
        if not self._result.returns_rows:
            return None
        return self._result.mappings().fetchone()

    def fetchall(self):
        if not self._result.returns_rows:
            return []
        return self._result.mappings().fetchall()

    def scalar(self):
        return self._result.scalar()


class DbConn:
    """sqlite3-style facade over a SQLAlchemy connection inside one transaction."""

    def __init__(self, conn: Connection) -> None:
        self.raw = conn
        self.dialect = conn.dialect.name

    def execute(self, sql: str, params: Sequence[Any] | dict[str, Any] | None = None) -> _Result:
        stmt, bound = _to_named(sql, params)
        return _Result(self.raw.execute(text(stmt), bound))


@contextmanager
def connect(db_path: Path | None = None) -> Iterator[DbConn]:
    engine = get_engine(db_path)
    with engine.begin() as conn:
        yield DbConn(conn)
