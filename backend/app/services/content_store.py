"""In-memory store of compiled v2 topics, study paths and the topic graph."""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

from backend.app.content.compiler import CompiledTopic, compile_all, load_paths
from backend.app.content.schema import StudyPath
from backend.app.content.v1_adapter import adapt_all
from backend.app.services.curriculum_loader import get_store

logger = logging.getLogger("systemcraft.content")


class ContentStore:
    def __init__(self) -> None:
        compiled = compile_all()
        written = {ct.id for ct in compiled if not ct.errors and ct.public}
        # Old v1 lessons and case studies without a rewrite are served as adapted
        # ("Preview") topics, so every path chapter uses the same model and progress.
        compiled += adapt_all(skip=written)
        self.topics: dict[str, CompiledTopic] = {}
        for ct in compiled:
            if ct.errors or not ct.public:
                logger.error("Skipping topic %s: %s", ct.id, "; ".join(ct.errors[:5]))
                continue
            self.topics[ct.id] = ct
        paths, errors = load_paths()
        for e in errors:
            logger.error("Study path error: %s", e)
        self.paths: dict[str, StudyPath] = {p.id: p for p in paths}
        # Adapted v1 topics keep their old, senior-sounding titles; the path's
        # beginner title is what the reader header and lists should show.
        for p in paths:
            for stage in p.stages:
                for entry in stage.chapters:
                    ct = self.topics.get(entry.topic)
                    if ct and ct.public.get("legacy") and "originalTitle" not in ct.public:
                        ct.public["originalTitle"] = ct.public["title"]
                        ct.public["title"] = entry.title
                        if entry.summary:
                            ct.public["summary"] = entry.summary

    def path_version(self, path_id: str) -> str:
        """Content hash of a path, pinned on an enrollment."""
        import hashlib
        import json

        p = self.paths[path_id]
        return hashlib.sha256(json.dumps(p.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()[:12]

    def public(self, topic_id: str) -> dict[str, Any] | None:
        ct = self.topics.get(topic_id)
        return ct.public if ct else None

    def block(self, topic_id: str, block_id: str) -> dict[str, Any] | None:
        pub = self.public(topic_id)
        if not pub:
            return None
        return next((b for b in pub["blocks"] if b["id"] == block_id), None)

    def key(self, topic_id: str, block_id: str) -> dict[str, Any] | None:
        ct = self.topics.get(topic_id)
        return ct.keys.get(block_id) if ct else None

    def summaries(self, track: str) -> list[dict[str, Any]]:
        out = []
        for ct in self.topics.values():
            p = ct.public
            if p["track"] != track:
                continue
            out.append(
                {
                    "id": p["id"],
                    "format": "v2",
                    "track": p["track"],
                    "kind": p["kind"],
                    "template": p["template"],
                    "title": p["title"],
                    "summary": p["summary"],
                    "status": p["status"],
                    "contentVersion": p["contentVersion"],
                    "prerequisites": p.get("prerequisites", []),
                    "sandboxLessonId": p.get("sandboxLessonId"),
                    "legacy": bool(p.get("legacy")),
                    "layers": [
                        {k: layer[k] for k in ("name", "level", "minutes")} | {"blocks": len(layer["blockIds"])}
                        for layer in p["layers"]
                    ],
                    "checkableBlockIds": [b["id"] for b in p["blocks"] if b.get("checkable")],
                    "blockCount": len(p["blocks"]),
                }
            )
        return out

    def v1_summaries(self, track: str) -> list[dict[str, Any]]:
        """Today's v1 lessons and case studies, listed through the same route until they are converted."""
        if track != "hld":
            return []
        store = get_store()
        out = []
        for entry in [*store.index.lessons, *store.index.case_studies]:
            if entry["id"] in self.topics:
                continue
            out.append(
                {
                    "id": entry["id"],
                    "format": "v1",
                    "track": "hld",
                    "kind": "case_study" if "tier" in entry else "concept",
                    "title": entry["title"],
                    "summary": entry.get("subtitle", ""),
                    "status": entry.get("status", "planned"),
                }
            )
        return out

    def graph(self) -> dict[str, Any]:
        nodes = []
        edges = []
        for ct in self.topics.values():
            p = ct.public
            nodes.append({"id": p["id"], "title": p["title"], "format": "v2", "legacy": bool(p.get("legacy")), "status": p["status"]})
            for pre in p.get("prerequisites", []):
                edges.append({"from": pre, "to": p["id"], "kind": "prerequisite"})
            for rel in p.get("related", []):
                edges.append({"from": p["id"], "to": rel, "kind": "related"})
        v1 = get_store()
        ready_v1 = {e["id"]: e for e in [*v1.index.lessons, *v1.index.case_studies]}
        linked = {e["to"] for e in edges if e["kind"] == "related"}
        for tid in sorted(linked - set(self.topics)):
            e = ready_v1.get(tid)
            if e:
                nodes.append({"id": tid, "title": e["title"], "format": "v1", "status": e.get("status", "planned")})
        unlocks: dict[str, list[str]] = {}
        for e in edges:
            if e["kind"] == "prerequisite":
                unlocks.setdefault(e["from"], []).append(e["to"])
        return {"nodes": nodes, "edges": edges, "unlocks": unlocks}


@lru_cache(maxsize=1)
def get_content() -> ContentStore:
    return ContentStore()


def content_version_for(topic_id: str, block_id: str = "") -> str | None:
    """The version a feedback report is filed against. Chapter blocks (``chapter:<id>``) use the v2 topic."""
    pub = get_content().public(topic_id)
    if pub and (block_id.startswith("chapter:") or topic_id not in get_store().content_versions):
        return pub["contentVersion"]
    return get_store().content_versions.get(topic_id)
