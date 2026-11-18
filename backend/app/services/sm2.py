"""SuperMemo SM-2 spaced repetition scheduling for HLD flashcards."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

Rating = Literal["again", "hard", "good", "easy"]

QUALITY_MAP: dict[Rating, int] = {
    "again": 1,
    "hard": 3,
    "good": 4,
    "easy": 5,
}


@dataclass
class Sm2State:
    repetitions: int = 0
    interval_days: int = 0
    easiness_factor: float = 2.5


def compute_next_sm2(state: Sm2State, rating: Rating, now: datetime | None = None) -> dict:
    """Apply SM-2 scheduling math and return next review state & ISO timestamp."""
    current = now or datetime.now(timezone.utc)
    q = QUALITY_MAP[rating]

    ef = state.easiness_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    ef = max(1.3, round(ef, 3))

    if q < 3:
        repetitions = 0
        interval_days = 1
    else:
        if state.repetitions == 0:
            interval_days = 1
        elif state.repetitions == 1:
            interval_days = 6
        else:
            interval_days = max(1, round(state.interval_days * ef))
        if rating == "easy":
            interval_days = max(interval_days + 1, round(interval_days * 1.25))
        elif rating == "hard":
            interval_days = max(1, round(interval_days * 0.8))
        repetitions = state.repetitions + 1

    next_dt = current + timedelta(days=interval_days)
    return {
        "repetitions": repetitions,
        "intervalDays": interval_days,
        "easinessFactor": ef,
        "nextReviewDate": next_dt.isoformat(),
        "lastRating": rating,
    }
