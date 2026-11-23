"""Phase 2a: one progress model for the whole path.

- unit_status: a learner's state on each path unit that is not derived from
  attempts: chapters completed under v1 (source 'v1') and, in Phase 2c,
  chapters placed out by a stage check (source 'placement'). Chapters finished
  in the reader are still derived from attempts; this table never overrides a
  pass, it only adds one.
- learning_events: append-only log of what learners do (opened a chapter,
  finished a layer, skipped, opened the Sandbox). Feeds the admin funnel.
- users.timezone (IANA name, sent by the browser) and users.onboarded_at.

Revision ID: 0003_one_model
Revises: 0002_phase1
Create Date: 2026-11-23
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_one_model"
down_revision = "0002_phase1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("timezone", sa.Text, nullable=False, server_default="UTC"))
        batch.add_column(sa.Column("onboarded_at", sa.Text, nullable=True))

    op.create_table(
        "unit_status",
        sa.Column("user_id", sa.Text, primary_key=True),
        sa.Column("topic_id", sa.Text, primary_key=True),
        sa.Column("status", sa.Text, nullable=False),  # completed | placed_out
        sa.Column("source", sa.Text, nullable=False),  # v1 | placement
        sa.Column("updated_at", sa.Text, nullable=False),
    )
    op.create_table(
        "learning_events",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Text, nullable=False),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("topic_id", sa.Text, nullable=False, server_default=""),
        sa.Column("ref", sa.Text, nullable=False, server_default=""),
        sa.Column("props_json", sa.Text, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.Text, nullable=False),
    )
    op.create_index("idx_learning_events_kind_topic", "learning_events", ["kind", "topic_id"])
    op.create_index("idx_learning_events_user", "learning_events", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("idx_learning_events_user", table_name="learning_events")
    op.drop_index("idx_learning_events_kind_topic", table_name="learning_events")
    op.drop_table("learning_events")
    op.drop_table("unit_status")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("onboarded_at")
        batch.drop_column("timezone")
