"""Loads and Pydantic-validates all static HLD curriculum datasets."""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from backend.app.core.config import DATA_DIR, HLD_DIR, PRACTICE_DIR, ROOT_DIR
from backend.app.schemas.hld import (
    CurriculumIndex,
    FlashcardsAndQuizzesBundle,
    HldCaseStudy,
    HldExplorerLesson,
    HldModulesBundle,
    PatternsBundle,
    PracticeTopicFile,
    ReferenceNumbersAndRubric,
)


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_practice_bundle(practice_dir: Path) -> FlashcardsAndQuizzesBundle:
    """Merge the per-topic practice files (flashcards + quizzes) into one bundle."""
    flashcards = []
    quizzes = []
    for path in sorted(practice_dir.glob("*.json")):
        topic_file = PracticeTopicFile.model_validate(_read_json(path))
        for item in [*topic_file.flashcards, *topic_file.quizzes]:
            if item.topic_id != topic_file.topic_id:
                raise ValueError(f"{path.name}: item {item.id} has topicId {item.topic_id}")
        flashcards.extend(topic_file.flashcards)
        quizzes.extend(topic_file.quizzes)
    return FlashcardsAndQuizzesBundle(version="2.0.0", flashcards=flashcards, quizzes=quizzes)


class CurriculumStore:
    """In-memory validated store of all HLD static lessons, case studies, and references."""

    def __init__(self) -> None:
        self.tracks: dict[str, Any] = _read_json(DATA_DIR / "curriculum_tracks.json")
        self.index = CurriculumIndex.model_validate(_read_json(HLD_DIR / "curriculum_index.json"))
        self.reference = ReferenceNumbersAndRubric.model_validate(
            _read_json(HLD_DIR / "reference_numbers_and_rubric.json")
        )
        self.patterns = PatternsBundle.model_validate(_read_json(HLD_DIR / "patterns.json"))
        self.fq_bundle = load_practice_bundle(PRACTICE_DIR)
        self.foundations: dict[str, Any] = _read_json(
            HLD_DIR / "ddia_and_pragmatic_foundations.json"
        )
        self.modules = HldModulesBundle.model_validate(_read_json(HLD_DIR / "modules.json"))
        self.modules_by_id = {m.id: m for m in self.modules.modules}

        self.lessons_by_id: dict[str, HldExplorerLesson] = {}
        for entry in self.index.lessons:
            if entry.get("status") == "ready" and entry.get("dataFile"):
                raw = _read_json(ROOT_DIR / entry["dataFile"])
                lesson = HldExplorerLesson.model_validate(raw)
                self.lessons_by_id[lesson.id] = lesson

        self.case_studies_by_id: dict[str, HldCaseStudy] = {}
        for entry in self.index.case_studies:
            if entry.get("status") == "ready" and entry.get("dataFile"):
                raw = _read_json(ROOT_DIR / entry["dataFile"])
                cs = HldCaseStudy.model_validate(raw)
                self.case_studies_by_id[cs.id] = cs

        self.flashcards_by_id = {c.id: c for c in self.fq_bundle.flashcards}
        self.quizzes_by_id = {q.id: q for q in self.fq_bundle.quizzes}
        self.content_versions = self._compute_content_versions()

    def _compute_content_versions(self) -> dict[str, str]:
        """A short hash per topic of its lesson/case-study JSON and its practice file.

        Feedback reports store it, so a report can be matched to the exact text the
        reviewer saw even after the content is edited.
        """
        parts: dict[str, list[Any]] = {}
        for lesson in self.lessons_by_id.values():
            parts.setdefault(lesson.id, []).append(lesson.model_dump(by_alias=True))
        for cs in self.case_studies_by_id.values():
            parts.setdefault(cs.id, []).append(cs.model_dump(by_alias=True))
        for mod in self.modules.modules:
            parts.setdefault(mod.id, []).append(mod.model_dump(by_alias=True))
        for item in [*self.fq_bundle.flashcards, *self.fq_bundle.quizzes]:
            parts.setdefault(item.topic_id, []).append(item.model_dump(by_alias=True))
        return {
            topic_id: hashlib.sha256(
                json.dumps(chunks, sort_keys=True, ensure_ascii=False).encode("utf-8")
            ).hexdigest()[:12]
            for topic_id, chunks in parts.items()
        }

    def search(self, query: str) -> list[dict[str, Any]]:
        q = query.strip().lower()
        if not q:
            return []

        results: list[dict[str, Any]] = []
        for entry in self.index.lessons:
            hay = f"{entry.get('title','')} {entry.get('subtitle','')} {entry.get('category','')}".lower()
            if q in hay:
                results.append(
                    {
                        "kind": "lesson",
                        "id": entry["id"],
                        "title": entry["title"],
                        "subtitle": entry["subtitle"],
                        "layer": entry["layer"],
                        "status": entry["status"],
                    }
                )

        for entry in self.index.case_studies:
            tags = " ".join(entry.get("tags", []))
            hay = f"{entry.get('title','')} {tags} {entry.get('levelTag','')}".lower()
            if q in hay:
                results.append(
                    {
                        "kind": "case_study",
                        "id": entry["id"],
                        "title": entry["title"],
                        "subtitle": f"Tier {entry['tier']} · {entry['levelTag']} · {', '.join(entry.get('tags', [])[:3])}",
                        "tier": entry["tier"],
                        "status": entry["status"],
                    }
                )

        for pat in self.patterns.patterns:
            hay = f"{pat.name} {pat.category} {pat.summary}".lower()
            if q in hay:
                results.append(
                    {
                        "kind": "pattern",
                        "id": pat.id,
                        "title": pat.name,
                        "subtitle": f"{pat.category} · {pat.summary[:80]}...",
                        "status": "ready",
                    }
                )

        for ch in self.foundations.get("ddiaChapterMap", []):
            hay = f"ch {ch['chapter']} {ch['title']} {' '.join(ch['coreMentalModels'])}".lower()
            if q in hay:
                results.append(
                    {
                        "kind": "ddia",
                        "id": f"ddia-{ch['chapter']}",
                        "title": f"DDIA Ch. {ch['chapter']}: {ch['title']}",
                        "subtitle": ch["part"],
                        "status": "ready",
                    }
                )

        return results[:20]


@lru_cache(maxsize=1)
def get_store() -> CurriculumStore:
    return CurriculumStore()
