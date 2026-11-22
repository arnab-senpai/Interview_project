import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Calculator,
  CheckCircle2,
  Compass,
  Flame,
  Layers,
  LayoutGrid,
  Play,
} from "lucide-react";
import type {
  CaseStudyIndexItem,
  HldModuleItem,
  LayerMeta,
  LessonIndexItem,
  ProgressSummary,
  StreakDay,
  StreakSummary,
  TopicProgress,
} from "../api/client";
import { truncateText } from "../utils/format";
import { FullRoadmapDrawer, type RoadmapStageDef } from "./FullRoadmapDrawer";
import { RoadmapPath, type PathStop } from "./RoadmapPath";

interface RoadmapViewProps {
  layers: LayerMeta[];
  lessons: LessonIndexItem[];
  caseStudies: CaseStudyIndexItem[];
  modules?: HldModuleItem[];
  progressByTopic: Record<string, TopicProgress>;
  summary: ProgressSummary | null;
  streak?: StreakSummary | null;
  theme?: "light" | "dark";
  onStartLesson: (lessonId: string) => void;
  onOpenCaseStudy: (caseId: string) => void;
  onOpenCapacityLab: () => void;
  onOpenModules?: () => void;
  onOpenPractice: () => void;
}

const STAGES: RoadmapStageDef[] = [
  {
    stage: 1,
    title: "Stage 1 · Foundations, Transport & Storage Internals",
    subtitle: "DNS/CDN physics, SSE/WebSockets/gRPC transport, B-Trees vs LSM-Trees, and MVCC/SSI isolation",
    ddiaRef: "DDIA Ch. 1, 3, 7",
    lessonIds: [
      "dns-and-cdn",
      "realtime-transport-protocols",
      "btrees-vs-lsm-trees",
      "sql-acid-and-isolation",
    ],
  },
  {
    stage: 2,
    title: "Stage 2 · Traffic Control, Caching, Sharding & Locking",
    subtitle: "L4/L7 balancing, atomic rate limits, stampede defense, hashing, hot-key salting & fencing tokens",
    ddiaRef: "DDIA Ch. 6, 8",
    lessonIds: [
      "l7-load-balancer",
      "distributed-rate-limiter",
      "caching-and-stampede",
      "consistent-hashing",
      "sharding-and-hot-keys",
      "distributed-locking-fencing",
    ],
  },
  {
    stage: 3,
    title: "Stage 3 · Consensus, Event Streams, Sagas & AI Infra",
    subtitle: "Raft consensus, Kafka append logs, Outbox + CDC, Sagas, Idempotency & ACL-safe Enterprise RAG",
    ddiaRef: "DDIA Ch. 5, 8, 9, 11, 12",
    lessonIds: [
      "replication-and-consensus",
      "kafka-event-streaming",
      "outbox-and-cdc",
      "schema-evolution-contracts",
      "distributed-transactions-saga",
      "idempotency-and-circuit-breakers",
      "enterprise-rag-pipeline",
    ],
  },
];

const MODULE_VISUALS: Record<number, { shortLabel: string }> = {
  1: { shortLabel: "Foundations" },
  2: { shortLabel: "Storage engines" },
  3: { shortLabel: "Contracts" },
  4: { shortLabel: "Replication" },
  5: { shortLabel: "Consensus" },
  6: { shortLabel: "Streaming & AI" },
};

// Ensures ready lessons/cases outside explicit module links still surface inside natural modules
const SUPPLEMENTAL_MODULE_LESSONS: Record<string, string[]> = {
  "module-1": ["realtime-transport-protocols"],
  "module-2": ["caching-and-stampede"],
  "module-6": ["enterprise-rag-pipeline"],
};

const SUPPLEMENTAL_MODULE_CASES: Record<string, string[]> = {
  "module-4": ["url-shortener"],
  "module-6": ["chatgpt-streaming-assistant"],
};

const HEATMAP_COLORS: Record<StreakDay["level"], string> = {
  0: "var(--bg-subtle)",
  1: "rgba(56, 189, 248, 0.3)",
  2: "rgba(56, 189, 248, 0.58)",
  3: "rgba(52, 211, 153, 0.74)",
  4: "rgba(52, 211, 153, 0.98)",
};

