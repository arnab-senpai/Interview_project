"""Turn v1 lessons and case studies (data/hld/*.json) into v2 topics.

The output goes through the same compiler as hand-written topics, so the whole
study path runs on one content model and one progress record (block_progress +
attempts). Adapted topics carry ``legacy`` and are shown as "Preview" until a
chapter-template rewrite in content/<track>/<id>/ replaces them; a hand-written
topic with the same id always wins.

Block ids are deterministic (``v1-...``, quiz ids kept as-is), so a rewrite that
keeps a quiz's id keeps learners' progress on it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from backend.app.content.compiler import CompiledTopic, compile_raw

ROOT_DIR = Path(__file__).resolve().parents[3]
HLD_DIR = ROOT_DIR / "data" / "hld"
LAST_VERIFIED = "2026-11-22"  # date of the Phase 0 audit that last checked the v1 numbers
LEVELS = {"Junior", "Mid", "Senior", "Staff"}


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _level(value: str | None) -> str:
    return value if value in LEVELS else "Mid"


def _practice(topic_id: str) -> dict[str, Any]:
    f = HLD_DIR / "practice" / f"{topic_id}.json"
    return _read(f) if f.exists() else {"quizzes": [], "flashcards": []}


def _module_reading(topic_id: str) -> list[dict[str, Any]]:
    """The DDIA module essays that used to be the Modules tab, as further reading."""
    f = HLD_DIR / "modules.json"
    if not f.exists():
        return []
    out: list[dict[str, Any]] = []
    for m in _read(f).get("modules", []):
        if topic_id not in [*m.get("linkedLessonIds", []), *m.get("linkedCaseStudyIds", [])]:
            continue
        for d in m.get("deepDiveFoundations", []):
            body = "\n\n".join(x for x in (d.get("corePrinciple"), d.get("mechanicsAndConstraints")) if x)
            out.append({"title": f"Module {m.get('moduleNumber')}: {d['heading']}", "body": body or None})
    return out


def _review_cards(topic_id: str) -> list[dict[str, Any]]:
    return [{"id": c["id"], "front": c["front"], "back": c["back"]} for c in _practice(topic_id).get("flashcards", [])]


def _quiz_blocks(topic_id: str, wanted: list[str] | None = None) -> list[dict[str, Any]]:
    blocks = []
    quizzes = _practice(topic_id).get("quizzes", [])
    if wanted:
        order = {qid: i for i, qid in enumerate(wanted)}
        quizzes = sorted(quizzes, key=lambda q: order.get(q["id"], len(order)))
    for q in quizzes:
        expl = q.get("optionExplanations") or []
        options = [
            {"text": text, "explanation": (expl[i] if i < len(expl) and expl[i] else q.get("explanation", ""))}
            for i, text in enumerate(q["options"])
        ]
        prompt = "\n\n".join(x for x in (q.get("scenario"), q.get("question")) if x)
        blocks.append(
            {
                "id": q["id"],
                "type": "quiz",
                "prompt": prompt,
                "options": options,
                "answer": q["correctIndex"],
                "gradingVersion": 1,
            }
        )
    return blocks


def _figure(topo: dict[str, Any], title: str) -> tuple[list[dict], list[dict], list[dict]]:
    """Components, arrows and the figure + trace blocks for one v1 topology."""
    components = []
    for n in topo.get("nodes", []):
        gp = n.get("gridPos") or {}
        components.append(
            {
                "id": n["id"],
                "label": n["label"],
                "kind": n["kind"],
                "example": n.get("sublabel"),
                "pos": [gp.get("gx", 0), gp.get("gy", 0)],
                "note": n.get("summary"),
            }
        )
    node_ids = {c["id"] for c in components}
    arrows = [
        {
            "id": e["id"],
            "from": e["from"],
            "to": e["to"],
            "label": e.get("label") or e.get("protocol") or "",
            "mode": "sync" if e.get("transport") == "sync" else "async",
        }
        for e in topo.get("edges", [])
        if e["from"] in node_ids and e["to"] in node_ids
    ]
    blocks: list[dict[str, Any]] = []
    if components:
        blocks.append(
            {
                "id": "v1-figure",
                "type": "figure",
                "figureKind": "topology",
                "title": title,
                "caption": topo.get("subtitle"),
                "stage": {"add": [*node_ids_in_order(components), *[a["id"] for a in arrows]]},
                "claims": list(topo.get("keyTakeaways") or [])[:3],
            }
        )
        steps = [
            {
                "from": s["sourceNodeId"],
                "to": s["targetNodeId"],
                "label": s.get("info") or s.get("phaseTitle") or "",
                "latencyMs": s.get("latencyDeltaMs"),
                "note": s.get("inspectorNote"),
            }
            for s in topo.get("steps", [])
            if s.get("sourceNodeId") in node_ids and s.get("targetNodeId") in node_ids
        ]
        if steps:
            blocks.append({"id": "v1-trace", "type": "trace", "title": "Follow one request", "figure": "v1-figure", "steps": steps})
    return components, arrows, blocks


def node_ids_in_order(components: list[dict[str, Any]]) -> list[str]:
    return [c["id"] for c in components]


def _bullets(items: list[str]) -> str:
    return "\n".join(f"- {x}" for x in items)


def _incidents(topo: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for i, c in enumerate(topo.get("chaosScenarios", []), start=1):
        body = f"**What breaks.** {c.get('triggerSummary', '')}\n\n**What saves it.** {c.get('mitigationSummary', '')}"
        out.append({"id": f"v1-incident-{i}", "type": "prose", "role": "incident", "title": c.get("title"), "body": body})
    return out


def _tradeoffs(topo: dict[str, Any]) -> list[dict[str, Any]]:
    rows = [
        {
            "option": t.get("option", ""),
            "pros": "; ".join(t.get("pros", [])),
            "cons": "; ".join(t.get("cons", [])),
            "bestFor": t.get("bestFor", ""),
        }
        for t in topo.get("tradeoffs", [])
    ]
    if not rows:
        return []
    return [
        {
            "id": "v1-tradeoffs",
            "type": "structuredTable",
            "variant": "decisionMatrix",
            "title": "Trade-offs",
            "columns": [
                {"key": "option", "label": "Option"},
                {"key": "pros", "label": "Buys"},
                {"key": "cons", "label": "Costs"},
                {"key": "bestFor", "label": "Best for"},
            ],
            "rows": rows,
        }
    ]


def _split_minutes(total: int) -> tuple[int, int]:
    total = max(4, min(int(total or 20), 90))
    first = max(2, min(60, round(total * 0.55)))
    return first, max(2, min(60, total - first))


def adapt_lesson(lesson: dict[str, Any]) -> dict[str, Any]:
    tid = lesson["id"]
    level = _level(lesson.get("difficulty"))
    components, arrows, fig_blocks = _figure(lesson, lesson["title"])
    lenses = lesson.get("adaptiveLenses") or {}
    understand: list[dict[str, Any]] = [
        {"id": "v1-story", "type": "prose", "role": "problem", "title": "Why this exists", "body": lesson.get("firstPrinciplesStory")},
        {"id": "v1-overview", "type": "prose", "role": "steps", "title": "Overview", "body": lesson.get("overview")},
    ]
    if lenses.get("intuition"):
        understand.append({"id": "v1-analogy", "type": "prose", "role": "analogy", "title": "In plain words", "body": lenses["intuition"]})
    understand += fig_blocks
    if lenses.get("mechanics"):
        understand.append({"id": "v1-internals", "type": "prose", "role": "internals", "title": "How it works", "body": lenses["mechanics"]})
    apply: list[dict[str, Any]] = [*_incidents(lesson), *_tradeoffs(lesson)]
    if lenses.get("staffTradeoffs"):
        apply.append({"id": "v1-at-scale", "type": "prose", "role": "atScale", "title": "At scale", "body": lenses["staffTradeoffs"]})
    if lesson.get("keyTakeaways"):
        apply.append({"id": "v1-takeaways", "type": "prose", "role": "why", "title": "Remember", "body": _bullets(lesson["keyTakeaways"])})
    apply += _quiz_blocks(tid, lesson.get("quizQuestionIds"))
    m1, m2 = _split_minutes(lesson.get("estimatedMinutes", 20))
    sources = [
        {"title": a.get("chapter", "DDIA"), "note": a.get("concept")} for a in lesson.get("ddiaAnchors", []) if a.get("chapter")
    ] or [{"title": "SystemCraft v1 lesson", "note": "Written before the chapter template"}]
    reading = [
        {"title": t.get("principle", "Pragmatic tip"), "body": "\n\n".join(x for x in (t.get("tip"), t.get("application")) if x)}
        for t in lesson.get("pragmaticTips", [])
    ] + _module_reading(tid)
    return _topic(tid, "concept", lesson, level, sources, reading, components, arrows, understand, apply, m1, m2,
                  {"kind": "lesson", "id": tid}, sandbox=tid)


def adapt_case_study(cs: dict[str, Any]) -> dict[str, Any]:
    tid = cs["id"]
    level = _level(cs.get("levelTag"))
    topo = cs.get("explorerTopology") or {}
    components, arrows, fig_blocks = _figure(topo, topo.get("title") or cs["title"])
    understand: list[dict[str, Any]] = [
        {"id": "v1-problem", "type": "prose", "role": "problem", "title": "What to build",
         "body": "\n\n".join(x for x in (cs.get("subtitle"), _bullets(cs.get("functionalReqs", []))) if x)},
    ]
    nfr = cs.get("nonFunctionalReqs") or []
    if nfr:
        understand.append({
            "id": "v1-clarify", "type": "structuredTable", "variant": "clarify", "title": "Requirements that shape the design",
            "columns": [{"key": "metric", "label": "Requirement"}, {"key": "target", "label": "Target"}, {"key": "rationale", "label": "Why"}],
            "rows": [{k: r.get(k, "") for k in ("metric", "target", "rationale")} for r in nfr],
        })
    worked = (cs.get("estimationPreset") or {}).get("workedSummary") or {}
    if worked:
        understand.append({"id": "v1-numbers", "type": "prose", "role": "numbers", "title": "The numbers",
                           "body": _bullets([f"**{k}**: {v}" for k, v in worked.items()])})
    if cs.get("apiContracts"):
        understand.append({
            "id": "v1-api", "type": "structuredTable", "variant": "reference", "title": "API",
            "columns": [{"key": "method", "label": "Method"}, {"key": "path", "label": "Path"}, {"key": "purpose", "label": "Purpose"}],
            "rows": [{k: str(a.get(k, "")) for k in ("method", "path", "purpose")} for a in cs["apiContracts"]],
        })
    if cs.get("coreEntities"):
        understand.append({
            "id": "v1-entities", "type": "structuredTable", "variant": "reference", "title": "Data model",
            "columns": [{"key": "name", "label": "Entity"}, {"key": "storageEngine", "label": "Stored in"}, {"key": "partitionKey", "label": "Partition key"}],
            "rows": [{k: str(e.get(k, "")) for k in ("name", "storageEngine", "partitionKey")} for e in cs["coreEntities"]],
        })
    understand += fig_blocks
    apply: list[dict[str, Any]] = []
    for i, d in enumerate(cs.get("deepDives", []), start=1):
        body = "\n\n".join(
            f"**{label}.** {d[key]}" for key, label in (("bottleneck", "The problem"), ("solution", "The fix"), ("tradeoff", "The cost")) if d.get(key)
        )
        apply.append({"id": f"v1-deep-{i}", "type": "prose", "role": "deepDive", "title": d.get("title"), "body": body})
    apply += _incidents(topo) + _tradeoffs(topo)
    if topo.get("keyTakeaways"):
        apply.append({"id": "v1-takeaways", "type": "prose", "role": "why", "title": "Remember", "body": _bullets(topo["keyTakeaways"])})
    if cs.get("rubricChecklist"):
        apply.append({
            "id": "v1-rubric", "type": "structuredTable", "variant": "reference", "title": "What an interviewer looks for",
            "columns": [{"key": "phase", "label": "Phase"}, {"key": "weight", "label": "Weight (%)"}, {"key": "criteria", "label": "Criteria"}],
            "rows": [{"phase": r.get("phase", ""), "weight": str(r.get("weight", "")), "criteria": "; ".join(r.get("criteria", []))}
                     for r in cs["rubricChecklist"]],
        })
    apply += _quiz_blocks(tid)
    m1, m2 = _split_minutes(cs.get("estimatedMinutes", 35))
    sources = [{"title": "SystemCraft v1 case study", "note": "Written before the chapter template"}]
    return _topic(tid, "case_study", cs, level, sources, _module_reading(tid), components, arrows, understand, apply, m1, m2,
                  {"kind": "case_study", "id": tid}, sandbox=None)


def _topic(tid, kind, src, level, sources, reading, components, arrows, understand, apply, m1, m2, legacy, sandbox):
    understand = [b for b in understand if b.get("type") != "prose" or b.get("body")]
    apply = [b for b in apply if b.get("type") != "prose" or b.get("body")]
    layers = {"understand": {"level": level, "minutes": m1, "blocks": understand}}
    if apply:
        layers["apply"] = {"level": level, "minutes": m2, "blocks": apply}
    return {
        "schemaVersion": 2,
        "id": tid,
        "track": "hld",
        "kind": kind,
        "template": "free",
        "title": src["title"],
        "summary": src.get("subtitle") or src.get("overview", "")[:200],
        "status": "ready",
        "sandboxLessonId": sandbox,
        "legacy": legacy,
        "furtherReading": reading,
        "reviewCards": _review_cards(tid),
        "sources": sources,
        "lastVerified": LAST_VERIFIED,
        "appliesTo": "General system design; numbers are typical, not vendor-specific",
        "components": components,
        "arrows": arrows,
        "layers": layers,
    }


def ready_v1_sources() -> list[tuple[str, Path]]:
    """(kind, file) for every ready v1 lesson and case study."""
    index = _read(HLD_DIR / "curriculum_index.json")
    out: list[tuple[str, Path]] = []
    for e in index.get("lessons", []):
        if e.get("status") == "ready" and e.get("dataFile"):
            out.append(("lesson", ROOT_DIR / e["dataFile"]))
    ready_cases = {e["id"] for e in index.get("caseStudies", []) if e.get("status") == "ready"}
    for f in sorted((HLD_DIR / "case_studies").glob("*.json")):
        cs = _read(f)
        if cs.get("id") in ready_cases:
            out.append(("case_study", f))
    return out


def adapt_all(skip: set[str] | None = None) -> list[CompiledTopic]:
    """Compile every ready v1 lesson and case study whose id has no hand-written v2 topic."""
    skip = skip or set()
    out: list[CompiledTopic] = []
    for kind, f in ready_v1_sources():
        src = _read(f)
        if src["id"] in skip:
            continue
        raw = adapt_lesson(src) if kind == "lesson" else adapt_case_study(src)
        out.append(compile_raw(raw, CompiledTopic(id=src["id"], path=f)))
    return out
