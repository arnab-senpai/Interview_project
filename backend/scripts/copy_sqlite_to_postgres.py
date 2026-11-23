"""One-off: copy an alpha SQLite file into a fresh Postgres database.

    SYSTEMCRAFT_DATABASE_URL=postgresql+psycopg://user:pw@host/db \\
        python -m backend.scripts.copy_sqlite_to_postgres backend/systemcraft.db

It migrates Postgres to the latest revision, refuses to run if Postgres already
holds learner data, copies every table the two have in common, and resets the
id sequences so new rows don't collide with copied ones.
"""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect, text

from backend.app.db.database import init_db
from backend.app.db.engine import get_database_url, get_engine

TABLES = (
    "users",
    "personal_tokens",
    "daily_activity",
    "user_notes",
    "lesson_progress",
    "flashcard_reviews",
    "quiz_attempts",
    "estimation_runs",
    "content_feedback",
    "case_study_rubrics",
    "block_progress",
    "attempts",
)


def main(sqlite_file: str) -> int:
    src_path = Path(sqlite_file)
    if not src_path.exists():
        print(f"No such file: {src_path}")
        return 2
    if get_database_url().startswith("sqlite"):
        print("Set SYSTEMCRAFT_DATABASE_URL to the target Postgres database first.")
        return 2

    # The source is read as-is; only the columns both sides have are copied.
    src = create_engine(f"sqlite:///{src_path}")
    init_db()
    dst = get_engine()

    with dst.begin() as d:
        n = d.execute(text("SELECT COUNT(*) FROM users WHERE id <> 'guest'")).scalar()
        if n:
            print(f"Target already has {n} users; refusing to overwrite.")
            return 1

    src_tables = set(inspect(src).get_table_names())
    with src.connect() as s, dst.begin() as d:
        for table in TABLES:
            if table not in src_tables:
                continue
            dst_cols = {c["name"] for c in inspect(d).get_columns(table)}
            src_cols = [c["name"] for c in inspect(s).get_columns(table)]
            cols = [c for c in src_cols if c in dst_cols]
            rows = [dict(r._mapping) for r in s.execute(text(f"SELECT {', '.join(cols)} FROM {table}"))]
            if table == "users":
                rows = [r for r in rows if r["id"] != "guest"]
            if rows:
                placeholders = ", ".join(f":{c}" for c in cols)
                d.execute(text(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders})"), rows)
            if "id" in cols and table != "users":
                d.execute(
                    text(
                        f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                        f"COALESCE((SELECT MAX(id) FROM {table}), 0) + 1, false)"
                    )
                )
            print(f"{table}: {len(rows)} rows")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))
