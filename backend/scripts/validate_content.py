"""Zero-dependency dataset validator for SystemCraft Studio HLD datasets."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
HLD_DIR = DATA_DIR / "hld"
PRACTICE_DIR = HLD_DIR / "practice"

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



VALID_LEVELS = {"Junior", "Mid", "Senior", "Staff"}

# Quiz quality thresholds (see the content audit's quiz authoring rules).
MAX_CORRECT_LENGTH_RATIO = 1.2      # correct option vs. mean option length -> error
MAX_OPTION_SPREAD_RATIO = 1.6       # longest vs. shortest option -> warning
MAX_POSITION_SHARE = 0.35           # share of quizzes whose key sits at one index -> error
MAX_CORRECT_IS_LONGEST_SHARE = 0.40 # share of quizzes whose key is the unique longest -> error

ABSOLUTE_RE = re.compile(r"\b(guarantee[sd]?|always|never|100%|zero[- ](?:downtime|data loss|lost|divergence|split-brain))\b", re.IGNORECASE)
SOURCE_HINT_RE = re.compile(r"(DDIA|RFC|https?://|\bCh\. ?\d)", re.IGNORECASE)


def lint_quiz(q: dict[str, Any], ctx: str) -> tuple[list[str], list[str]]:
    """Structural checks (errors) and length heuristics for one quiz question."""
    errors: list[str] = []
    warnings: list[str] = []
    opts = q.get("options", [])
    cidx = q.get("correctIndex")
    if len(opts) < 3:
        errors.append(f"{ctx}: needs at least 3 options")
        return errors, warnings
    if not isinstance(cidx, int) or not (0 <= cidx < len(opts)):
        errors.append(f"{ctx}: invalid correctIndex={cidx} for {len(opts)} options")
        return errors, warnings
    if not isinstance(q.get("explanation"), str) or not q["explanation"].strip():
        errors.append(f"{ctx}: missing explanation")
    expl = q.get("optionExplanations")
    if not isinstance(expl, list) or len(expl) != len(opts) or not all(isinstance(e, str) and e.strip() for e in expl):
        errors.append(f"{ctx}: needs one non-empty optionExplanation per option")
    lengths = [len(o) for o in opts]
    mean = sum(lengths) / len(lengths)
    if lengths[cidx] > MAX_CORRECT_LENGTH_RATIO * mean:
        errors.append(
            f"{ctx}: correct option is {lengths[cidx] / mean:.2f}x the mean option length (max {MAX_CORRECT_LENGTH_RATIO})"
        )
    if min(lengths) and max(lengths) / min(lengths) > MAX_OPTION_SPREAD_RATIO:
        warnings.append(f"{ctx}: option lengths range {min(lengths)}-{max(lengths)} characters")
    return errors, warnings


def lint_quiz_bank(quizzes: list[dict[str, Any]]) -> list[str]:
    """Bank-wide checks: answer positions spread out, and the key is not usually the longest option."""
    errors: list[str] = []
    graded = [q for q in quizzes if isinstance(q.get("correctIndex"), int) and q.get("options")]
    if len(graded) < 8:
        return errors
    positions: dict[int, int] = {}
    longest = 0
    for q in graded:
        positions[q["correctIndex"]] = positions.get(q["correctIndex"], 0) + 1
        lengths = [len(o) for o in q["options"]]
        if lengths.count(max(lengths)) == 1 and lengths[q["correctIndex"]] == max(lengths):
            longest += 1
    for pos, count in sorted(positions.items()):
        if count / len(graded) > MAX_POSITION_SHARE:
            errors.append(
                f"quiz bank: {count}/{len(graded)} answers sit at index {pos} (max {MAX_POSITION_SHARE:.0%})"
            )
    if longest / len(graded) > MAX_CORRECT_IS_LONGEST_SHARE:
        errors.append(
            f"quiz bank: the correct option is the longest in {longest}/{len(graded)} questions (max {MAX_CORRECT_IS_LONGEST_SHARE:.0%})"
        )
    return errors


def _iter_strings(node: Any, path: str = ""):
    if isinstance(node, str):
        yield path, node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from _iter_strings(v, f"{path}.{k}" if path else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _iter_strings(v, f"{path}[{i}]")


def lint_prose(doc: dict[str, Any], topic_id: str) -> list[str]:
    """Prose heuristics. These stay warnings: they flag text for an author to look at, never fail CI."""
    warnings: list[str] = []
    absolutes = 0
    exclamations = 0
    for path, text in _iter_strings(doc):
        if path.endswith(("id", "Id", "edgeId", "sourceNodeId", "targetNodeId", "dataFile")):
            continue
        if ABSOLUTE_RE.search(text) and not SOURCE_HINT_RE.search(text):
            absolutes += 1
        exclamations += text.count("!") - text.count("!=")
    if absolutes:
        warnings.append(f"{topic_id}: {absolutes} field(s) use an absolute (guarantee/always/never/100%/zero ...) without a source")
    if exclamations > 3:
        warnings.append(f"{topic_id}: {exclamations} exclamation marks; prefer a neutral tone")
    if not doc.get("lastVerified"):
        warnings.append(f"{topic_id}: no lastVerified date (becomes an error in Phase 1)")
    return warnings


def validate_all() -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []

    tracks = load_json(DATA_DIR / "curriculum_tracks.json")
    index = load_json(HLD_DIR / "curriculum_index.json")
    ref = load_json(HLD_DIR / "reference_numbers_and_rubric.json")
    patterns_bundle = load_json(HLD_DIR / "patterns.json")
    practice_files = sorted(PRACTICE_DIR.glob("*.json"))
    if not practice_files:
        errors.append(f"{PRACTICE_DIR}: no per-topic practice files found")
    practice_docs = [(path, load_json(path)) for path in practice_files]
    foundations = load_json(HLD_DIR / "ddia_and_pragmatic_foundations.json")

    if len(foundations.get("ddiaChapterMap", [])) != 12:
        errors.append("ddia_and_pragmatic_foundations: expected all 12 DDIA chapters")
    if len(foundations.get("pragmaticPrinciples", [])) < 6:
        errors.append("ddia_and_pragmatic_foundations: expected at least 6 pragmatic principles")

    if len(index.get("layers", [])) != 7:
        errors.append("curriculum_index: expected exactly 7 layers")

    flashcard_ids: set[str] = set()
    quiz_ids: set[str] = set()
    all_quizzes: list[dict[str, Any]] = []
    for path, doc in practice_docs:
        ctx = f"practice/{path.name}"
        topic_id = doc.get("topicId")
        if path.stem != topic_id:
            errors.append(f"{ctx}: topicId '{topic_id}' must match the file name")
        for fc in doc.get("flashcards", []):
            fid = fc.get("id")
            if not fid or fid in flashcard_ids:
                errors.append(f"{ctx}: duplicate or empty flashcard id '{fid}'")
            else:
                flashcard_ids.add(fid)
            if fc.get("topicId") != topic_id:
                errors.append(f"{ctx}: flashcard '{fid}' has topicId '{fc.get('topicId')}'")
            if fc.get("difficulty") not in VALID_LEVELS:
                errors.append(f"{ctx}: flashcard '{fid}' has invalid level '{fc.get('difficulty')}'")
        for q in doc.get("quizzes", []):
            qid = q.get("id")
            if not qid or qid in quiz_ids:
                errors.append(f"{ctx}: duplicate or empty quiz id '{qid}'")
                continue
            quiz_ids.add(qid)
            if q.get("topicId") != topic_id:
                errors.append(f"{ctx}: quiz '{qid}' has topicId '{q.get('topicId')}'")
            if q.get("difficulty") not in VALID_LEVELS:
                errors.append(f"{ctx}: quiz '{qid}' has invalid level '{q.get('difficulty')}'")
            q_errors, q_warnings = lint_quiz(q, f"{ctx}[{qid}]")
            errors.extend(q_errors)
            warnings.extend(q_warnings)
            all_quizzes.append(q)
    errors.extend(lint_quiz_bank(all_quizzes))

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

    known_topics = {l.get("id") for l in index.get("lessons", [])} | all_case_ids
    for path, doc in practice_docs:
        if doc.get("topicId") not in known_topics:
            errors.append(f"practice/{path.name}: topicId '{doc.get('topicId')}' is not a lesson or case study in curriculum_index")

    for entry in [*index.get("lessons", []), *index.get("caseStudies", [])]:
        if entry.get("status") == "ready" and entry.get("dataFile"):
            warnings.extend(lint_prose(load_json(ROOT / entry["dataFile"]), entry["id"]))

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
        "warnings": warnings,
    }
    return summary


def validate_v2() -> dict:
    """Content model v2 (content/<track>/<topic>/topic.yaml). Needs PyYAML, so it is imported lazily."""
    root = Path(__file__).resolve().parents[2]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from backend.scripts.build_content import run

    return run()


def main() -> int:
    summary = validate_all()
    v2 = validate_v2()
    summary["v2_topics"] = v2["topics"]
    summary["errors"] = [*summary["errors"], *(f"v2 {e}" for e in v2["errors"])]
    summary["warnings"] = [*summary["warnings"], *(f"v2 {w}" for w in v2["warnings"])]
    errors = summary["errors"]
    warnings = summary["warnings"]
    printable = {k: v for k, v in summary.items() if k not in ("errors", "warnings")}
    print(json.dumps(printable, indent=2))
    if warnings:
        print(f"\n{len(warnings)} warning(s) (prose heuristics; these never fail the build):")
        for w in warnings:
            print(f"  warning: {w}")
    if errors:
        print(f"\n{len(errors)} error(s):", file=sys.stderr)
        for e in errors:
            print(f"  error: {e}", file=sys.stderr)
        print(f"\nValidation FAILED with {len(errors)} error(s).", file=sys.stderr)
        return 1
    print("\nValidation PASSED: all HLD datasets and cross-references are valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
