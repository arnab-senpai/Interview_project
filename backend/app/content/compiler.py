"""Compile ``content/<track>/<topic>/topic.yaml`` (+ Markdown) into the JSON the API serves.

Output per topic:
- ``public``: everything a browser may see. No answer keys, no reveals.
- ``keys``: the server-only map {blockId: {...}} used by POST /api/attempts.
- ``gradingHashes``: {blockId: sha} of what a grade depends on, compared with
  content/grading.lock.json so a changed key without a gradingVersion bump fails CI.

contentVersion is a hash of public + keys, so any edit changes it and nobody has
to remember to bump it. gradingVersion is authored by hand on each checkable block.
"""

from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from backend.app.content import formula
from backend.app.content.schema import (
    CHAPTER_SECTIONS,
    CHECKABLE_TYPES,
    SECTION_LAYER,
    StudyPath,
    Topic,
)

ROOT_DIR = Path(__file__).resolve().parents[3]
CONTENT_DIR = ROOT_DIR / "content"
REFERENCE_FILE = ROOT_DIR / "data" / "hld" / "reference_numbers_and_rubric.json"
GRADING_LOCK = CONTENT_DIR / "grading.lock.json"


@dataclass
class CompiledTopic:
    id: str
    path: Path
    public: dict[str, Any] = field(default_factory=dict)
    keys: dict[str, dict[str, Any]] = field(default_factory=dict)
    grading_hashes: dict[str, str] = field(default_factory=dict)
    defaults: dict[str, float] = field(default_factory=dict)
    model: Topic | None = None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _sha(obj: Any, n: int = 12) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()[:n]


def _load_reference() -> dict[str, Any]:
    if REFERENCE_FILE.exists():
        return json.loads(REFERENCE_FILE.read_text(encoding="utf-8"))
    return {}


def _resolve_files(raw: Any, topic_dir: Path, errors: list[str]) -> Any:
    """Inline every ``bodyFile`` and resolve ``rowsFrom`` before validation."""
    if isinstance(raw, list):
        return [_resolve_files(x, topic_dir, errors) for x in raw]
    if not isinstance(raw, dict):
        return raw
    out = {k: _resolve_files(v, topic_dir, errors) for k, v in raw.items()}
    body_file = out.get("bodyFile")
    if isinstance(body_file, str):
        md_path = (topic_dir / body_file).resolve()
        if topic_dir.resolve() not in md_path.parents or not md_path.exists():
            errors.append(f"bodyFile {body_file!r} not found next to topic.yaml")
        else:
            out["body"] = md_path.read_text(encoding="utf-8").strip()
    rows_from = out.get("rowsFrom")
    if isinstance(rows_from, str):
        ref = _load_reference()
        key = rows_from.split(".", 1)[1] if rows_from.startswith("reference.") else rows_from
        rows = ref.get(key)
        if not isinstance(rows, list):
            errors.append(f"rowsFrom {rows_from!r} does not name a list in reference_numbers_and_rubric.json")
        else:
            out["rows"] = rows
    return out


