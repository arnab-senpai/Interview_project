"""Phase 2b: learner profile, enrollment and the review queue.

- learner_profiles: the three onboarding answers plus the browser time zone.
- enrollments: which path a learner follows, pinned to the path version it started on.
- review_items: one row per thing a learner has met and should see again
  (a quiz/predict block, a Remember fact, a recall card). Items are only
  added once the learner has studied them, so a new account has nothing due.
  Scheduling is SM-2 (services/sm2.py) behind services/review.py.
- attempts.source: 'check' (in the chapter), 'review' (from the queue) or
  'placement'. Mastery weighs them differently.

flashcard_reviews state is copied into review_items for the cards a learner
already reviewed, keeping their schedule.

Revision ID: 0005_guide
Revises: 0004_v1_progress
Create Date: 2026-11-23
"""

from __future__ import annotations

import json
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision = "0005_guide"
down_revision = "0004_v1_progress"
branch_labels = None
depends_on = None

PRACTICE_DIR = Path(__file__).resolve().parents[3] / "data" / "hld" / "practice"


def upgrade() -> None:
    op.create_table(
        "learner_profiles",
        sa.Column("user_id", sa.Text, primary_key=True),
        sa.Column("goals_json", sa.Text, nullable=False, server_default='["hld"]'),
        sa.Column("start_level", sa.Text, nullable=True),  # new | built_apps | experienced
        sa.Column("interview_date", sa.Text, nullable=True),
        sa.Column("hours_per_week", sa.Float, nullable=True),
        sa.Column("updated_at", sa.Text, nullable=False),
    )
    op.create_table(
        "enrollments",
        sa.Column("user_id", sa.Text, primary_key=True),
        sa.Column("path_id", sa.Text, primary_key=True),
        sa.Column("path_version", sa.Text, nullable=False),
        sa.Column("active", sa.Integer, nullable=False, server_default="1"),
        sa.Column("started_at", sa.Text, nullable=False),
    )
    op.create_table(
        "review_items",
        sa.Column("user_id", sa.Text, primary_key=True),
        sa.Column("item_ref", sa.Text, primary_key=True),  # topic:block or topic:block:fact
        sa.Column("topic_id", sa.Text, nullable=False),
        sa.Column("kind", sa.Text, nullable=False),  # choice | recall
        sa.Column("grading_version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("repetitions", sa.Integer, nullable=False, server_default="0"),
        sa.Column("interval_days", sa.Integer, nullable=False, server_default="0"),
        sa.Column("easiness_factor", sa.Float, nullable=False, server_default="2.5"),
        sa.Column("due_at", sa.Text, nullable=False),
        sa.Column("last_rating", sa.Text, nullable=False, server_default="new"),
        sa.Column("created_at", sa.Text, nullable=False),
        sa.Column("updated_at", sa.Text, nullable=False),
    )
    op.create_index("idx_review_items_due", "review_items", ["user_id", "due_at"])
    with op.batch_alter_table("attempts") as batch:
        batch.add_column(sa.Column("source", sa.Text, nullable=False, server_default="check"))

    # Carry flashcard schedules over for cards a learner already reviewed.
    card_topic: dict[str, str] = {}
    if PRACTICE_DIR.exists():
        for f in PRACTICE_DIR.glob("*.json"):
            data = json.loads(f.read_text(encoding="utf-8"))
            for c in data.get("flashcards", []):
                card_topic[c["id"]] = c.get("topicId") or data.get("topicId") or f.stem
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT * FROM flashcard_reviews")).mappings().fetchall()
    for r in rows:
        topic = card_topic.get(r["card_id"])
        if not topic:
            continue
        ref = f"{topic}:{r['card_id']}"
        exists = bind.execute(
            sa.text("SELECT 1 FROM review_items WHERE user_id = :u AND item_ref = :r"), {"u": r["user_id"], "r": ref}
        ).fetchone()
        if exists:
            continue
        bind.execute(
            sa.text(
                "INSERT INTO review_items (user_id, item_ref, topic_id, kind, grading_version, repetitions, interval_days,"
                " easiness_factor, due_at, last_rating, created_at, updated_at)"
                " VALUES (:u, :r, :t, 'recall', 1, :rep, :iv, :ef, :due, :lr, :now, :now)"
            ),
            {"u": r["user_id"], "r": ref, "t": topic, "rep": r["repetitions"], "iv": r["interval_days"],
             "ef": r["easiness_factor"], "due": r["next_review_date"], "lr": r["last_rating"], "now": r["updated_at"]},
        )


def downgrade() -> None:
    with op.batch_alter_table("attempts") as batch:
        batch.drop_column("source")
    op.drop_index("idx_review_items_due", table_name="review_items")
    op.drop_table("review_items")
    op.drop_table("enrollments")
    op.drop_table("learner_profiles")
