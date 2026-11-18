"""Zero-dependency dataset validator for SystemCraft Studio HLD datasets."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
HLD_DIR = DATA_DIR / "hld"

VALID_LAYERS = {1, 2, 3, 4, 5, 6, 7}
VALID_NODE_KINDS = {
    "client",
    "dns",
    "cdn",
    "load_balancer",
    "api_gateway",
    "compute",
    "cache",
    "db_sql",
    "db_nosql",
    "object_store",
    "queue",
    "search_index",
    "vector_db",
    "gpu_cluster",
    "external",
}
VALID_STEP_CATEGORIES = {
    "network",
    "cache_hit",
    "cache_miss",
    "read",
    "write",
    "async",
    "consensus",
    "failover",
    "llm",
}
VALID_FAULT_TYPES = {
    "node_down",
    "qps_spike",
    "latency_injection",
    "partition",
    "cache_expiry",
    "gpu_saturation",
}


def load_json(path: Path) -> Any:
    if not path.exists():
        raise FileNotFoundError(f"Missing required data file: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def validate_trace_steps(
    steps: list[dict[str, Any]],
    node_ids: set[str],
    edge_ids: set[str],
    context: str,
) -> list[str]:
    errors: list[str] = []
    if not steps:
        return [f"{context}: must contain at least 1 trace step"]

    prev_ts = -1.0
    for idx, step in enumerate(steps, start=1):
        if step.get("stepNo") != idx:
            errors.append(f"{context}: step[{idx-1}] stepNo={step.get('stepNo')} expected {idx}")
        ts = step.get("timestampMs")
        if not isinstance(ts, (int, float)) or ts < prev_ts:
            errors.append(f"{context}: step {idx} timestampMs={ts} is not monotonic (>= {prev_ts})")
        else:
            prev_ts = float(ts)
        if step.get("sourceNodeId") not in node_ids:
            errors.append(f"{context}: step {idx} unknown sourceNodeId={step.get('sourceNodeId')}")
        if step.get("targetNodeId") not in node_ids:
            errors.append(f"{context}: step {idx} unknown targetNodeId={step.get('targetNodeId')}")
        if step.get("edgeId") not in edge_ids:
            errors.append(f"{context}: step {idx} unknown edgeId={step.get('edgeId')}")
        if step.get("category") not in VALID_STEP_CATEGORIES:
            errors.append(f"{context}: step {idx} invalid category={step.get('category')}")
        for req_str in ("phaseTitle", "protocol", "info", "payloadSize", "payloadInspector", "inspectorNote"):
            if not isinstance(step.get(req_str), str) or not step[req_str].strip():
                errors.append(f"{context}: step {idx} missing non-empty '{req_str}'")
    return errors


def validate_explorer_lesson(
    lesson: dict[str, Any],
    context: str,
    valid_quiz_ids: set[str],
    valid_flashcard_ids: set[str],
    require_pedagogy_layer: bool = False,
) -> list[str]:
    errors: list[str] = []
    if lesson.get("track") != "hld":
        errors.append(f"{context}: track must be 'hld'")
    if lesson.get("layer") not in VALID_LAYERS:
        errors.append(f"{context}: invalid layer {lesson.get('layer')}")
    if len(lesson.get("keyTakeaways", [])) < 2:
        errors.append(f"{context}: needs at least 2 keyTakeaways")

    if require_pedagogy_layer:
        if not isinstance(lesson.get("firstPrinciplesStory"), str) or not lesson["firstPrinciplesStory"].strip():
            errors.append(f"{context}: missing firstPrinciplesStory")
        lenses = lesson.get("adaptiveLenses") or {}
        for k in ("intuition", "mechanics", "staffTradeoffs"):
            if not isinstance(lenses.get(k), str) or not lenses[k].strip():
                errors.append(f"{context}: adaptiveLenses missing '{k}'")
        if not lesson.get("ddiaAnchors"):
            errors.append(f"{context}: must include at least 1 ddiaAnchor")
        if not lesson.get("pragmaticTips"):
            errors.append(f"{context}: must include at least 1 pragmaticTip")
        if not any(s.get("predictPrompt") for s in lesson.get("steps", [])):
            errors.append(f"{context}: must include at least 1 step with a predictPrompt")

    nodes = lesson.get("nodes", [])
    if len(nodes) < 2:
        errors.append(f"{context}: needs at least 2 nodes")

    node_ids: set[str] = set()
    coords_seen: dict[tuple[float, float], str] = {}
    for node in nodes:
        nid = node.get("id")
        if not nid or nid in node_ids:
            errors.append(f"{context}: duplicate or empty node id '{nid}'")
            continue
        node_ids.add(nid)
        if node.get("kind") not in VALID_NODE_KINDS:
            errors.append(f"{context}: node '{nid}' invalid kind '{node.get('kind')}'")
        if node.get("layer") not in VALID_LAYERS:
            errors.append(f"{context}: node '{nid}' invalid layer '{node.get('layer')}'")
        pos = node.get("gridPos", {})
        gx, gy = pos.get("gx"), pos.get("gy")
        if not isinstance(gx, (int, float)) or not isinstance(gy, (int, float)):
            errors.append(f"{context}: node '{nid}' missing numeric gridPos")
        elif not (0 <= gx <= 12 and 0 <= gy <= 10):
            errors.append(f"{context}: node '{nid}' gridPos ({gx}, {gy}) out of bounds")
        else:
            key = (float(gx), float(gy))
            if key in coords_seen:
                errors.append(
                    f"{context}: node '{nid}' overlaps '{coords_seen[key]}' at gridPos {key}"
                )
            coords_seen[key] = nid

    edges = lesson.get("edges", [])
    if not edges:
        errors.append(f"{context}: must have at least 1 edge")
    edge_ids: set[str] = set()
    for edge in edges:
        eid = edge.get("id")
        if not eid or eid in edge_ids:
            errors.append(f"{context}: duplicate or empty edge id '{eid}'")
            continue
        edge_ids.add(eid)
        if edge.get("from") not in node_ids:
            errors.append(f"{context}: edge '{eid}' unknown 'from' node '{edge.get('from')}'")
        if edge.get("to") not in node_ids:
            errors.append(f"{context}: edge '{eid}' unknown 'to' node '{edge.get('to')}'")

    errors.extend(validate_trace_steps(lesson.get("steps", []), node_ids, edge_ids, f"{context}.steps"))

    chaos = lesson.get("chaosScenarios", [])
    if not chaos:
        errors.append(f"{context}: must contain at least 1 chaosScenario")
    for cs in chaos:
        cid = cs.get("id", "<unknown>")
        if cs.get("faultType") not in VALID_FAULT_TYPES:
            errors.append(f"{context}.chaos[{cid}]: invalid faultType '{cs.get('faultType')}'")
        if cs.get("targetNodeId") not in node_ids:
            errors.append(f"{context}.chaos[{cid}]: unknown targetNodeId '{cs.get('targetNodeId')}'")
        errors.extend(
            validate_trace_steps(
                cs.get("steps", []),
                node_ids,
                edge_ids,
                f"{context}.chaos[{cid}].steps",
            )
        )

    for qid in lesson.get("quizQuestionIds", []):
        if qid not in valid_quiz_ids:
            errors.append(f"{context}: dangling quizQuestionId '{qid}'")
    for fid in lesson.get("flashcardIds", []):
        if fid not in valid_flashcard_ids:
            errors.append(f"{context}: dangling flashcardId '{fid}'")

    return errors


def validate_all() -> dict[str, Any]:
    errors: list[str] = []

    tracks = load_json(DATA_DIR / "curriculum_tracks.json")
    index = load_json(HLD_DIR / "curriculum_index.json")
    ref = load_json(HLD_DIR / "reference_numbers_and_rubric.json")
    patterns_bundle = load_json(HLD_DIR / "patterns.json")
    fq_bundle = load_json(HLD_DIR / "flashcards_and_quizzes.json")
    foundations = load_json(HLD_DIR / "ddia_and_pragmatic_foundations.json")

    if len(foundations.get("ddiaChapterMap", [])) != 12:
        errors.append("ddia_and_pragmatic_foundations: expected all 12 DDIA chapters")
    if len(foundations.get("pragmaticPrinciples", [])) < 6:
        errors.append("ddia_and_pragmatic_foundations: expected at least 6 pragmatic principles")

    if len(index.get("layers", [])) != 7:
        errors.append("curriculum_index: expected exactly 7 layers")

    flashcard_ids: set[str] = set()
    for fc in fq_bundle.get("flashcards", []):
        fid = fc.get("id")
        if not fid or fid in flashcard_ids:
            errors.append(f"flashcards: duplicate or empty id '{fid}'")
        else:
            flashcard_ids.add(fid)

    quiz_ids: set[str] = set()
    for q in fq_bundle.get("quizzes", []):
        qid = q.get("id")
        if not qid or qid in quiz_ids:
            errors.append(f"quizzes: duplicate or empty id '{qid}'")
            continue
        quiz_ids.add(qid)
        opts = q.get("options", [])
        cidx = q.get("correctIndex")
        if not isinstance(cidx, int) or not (0 <= cidx < len(opts)):
            errors.append(f"quizzes[{qid}]: invalid correctIndex={cidx} for {len(opts)} options")

    ready_lessons = 0
    for entry in index.get("lessons", []):
        if entry.get("status") == "ready":
            ready_lessons += 1
            data_path = ROOT / entry["dataFile"]
            lesson = load_json(data_path)
            if lesson.get("id") != entry.get("id"):
                errors.append(f"lesson {entry['id']}: id mismatch in {entry['dataFile']}")
            if lesson.get("layer") != entry.get("layer"):
                errors.append(f"lesson {entry['id']}: layer mismatch with index")
            errors.extend(
                validate_explorer_lesson(
                    lesson,
                    f"lesson[{entry['id']}]",
                    quiz_ids,
                    flashcard_ids,
                    require_pedagogy_layer=True,
                )
            )

    ready_cases = 0
    all_case_ids = {c.get("id") for c in index.get("caseStudies", [])}
    for entry in index.get("caseStudies", []):
        if entry.get("status") == "ready":
            ready_cases += 1
            data_path = ROOT / entry["dataFile"]
            cs = load_json(data_path)
            if cs.get("id") != entry.get("id"):
                errors.append(f"case_study {entry['id']}: id mismatch in {entry['dataFile']}")
            if cs.get("tier") != entry.get("tier"):
                errors.append(f"case_study {entry['id']}: tier mismatch with index")
            weights = sum(sec.get("weight", 0) for sec in cs.get("rubricChecklist", []))
            if weights != 100:
                errors.append(f"case_study {entry['id']}: rubric weights sum to {weights}, expected 100")
            topo = cs.get("explorerTopology", {})
            errors.extend(
                validate_explorer_lesson(
                    topo,
                    f"case_study[{entry['id']}].explorerTopology",
                    quiz_ids,
                    flashcard_ids,
                )
            )

    for p in patterns_bundle.get("patterns", []):
        for rel in p.get("relatedCaseStudies", []):
            if rel not in all_case_ids:
                errors.append(f"pattern[{p.get('id')}]: unknown relatedCaseStudy '{rel}'")

    modules_bundle = load_json(HLD_DIR / "modules.json")
    modules_list = modules_bundle.get("modules", [])
    if len(modules_list) < 6:
        errors.append(f"modules.json: expected at least 6 modules, found {len(modules_list)}")
    all_lesson_ids = {l.get("id") for l in index.get("lessons", [])}
    for mod in modules_list:
        mid = mod.get("id", "unknown")
        for lid in mod.get("linkedLessonIds", []):
            if lid not in all_lesson_ids:
                errors.append(f"module[{mid}]: unknown linkedLessonId '{lid}'")
        for cid in mod.get("linkedCaseStudyIds", []):
            if cid not in all_case_ids:
                errors.append(f"module[{mid}]: unknown linkedCaseStudyId '{cid}'")
        if len(mod.get("deepDiveFoundations", [])) < 3:
            errors.append(f"module[{mid}]: needs at least 3 deepDiveFoundations")
        if len(mod.get("tradeoffsMatrix", [])) < 3:
            errors.append(f"module[{mid}]: needs at least 3 tradeoffsMatrix rows")

    summary = {
        "tracks": len(tracks.get("tracks", [])),
        "layers": len(index.get("layers", [])),
        "planned_lessons": len(index.get("lessons", [])),
        "ready_lessons": ready_lessons,
        "planned_case_studies": len(index.get("caseStudies", [])),
        "ready_case_studies": ready_cases,
        "modules": len(modules_list),
        "patterns": len(patterns_bundle.get("patterns", [])),
        "flashcards": len(flashcard_ids),
        "quizzes": len(quiz_ids),
        "latency_benchmarks": len(ref.get("latencyBenchmarks", [])),
        "ddia_chapters": len(foundations.get("ddiaChapterMap", [])),
        "pragmatic_principles": len(foundations.get("pragmaticPrinciples", [])),
        "errors": errors,
    }
    return summary


def main() -> int:
    summary = validate_all()
    errors = summary["errors"]
    print(json.dumps(summary, indent=2))
    if errors:
        print(f"\nValidation FAILED with {len(errors)} error(s).", file=sys.stderr)
        return 1
    print("\nValidation PASSED: all HLD datasets and cross-references are valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
