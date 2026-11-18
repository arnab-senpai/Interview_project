import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Compass, Layers, Lock, Search, Sparkles, X } from "lucide-react";
import type { CaseStudyIndexItem, LessonIndexItem, TopicProgress } from "../api/client";

export interface RoadmapStageDef {
  stage: number;
  title: string;
  subtitle: string;
  ddiaRef: string;
  lessonIds: string[];
}

interface FullRoadmapDrawerProps {
  open: boolean;
  stages: RoadmapStageDef[];
  lessons: LessonIndexItem[];
  caseStudies: CaseStudyIndexItem[];
  progressByTopic: Record<string, TopicProgress>;
  onClose: () => void;
  onStartLesson: (lessonId: string) => void;
  onOpenCaseStudy: (caseId: string) => void;
}

/**
 * Progressive-disclosure catalog drawer housing the complete 30+ lesson/case-study
 * syllabus and upcoming tracks without cluttering the spatial 3D Bento home screen.
 */
export const FullRoadmapDrawer: React.FC<FullRoadmapDrawerProps> = ({
  open,
  stages,
  lessons,
  caseStudies,
  progressByTopic,
  onClose,
  onStartLesson,
  onOpenCaseStudy,
}) => {
  const [query, setQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState<"all" | "lessons" | "cases">("all");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const normQuery = query.trim().toLowerCase();
  const readyCases = useMemo(
    () =>
      caseStudies.filter(
        (c) =>
          c.status === "ready" &&
          (!normQuery ||
            c.title.toLowerCase().includes(normQuery) ||
            c.tags.some((t) => t.toLowerCase().includes(normQuery)))
      ),
    [caseStudies, normQuery]
  );

  const plannedCasesCount = useMemo(
    () => caseStudies.filter((c) => c.status === "planned").length,
    [caseStudies]
  );

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
            background: "rgba(3, 5, 14, 0.72)",
            backdropFilter: "blur(6px)",
            zIndex: 60,
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
              padding: "22px 24px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--accent)" }}>
                  COMPLETE HLD CURRICULUM CATALOG
                </div>
                <h2 className="mono" style={{ margin: "2px 0 0", fontSize: 18 }}>
                  All Interactive Topologies & Case Studies
                </h2>
              </div>
              <button className="icon-btn" aria-label="Close full roadmap index" onClick={onClose}>
                <X size={15} />
              </button>
            </div>

            {/* Search & Section Filter */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div
                style={{
                  flex: 1,
                  minWidth: 220,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "0 12px",
                  height: 36,
                  borderRadius: 99,
                  border: "1px solid var(--border)",
                  background: "var(--bg-subtle)",
                }}
              >
                <Search size={13} color="var(--ink-muted)" />
                <input
                  id="full-roadmap-search"
                  name="fullRoadmapSearch"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter by topic, DDIA concept, or case study..."
                  style={{
                    flex: 1,
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: "var(--ink-primary)",
                    fontSize: 12.5,
                  }}
                />
              </div>

              <div className="hud-segmented">
                <button
                  onClick={() => setSectionFilter("all")}
                  className={`hud-seg-btn ${sectionFilter === "all" ? "active" : ""}`}
                >
                  All
                </button>
                <button
                  onClick={() => setSectionFilter("lessons")}
                  className={`hud-seg-btn ${sectionFilter === "lessons" ? "active" : ""}`}
                >
                  Stages 1–3
                </button>
                <button
                  onClick={() => setSectionFilter("cases")}
                  className={`hud-seg-btn ${sectionFilter === "cases" ? "active" : ""}`}
                >
                  Case Studies
                </button>
              </div>
            </div>

            {/* Stages 1..3 */}
            {sectionFilter !== "cases" &&
              stages.map((st) => {
                const matched = st.lessonIds
                  .map((lid) => lessons.find((l) => l.id === lid))
                  .filter((l): l is LessonIndexItem => Boolean(l))
                  .filter(
                    (item) =>
                      !normQuery ||
                      item.title.toLowerCase().includes(normQuery) ||
                      item.subtitle.toLowerCase().includes(normQuery)
                  );
                if (matched.length === 0) return null;

                return (
                  <section key={st.stage}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 8 }}>
                      <div>
                        <h3 className="mono" style={{ margin: 0, fontSize: 13.5 }}>{st.title}</h3>
                        <div style={{ fontSize: 11.5, color: "var(--ink-muted)", marginTop: 2 }}>{st.subtitle}</div>
                      </div>
                      <span className="badge badge-purple">{st.ddiaRef}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                      {matched.map((item, idx) => {
                        const isDone = progressByTopic[item.id]?.status === "completed";
                        return (
                          <button
                            key={item.id}
                            onClick={() => {
                              onStartLesson(item.id);
                              onClose();
                            }}
                            className="card card-interactive"
                            style={{
                              textAlign: "left",
                              cursor: "pointer",
                              padding: 12,
                              display: "flex",
                              flexDirection: "column",
                              justifyContent: "space-between",
                              gap: 8,
                              borderColor: isDone ? "var(--success)" : undefined,
                            }}
                          >
                            <div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)" }}>
                                  STEP {st.stage}.{idx + 1} · L{item.layer}
                                </span>
                                {isDone ? (
                                  <span className="badge badge-success">
                                    <CheckCircle2 size={10} /> DONE
                                  </span>
                                ) : (
                                  <span className="badge">{item.difficulty}</span>
                                )}
                              </div>
                              <div className="mono" style={{ fontWeight: 700, fontSize: 12.5, marginTop: 5, color: "var(--ink-primary)" }}>
                                {item.title}
                              </div>
                              <div style={{ fontSize: 11.5, color: "var(--ink-secondary)", marginTop: 3 }}>
                                {item.subtitle}
                              </div>
                            </div>
                            <div className="mono" style={{ fontSize: 10.5, color: "var(--accent)", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                              <Compass size={11} /> Launch 3D Lab <ArrowRight size={11} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}

            {/* Stage 4 Case Studies */}
            {sectionFilter !== "lessons" && readyCases.length > 0 && (
              <section>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <h3 className="mono" style={{ margin: 0, fontSize: 13.5 }}>
                    Stage 4 · End-to-End Interview Case Studies (Tiers 1–5)
                  </h3>
                  <span className="badge badge-accent">
                    {readyCases.length} INTERACTIVE · {plannedCasesCount} PLANNED
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(215px, 1fr))", gap: 10 }}>
                  {readyCases.map((cs) => {
                    const isDone = progressByTopic[cs.id]?.status === "completed";
                    return (
                      <button
                        key={cs.id}
                        onClick={() => {
                          onOpenCaseStudy(cs.id);
                          onClose();
                        }}
                        className="card card-interactive"
                        style={{
                          textAlign: "left",
                          cursor: "pointer",
                          padding: 12,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                          gap: 8,
                          borderColor: isDone ? "var(--success)" : undefined,
                        }}
                      >
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span className="badge badge-accent">TIER {cs.tier} · {cs.levelTag}</span>
                            {isDone && <CheckCircle2 size={12} color="var(--success)" />}
                          </div>
                          <div className="mono" style={{ fontWeight: 700, fontSize: 12.5, marginTop: 6, color: "var(--ink-primary)" }}>
                            {cs.title}
                          </div>
                        </div>
                        <div className="mono" style={{ fontSize: 10.5, color: "var(--accent)", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                          <Layers size={11} /> Open Case Study <ArrowRight size={11} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Track 2 & 3 Future Roadmap Preview */}
            <section className="card" style={{ background: "var(--bg-subtle)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                  <Lock size={11} /> TRACK 2 · LOW-LEVEL DESIGN
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-secondary)", marginTop: 4 }}>
                  SOLID Refactoring Sandboxes, Interactive UML Class Diagrams & Machine Coding.
                </div>
              </div>
              <div>
                <div className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                  <Sparkles size={11} /> TRACK 3 & LOCAL AI MENTOR
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-secondary)", marginTop: 4 }}>
                  DSA Pattern Tracks + Grounded Self-Hosted SLM Mentor on this curriculum.
                </div>
              </div>
            </section>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
