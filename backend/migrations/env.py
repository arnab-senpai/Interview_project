"""Alembic environment: reuses the app's engine so URL handling lives in one place."""

from __future__ import annotations

from alembic import context

from backend.app.db.engine import get_engine

config = context.config


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        context.configure(connection=connection, render_as_batch=connection.dialect.name == "sqlite")
        with context.begin_transaction():
            context.run_migrations()
        return

    engine = get_engine()
    with engine.connect() as conn:
        context.configure(connection=conn, render_as_batch=conn.dialect.name == "sqlite")
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():  # pragma: no cover
    raise SystemExit("Offline migrations are not supported; run against a database.")
run_migrations_online()
