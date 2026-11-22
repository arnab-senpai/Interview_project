import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  Compass,
  Download,
  Pin,
  Plus,
  Save,
  Search,
  Table2,
  Trash2,
} from "lucide-react";
import { api, type StreakSummary, type StudyNote } from "../api/client";
import { renderMarkdown } from "../utils/markdown";
import { StreakHeatmapCard } from "./StreakHeatmapCard";

interface NotesVaultViewProps {
  streak: StreakSummary | null;
  topicMetaById: Record<string, { title: string; ready: boolean; kind: "lesson" | "case_study" }>;
  onOpenTopic: (topicId: string) => void;
  onDataChanged: () => void;
}

export const NotesVaultView: React.FC<NotesVaultViewProps> = ({
  streak,
  topicMetaById,
  onOpenTopic,
  onDataChanged,
}) => {
  const [notes, setNotes] = useState<StudyNote[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);

  const [title, setTitle] = useState("");
  const [contentMd, setContentMd] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlag, setSavedFlag] = useState(false);

  const loadNotes = async (keepSelection = true) => {
    const res = await api.listNotes();
    setNotes(res.notes);
    if (res.notes.length > 0 && (!keepSelection || !res.notes.some((n) => n.topicId === selectedTopicId))) {
      selectNote(res.notes[0]);
    } else if (res.notes.length === 0) {
      setSelectedTopicId("");
      setTitle("");
      setContentMd("");
      setTagsRaw("");
      setPinned(false);
    }
  };

  const selectNote = (note: StudyNote) => {
    setSelectedTopicId(note.topicId);
    setTitle(note.title);
    setContentMd(note.contentMd);
    setTagsRaw(note.tags.join(", "));
    setPinned(note.pinned);
    setSavedFlag(false);
  };

  useEffect(() => {
    loadNotes(false);
  }, []);

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((n) => {
      if (pinnedOnly && !n.pinned) return false;
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) ||
        n.contentMd.toLowerCase().includes(q) ||
        n.topicId.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [notes, query, pinnedOnly]);

  const handleCreateScratchpad = async () => {
    const newTopicId = `scratch-${Date.now()}`;
    const res = await api.saveNote(newTopicId, {
      title: "Architecture Scratchpad",
      contentMd: "## System Design Scratchpad\n- Problem scope & QPS targets\n- Storage / Partitioning choice\n- Failure modes & mitigations\n",
      tags: ["Scratchpad"],
      pinned: false,
    });
    await loadNotes(false);
    selectNote(res.note);
    onDataChanged();
  };

  const handleSave = async () => {
    if (!selectedTopicId) return;
    setSaving(true);
    try {
      const tags = tagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await api.saveNote(selectedTopicId, {
        title: title || selectedTopicId,
        contentMd,
        tags,
        pinned,
      });
      setNotes((prev) =>
        prev.map((n) => (n.topicId === selectedTopicId ? res.note : n))
      );
      setSavedFlag(true);
      onDataChanged();
      window.setTimeout(() => setSavedFlag(false), 1800);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedTopicId) return;
    await api.deleteNote(selectedTopicId);
    await loadNotes(false);
    onDataChanged();
  };

  const handleDownloadMd = () => {
    if (!selectedTopicId) return;
    const blob = new Blob([`# ${title}\n\n${contentMd}`], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedTopicId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const linkedTopicMeta = selectedTopicId ? topicMetaById[selectedTopicId] : undefined;

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", padding: "16px 20px", gap: 14 }}>
      {/* Top Personal Daily Study Streak Heatmap */}
      <StreakHeatmapCard streak={streak} compact />

      {/* Two-pane Personal Markdown Notes Vault */}
      <div
        className="card"
        style={{
          flex: 1,
          minHeight: 0,
          padding: 0,
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: "300px 1fr",
        }}
      >
        {/* Left Note Index */}
        <aside style={{ borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-soft)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span className="pane-title">MY NOTES ({notes.length})</span>
            <button type="button" className="btn-primary" style={{ padding: "4px 9px", fontSize: 10.5 }} onClick={handleCreateScratchpad}>
              <Plus size={12} /> New Note
            </button>
          </div>

          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-soft)", display: "grid", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 6, background: "var(--bg-subtle)", border: "1px solid var(--border-soft)" }}>
              <Search size={12} color="var(--ink-muted)" />
              <input
                id="notes-vault-search"
                name="notesVaultSearch"
                aria-label="Search study notes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter notes or tags..."
                style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--ink-primary)", fontSize: 12 }}
              />
            </div>
            <div style={{ display: "flex", gap: 5 }}>
              <button type="button" className={!pinnedOnly ? "layer-pill active" : "layer-pill"} onClick={() => setPinnedOnly(false)}>
                ALL
              </button>
              <button type="button" className={pinnedOnly ? "layer-pill active" : "layer-pill"} onClick={() => setPinnedOnly(true)}>
                PINNED
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {filteredNotes.length === 0 ? (
              <div className="mono" style={{ padding: 16, fontSize: 11.5, color: "var(--ink-muted)", lineHeight: 1.5 }}>
                No notes yet. Click <strong>New Note</strong> above or press <strong>Quick Note</strong> inside any Lesson / Case Study.
              </div>
            ) : (
              filteredNotes.map((n) => {
                const isSel = n.topicId === selectedTopicId;
                return (
                  <button
                    key={n.topicId}
                    type="button"
                    onClick={() => selectNote(n)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      border: "none",
                      borderBottom: "1px solid var(--border-soft)",
                      borderLeft: isSel ? "3px solid var(--accent)" : "3px solid transparent",
                      background: isSel ? "var(--bg-active-card)" : "transparent",
                      color: "var(--ink-primary)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                      <span className="mono" style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {n.title}
                      </span>
                      {n.pinned && <Pin size={11} color="var(--accent)" />}
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--ink-muted)", marginTop: 3 }}>
                      {n.updatedAt.slice(0, 10)} · {n.topicId}
                    </div>
                    {n.tags.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>
                        {n.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="badge" style={{ fontSize: 9 }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Right Split-Pane Markdown IDE */}
        {!selectedTopicId ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 32, textAlign: "center" }}>
            <div className="mono" style={{ fontSize: 15, fontWeight: 700 }}>
              Your Personal HLD Markdown Vault
            </div>
            <p style={{ maxWidth: 420, margin: 0, fontSize: 13, color: "var(--ink-secondary)", lineHeight: 1.6 }}>
              Every note you write inside an Explorer lesson or Case Study syncs right here under your active account, alongside custom architecture scratchpads.
            </p>
            <button type="button" className="btn-primary" onClick={handleCreateScratchpad}>
              <Plus size={13} /> Create First Scratchpad
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            {/* Editor Header */}
            <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-soft)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <input
                id="vault-note-title"
                name="vaultNoteTitle"
                aria-label="Note title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 200,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: "var(--ink-primary)",
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  fontSize: 15,
                }}
              />
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {linkedTopicMeta?.ready && (
                  <button type="button" className="btn-secondary" onClick={() => onOpenTopic(selectedTopicId)}>
                    <Compass size={12} /> Open Topic
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    setContentMd((prev) =>
                      prev
                        ? `${prev.trimEnd()}\n\n| Option | Strength | Bottleneck |\n| --- | --- | --- |\n| A | Fast | Memory |\n| B | Durable | Latency |`
                        : `| Option | Strength | Bottleneck |\n| --- | --- | --- |\n| A | Fast | Memory |`
                    )
                  }
                >
                  <Table2 size={12} /> + Table
                </button>
                <button type="button" className={`icon-btn ${pinned ? "active" : ""}`} aria-label="Pin note" onClick={() => setPinned((p) => !p)}>
                  <Pin size={12} />
                </button>
                <button type="button" className="icon-btn" aria-label="Export markdown note" onClick={handleDownloadMd}>
                  <Download size={12} />
                </button>
                <button type="button" className="icon-btn" aria-label="Delete note" onClick={handleDelete} style={{ color: "var(--danger)" }}>
                  <Trash2 size={12} />
                </button>
                <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
                  {savedFlag && !saving ? <Check size={12} /> : <Save size={12} />}
                  {saving ? "Saving..." : savedFlag ? "Saved" : "Save"}
                </button>
              </div>
            </div>

            {/* Tags Bar */}
            <div style={{ padding: "6px 16px", borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", gap: 8, background: "var(--bg-subtle)" }}>
              <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-muted)" }}>TAGS:</span>
              <input
                id="vault-note-tags"
                name="vaultNoteTags"
                aria-label="Note tags"
                value={tagsRaw}
                onChange={(e) => setTagsRaw(e.target.value)}
                placeholder="DDIA, Sharding, Consistency..."
                style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--ink-primary)", fontSize: 12 }}
              />
            </div>

            {/* Split Editor / Live Preview */}
            <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 1fr", overflow: "hidden" }}>
              <textarea
                id="vault-note-editor"
                name="vaultNoteEditor"
                aria-label="Note markdown editor"
                value={contentMd}
                onChange={(e) => setContentMd(e.target.value)}
                style={{
                  width: "100%",
                  height: "100%",
                  resize: "none",
                  border: "none",
                  borderRight: "1px solid var(--border-soft)",
                  outline: "none",
                  padding: 16,
                  background: "transparent",
                  color: "var(--ink-primary)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12.5,
                  lineHeight: 1.62,
                }}
              />
              <div className="hand-notes" style={{ overflowY: "auto", padding: "14px 18px" }}>{renderMarkdown(contentMd)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
