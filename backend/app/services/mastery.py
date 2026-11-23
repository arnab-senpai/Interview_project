"""Per-skill mastery from graded evidence. Plain rules, no trained model, so every state can be explained.

Each attempt is one piece of evidence on the skills of the block it answered:
a result r in [0, 1], a weight w by where it came from, and an age a in days.
The score is a recency-weighted average with a 30-day half-life:

    m = sum(w * r * 2^(-a/30)) / sum(w * 2^(-a/30))

States: new (no evidence), learning, practiced, mastered, rusty (see state_for).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.app.db.database import get_conn

HALF_LIFE_DAYS = 30.0
WEIGHTS = {"check": 1.0, "review": 0.7, "placement": 0.7}
SELF_ASSESSED_WEIGHT = 0.4  # designPrompt until AI grading lands


def _parse(ts: str) -> datetime:
    dt = datetime.fromisoformat(ts)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def block_skills(content: Any, topic_id: str, block_id: str) -> list[str]:
    pub = content.public(topic_id)
    if not pub:
        return []
    block = content.block(topic_id, block_id)
    if block and block.get("skills"):
        return list(block["skills"])
    return list(pub.get("skills") or [f"{pub['track']}.{topic_id}"])


def evidence(user_id: str, content: Any, now: datetime | None = None) -> dict[str, list[dict[str, Any]]]:
    """skill -> [{r, w, age, at, source}] from the attempts log (the source of truth)."""
    now = now or datetime.now(timezone.utc)
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT topic_id, block_id, passed, score, created_at, source FROM attempts WHERE user_id = ?", (user_id,)
        ).fetchall()
    out: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        block = content.block(r["topic_id"], r["block_id"])
        source = r["source"] or "check"
        w = WEIGHTS.get(source, 1.0)
        if block and block["type"] == "designPrompt" and source == "check":
            w = SELF_ASSESSED_WEIGHT
        result = float(r["score"]) if r["score"] is not None else (1.0 if r["passed"] else 0.0)
        at = _parse(r["created_at"])
        age = max(0.0, (now - at).total_seconds() / 86400)
        for skill in block_skills(content, r["topic_id"], r["block_id"]):
            out.setdefault(skill, []).append({"r": result, "w": w, "age": age, "at": at, "source": source, "topic": r["topic_id"]})
    return out


def score(items: list[dict[str, Any]]) -> float:
    num = sum(e["w"] * e["r"] * 2 ** (-e["age"] / HALF_LIFE_DAYS) for e in items)
    den = sum(e["w"] * 2 ** (-e["age"] / HALF_LIFE_DAYS) for e in items)
    return num / den if den else 0.0


def state_for(items: list[dict[str, Any]], overdue: bool) -> str:
    if not items:
        return "new"
    m = score(items)
    n = len(items)
    span_days = (max(e["at"] for e in items) - min(e["at"] for e in items)).total_seconds() / 86400
    if m >= 0.85 and n >= 3 and span_days >= 7 and any(e["source"] == "review" for e in items):
        state = "mastered"
    elif m >= 0.6 and n >= 2:
        state = "practiced"
    else:
        state = "learning"
    if overdue and state in ("practiced", "mastered"):
        return "rusty"
    return state


def skill_states(user_id: str, content: Any, overdue_topic_ids: set[str], track: str | None = None,
                 now: datetime | None = None) -> dict[str, dict[str, Any]]:
    ev = evidence(user_id, content, now)
    out: dict[str, dict[str, Any]] = {}
    for skill, items in ev.items():
        if track and not skill.startswith(f"{track}."):
            continue
        topics = sorted({e["topic"] for e in items})
        out[skill] = {
            "skill": skill,
            "topics": topics,
            "state": state_for(items, bool(set(topics) & overdue_topic_ids)),
            "score": round(score(items), 3),
            "evidence": len(items),
            "lastAt": max(e["at"] for e in items).isoformat(),
        }
    return out


def topic_skills(topic: dict[str, Any]) -> list[str]:
    skills: list[str] = []
    for b in topic["blocks"]:
        for s in b.get("skills", []) if b.get("checkable") else []:
            if s not in skills:
                skills.append(s)
    return skills or [f"{topic['track']}.{topic['id']}"]
