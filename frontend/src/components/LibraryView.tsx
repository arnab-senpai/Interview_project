import React, { useEffect, useMemo, useState } from "react";
import { BookMarked, Compass, Layers, LibraryBig } from "lucide-react";
import { api, type CaseStudyIndexItem, type LessonIndexItem } from "../api/client";
import type { StudyPathResponse } from "../content/types";
import { LIBRARY_TABS, levelLabel } from "../copy";
import type { LibraryTab } from "../router";

interface LibraryViewProps {
  tab: LibraryTab;
  onTab: (tab: LibraryTab) => void;
  lessons: LessonIndexItem[];
  caseStudies: CaseStudyIndexItem[];
  onOpenChapter: (topicId: string) => void;
  onOpenDesign: (id: string) => void;
  /** What to show on the tabs that host an existing screen (guided designs, reading list, playground). */
  children?: React.ReactNode;
}

const TAB_ICONS: Record<LibraryTab, typeof Layers> = {
  topics: LibraryBig,
  designs: Layers,
  reading: BookMarked,
  playground: Compass,
};

type Level = "all" | "Beginner" | "Intermediate" | "Advanced";

interface TopicRow {
  id: string;
  title: string;
  meta: string;
  level: string;
  preview: boolean;
  open: () => void;
}

/** Browse everything once you know your way around. The path on Learn stays the way in for beginners. */
export const LibraryView: React.FC<LibraryViewProps> = ({ tab, onTab, lessons, caseStudies, onOpenChapter, onOpenDesign, children }) => {
  const [path, setPath] = useState<StudyPathResponse | null>(null);
  const [level, setLevel] = useState<Level>("all");

  useEffect(() => {
    if (tab !== "topics") return;
    api.getPath("start-here").then(setPath).catch(() => setPath(null));
  }, [tab]);

  const rows = useMemo<TopicRow[]>(() => {
    const out: TopicRow[] = [];
    const seen = new Set<string>();
    const lessonById = new Map(lessons.map((l) => [l.id, l]));
    for (const stage of path?.stages ?? []) {
      for (const ch of stage.chapters) {
        if (!ch.available) continue;
        seen.add(ch.topicId);
        const lesson = lessonById.get(ch.topicId);
        out.push({
          id: ch.topicId,
          title: ch.title,
          meta: `Chapter ${ch.number}${ch.minutes || lesson ? ` · ${ch.minutes ?? lesson?.estimatedMinutes} min` : ""}`,
          level: levelLabel(lesson?.difficulty) || (ch.number <= 3 ? "Beginner" : "Intermediate"),
          preview: ch.format !== "v2",
          open: () => onOpenChapter(ch.topicId),
        });
      }
    }
    for (const l of lessons) {
      if (seen.has(l.id) || l.status !== "ready") continue;
      out.push({
        id: l.id,
        title: l.title,
        meta: `Topic · ${l.estimatedMinutes} min`,
        level: levelLabel(l.difficulty),
        preview: true,
        open: () => onOpenChapter(l.id),
      });
    }
    return out;
  }, [path, lessons, onOpenChapter]);

  const designs = caseStudies.filter((c) => c.status === "ready");
  const visible = level === "all" ? rows : rows.filter((r) => r.level === level);

  return (
    <div className="library-shell">
      <div className="library-tabs" role="tablist" aria-label="Library sections">
        {(Object.keys(LIBRARY_TABS) as LibraryTab[]).map((t) => {
          const Icon = TAB_ICONS[t];
          return (
            <button key={t} role="tab" aria-selected={tab === t} className="chip-btn" data-active={tab === t} onClick={() => onTab(t)}>
              <Icon size={12} /> {LIBRARY_TABS[t]}
            </button>
          );
        })}
        {tab === "topics" && (
          <label className="library-filter">
            <span>Level</span>
            <select id="library-level" value={level} onChange={(e) => setLevel(e.target.value as Level)}>
              <option value="all">All levels</option>
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
            </select>
          </label>
        )}
      </div>

      {tab === "topics" ? (
        <div className="library-body">
          <p className="library-intro">Every topic, for browsing. If you are new, the path on Learn takes you through them in order.</p>
          <div className="library-grid">
            {visible.map((r) => (
              <button key={r.id} className="library-card" onClick={r.open}>
                <span className="library-card-title">{r.title}</span>
                <span className="library-card-meta">
                  {r.meta}
                  {r.level ? ` · ${r.level}` : ""}
                  {r.preview && <span className="pill-preview">Preview</span>}
                </span>
              </button>
            ))}
            {visible.length === 0 && <div className="library-empty">No topics at this level yet.</div>}
          </div>
        </div>
      ) : tab === "designs" && !children ? (
        <div className="library-body">
          <p className="library-intro">Classic interview designs, worked through step by step.</p>
          <div className="library-grid">
            {designs.map((c) => (
              <button key={c.id} className="library-card" onClick={() => onOpenDesign(c.id)}>
                <span className="library-card-title">{c.title.replace(/^Design (a |an )?/i, "")}</span>
                <span className="library-card-meta">
                  Guided design · {levelLabel(c.levelTag)} <span className="pill-preview">Preview</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="library-host">{children}</div>
      )}
    </div>
  );
};
