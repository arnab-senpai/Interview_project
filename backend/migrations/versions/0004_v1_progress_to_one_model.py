"""Phase 2a: carry v1 progress into the one model. Data only, idempotent.

- lesson_progress rows with status 'completed' become unit_status rows
  (source 'v1'), so nobody loses a finished chapter when old lessons start
  opening as adapted v2 topics.
- quiz_attempts are copied into attempts (block_id = question id, which is the
  adapted quiz block's id; grading_version 1; content_version 'v1'), so answers
  from the old Practice tab count toward the chapter.

The old tables stay in place (read-only from now on) until the deprecation
release drops them. Flashcard state moves in Phase 2b with the review queue.

Revision ID: 0004_v1_progress
Revises: 0003_one_model
Create Date: 2026-11-23
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_v1_progress"
down_revision = "0003_one_model"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "INSERT INTO unit_status (user_id, topic_id, status, source, updated_at)"
            " SELECT lp.user_id, lp.topic_id, 'completed', 'v1', lp.updated_at FROM lesson_progress lp"
            " WHERE lp.status = 'completed' AND NOT EXISTS ("
            "   SELECT 1 FROM unit_status us WHERE us.user_id = lp.user_id AND us.topic_id = lp.topic_id)"
        )
    )
    bind.execute(
        sa.text(
            "INSERT INTO attempts (user_id, topic_id, block_id, grading_version, content_version, response_json, passed, score, created_at)"
            " SELECT qa.user_id, qa.topic_id, qa.question_id, 1, 'v1',"
            "   '{\"choice\": ' || CAST(qa.selected_index AS TEXT) || '}', qa.is_correct, CAST(qa.is_correct AS FLOAT), qa.answered_at"
            " FROM quiz_attempts qa WHERE NOT EXISTS ("
            "   SELECT 1 FROM attempts a WHERE a.user_id = qa.user_id AND a.topic_id = qa.topic_id"
            "   AND a.block_id = qa.question_id AND a.created_at = qa.answered_at)"
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DELETE FROM attempts WHERE content_version = 'v1'"))
    bind.execute(sa.text("DELETE FROM unit_status WHERE source = 'v1'"))
