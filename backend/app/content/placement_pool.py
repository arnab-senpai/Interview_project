"""Which checks a stage test-out may ask from a chapter. Kept free of web imports so content lint can use it."""

from __future__ import annotations

from typing import Any


def pool(topic: dict[str, Any]) -> list[dict[str, Any]]:
    """Checks marked ``placement: true``; else the Check section's quiz/predict checks; else any quiz/predict check."""
    choice = [b for b in topic["blocks"] if b["type"] in ("quiz", "predict") and b.get("checkable")]
    tagged = [b for b in choice if b.get("placement")]
    if tagged:
        return tagged
    in_check = [b for b in choice if b.get("section") == "check"]
    return in_check or choice
