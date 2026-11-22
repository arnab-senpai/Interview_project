import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Download,
  Eye,
  FileText,
  Pin,
  Quote,
  Save,
  SplitSquareHorizontal,
  Table2,
  X,
} from "lucide-react";
import { api } from "../api/client";
import { renderMarkdown } from "../utils/markdown";

interface NotesDrawerProps {
  open: boolean;
  topicId: string;
  topicTitle: string;
  activeStepQuote?: string | null;
  onClose: () => void;
  onNoteSaved?: () => void;
}

export const NotesDrawer: React.FC<NotesDrawerProps> = ({
  open,
  topicId,
  topicTitle,
  activeStepQuote,
  onClose,
  onNoteSaved,
}) => {
  const [title, setTitle] = useState(topicTitle);
  const [contentMd, setContentMd] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [pinned, setPinned] = useState(false);
  const [viewMode, setViewMode] = useState<"split" | "edit" | "preview">("split");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !topicId) return;
    let cancelled = false;
    setLoading(true);
    setSavedAt(null);
    api
      .getNote(topicId)
      .then((res) => {
        if (cancelled) return;
        setTitle(res.exists ? res.note.title : topicTitle);
        setContentMd(res.note.contentMd);
        setTagsRaw((res.note.tags ?? []).join(", "));
        setPinned(Boolean(res.note.pinned));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, topicId, topicTitle]);

  const persist = async (nextTitle = title, nextContent = contentMd, nextTagsRaw = tagsRaw, nextPinned = pinned) => {
    setSaving(true);
    try {
      const tags = nextTagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await api.saveNote(topicId, {
        title: nextTitle || topicTitle,
        contentMd: nextContent,
        tags,
        pinned: nextPinned,
      });
      setSavedAt(res.note.updatedAt);
      onNoteSaved?.();
    } finally {
      setSaving(false);
    }
  };

  const insertSnippet = (snippet: string) => {
    const next = contentMd ? `${contentMd.trimEnd()}\n\n${snippet}` : snippet;
    setContentMd(next);
  };

  const handleDownloadMd = () => {
    const blob = new Blob([`# ${title}\n\n${contentMd}`], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${topicId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 65,
            background: "rgba(3, 5, 14, 0.65)",
            backdropFilter: "blur(6px)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(760px, 95vw)",
              height: "100%",
              background: "var(--bg-surface-solid)",
              borderLeft: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-soft)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)" }}>
                  STUDY NOTEBOOK · {topicId.toUpperCase()}
                </div>
                <input
                  id="drawer-note-title"
                  name="drawerNoteTitle"
                  aria-label="Study note title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  style={{
                    width: "100%",
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: "var(--ink-primary)",
                    fontFamily: "var(--font-mono)",
                    fontWeight: 700,
                    fontSize: 16,
                    marginTop: 2,
                  }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  className={`icon-btn ${pinned ? "active" : ""}`}
                  aria-label="Pin study note"
                  onClick={() => {
                    const next = !pinned;
                    setPinned(next);
                    persist(title, contentMd, tagsRaw, next);
                  }}
                  title="Pin to Notes Vault"
                >
                  <Pin size={13} />
                </button>
                <button type="button" className="icon-btn" aria-label="Download markdown note" onClick={handleDownloadMd} title="Export .md">
                  <Download size={13} />
                </button>
                <button type="button" className="btn-primary" onClick={() => persist()} disabled={saving}>
                  {savedAt && !saving ? <Check size={12} /> : <Save size={12} />}
                  {saving ? "Saving..." : savedAt ? "Saved" : "Save Note"}
                </button>
                <button type="button" className="icon-btn" aria-label="Close study notes drawer" onClick={onClose}>
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Toolbar: View modes, Tags, and Study Templates */}
            <div style={{ padding: "8px 18px", borderBottom: "1px solid var(--border-soft)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", background: "var(--bg-subtle)" }}>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                <button type="button" className={viewMode === "split" ? "layer-pill active" : "layer-pill"} onClick={() => setViewMode("split")}>
                  <SplitSquareHorizontal size={11} style={{ verticalAlign: -1, marginRight: 3 }} /> Split
                </button>
                <button type="button" className={viewMode === "edit" ? "layer-pill active" : "layer-pill"} onClick={() => setViewMode("edit")}>
                  <FileText size={11} style={{ verticalAlign: -1, marginRight: 3 }} /> Write
                </button>
                <button type="button" className={viewMode === "preview" ? "layer-pill active" : "layer-pill"} onClick={() => setViewMode("preview")}>
                  <Eye size={11} style={{ verticalAlign: -1, marginRight: 3 }} /> Preview
                </button>
                {activeStepQuote && (
                  <button type="button" className="btn-secondary" style={{ fontSize: 10.5, padding: "4px 9px" }} onClick={() => insertSnippet(activeStepQuote)}>
                    <Quote size={11} /> Quote Current Hop
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: 10.5, padding: "4px 9px" }}
                  onClick={() =>
                    insertSnippet(
                      `## Trade-Off Matrix\n| Option | Strength | Bottleneck |\n| --- | --- | --- |\n| Primary | High throughput | Watch tail latency |\n| Fallback | Graceful degradation | Stale cache risk |`
                    )
                  }
                >
                  <Table2 size={11} /> + Trade-Off Table
                </button>
              </div>

              <input
                id="drawer-note-tags"
                name="drawerNoteTags"
                aria-label="Comma-separated note tags"
                value={tagsRaw}
                onChange={(e) => setTagsRaw(e.target.value)}
                placeholder="Tags: DDIA Ch.11, WAL, Quorum"
                style={{
                  minWidth: 210,
                  padding: "4px 9px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--bg-surface-solid)",
                  color: "var(--ink-primary)",
                  fontSize: 11.5,
                }}
              />
            </div>

            {/* Editor + Live Preview Body */}
            {loading ? (
              <div className="mono" style={{ padding: 24, color: "var(--ink-muted)" }}>
                Loading notebook...
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  display: "grid",
                  gridTemplateColumns: viewMode === "split" ? "1fr 1fr" : "1fr",
                  overflow: "hidden",
                }}
              >
                {viewMode !== "preview" && (
                  <textarea
                    id="drawer-note-editor"
                    name="drawerNoteEditor"
                    aria-label="Markdown note editor"
                    value={contentMd}
                    onChange={(e) => setContentMd(e.target.value)}
                    placeholder={`## Key Architecture Takeaways\n- Write your first-principles intuition here...\n- Use \`inline code\` or \`\`\`sql code blocks\`\`\``}
                    style={{
                      width: "100%",
                      height: "100%",
                      resize: "none",
                      border: "none",
                      borderRight: viewMode === "split" ? "1px solid var(--border-soft)" : "none",
                      outline: "none",
                      padding: 16,
                      background: "transparent",
                      color: "var(--ink-primary)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12.5,
                      lineHeight: 1.6,
                    }}
                  />
                )}
                {viewMode !== "edit" && (
                  <div className="hand-notes" style={{ overflowY: "auto", padding: "14px 18px" }}>
                    {renderMarkdown(contentMd)}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
