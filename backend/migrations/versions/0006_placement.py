"""Phase 2c: stage test-out sessions.

One row per started stage check. The questions are fixed when the check starts
(so a content change mid-check cannot shift them); answers are appended as the
learner goes. Each answer is also an attempt with source 'placement'.

Revision ID: 0006_placement
Revises: 0005_guide
Create Date: 2026-11-23
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_placement"
down_revision = "0005_guide"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "placement_sessions",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("user_id", sa.Text, nullable=False),
        sa.Column("path_id", sa.Text, nullable=False),
        sa.Column("stage_id", sa.Text, nullable=False),
        sa.Column("questions_json", sa.Text, nullable=False),  # [{topicId, blockId}]
        sa.Column("answers_json", sa.Text, nullable=False, server_default="[]"),  # [{topicId, blockId, choice, correct}]
        sa.Column("status", sa.Text, nullable=False, server_default="active"),  # active | finished
        sa.Column("result_json", sa.Text, nullable=True),
        sa.Column("created_at", sa.Text, nullable=False),
        sa.Column("finished_at", sa.Text, nullable=True),
    )
    op.create_index("idx_placement_sessions_user", "placement_sessions", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("idx_placement_sessions_user", table_name="placement_sessions")
    op.drop_table("placement_sessions")
