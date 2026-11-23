"""Baseline: the tables the app created by hand before Alembic (Phase 0 schema).

Each table is created only if it is missing, so an alpha SQLite file made by the
old init_db() is adopted as-is and simply stamped at this revision.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-11-23
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def _create(name: str, *columns, **kw) -> None:
    if not sa.inspect(op.get_bind()).has_table(name):
        op.create_table(name, *columns, **kw)


def upgrade() -> None:
    T = sa.Text
    I = sa.Integer
    _create(
        "users",
        sa.Column("id", T, primary_key=True),
        sa.Column("username", T, nullable=False, unique=True),
        sa.Column("display_name", T, nullable=False),
        sa.Column("email", T, nullable=False, server_default=""),
        sa.Column("password_hash", T, nullable=False),
        sa.Column("daily_goal", I, nullable=False, server_default="3"),
        sa.Column("preferred_lens", T, nullable=False, server_default="intuition"),
        sa.Column("created_at", T, nullable=False),
    )
    _create(
        "personal_tokens",
        sa.Column("id", I, primary_key=True, autoincrement=True),
        sa.Column("user_id", T, nullable=False),
        sa.Column("label", T, nullable=False),
        sa.Column("token_prefix", T, nullable=False),
        sa.Column("token_hash", T, nullable=False, unique=True),
        sa.Column("last_used_at", T),
        sa.Column("expires_at", T),
        sa.Column("revoked", I, nullable=False, server_default="0"),
        sa.Column("created_at", T, nullable=False),
    )
    _create(
        "daily_activity",
        sa.Column("user_id", T, primary_key=True),
        sa.Column("activity_date", T, primary_key=True),
        sa.Column("lessons_touched", I, nullable=False, server_default="0"),
        sa.Column("flashcards_reviewed", I, nullable=False, server_default="0"),
        sa.Column("quizzes_answered", I, nullable=False, server_default="0"),
        sa.Column("notes_saved", I, nullable=False, server_default="0"),
        sa.Column("total_actions", I, nullable=False, server_default="0"),
        sa.Column("updated_at", T, nullable=False),
    )
    _create(
        "user_notes",
        sa.Column("id", I, primary_key=True, autoincrement=True),
        sa.Column("user_id", T, nullable=False),
        sa.Column("topic_id", T, nullable=False),
        sa.Column("title", T, nullable=False),
        sa.Column("content_md", T, nullable=False, server_default=""),
        sa.Column("tags_json", T, nullable=False, server_default="[]"),
        sa.Column("pinned", I, nullable=False, server_default="0"),
        sa.Column("created_at", T, nullable=False),
        sa.Column("updated_at", T, nullable=False),
        sa.UniqueConstraint("user_id", "topic_id"),
    )
    _create(
        "lesson_progress",
        sa.Column("user_id", T, primary_key=True, server_default="guest"),
        sa.Column("topic_id", T, primary_key=True),
        sa.Column("kind", T, nullable=False),
        sa.Column("status", T, nullable=False, server_default="not_started"),
        sa.Column("completed_steps_json", T, nullable=False, server_default="[]"),
        sa.Column("active_lens", T, nullable=False, server_default="intuition"),
        sa.Column("updated_at", T, nullable=False),
    )
    _create(
        "flashcard_reviews",
        sa.Column("user_id", T, primary_key=True, server_default="guest"),
        sa.Column("card_id", T, primary_key=True),
        sa.Column("repetitions", I, nullable=False, server_default="0"),
        sa.Column("interval_days", I, nullable=False, server_default="0"),
        sa.Column("easiness_factor", sa.Float, nullable=False, server_default="2.5"),
        sa.Column("next_review_date", T, nullable=False),
        sa.Column("last_rating", T, nullable=False, server_default="new"),
        sa.Column("updated_at", T, nullable=False),
    )
    _create(
        "quiz_attempts",
        sa.Column("id", I, primary_key=True, autoincrement=True),
        sa.Column("user_id", T, nullable=False, server_default="guest"),
        sa.Column("question_id", T, nullable=False),
        sa.Column("topic_id", T, nullable=False),
        sa.Column("selected_index", I, nullable=False),
        sa.Column("is_correct", I, nullable=False),
        sa.Column("answered_at", T, nullable=False),
    )
    _create(
        "estimation_runs",
        sa.Column("id", I, primary_key=True, autoincrement=True),
        sa.Column("user_id", T, nullable=False, server_default="guest"),
        sa.Column("title", T, nullable=False),
        sa.Column("dau", sa.BigInteger, nullable=False),
        sa.Column("actions_per_day", sa.Float, nullable=False),
        sa.Column("peak_multiplier", sa.Float, nullable=False),
        sa.Column("avg_payload_bytes", sa.BigInteger, nullable=False),
        sa.Column("retention_years", I, nullable=False),
        sa.Column("read_ratio", sa.Float, nullable=False),
        sa.Column("results_json", T, nullable=False),
        sa.Column("created_at", T, nullable=False),
    )
    _create(
        "content_feedback",
        sa.Column("id", I, primary_key=True, autoincrement=True),
        sa.Column("user_id", T, nullable=False),
        sa.Column("topic_id", T, nullable=False),
        sa.Column("block_id", T, nullable=False),
        sa.Column("content_version", T, nullable=False),
        sa.Column("category", T, nullable=False, server_default="other"),
        sa.Column("message", T, nullable=False),
        sa.Column("page_url", T, nullable=False, server_default=""),
        sa.Column("status", T, nullable=False, server_default="open"),
        sa.Column("admin_note", T, nullable=False, server_default=""),
        sa.Column("created_at", T, nullable=False),
        sa.Column("resolved_at", T),
    )
    bind = op.get_bind()
    existing_idx = {ix["name"] for ix in sa.inspect(bind).get_indexes("content_feedback")}
    if "idx_content_feedback_topic" not in existing_idx:
        op.create_index("idx_content_feedback_topic", "content_feedback", ["topic_id", "status"])
    _create(
        "case_study_rubrics",
        sa.Column("user_id", T, primary_key=True, server_default="guest"),
        sa.Column("case_study_id", T, primary_key=True),
        sa.Column("checked_criteria_json", T, nullable=False, server_default="[]"),
        sa.Column("notes", T, nullable=False, server_default=""),
        sa.Column("score", I, nullable=False, server_default="0"),
        sa.Column("updated_at", T, nullable=False),
    )


def downgrade() -> None:
    for name in (
        "case_study_rubrics",
        "content_feedback",
        "estimation_runs",
        "quiz_attempts",
        "flashcard_reviews",
        "lesson_progress",
        "user_notes",
        "daily_activity",
        "personal_tokens",
        "users",
    ):
        op.drop_table(name)
