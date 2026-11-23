import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, X } from "lucide-react";
import { api, type SearchHit } from "../api/client";
import type { PathChapter } from "../content/types";

const KIND_LABEL: Record<SearchHit["kind"], string> = {
  chapter: "Chapter",
  lesson: "Topic",
  case_study: "Guided design",
  pattern: "Pattern",
  ddia: "Reading notes",
};

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  onSelectHit: (hit: SearchHit) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({ open, onClose, onSelectHit }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [chapters, setChapters] = useState<PathChapter[]>([]);

  // The path is the source of truth for chapter names; the older search index still has the v1 titles.
  useEffect(() => {
    if (!open || chapters.length) return;
    api
      .getPath("start-here")
      .then((p) => setChapters(p.stages.flatMap((s) => s.chapters).filter((c) => c.available)))
      .catch(() => undefined);
  }, [open]);

  const merged = useMemo<SearchHit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const byId = new Map(chapters.map((c) => [c.topicId, c]));
    const words = q.split(/\s+/);
    const chapterHits: SearchHit[] = chapters
      .filter((c) => {
        const hay = `${c.title} ${c.summary ?? ""}`.toLowerCase();
        return words.every((w) => hay.includes(w)) || results.some((r) => r.id === c.topicId);
      })
      .map((c) => ({ kind: "chapter", id: c.topicId, title: `${c.number}. ${c.title}`, subtitle: c.summary ?? "", status: "ready" }));
    // Older hits for a chapter on the path are folded into that chapter.
    return [...chapterHits, ...results.filter((r) => !byId.has(r.id))];
  }, [query, chapters, results]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      api.search(query).then((r) => setResults(r.results));
    }, 120);
    return () => window.clearTimeout(t);
  }, [query, open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(3, 5, 14, 0.72)",
            backdropFilter: "blur(6px)",
            zIndex: 50,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "10vh",
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(640px, 92vw)",
              background: "var(--bg-surface-solid)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              overflow: "hidden",
              boxShadow: "0 24px 70px rgba(0, 0, 0, 0.45), 0 0 28px color-mix(in srgb, var(--accent) 14%, transparent)",
            }}
          >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--border-soft)" }}>
          <Search size={16} color="var(--accent)" />
          <input
            id="global-search-input"
            name="globalSearch"
            aria-label="Search HLD curriculum"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search HLD lessons, Raft, B-Trees, Write Skew, Uber, ChatGPT, RAG..."
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--ink-primary)",
              fontSize: 14,
            }}
          />
          <button className="icon-btn" aria-label="Close search modal" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div style={{ maxHeight: 380, overflow: "auto", padding: 10 }}>
          {query.trim() === "" ? (
            <div className="mono" style={{ padding: 16, fontSize: 12, color: "var(--ink-muted)" }}>
              Try typing: <strong>load balancing</strong>, <strong>caching</strong>, <strong>queues</strong>, <strong>url shortener</strong>...
            </div>
          ) : merged.length === 0 ? (
            <div className="mono" style={{ padding: 16, fontSize: 12, color: "var(--ink-muted)" }}>
              No matching topics found.
            </div>
          ) : (
            merged.map((hit) => (
              <button
                key={`${hit.kind}-${hit.id}`}
                onClick={() => {
                  onSelectHit(hit);
                  onClose();
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 10px",
                  borderRadius: 6,
                  border: "1px solid transparent",
                  background: "transparent",
                  color: "var(--ink-primary)",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-subtle)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div>
                  <div style={{ fontWeight: 650, fontSize: 13.5 }}>{hit.title}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>{hit.subtitle}</div>
                </div>
                <span className={`badge ${hit.status === "ready" ? "badge-accent" : ""}`}>
                  {KIND_LABEL[hit.kind] ?? hit.kind}
                  {hit.status === "planned" ? " · coming soon" : ""}
                </span>
              </button>
            ))
          )}
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
