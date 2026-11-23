"""Content lint for v2 topics. Structural checks are errors (CI fails); prose checks are warnings forever.

Run through ``python backend/scripts/build_content.py`` or ``validate_content.py``.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

from backend.app.content.compiler import CompiledTopic, load_grading_lock, load_paths
from backend.app.content.schema import CHAPTER_SECTIONS

ABSOLUTES = re.compile(r"\b(always|never|guarantees?|100%)\b", re.IGNORECASE)
LAYER_BUDGET = {"understand": 15, "apply": 20, "defend": 20}
MAX_FIGURE_PARTS = 8
MAX_STEP_WORDS = 150


def _words(text: str) -> int:
    return len(re.findall(r"\b\w[\w'-]*\b", text or ""))


def _prose_text(block: dict[str, Any]) -> str:
    return " ".join(str(block.get(k, "")) for k in ("body", "why", "title", "prompt", "caption"))


def lint_topic(ct: CompiledTopic) -> None:
    pub = ct.public
    if not pub:
        return
    if pub.get("legacy"):
        # Adapted v1 topics: report everything, fail on nothing. A rewrite to the
        # chapter template replaces them and gets the full lint.
        before = len(ct.errors)
        _lint_topic(ct)
        ct.warnings.extend(f"(preview) {e}" for e in ct.errors[before:])
        del ct.errors[before:]
        return
    _lint_topic(ct)


def _lint_topic(ct: CompiledTopic) -> None:
    pub = ct.public
    blocks: list[dict[str, Any]] = pub["blocks"]
    by_id = {b["id"]: b for b in blocks}

    # Checkable blocks: gradingVersion present, quiz options well formed and unbiased.
    for b in blocks:
        if b["type"] in ("quiz", "predict"):
            opts = [o["text"] for o in b["options"]]
            if len(opts) < 2:
                ct.errors.append(f"{b['id']}: needs at least two options")
                continue
            key = ct.keys[b["id"]]
            lengths = [len(o) for o in opts]
            mean = sum(lengths) / len(lengths)
            right = lengths[key["answer"]]
            if len(opts) >= 3 and right == max(lengths) and right > 1.2 * mean:
                ct.errors.append(
                    f"{b['id']}: the correct option is the longest and >20% longer than the mean; rebalance the options"
                )
            if any(not e.strip() for e in key["explanations"]):
                ct.errors.append(f"{b['id']}: every option needs an explanation")

    # Metadata
    if not pub.get("sources"):
        ct.errors.append("sources: at least one source is required")

    # Layer time budgets (warning) and a check per layer (warning).
    for layer in pub["layers"]:
        budget = LAYER_BUDGET.get(layer["name"])
        if budget and layer["minutes"] > budget:
            ct.warnings.append(f"layer {layer['name']}: {layer['minutes']} min is over the {budget} min budget")
        if layer["name"] in ("apply", "defend") and not any(by_id[i]["checkable"] for i in layer["blockIds"]):
            ct.warnings.append(f"layer {layer['name']}: has no check; each layer should end in one")

    # Figures: size, claims, a claim-style title, labelled arrows.
    arrows = {a["id"]: a for a in pub["arrows"]}
    for fid, st in pub["figures"].items():
        fig = by_id[fid]
        if len(st["components"]) > MAX_FIGURE_PARTS:
            ct.errors.append(f"figure {fid}: {len(st['components'])} parts; split it (max {MAX_FIGURE_PARTS})")
        if not fig.get("claims"):
            ct.errors.append(f"figure {fid}: list the claims it makes so a reviewer can sign them off")
        if len(fig["title"].split()) < 3:
            ct.warnings.append(f"figure {fid}: title {fig['title']!r} reads like a topic; state the point")
        for aid in st["arrows"]:
            a = arrows[aid]
            if not a.get("label", "").strip():
                ct.errors.append(f"figure {fid}: arrow {aid} has no label")
            if a.get("rate") is None and aid not in st["arrowOverrides"]:
                ct.warnings.append(f"figure {fid}: arrow {aid} carries no rate formula")

    if pub.get("template") == "chapter":
        _lint_chapter(ct, blocks)

    # Prose heuristics: warnings only.
    for b in blocks:
        text = _prose_text(b)
        if "!" in text.replace("!=", ""):
            ct.warnings.append(f"{b['id']}: exclamation mark")
        for m in ABSOLUTES.finditer(text):
            ct.warnings.append(f"{b['id']}: absolute word {m.group(0)!r}; give a source or soften it")


def _lint_chapter(ct: CompiledTopic, blocks: list[dict[str, Any]]) -> None:
    sections = [b.get("section") for b in blocks if b.get("section")]
    present = [s for s in CHAPTER_SECTIONS if s in sections]
    for s in CHAPTER_SECTIONS:
        if s not in present:
            ct.errors.append(f"chapter template: missing section {s!r}")
    by_section: dict[str, list[dict[str, Any]]] = {s: [] for s in CHAPTER_SECTIONS}
    for b in blocks:
        if b.get("section"):
            by_section[b["section"]].append(b)

    if not any(b["type"] == "predict" for b in by_section["clarify"]):
        ct.errors.append("chapter template: Clarify needs one predict prompt before the answers")

    design_figs = [b for b in by_section["design"] if b["type"] == "figure"]
    if not 3 <= len(design_figs) <= 6:
        ct.errors.append(f"chapter template: Design needs 3 to 6 steps with one figure each (found {len(design_figs)})")
    # Each design step = the prose before its figure: at most 150 words and one "Why" line.
    step_words = 0
    step_has_why = False
    for b in by_section["design"]:
        if b["type"] == "prose":
            step_words += _words(b.get("body", ""))
            step_has_why = step_has_why or bool((b.get("why") or "").strip().lower().startswith("why"))
        elif b["type"] == "figure":
            if step_words > MAX_STEP_WORDS:
                ct.errors.append(f"design step before {b['id']}: {step_words} words (max {MAX_STEP_WORDS})")
            if not step_has_why:
                ct.errors.append(f"design step before {b['id']}: needs one line that starts with 'Why'")
            if b is not design_figs[0] and not b.get("base"):
                ct.errors.append(f"figure {b['id']}: a design step builds on the previous figure; set base")
            if b is not design_figs[0] and not (b.get("stage") or {}).get("add") and not (b.get("stage") or {}).get("change"):
                ct.errors.append(f"figure {b['id']}: adds or changes nothing compared with its base")
            step_words, step_has_why = 0, False

    remember = [b for b in by_section["remember"] if b["type"] == "rememberCard"]
    if len(remember) != 1:
        ct.errors.append("chapter template: Remember needs exactly one rememberCard")
    else:
        card = remember[0]
        if len(card["facts"]) != 3:
            ct.errors.append(f"{card['id']}: a Remember card has exactly three facts")
        if design_figs and card["figure"] != design_figs[-1]["id"]:
            ct.warnings.append(f"{card['id']}: the card usually shows the final design figure")

    checks = [b for b in by_section["check"] if b.get("checkable")]
    if not 3 <= len(checks) <= 5:
        ct.errors.append(f"chapter template: Check needs 3 to 5 questions (found {len(checks)})")
    if checks and not any(b.get("aboutFigure") for b in checks):
        ct.errors.append("chapter template: Check needs one question that uses a figure (set aboutFigure)")

    deep = by_section["deepDive"]
    if not deep:
        ct.errors.append("chapter template: Deep dive needs at least one named question")


def lint_graph(topics: list[CompiledTopic], v1_ids: Iterable[str]) -> list[str]:
    """Prerequisites and links must resolve; prerequisites must not form a cycle."""
    errors: list[str] = []
    v2 = {t.id: t for t in topics if t.public}
    known = set(v2) | set(v1_ids)
    for t in v2.values():
        for pre in t.public.get("prerequisites", []):
            if pre not in v2:
                errors.append(f"{t.id}: prerequisite {pre!r} is not a v2 topic")
        for rel in t.public.get("related", []):
            if rel not in known:
                errors.append(f"{t.id}: related link {rel!r} points at nothing ready")
        sb = t.public.get("sandboxLessonId")
        if sb and sb not in set(v1_ids):
            errors.append(f"{t.id}: sandboxLessonId {sb!r} is not a ready v1 lesson")

    state: dict[str, int] = {}

    def visit(node: str, trail: list[str]) -> None:
        if state.get(node) == 2:
            return
        if state.get(node) == 1:
            errors.append(f"prerequisite cycle: {' -> '.join([*trail, node])}")
            return
        state[node] = 1
        for pre in v2[node].public.get("prerequisites", []):
            if pre in v2:
                visit(pre, [*trail, node])
        state[node] = 2

    for tid in v2:
        visit(tid, [])

    paths, path_errors = load_paths()
    errors.extend(path_errors)
    for p in paths:
        numbers = [e.number for s in p.stages for e in s.chapters]
        if len(numbers) != len(set(numbers)):
            errors.append(f"path {p.id}: chapter numbers repeat")
        for s in p.stages:
            for e in s.chapters:
                if e.status == "planned":
                    if e.topic in v2:
                        errors.append(f"path {p.id}: chapter {e.number} is marked planned but {e.topic!r} exists; drop status")
                    continue
                if e.topic not in v2:
                    errors.append(
                        f"path {p.id}: chapter {e.number} points at {e.topic!r}, which is not a v2 topic (written or adapted);"
                        " write it or mark it status: planned"
                    )
                elif v2[e.topic].public.get("status") != "ready":
                    errors.append(f"path {p.id}: chapter {e.number} links a draft topic as if it were live")
            if s.stageCheck:
                from backend.app.content.placement_pool import pool

                for e in s.chapters:
                    if e.status == "ready" and e.topic in v2 and not pool(v2[e.topic].public):
                        errors.append(
                            f"path {p.id}: stage {s.id} has a test-out but chapter {e.number} has no quiz or predict check to ask"
                        )
    return errors


def lint_grading_lock(topics: list[CompiledTopic], lock: dict[str, dict[str, Any]] | None = None) -> list[str]:
    """A block whose grading material changed must bump gradingVersion (compared with the lockfile)."""
    lock = load_grading_lock() if lock is None else lock
    errors: list[str] = []
    for t in topics:
        if not t.public or t.public.get("legacy"):
            continue  # adapted v1 quizzes have no authored gradingVersion yet
        versions = {b["id"]: b.get("gradingVersion", 1) for b in t.public["blocks"] if b.get("checkable")}
        for bid, sha in t.grading_hashes.items():
            key = f"{t.id}/{bid}"
            entry = lock.get(key)
            if entry is None:
                errors.append(f"{key}: not in content/grading.lock.json; run build_content.py --update-lock")
                continue
            if entry["hash"] != sha and entry["gradingVersion"] >= versions[bid]:
                errors.append(
                    f"{key}: prompt, options or key changed but gradingVersion is still {versions[bid]}; bump it"
                )
            elif entry["hash"] != sha or entry["gradingVersion"] != versions[bid]:
                errors.append(f"{key}: lockfile is stale; run build_content.py --update-lock")
    return errors


def build_lock(topics: list[CompiledTopic]) -> dict[str, dict[str, Any]]:
    lock: dict[str, dict[str, Any]] = {}
    for t in topics:
        if not t.public or t.public.get("legacy"):
            continue
        versions = {b["id"]: b.get("gradingVersion", 1) for b in t.public["blocks"] if b.get("checkable")}
        for bid, sha in sorted(t.grading_hashes.items()):
            lock[f"{t.id}/{bid}"] = {"gradingVersion": versions[bid], "hash": sha}
    return dict(sorted(lock.items()))
