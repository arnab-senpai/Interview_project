"""Compile and lint every v2 topic in content/.

    python backend/scripts/build_content.py               # lint; exit 1 on errors
    python backend/scripts/build_content.py --out data/build   # also write the JSON bundles
    python backend/scripts/build_content.py --update-lock      # after bumping a gradingVersion

The API compiles the same way at startup, so the files under --out are for
inspection and review only (data/build is git-ignored).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.content.compiler import GRADING_LOCK, compile_all  # noqa: E402
from backend.app.content.v1_adapter import adapt_all  # noqa: E402
from backend.app.content.lint import build_lock, lint_grading_lock, lint_graph, lint_topic  # noqa: E402


def ready_v1_lesson_ids() -> list[str]:
    index = json.loads((ROOT / "data" / "hld" / "curriculum_index.json").read_text(encoding="utf-8"))
    return [e["id"] for e in [*index["lessons"], *index["caseStudies"]] if e.get("status") == "ready"]


def run(out: Path | None = None, update_lock: bool = False) -> dict:
    topics = compile_all()
    written = {t.id for t in topics if t.public and not t.errors}
    topics += adapt_all(skip=written)
    for t in topics:
        lint_topic(t)
    graph_errors = lint_graph(topics, ready_v1_lesson_ids())
    lock_errors = lint_grading_lock(topics)
    if update_lock:
        must_bump = [e for e in lock_errors if "bump it" in e]
        if must_bump:
            lock_errors = must_bump
        else:
            GRADING_LOCK.write_text(json.dumps(build_lock(topics), indent=2) + "\n", encoding="utf-8")
            lock_errors = []
    errors = [f"{t.id}: {e}" for t in topics for e in t.errors] + graph_errors + lock_errors
    warnings = [f"{t.id}: {w}" for t in topics for w in t.warnings]
    if out:
        out.mkdir(parents=True, exist_ok=True)
        (out / "topics.public.json").write_text(
            json.dumps({t.id: t.public for t in topics}, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        (out / "keys.server.json").write_text(
            json.dumps({t.id: t.keys for t in topics}, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    return {"topics": len(topics), "errors": errors, "warnings": warnings}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path)
    ap.add_argument("--update-lock", action="store_true")
    args = ap.parse_args()
    summary = run(args.out, args.update_lock)
    for w in summary["warnings"]:
        print(f"warning: {w}")
    for e in summary["errors"]:
        print(f"ERROR: {e}")
    print(f"{summary['topics']} v2 topics (written + adapted), {len(summary['errors'])} errors, {len(summary['warnings'])} warnings")
    return 1 if summary["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