def _public_block(block: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Split one block into (public view, server key or None)."""
    b = copy.deepcopy(block)
    b.pop("bodyFile", None)
    t = b["type"]
    key: dict[str, Any] | None = None
    if t == "quiz":
        key = {"answer": b.pop("answer"), "explanations": [o["explanation"] for o in b["options"]]}
        b["options"] = [{"text": o["text"]} for o in b["options"]]
    elif t == "predict":
        key = {
            "answer": b.pop("answer"),
            "explanations": [o["explanation"] for o in b["options"]],
            "reveal": b.pop("reveal"),
        }
        b["options"] = [{"text": o["text"]} for o in b["options"]]
    elif t == "spotTheBug":
        key = {"steps": [{"answer": s.pop("answer"), "explanation": s.pop("explanation")} for s in b["steps"]]}
    elif t == "ladder":
        key = {"rungs": [{"answer": r.pop("answer"), "strongAnswer": r.pop("strongAnswer")} for r in b["rungs"]]}
    elif t == "designPrompt":
        key = {"modelAnswers": b.pop("modelAnswers"), "rubric": b.get("rubric", [])}
    b["checkable"] = t in CHECKABLE_TYPES
    return b, key


def _grading_material(block: dict[str, Any]) -> dict[str, Any]:
    """What a verdict depends on. Wording of explanations is excluded on purpose."""
    t = block["type"]
    if t in ("quiz", "predict"):
        return {"prompt": block["prompt"], "options": [o["text"] for o in block["options"]], "answer": block["answer"]}
    if t == "spotTheBug":
        return {"code": block["code"], "steps": [[s["prompt"], s["options"], s["answer"]] for s in block["steps"]]}
    if t == "ladder":
        return {"rungs": [[r["constraint"], r["options"], r["answer"]] for r in block["rungs"]]}
    if t == "designPrompt":
        return {"prompt": block["prompt"], "rubric": block.get("rubric", [])}
    if t == "estimationWorksheet":
        return {"lines": [ln["value"] for ln in block["lines"]], "tolerance": block.get("tolerance", 2.0)}
    return {}


def _figure_states(blocks: list[dict[str, Any]], comp_ids: set[str], arrow_ids: set[str], errors: list[str]) -> dict[str, Any]:
    states: dict[str, Any] = {}
    for b in blocks:
        if b["type"] != "figure":
            continue
        fid = b["id"]
        stage = b.get("stage") or {}
        if b.get("base"):
            if b["base"] not in states:
                errors.append(f"figure {fid}: base {b['base']!r} is not an earlier figure in this topic")
                prev = {"components": [], "arrows": [], "overrides": {}, "arrowOverrides": {}}
            else:
                prev = states[b["base"]]
        else:
            prev = {"components": [], "arrows": [], "overrides": {}, "arrowOverrides": {}}
        comps = list(prev["components"])
        arrows = list(prev["arrows"])
        for item in stage.get("add", []):
            if item in comp_ids:
                if item not in comps:
                    comps.append(item)
            elif item in arrow_ids:
                if item not in arrows:
                    arrows.append(item)
            else:
                errors.append(f"figure {fid}: adds unknown id {item!r}")
        for item in stage.get("remove", []):
            if item in comps:
                comps.remove(item)
            elif item in arrows:
                arrows.remove(item)
            else:
                errors.append(f"figure {fid}: removes {item!r}, which is not on the figure")
        for item in stage.get("change", []):
            if item not in comps and item not in arrows:
                errors.append(f"figure {fid}: changes {item!r}, which is not on the figure")
        overrides = copy.deepcopy(prev["overrides"])
        for cid, ov in (stage.get("overrides") or {}).items():
            if cid not in comp_ids:
                errors.append(f"figure {fid}: override for unknown component {cid!r}")
            overrides.setdefault(cid, {}).update({k: v for k, v in ov.items() if v is not None})
        arrow_ovr = copy.deepcopy(prev["arrowOverrides"])
        for aid, ov in (stage.get("arrowOverrides") or {}).items():
            if aid not in arrow_ids:
                errors.append(f"figure {fid}: override for unknown arrow {aid!r}")
            arrow_ovr.setdefault(aid, {}).update({k: v for k, v in ov.items() if v is not None})
        highlight = [i for i in [*stage.get("add", []), *stage.get("change", [])] if i in comps or i in arrows]
        states[fid] = {
            "components": comps,
            "arrows": arrows,
            "highlight": highlight,
            "overrides": overrides,
            "arrowOverrides": arrow_ovr,
        }
    return states


def compile_topic(topic_dir: Path) -> CompiledTopic:
    yaml_path = topic_dir / "topic.yaml"
    ct = CompiledTopic(id=topic_dir.name, path=yaml_path)
    try:
        raw = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        ct.errors.append(f"YAML error: {exc}")
        return ct
    raw = _resolve_files(raw, topic_dir, ct.errors)
    try:
        model = Topic.model_validate(raw)
    except ValidationError as exc:
        for err in exc.errors():
            loc = ".".join(str(p) for p in err["loc"])
            ct.errors.append(f"schema: {loc}: {err['msg']}")
        return ct
    ct.model = model
    if model.id != topic_dir.name:
        ct.errors.append(f"id {model.id!r} must match its folder name {topic_dir.name!r}")

    data = model.model_dump(mode="json", by_alias=True, exclude_none=True)

    # Flatten layers (and chapter sections) into one ordered block list.
    ordered: list[dict[str, Any]] = []
    layers_out: list[dict[str, Any]] = []
    for layer_name in ("understand", "apply", "defend", "practice", "cheatSheet"):
        layer = data["layers"].get(layer_name)
        if not layer:
            continue
        ids: list[str] = []
        if layer.get("sections"):
            for section in CHAPTER_SECTIONS:
                for blk in layer["sections"].get(section, []):
                    if SECTION_LAYER[section] != layer_name:
                        ct.errors.append(f"section {section!r} belongs in layer {SECTION_LAYER[section]!r}, not {layer_name!r}")
                    blk["section"] = section
                    blk["layer"] = layer_name
                    ordered.append(blk)
                    ids.append(blk["id"])
            unknown = set(layer["sections"]) - set(CHAPTER_SECTIONS)
            if unknown:
                ct.errors.append(f"unknown sections {sorted(unknown)}")
        for blk in layer.get("blocks", []):
            blk["layer"] = layer_name
            ordered.append(blk)
            ids.append(blk["id"])
        layers_out.append(
            {"name": layer_name, "level": layer["level"], "minutes": layer["minutes"], "goal": layer.get("goal"), "blockIds": ids}
        )

    seen: set[str] = set()
    for blk in ordered:
        if blk["id"] in seen:
            ct.errors.append(f"duplicate block id {blk['id']!r}")
        seen.add(blk["id"])

    comp_ids = {c["id"] for c in data["components"]}
    arrow_ids = {a["id"] for a in data["arrows"]}
    if comp_ids & arrow_ids:
        ct.errors.append(f"component and arrow ids overlap: {sorted(comp_ids & arrow_ids)}")
    for a in data["arrows"]:
        for end in (a["from"], a["to"]):
            if end not in comp_ids:
                ct.errors.append(f"arrow {a['id']}: unknown component {end!r}")

    # Numbers: every formula must parse, reference known names and evaluate at the defaults.
    nm = data["numbers"]
    defaults = {i["id"]: float(i["default"]) for i in nm["inputs"]}
    for i in nm["inputs"]:
        if not (i["min"] <= i["default"] <= i["max"]):
            ct.errors.append(f"input {i['id']}: default {i['default']} outside [{i['min']}, {i['max']}]")
    try:
        env = formula.solve_values(defaults, [(v["id"], v["formula"]) for v in nm["values"]])
        ct.defaults = env
    except formula.FormulaError as exc:
        ct.errors.append(f"numbers: {exc}")
        env = dict(defaults)
    known = set(env)
    for p in nm["presets"]:
        bad = set(p["inputs"]) - set(defaults)
        if bad:
            ct.errors.append(f"preset {p['id']}: unknown inputs {sorted(bad)}")

    def check_formula(where: str, src: Any) -> None:
        if src is None or src == "auto":
            return
        try:
            node = formula.parse(src)
            missing = formula.references(node) - known
            if missing:
                ct.errors.append(f"{where}: unknown names {sorted(missing)} in {src!r}")
                return
            val = formula.evaluate(node, env)
            if val != val or val in (float("inf"), float("-inf")):
                ct.errors.append(f"{where}: {src!r} is not finite at the default inputs")
        except formula.FormulaError as exc:
            ct.errors.append(f"{where}: {exc}")

    for c in data["components"]:
        check_formula(f"component {c['id']}.load", c.get("load"))
        check_formula(f"component {c['id']}.instances", c.get("instances"))
        for m in c.get("metrics", []):
            check_formula(f"component {c['id']}.metrics", m["value"])
    for a in data["arrows"]:
        check_formula(f"arrow {a['id']}.rate", a.get("rate"))

    figure_states = _figure_states(ordered, comp_ids, arrow_ids, ct.errors)
    for fid, st in figure_states.items():
        for cid, ov in st["overrides"].items():
            check_formula(f"figure {fid} override {cid}.load", ov.get("load"))
            check_formula(f"figure {fid} override {cid}.instances", ov.get("instances"))
            for m in ov.get("metrics") or []:
                check_formula(f"figure {fid} override {cid}.metrics", m["value"])
        for aid, ov in st["arrowOverrides"].items():
            check_formula(f"figure {fid} override {aid}.rate", ov.get("rate"))
        arrows_by_id = {a["id"]: a for a in data["arrows"]}
        for aid in st["arrows"]:
            a = arrows_by_id.get(aid)
            if a and (a["from"] not in st["components"] or a["to"] not in st["components"]):
                ct.errors.append(f"figure {fid}: arrow {aid} is drawn but one of its ends is not on the figure")

    for blk in ordered:
        if blk["type"] == "estimationWorksheet":
            for ln in blk["lines"]:
                if ln["value"] not in known:
                    ct.errors.append(f"worksheet {blk['id']}: unknown value {ln['value']!r}")
            if blk.get("preset") and blk["preset"] not in {p["id"] for p in nm["presets"]}:
                ct.errors.append(f"worksheet {blk['id']}: unknown preset {blk['preset']!r}")
        if blk["type"] in ("trace",) and blk.get("figure") and blk["figure"] not in figure_states:
            ct.errors.append(f"trace {blk['id']}: unknown figure {blk['figure']!r}")
        if blk["type"] == "rememberCard" and blk["figure"] not in figure_states:
            ct.errors.append(f"rememberCard {blk['id']}: unknown figure {blk['figure']!r}")
        if blk["type"] in ("quiz", "predict"):
            if not (0 <= blk["answer"] < len(blk["options"])):
                ct.errors.append(f"{blk['type']} {blk['id']}: answer index out of range")
            if blk.get("aboutFigure") and blk["aboutFigure"] not in figure_states:
                ct.errors.append(f"{blk['type']} {blk['id']}: aboutFigure {blk['aboutFigure']!r} is not a figure here")
        if blk["type"] == "trace":
            for st in blk["steps"]:
                for end in (st["from"], st["to"]):
                    if end not in comp_ids:
                        ct.errors.append(f"trace {blk['id']}: unknown component {end!r}")

    public_blocks: list[dict[str, Any]] = []
    for blk in ordered:
        pub, key = _public_block(blk)
        if blk["type"] in CHECKABLE_TYPES:
            ct.grading_hashes[blk["id"]] = _sha(_grading_material(blk), 16)
        if key is not None:
            ct.keys[blk["id"]] = {"type": blk["type"], "gradingVersion": blk.get("gradingVersion", 1), **key}
        public_blocks.append(pub)

    public = {k: v for k, v in data.items() if k != "layers"}
    public["layers"] = layers_out
    public["blocks"] = public_blocks
    public["figures"] = figure_states
    public["defaults"] = {k: v for k, v in env.items()}
    public["contentVersion"] = _sha({"public": public, "keys": ct.keys})
    ct.public = public
    return ct


def topic_dirs(content_dir: Path = CONTENT_DIR) -> list[Path]:
    return sorted(p.parent for p in content_dir.glob("*/*/topic.yaml"))


def compile_all(content_dir: Path = CONTENT_DIR) -> list[CompiledTopic]:
    return [compile_topic(d) for d in topic_dirs(content_dir)]


def load_paths(content_dir: Path = CONTENT_DIR) -> tuple[list[StudyPath], list[str]]:
    paths: list[StudyPath] = []
    errors: list[str] = []
    for f in sorted((content_dir / "paths").glob("*.yaml")):
        try:
            paths.append(StudyPath.model_validate(yaml.safe_load(f.read_text(encoding="utf-8"))))
        except (yaml.YAMLError, ValidationError) as exc:
            errors.append(f"{f.name}: {exc}")
    return paths, errors


def load_grading_lock(path: Path = GRADING_LOCK) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))
