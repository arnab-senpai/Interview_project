"""Today's plan: one function turns the path, the review queue and skill states into 1 to 4 cards.

Order (the day's minutes run out top-down):
1. review   due items, capped at a third of the day
2. repair   a short refresh when the next chapter's prerequisite skills are rusty or still learning
3. continue the rest of the chapter in progress
4. next     the following chapter, if minutes remain
Every card says why it is there.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone
from typing import Any

from backend.app.db.database import get_conn, get_streak_summary, user_today
from backend.app.services import mastery, review

DEFAULT_HOURS_PER_WEEK = 5.0
TRACK_PATHS = {"hld": "start-here"}
MINUTES_PER_REVIEW_ITEM = 0.75


def daily_minutes(hours_per_week: float | None) -> int:
    return max(10, round((hours_per_week or DEFAULT_HOURS_PER_WEEK) * 60 / 7))


def _layer_left(chapter: dict[str, Any], topic: dict[str, Any], layer_name: str | None) -> int:
    for layer in topic["layers"]:
        if layer["name"] == layer_name:
            prog = next((l for l in chapter.get("layers", []) if l["name"] == layer_name), None)
            seen = prog["blocksSeen"] / prog["blocks"] if prog and prog["blocks"] else 0
            return max(2, math.ceil(layer["minutes"] * (1 - seen)))
    return sum(l["minutes"] for l in topic["layers"]) or 10


def minutes_this_week(user_id: str, content: Any, today: date) -> int:
    """Estimated study minutes in the last 7 days: share of each chapter's blocks first seen this week x its minutes."""
    since = datetime.combine(today - timedelta(days=6), datetime.min.time(), tzinfo=timezone.utc).isoformat()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT topic_id, COUNT(*) AS n FROM block_progress WHERE user_id = ? AND first_viewed_at >= ? GROUP BY topic_id",
            (user_id, since),
        ).fetchall()
    total = 0.0
    for r in rows:
        pub = content.public(r["topic_id"])
        if pub and pub["blocks"]:
            total += sum(l["minutes"] for l in pub["layers"]) * min(1.0, int(r["n"]) / len(pub["blocks"]))
    return round(total)


def plan_today(user: dict[str, Any], profile: dict[str, Any], path: dict[str, Any], content: Any,
               now: datetime | None = None) -> dict[str, Any]:
    uid = user["id"]
    now = now or datetime.now(timezone.utc)
    today = user_today(uid, now)
    budget = daily_minutes(profile.get("hoursPerWeek"))
    left = budget
    cards: list[dict[str, Any]] = []

    _items, due = review.due_items(uid, now, limit=1)
    with get_conn() as conn:
        new_today = conn.execute(
            "SELECT COUNT(*) AS n FROM review_items WHERE user_id = ? AND created_at >= ?",
            (uid, datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc).isoformat()),
        ).fetchone()["n"]
    if due:
        mins = max(2, min(math.ceil(due * MINUTES_PER_REVIEW_ITEM), budget // 3))
        cards.append({"kind": "review", "title": "Review", "reason": f"{due} card{'s' if due != 1 else ''} due from chapters you finished",
                      "minutes": mins, "topicId": None, "layer": None})
        left -= mins

    cont = path.get("continue")
    chapters = [c for s in path["stages"] for c in s["chapters"]]
    if cont:
        topic = content.public(cont["topicId"])
        prereqs = topic.get("prerequisites", []) if topic else []
        if prereqs:
            states = mastery.skill_states(uid, content, review.overdue_topics(uid, now=now), now=now)
            for pre in prereqs:
                pre_topic = content.public(pre)
                if not pre_topic:
                    continue
                weak = [s for s in mastery.topic_skills(pre_topic) if states.get(s, {}).get("state") in ("rusty", "learning")]
                if weak:
                    cards.append({"kind": "repair", "title": f"Refresh: {pre_topic['title']}",
                                  "reason": f"Before {cont['title']}: this one is {states[weak[0]]['state']}",
                                  "minutes": 5, "topicId": pre, "layer": "apply"})
                    left -= 5
                    break
        chapter = next((c for c in chapters if c["topicId"] == cont["topicId"]), {})
        mins = _layer_left(chapter, topic, cont.get("layer")) if topic else 10
        started = chapter.get("status") == "in_progress"
        cards.append({"kind": "continue", "title": f"{cont['number']}. {cont['title']}",
                      "reason": "Pick up where you stopped" if started else "Next chapter on your path",
                      "minutes": mins, "topicId": cont["topicId"], "layer": cont.get("layer"),
                      "stepKey": cont.get("stepKey")})
        left -= mins
        if left >= 10:
            after = False
            for c in chapters:
                if c["topicId"] == cont["topicId"]:
                    after = True
                    continue
                if after and c["available"] and c["status"] not in ("completed", "placed_out"):
                    cards.append({"kind": "next", "title": f"{c['number']}. {c['title']}",
                                  "reason": "You have time left today", "minutes": min(left, c["minutes"] or left),
                                  "topicId": c["topicId"], "layer": "understand"})
                    break

    # Chapter states for the home page.
    out_chapters = []
    stage_titles = {s["id"]: s["title"] for s in path["stages"]}
    for c in chapters:
        if c["status"] in ("completed",):
            state = "done"
        elif c["status"] == "placed_out":
            state = "placed_out"
        elif not c["available"]:
            state = "soon"
        elif cont and c["topicId"] == cont["topicId"]:
            state = "current"
        elif c.get("legacy"):
            state = "preview"
        else:
            state = "open"
        out_chapters.append({"number": c["number"], "topicId": c["topicId"], "title": c["title"], "stageId": c["stageId"],
                             "stageTitle": stage_titles[c["stageId"]], "state": state, "legacy": c.get("legacy", False),
                             "minutes": c.get("minutes")})

    remaining = sum(c["minutes"] or 0 for c in chapters if c["available"] and c["status"] not in ("completed", "placed_out"))
    weekly = (profile.get("hoursPerWeek") or DEFAULT_HOURS_PER_WEEK) * 60
    finish_by = today + timedelta(days=math.ceil(remaining / weekly * 7)) if remaining else today
    interview = profile.get("interviewDate")
    pace = {
        "hoursPerWeek": profile.get("hoursPerWeek") or DEFAULT_HOURS_PER_WEEK,
        "minutesThisWeek": minutes_this_week(uid, content, today),
        "interviewDate": interview,
        "chaptersLeft": sum(1 for c in chapters if c["available"] and c["status"] not in ("completed", "placed_out")),
        "minutesLeft": remaining,
        "finishBy": finish_by.isoformat(),
        "onTrack": None if not interview else finish_by.isoformat() <= interview,
    }
    streak = get_streak_summary(uid, daily_goal=user.get("dailyGoal", 3))
    return {
        "track": "hld",
        "pathId": path["id"],
        "dailyMinutes": budget,
        "continue": cont,
        "cards": cards[:4],
        "chapters": out_chapters,
        "review": {"due": due, "newToday": int(new_today)},
        "pace": pace,
        "streak": {k: streak[k] for k in ("currentStreak", "longestStreak", "todayActions", "dailyGoal")},
    }
