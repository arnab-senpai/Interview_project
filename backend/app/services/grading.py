"""Server-side grading for v2 checkable blocks. Keys never leave the server until an attempt is made."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from backend.app.content import formula


def _choice(response: dict[str, Any], n: int, field: str = "choice") -> int:
    val = response.get(field)
    if not isinstance(val, int) or not 0 <= val < n:
        raise HTTPException(status_code=400, detail=f"response.{field} must be an option index")
    return val


def _choices(response: dict[str, Any], n_steps: int, n_opts: list[int]) -> list[int]:
    vals = response.get("choices")
    if not isinstance(vals, list) or len(vals) != n_steps:
        raise HTTPException(status_code=400, detail=f"response.choices must list {n_steps} option indexes")
    for v, n in zip(vals, n_opts):
        if not isinstance(v, int) or not 0 <= v < n:
            raise HTTPException(status_code=400, detail="response.choices has an index out of range")
    return vals


def grade(block: dict[str, Any], key: dict[str, Any] | None, response: dict[str, Any], topic: dict[str, Any]) -> dict[str, Any]:
    """Return {passed, score, reveal}. ``reveal`` is what the learner may now see."""
    t = block["type"]
    if t in ("quiz", "predict"):
        assert key is not None
        choice = _choice(response, len(block["options"]))
        passed = choice == key["answer"]
        reveal = {"correctIndex": key["answer"], "explanations": key["explanations"]}
        if t == "predict":
            reveal["reveal"] = key["reveal"]
        return {"passed": passed, "score": 1.0 if passed else 0.0, "reveal": reveal}

    if t == "spotTheBug":
        assert key is not None
        vals = _choices(response, len(block["steps"]), [len(s["options"]) for s in block["steps"]])
        right = [v == k["answer"] for v, k in zip(vals, key["steps"])]
        return {
            "passed": all(right),
            "score": sum(right) / len(right),
            "reveal": {"steps": [{"correctIndex": k["answer"], "explanation": k["explanation"], "correct": r}
                                 for k, r in zip(key["steps"], right)]},
        }

    if t == "ladder":
        assert key is not None
        vals = _choices(response, len(block["rungs"]), [len(r["options"]) for r in block["rungs"]])
        right = [v == k["answer"] for v, k in zip(vals, key["rungs"])]
        return {
            "passed": all(right),
            "score": sum(right) / len(right),
            "reveal": {"rungs": [{"correctIndex": k["answer"], "strongAnswer": k["strongAnswer"], "correct": r}
                                 for k, r in zip(key["rungs"], right)]},
        }

    if t == "designPrompt":
        assert key is not None
        text = response.get("text")
        if not isinstance(text, str) or len(text.strip()) < 40:
            raise HTTPException(status_code=400, detail="Write at least a few sentences before comparing")
        # Self-compared until AI grading (Phase 4): submitting unlocks the model answers.
        return {"passed": True, "score": 0.0, "reveal": {"modelAnswers": key["modelAnswers"], "rubric": key["rubric"]},
                "selfScored": True}

    if t == "estimationWorksheet":
        answers = response.get("answers")
        if not isinstance(answers, dict):
            raise HTTPException(status_code=400, detail="response.answers must map value ids to numbers")
        inputs = {i["id"]: float(i["default"]) for i in topic["numbers"]["inputs"]}
        preset_id = block.get("preset")
        if preset_id:
            preset = next(p for p in topic["numbers"]["presets"] if p["id"] == preset_id)
            inputs.update({k: float(v) for k, v in preset["inputs"].items()})
        env = formula.solve_values(inputs, [(v["id"], v["formula"]) for v in topic["numbers"]["values"]])
        tol = float(block.get("tolerance", 2.0))
        lines = []
        for ln in block["lines"]:
            expected = env[ln["value"]]
            given = answers.get(ln["value"])
            ok = False
            if isinstance(given, (int, float)) and given > 0 and expected > 0:
                ratio = max(given / expected, expected / given)
                ok = ratio <= tol
            lines.append({"value": ln["value"], "expected": expected, "given": given, "withinTolerance": ok})
        right = [ln["withinTolerance"] for ln in lines]
        return {"passed": all(right), "score": sum(right) / len(right), "reveal": {"lines": lines, "tolerance": tol}}

    raise HTTPException(status_code=400, detail=f"Block type {t!r} is not checkable")
