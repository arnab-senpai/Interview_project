"""Phase 1: per-block progress, attempts log, and guest rows.

- users.is_guest / users.last_seen_at: guests are real rows (id anon_<hex>) issued
  through a signed cookie; idle ones are purged after 30 days.
- block_progress: which blocks a learner has seen, keyed (user, topic, block).
  Progress is per block id, so adding or reordering blocks never shifts it.
- attempts: append-only log of checks. A block is "passed" when any attempt at
  the block's current gradingVersion passed; a pass at an older version shows as
  "re-check suggested" and is never wiped.

Revision ID: 0002_phase1
Revises: 0001_baseline
Create Date: 2026-11-23
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002_phase1"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("is_guest", sa.Integer, nullable=False, server_default="0"))
        batch.add_column(sa.Column("last_seen_at", sa.Text, nullable=True))

    op.create_table(
        "block_progress",
        sa.Column("user_id", sa.Text, primary_key=True),
        sa.Column("topic_id", sa.Text, primary_key=True),
        sa.Column("block_id", sa.Text, primary_key=True),
        sa.Column("content_version", sa.Text, nullable=False),
        sa.Column("first_viewed_at", sa.Text, nullable=False),
        sa.Column("last_viewed_at", sa.Text, nullable=False),
    )
    op.create_table(
        "attempts",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Text, nullable=False),
        sa.Column("topic_id", sa.Text, nullable=False),
        sa.Column("block_id", sa.Text, nullable=False),
        sa.Column("grading_version", sa.Integer, nullable=False),
        sa.Column("content_version", sa.Text, nullable=False),
        sa.Column("response_json", sa.Text, nullable=False),
        sa.Column("passed", sa.Integer, nullable=False),
        sa.Column("score", sa.Float, nullable=False, server_default="0"),
        sa.Column("created_at", sa.Text, nullable=False),
    )
    op.create_index("idx_attempts_user_topic", "attempts", ["user_id", "topic_id", "block_id"])

    bind = op.get_bind()
    bind.execute(
        sa.text(
            "INSERT INTO users (id, username, display_name, email, password_hash, daily_goal, preferred_lens, created_at)"
            " VALUES ('guest', 'guest', 'Local Guest', '', '', 3, 'intuition', '2026-01-01T00:00:00+00:00')"
            " ON CONFLICT (id) DO NOTHING"
        )
    )


def downgrade() -> None:
    op.drop_index("idx_attempts_user_topic", table_name="attempts")
    op.drop_table("attempts")
    op.drop_table("block_progress")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("last_seen_at")
        batch.drop_column("is_guest")