interface EnrichedModuleCluster {
  id: string;
  moduleNumber: number;
  title: string;
  shortLabel: string;
  ddiaSource: string;
  lessonItems: LessonIndexItem[];
  caseItems: CaseStudyIndexItem[];
  completedCount: number;
  status: "completed" | "in_progress" | "not_started";
}

export const RoadmapView: React.FC<RoadmapViewProps> = ({
  lessons,
  caseStudies,
  modules = [],
  progressByTopic,
  summary,
  streak,
  onStartLesson,
  onOpenCaseStudy,
  onOpenCapacityLab,
  onOpenModules,
  onOpenPractice,
}) => {
  const [universeScope, setUniverseScope] = useState<"modules" | "cases">("modules");
  const [fullIndexOpen, setFullIndexOpen] = useState(false);

  const readyLessons = useMemo(
    () => lessons.filter((l) => l.status === "ready"),
    [lessons]
  );
  const readyCases = useMemo(
    () => caseStudies.filter((c) => c.status === "ready"),
    [caseStudies]
  );

  const nextIncompleteLesson = useMemo(
    () => readyLessons.find((l) => progressByTopic[l.id]?.status !== "completed") ?? readyLessons[0] ?? null,
    [readyLessons, progressByTopic]
  );

  const moduleClusters: EnrichedModuleCluster[] = useMemo(() => {
    if (modules.length > 0) {
      return modules.map((mod) => {
        const lessonIds = Array.from(
          new Set([...mod.linkedLessonIds, ...(SUPPLEMENTAL_MODULE_LESSONS[mod.id] ?? [])])
        );
        const caseIds = Array.from(
          new Set([...mod.linkedCaseStudyIds, ...(SUPPLEMENTAL_MODULE_CASES[mod.id] ?? [])])
        );
        const lessonItems = lessonIds
          .map((id) => readyLessons.find((l) => l.id === id))
          .filter((item): item is LessonIndexItem => Boolean(item));
        const caseItems = caseIds
          .map((id) => readyCases.find((c) => c.id === id))
          .filter((item): item is CaseStudyIndexItem => Boolean(item));
        const completedCount = lessonItems.filter(
          (l) => progressByTopic[l.id]?.status === "completed"
        ).length;
        const hasAnyStarted = lessonItems.some((l) => {
          const st = progressByTopic[l.id]?.status;
          return st === "completed" || st === "in_progress";
        });
        const status: EnrichedModuleCluster["status"] =
          lessonItems.length > 0 && completedCount === lessonItems.length
            ? "completed"
            : hasAnyStarted
              ? "in_progress"
              : "not_started";

        const vis = MODULE_VISUALS[mod.moduleNumber];
        return {
          id: mod.id,
          moduleNumber: mod.moduleNumber,
          title: mod.title,
          shortLabel: vis?.shortLabel ?? `Module ${mod.moduleNumber}`,
          ddiaSource: mod.ddiaSources[0] ?? "DDIA Core",
          lessonItems,
          caseItems,
          completedCount,
          status,
        };
      });
    }

    // Fallback grouping directly from STAGES when modules catalog hasn't loaded yet
    return STAGES.map((st) => {
      const lessonItems = st.lessonIds
        .map((id) => readyLessons.find((l) => l.id === id))
        .filter((item): item is LessonIndexItem => Boolean(item));
      const completedCount = lessonItems.filter(
        (l) => progressByTopic[l.id]?.status === "completed"
      ).length;
      const status: EnrichedModuleCluster["status"] =
        lessonItems.length > 0 && completedCount === lessonItems.length
          ? "completed"
          : completedCount > 0
            ? "in_progress"
            : "not_started";
      return {
        id: `stage-${st.stage}`,
        moduleNumber: st.stage,
        title: st.title,
        shortLabel: `Stage ${st.stage}`,
        ddiaSource: st.ddiaRef,
        lessonItems,
        caseItems: [],
        completedCount,
        status,
      };
    });
  }, [modules, readyLessons, readyCases, progressByTopic]);

  const defaultSelectedModuleId = useMemo(() => {
    if (nextIncompleteLesson) {
      const owningMod = moduleClusters.find((m) =>
        m.lessonItems.some((l) => l.id === nextIncompleteLesson.id)
      );
      if (owningMod) return owningMod.id;
    }
    return moduleClusters[0]?.id ?? "";
  }, [moduleClusters, nextIncompleteLesson]);

  const [selectedModuleId, setSelectedModuleId] = useState<string>(defaultSelectedModuleId);
  const [selectedCaseId, setSelectedCaseId] = useState<string>(readyCases[0]?.id ?? "");

  useEffect(() => {
    if (!moduleClusters.some((m) => m.id === selectedModuleId) && defaultSelectedModuleId) {
      setSelectedModuleId(defaultSelectedModuleId);
    }
  }, [moduleClusters, selectedModuleId, defaultSelectedModuleId]);

  useEffect(() => {
    if (!readyCases.some((c) => c.id === selectedCaseId) && readyCases[0]) {
      setSelectedCaseId(readyCases[0].id);
    }
  }, [readyCases, selectedCaseId]);

  // Ordered learning-path stops for the active scope
  const pathStops: PathStop[] = useMemo(() => {
    if (universeScope === "modules") {
      return moduleClusters.map((mod) => ({
        id: mod.id,
        code: String(mod.moduleNumber),
        title: mod.title.replace(/^Module\s+\d+:\s*/i, ""),
        subtitle: `${mod.lessonItems.length} lessons · ${mod.caseItems.length} case ${mod.caseItems.length === 1 ? "study" : "studies"}`,
        status: mod.status,
        done: mod.completedCount,
        total: mod.lessonItems.length,
      }));
    }
    return [...readyCases]
      .sort((a, b) => a.tier - b.tier)
      .map((c) => {
        const prog = progressByTopic[c.id]?.status;
        return {
          id: c.id,
          code: `T${c.tier}`,
          title: c.title,
          subtitle: `${c.levelTag} · ${c.tags.slice(0, 3).join(" · ")}`,
          status: prog === "completed" ? "completed" : prog === "in_progress" ? "in_progress" : "not_started",
          done: prog === "completed" ? 1 : 0,
          total: 0,
          group: `Tier ${c.tier}`,
        } as PathStop;
      });
  }, [universeScope, moduleClusters, readyCases, progressByTopic]);

  const activeModule =
    moduleClusters.find((m) => m.id === selectedModuleId) ?? moduleClusters[0] ?? null;
  const activeCase =
    readyCases.find((c) => c.id === selectedCaseId) ?? readyCases[0] ?? null;

  const moduleRecommendedLesson = useMemo(() => {
    if (!activeModule) return nextIncompleteLesson;
    return (
      activeModule.lessonItems.find((l) => progressByTopic[l.id]?.status !== "completed") ??
      activeModule.lessonItems[0] ??
      nextIncompleteLesson
    );
  }, [activeModule, nextIncompleteLesson, progressByTopic]);

  const completionPct =
    summary && summary.readyLessons > 0
      ? Math.round((summary.completedLessons / summary.readyLessons) * 100)
      : 0;

  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - completionPct / 100);

  const heatmapDays = streak?.heatmap ?? [];
  const quizPct =
    summary && summary.totalQuizzes > 0
      ? Math.round((summary.quizzesCorrect / summary.totalQuizzes) * 100)
      : 0;

  return (
    <div className="roadmap-bento-grid">
      {/* LEFT: learning path */}
      <div
        className="hud-glass-card"
        style={{
          position: "relative",
          minHeight: 360,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="path-header">
          <div>
            <h2 className="section-title">Your learning path</h2>
            <p className="section-sub">
              {universeScope === "modules"
                ? "Six modules, in order. Each builds on the one before."
                : "Interview-style case studies, from warm-up to staff-level."}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div className="hud-segmented hud-glass-pill" style={{ padding: "3px 4px", minHeight: 34 }}>
              <button
                onClick={() => setUniverseScope("modules")}
                className={`hud-seg-btn ${universeScope === "modules" ? "active" : ""}`}
              >
                Modules
              </button>
              <button
                onClick={() => setUniverseScope("cases")}
                className={`hud-seg-btn ${universeScope === "cases" ? "active" : ""}`}
              >
                Case studies · {readyCases.length}
              </button>
            </div>
            <button
              onClick={() => setFullIndexOpen(true)}
              className="hud-glass-pill"
              style={{ fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}
              title="Browse the full catalog, including upcoming LLD and Coding tracks"
            >
              <LayoutGrid size={13} color="var(--accent)" />
              <span>Full index</span>
            </button>
          </div>
        </div>
        <div className="path-scroll">
          <RoadmapPath
            stops={pathStops}
            selectedId={universeScope === "modules" ? selectedModuleId : selectedCaseId}
            onSelect={(id) => {
              if (universeScope === "modules") setSelectedModuleId(id);
              else setSelectedCaseId(id);
            }}
          />
        </div>
      </div>

      {/* RIGHT BENTO COLUMN: 3 Calm Progressive-Disclosure Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
        {/* CARD 1: Selected Module / Case Study Focus Card */}
        <section
          className="hud-glass-card"
          style={{
            flex: 1,
            minHeight: 0,
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {universeScope === "modules" && activeModule ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.05em" }}>
                  MODULE {activeModule.moduleNumber} · {truncateText(activeModule.ddiaSource, 28)}
                </span>
                <span className={`badge ${activeModule.status === "completed" ? "badge-success" : "badge-accent"}`}>
                  {activeModule.completedCount}/{activeModule.lessonItems.length} DONE
                </span>
              </div>

              <h2 className="mono" style={{ margin: 0, fontSize: 16, lineHeight: 1.3 }}>
                {activeModule.title}
              </h2>

              <div style={{ flex: 1, overflowY: "auto", marginTop: 12, display: "flex", flexDirection: "column", gap: 7, paddingRight: 2 }}>
                {activeModule.lessonItems.map((item) => {
                  const isDone = progressByTopic[item.id]?.status === "completed";
                  const isRecommended = moduleRecommendedLesson?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => onStartLesson(item.id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "9px 11px",
                        borderRadius: 10,
                        border: isDone
                          ? "1px solid rgba(52, 211, 153, 0.38)"
                          : isRecommended
                            ? "1px solid rgba(56, 189, 248, 0.45)"
                            : "1px solid var(--border-soft)",
                        background: isRecommended ? "var(--bg-active-card)" : "var(--bg-subtle)",
                        color: "var(--ink-primary)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        transition: "border-color 0.16s ease, transform 0.14s ease",
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          flexShrink: 0,
                          background: isDone ? "var(--success)" : isRecommended ? "var(--accent)" : "var(--border)",
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="mono" style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {item.title}
                        </div>
                        <div className="mono" style={{ fontSize: 10, color: "var(--ink-muted)" }}>
                          Layer {item.layer} · {item.difficulty} · {item.estimatedMinutes}m
                        </div>
                      </div>
                      {isDone ? (
                        <CheckCircle2 size={14} color="var(--success)" />
                      ) : (
                        <ArrowRight size={13} color="var(--accent)" />
                      )}
                    </button>
                  );
                })}

                {activeModule.caseItems.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: "var(--ink-muted)", marginBottom: 6 }}>
                      APPLIED CASE STUDIES
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {activeModule.caseItems.map((cs) => (
                        <button
                          key={cs.id}
                          onClick={() => onOpenCaseStudy(cs.id)}
                          className="hud-dock-btn"
                          style={{ height: 26, fontSize: 10.5 }}
                        >
                          <Layers size={11} color="var(--purple)" />
                          <span>{truncateText(cs.title, 26)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
                {moduleRecommendedLesson && (
                  <button
                    className="btn-primary"
                    style={{ flex: 1 }}
                    onClick={() => onStartLesson(moduleRecommendedLesson.id)}
                  >
                    <Play size={13} />
                    <span>
                      {progressByTopic[moduleRecommendedLesson.id]?.status === "completed"
                        ? `Replay: ${truncateText(moduleRecommendedLesson.title, 20)}`
                        : `Launch: ${truncateText(moduleRecommendedLesson.title, 20)}`}
                    </span>
                  </button>
                )}
                {onOpenModules && (
                  <button className="btn-secondary" onClick={onOpenModules} title="Read full DDIA & Staff rubric blueprint">
                    <Compass size={13} /> Blueprint
                  </button>
                )}
              </div>
            </>
          ) : (
            activeCase && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span className="badge badge-accent">TIER {activeCase.tier} · {activeCase.levelTag}</span>
                  {progressByTopic[activeCase.id]?.status === "completed" && (
                    <span className="badge badge-success"><CheckCircle2 size={10} /> COMPLETED</span>
                  )}
                </div>
                <h2 className="mono" style={{ margin: 0, fontSize: 18, lineHeight: 1.3 }}>
                  {activeCase.title}
                </h2>
                <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-secondary)", margin: "10px 0 12px" }}>
                  Inspect end-to-end functional/NFR contracts, back-of-the-envelope capacity estimates, step-by-step request flows, and a 100-point Staff rubric.
                </p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "auto" }}>
                  {activeCase.tags.map((tag) => (
                    <span key={tag} className="badge">{tag}</span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
                  <button className="btn-primary" style={{ flex: 1 }} onClick={() => onOpenCaseStudy(activeCase.id)}>
                    <Layers size={13} /> Open case study →
                  </button>
                </div>
              </>
            )
          )}
        </section>

        {/* CARD 2: Unified Readiness Ring & Daily Streak Heatmap */}
        <section className="hud-glass-card" style={{ padding: "14px 16px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ position: "relative", width: 52, height: 52, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width={52} height={52} style={{ transform: "rotate(-90deg)" }}>
                  <circle cx={26} cy={26} r={radius} fill="none" stroke="var(--border)" strokeWidth={5} />
                  <circle
                    cx={26}
                    cy={26}
                    r={radius}
                    fill="none"
                    stroke="url(#roadmap-readiness-grad)"
                    strokeWidth={5}
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    style={{ transition: "stroke-dashoffset 0.55s ease" }}
                  />
                  <defs>
                    <linearGradient id="roadmap-readiness-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#38bdf8" />
                      <stop offset="100%" stopColor="#34d399" />
                    </linearGradient>
                  </defs>
                </svg>
                <span className="mono" style={{ position: "absolute", fontSize: 11, fontWeight: 700, color: "var(--accent)" }}>
                  {completionPct}%
                </span>
              </div>

              <div>
                <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-muted)" }}>
                  DAILY READINESS & STREAK
                </div>
                <div className="mono" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, fontSize: 16, fontWeight: 700 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Flame size={15} color="#fbbf24" /> {streak?.currentStreak ?? 0}d
                  </span>
                  <span style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600 }}>
                    Goal {Math.min(streak?.todayActions ?? 0, streak?.dailyGoal ?? 3)}/{streak?.dailyGoal ?? 3}
                  </span>
                </div>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-secondary)", marginTop: 2 }}>
                  {summary?.completedLessons ?? 0}/{summary?.readyLessons ?? readyLessons.length} topologies completed
                </div>
              </div>
            </div>

            {heatmapDays.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridAutoFlow: "column",
                  gridTemplateRows: "repeat(7, 8px)",
                  gap: 2.5,
                  flexShrink: 0,
                }}
                title={`${streak?.activeDays ?? 0} active study days in the last 12 weeks`}
              >
                {heatmapDays.map((day) => (
                  <div
                    key={day.date}
                    title={`${day.date}: ${day.count} actions`}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: HEATMAP_COLORS[day.level],
                      border: "1px solid rgba(148, 163, 184, 0.14)",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* CARD 3: Spaced Practice & Lab Queue */}
        <section className="hud-glass-card" style={{ padding: "14px 16px", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div>
              <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-primary)" }}>
                Spaced Practice Queue
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-muted)", marginTop: 2 }}>
                {summary?.dueFlashcards ?? 25} Due Flashcards · {quizPct}% Quiz Score
              </div>
            </div>
            <button className="btn-primary" style={{ padding: "6px 12px" }} onClick={onOpenPractice}>
              <BookOpen size={12} /> Start Drill
            </button>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-secondary" style={{ flex: 1, fontSize: 10.5 }} onClick={onOpenCapacityLab}>
              <Calculator size={12} /> Capacity Lab
            </button>
            <button className="btn-secondary" style={{ flex: 1, fontSize: 10.5 }} onClick={() => setFullIndexOpen(true)}>
              <LayoutGrid size={12} /> All 30+ Topics
            </button>
          </div>
        </section>
      </div>

      {/* Progressive-Disclosure Catalog Drawer for Stages 1-4 & Future Tracks */}
      <FullRoadmapDrawer
        open={fullIndexOpen}
        stages={STAGES}
        lessons={lessons}
        caseStudies={caseStudies}
        progressByTopic={progressByTopic}
        onClose={() => setFullIndexOpen(false)}
        onStartLesson={onStartLesson}
        onOpenCaseStudy={onOpenCaseStudy}
      />
    </div>
  );
};
