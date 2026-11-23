import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Flame,
  HelpCircle,
  Lightbulb,
  Minimize2,
  NotebookPen,
  PanelRightOpen,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  X,
} from "lucide-react";
import { ReportIssueButton } from "./ReportIssueButton";
import type { HldModuleItem, LessonIndexItem, TopicProgress } from "../api/client";
import type { HldExplorerLesson, TraceStep } from "../types/hld";
import { renderInlineCode, truncateText } from "../utils/format";
import { TARGET_UTILIZATION, computeTopologyTelemetry, formatCompactRps } from "../utils/telemetry";
import { DeepDiveDrawer } from "./DeepDiveDrawer";
import { IsometricCanvas, type PlaybackState } from "./IsometricCanvas";
import { NotesDrawer } from "./NotesDrawer";
import { TraceWaterfallDrawer } from "./TraceWaterfallDrawer";

interface ExplorerWorkspaceProps {
  lessonsIndex: LessonIndexItem[];
  selectedLayer: number | null;
  activeLessonId: string;
  activeLesson: HldExplorerLesson | null;
  linkedModule?: HldModuleItem | null;
  loadingLesson: boolean;
  progressByTopic: Record<string, TopicProgress>;
  theme?: "light" | "dark";
  showLeftPane?: boolean;
  showRightPane?: boolean;
  showBottomPane?: boolean;
  onToggleLeftPane?: () => void;
  onSelectLayer?: (layer: number | null) => void;
  onSelectLesson: (lessonId: string) => void;
  onUpdateProgress: (
    topicId: string,
    payload: {
      kind: "lesson" | "case_study";
      status: "not_started" | "in_progress" | "completed";
      completedSteps: number[];
      activeLens: "intuition" | "mechanics" | "staffTradeoffs";
    }
  ) => void;
  onJumpToPractice: (topicId: string) => void;
  onNoteSaved?: () => void;
  standaloneMode?: boolean;
}

const FILTER_TABS = [
  { key: "all", label: "ALL" },
  { key: "core", label: "CORE" },
  { key: "patterns_ai", label: "PATTERNS & AI" },
] as const;

const LENS_META = [
  { key: "intuition", label: "Analogy" },
  { key: "mechanics", label: "Mechanics" },
  { key: "staffTradeoffs", label: "Staff" },
] as const;

const SPEED_OPTIONS = [0.5, 1, 2] as const;

/**
 * Full-bleed architecture lab with frosted glass HUD controls,
 * live QPS-reactive Three.js particle physics, and progressive-disclosure drawers.
 */
export const ExplorerWorkspace: React.FC<ExplorerWorkspaceProps> = ({
  lessonsIndex,
  selectedLayer,
  activeLessonId,
  activeLesson,
  linkedModule = null,
  loadingLesson,
  progressByTopic,
  showLeftPane = false,
  showRightPane = true,
  showBottomPane = true,
  onToggleLeftPane,
  onSelectLayer,
  onSelectLesson,
  onUpdateProgress,
  onJumpToPractice,
  onNoteSaved,
  standaloneMode = true,
}) => {
  const [catFilter, setCatFilter] = useState<"all" | "core" | "patterns_ai">("all");
  const [showPlanned, setShowPlanned] = useState(false);
  const [viewMode, setViewMode] = useState<"iso" | "sequence">("iso");
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [activeStepIdx, setActiveStepIdx] = useState<number>(-1);
  const [flightProgress, setFlightProgress] = useState<number>(0);
  const [singleShotTarget, setSingleShotTarget] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(1);
  const [chaosId, setChaosId] = useState<string | null>(null);
  // Illustrative inputs for the Sandbox: the learner sets ingress and cache hit rate.
  // (Before the Phase 1 audit fix, ingress was derived from node capacities and
  // every lesson showed 48% utilisation.)
  const [ingressRps, setIngressRps] = useState<number>(5_000);
  const [cacheHitRate, setCacheHitRate] = useState<number>(0.9);

  const [internalLeftOpen, setInternalLeftOpen] = useState<boolean>(false);
  const [rightCardCollapsed, setRightCardCollapsed] = useState<boolean>(false);
  const [traceDrawerOpen, setTraceDrawerOpen] = useState<boolean>(false);
  const [chaosMenuOpen, setChaosMenuOpen] = useState<boolean>(false);
  const [telemetryOpen, setTelemetryOpen] = useState<boolean>(false);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [rightInspectNode, setRightInspectNode] = useState<boolean>(false);
  const [inspectedPacketIdx, setInspectedPacketIdx] = useState<number | null>(null);
  const [deepReadOpen, setDeepReadOpen] = useState<boolean>(false);
  const [notesOpen, setNotesOpen] = useState<boolean>(false);

  const [lens, setLens] = useState<"intuition" | "mechanics" | "staffTradeoffs">("intuition");
  const [revealedPredicts, setRevealedPredicts] = useState<Record<string, boolean>>({});
  const [showHint, setShowHint] = useState<Record<string, boolean>>({});

  const rafRef = useRef<number | null>(null);
  const progressRef = useRef<number>(0);
  progressRef.current = flightProgress;
  const lastTickRef = useRef<number | null>(null);

  const isLeftDrawerOpen = onToggleLeftPane ? showLeftPane : internalLeftOpen;
  const toggleLeftDrawer = () => {
    setChaosMenuOpen(false);
    setTelemetryOpen(false);
    if (onToggleLeftPane) onToggleLeftPane();
    else setInternalLeftOpen((p) => !p);
  };

  const activeChaos = useMemo(
    () => activeLesson?.chaosScenarios.find((c) => c.id === chaosId) ?? null,
    [activeLesson, chaosId]
  );

  const steps: TraceStep[] = useMemo(
    () => (activeChaos ? activeChaos.steps : activeLesson?.steps ?? []),
    [activeChaos, activeLesson]
  );

  // Reset cleanly when switching topic or chaos fault
  useEffect(() => {
    setPlaybackState("idle");
    setActiveStepIdx(-1);
    setFlightProgress(0);
    setSingleShotTarget(false);
    setSelectedNodeId(null);
    setRightInspectNode(false);
    setInspectedPacketIdx(null);
    setDeepReadOpen(false);
    setChaosMenuOpen(false);
    setTelemetryOpen(false);
    setRevealedPredicts({});
    setShowHint({});
    const saved = activeLesson ? progressByTopic[activeLesson.id] : undefined;
    if (saved?.activeLens) setLens(saved.activeLens);
  }, [activeLesson?.id, chaosId]);

  const markLessonProgress = (stepIdx: number) => {
    if (!activeLesson || !standaloneMode || chaosId) return;
    const prev = progressByTopic[activeLesson.id];
    const nextSteps = Array.from(new Set([...(prev?.completedSteps ?? []), stepIdx + 1]));
    const allDone = nextSteps.length >= activeLesson.steps.length;
    onUpdateProgress(activeLesson.id, {
      kind: "lesson",
      status: allDone ? "completed" : "in_progress",
      completedSteps: nextSteps,
      activeLens: lens,
    });
  };

  // Synchronized RAF packet flight loop
  useEffect(() => {
    const isAnimating =
      playbackState === "playing" || (playbackState === "paused" && singleShotTarget);

    if (!isAnimating || steps.length === 0 || activeStepIdx < 0) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTickRef.current = null;
      return;
    }

    const stepDurationMs = 1250 / speed;

    // Side effects live in the tick itself, never inside a state updater: React
    // StrictMode double-invokes updaters, which previously spawned an extra RAF
    // loop every frame (playback crawled) and double-counted progress events.
    const tick = (now: number) => {
      if (lastTickRef.current === null) {
        lastTickRef.current = now;
      }
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;

      const next = progressRef.current + dt / stepDurationMs;
      if (next < 1) {
        progressRef.current = next;
        setFlightProgress(next);
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      rafRef.current = null;
      markLessonProgress(activeStepIdx);

      if (singleShotTarget && playbackState === "paused") {
        progressRef.current = 1;
        setFlightProgress(1);
        setSingleShotTarget(false);
        if (activeStepIdx >= steps.length - 1) {
          setPlaybackState("completed");
        }
        return;
      }

      if (activeStepIdx < steps.length - 1) {
        // The effect re-runs on the new step index and starts the next hop.
        progressRef.current = 0;
        setFlightProgress(0);
        setActiveStepIdx(activeStepIdx + 1);
      } else {
        progressRef.current = 1;
        setFlightProgress(1);
        setPlaybackState("completed");
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTickRef.current = null;
    };
  }, [playbackState, singleShotTarget, activeStepIdx, speed, steps.length]);

  const handlePlayPause = () => {
    if (steps.length === 0) return;
    setSingleShotTarget(false);
    if (playbackState === "playing") {
      setPlaybackState("paused");
      return;
    }
    if (playbackState === "idle" || playbackState === "completed") {
      setActiveStepIdx(0);
      setFlightProgress(0);
    } else if (flightProgress >= 1) {
      if (activeStepIdx < steps.length - 1) {
        setActiveStepIdx((i) => i + 1);
        setFlightProgress(0);
      } else {
        setActiveStepIdx(0);
        setFlightProgress(0);
      }
    }
    setRightInspectNode(false);
    setPlaybackState("playing");
  };

  const handleStepForward = () => {
    if (steps.length === 0 || playbackState === "completed") return;
    setRightInspectNode(false);
    if (playbackState === "idle" || activeStepIdx < 0) {
      setActiveStepIdx(0);
      setFlightProgress(0);
      setPlaybackState("paused");
      setSingleShotTarget(true);
      return;
    }
    if (activeStepIdx < steps.length - 1) {
      setActiveStepIdx((i) => i + 1);
      setFlightProgress(0);
      setPlaybackState("paused");
      setSingleShotTarget(true);
    }
  };

  const handlePrevStep = () => {
    if (activeStepIdx <= 0) return;
    setActiveStepIdx((i) => Math.max(0, i - 1));
    setFlightProgress(0);
    setSingleShotTarget(false);
    setPlaybackState("playing");
  };

  const handleReset = () => {
    setPlaybackState("idle");
    setActiveStepIdx(-1);
    setFlightProgress(0);
    setSingleShotTarget(false);
    setRightInspectNode(false);
    setInspectedPacketIdx(null);
  };

  const handleJumpToStep = (idx: number) => {
    setActiveStepIdx(idx);
    setFlightProgress(1);
    setSingleShotTarget(false);
    setPlaybackState(idx >= steps.length - 1 ? "completed" : "paused");
    setRightInspectNode(false);
    markLessonProgress(idx);
  };

  const cycleSpeed = () => {
    const idx = SPEED_OPTIONS.indexOf(speed as (typeof SPEED_OPTIONS)[number]);
    setSpeed(SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length]);
  };

  // Keep latest handlers in a ref so the window keydown listener binds once cleanly
  const keyActionRef = useRef({
    standaloneMode,
    notesOpen,
    deepReadOpen,
    traceDrawerOpen,
    chaosMenuOpen,
    telemetryOpen,
    handlePlayPause,
    handleStepForward,
    handlePrevStep,
    handleReset,
  });
  keyActionRef.current = {
    standaloneMode,
    notesOpen,
    deepReadOpen,
    traceDrawerOpen,
    chaosMenuOpen,
    telemetryOpen,
    handlePlayPause,
    handleStepForward,
    handlePrevStep,
    handleReset,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const cur = keyActionRef.current;
      if (e.code === "Space") {
        e.preventDefault();
        cur.handlePlayPause();
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        cur.handleStepForward();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        cur.handlePrevStep();
      } else if (e.key.toLowerCase() === "n" && cur.standaloneMode) {
        e.preventDefault();
        setNotesOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        if (cur.notesOpen) setNotesOpen(false);
        else if (cur.deepReadOpen) setDeepReadOpen(false);
        else if (cur.chaosMenuOpen || cur.telemetryOpen) {
          setChaosMenuOpen(false);
          setTelemetryOpen(false);
        } else if (cur.traceDrawerOpen) setTraceDrawerOpen(false);
        else cur.handleReset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const readyLessons = useMemo(
    () =>
      lessonsIndex.filter((l) => {
        if (l.status !== "ready") return false;
        if (selectedLayer !== null && l.layer !== selectedLayer) return false;
        if (catFilter === "core") return l.category === "foundations" || l.category === "building-blocks";
        if (catFilter === "patterns_ai") return l.category === "patterns" || l.category === "ai-infra";
        return true;
      }),
    [lessonsIndex, selectedLayer, catFilter]
  );

  const plannedLessons = useMemo(
    () =>
      lessonsIndex.filter((l) => {
        if (l.status !== "planned") return false;
        if (selectedLayer !== null && l.layer !== selectedLayer) return false;
        return true;
      }),
    [lessonsIndex, selectedLayer]
  );

  const allReadyOrdered = useMemo(
    () => lessonsIndex.filter((l) => l.status === "ready"),
    [lessonsIndex]
  );
  const currentLessonOrderIdx = allReadyOrdered.findIndex((l) => l.id === activeLessonId);
  const prevLesson = currentLessonOrderIdx > 0 ? allReadyOrdered[currentLessonOrderIdx - 1] : null;
  const nextLesson =
    currentLessonOrderIdx >= 0 && currentLessonOrderIdx < allReadyOrdered.length - 1
      ? allReadyOrdered[currentLessonOrderIdx + 1]
      : null;

  const visibleTraceRows = useMemo(() => {
    if (playbackState === "idle") return steps;
    if (activeStepIdx < 0) return [];
    return steps.slice(0, activeStepIdx + 1);
  }, [playbackState, steps, activeStepIdx]);

  const currentStep = activeStepIdx >= 0 ? steps[activeStepIdx] ?? null : null;
  const selectedNode = useMemo(
    () => activeLesson?.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [activeLesson, selectedNodeId]
  );

  const nodeLabel = (id: string) => activeLesson?.nodes.find((n) => n.id === id)?.label ?? id;
  const totalLatencyMs = useMemo(
    () => steps.reduce((acc, s) => acc + s.latencyDeltaMs, 0),
    [steps]
  );

  const telemetry = useMemo(
    () =>
      computeTopologyTelemetry(
        activeLesson?.nodes ?? [],
        activeLesson?.edges ?? [],
        steps,
        ingressRps,
        cacheHitRate,
        activeChaos?.targetNodeId ?? null
      ),
    [activeLesson?.nodes, activeLesson?.edges, steps, ingressRps, cacheHitRate, activeChaos?.targetNodeId]
  );

  const handleLensChange = (nextLens: "intuition" | "mechanics" | "staffTradeoffs") => {
    setLens(nextLens);
    if (activeLesson && standaloneMode) {
      const prev = progressByTopic[activeLesson.id];
      onUpdateProgress(activeLesson.id, {
        kind: "lesson",
        status: prev?.status ?? "in_progress",
        completedSteps: prev?.completedSteps ?? [],
        activeLens: nextLens,
      });
    }
  };

  const predictKey = currentStep ? `${activeLesson?.id}-${chaosId ?? "normal"}-${currentStep.stepNo}` : "";
  const effectiveRightCardVisible = Boolean(showRightPane && !rightCardCollapsed && activeLesson);
  const effectiveTraceOpen = Boolean(showBottomPane && traceDrawerOpen);

  const tierColor =
    telemetry.healthTier === "fault" || telemetry.healthTier === "saturated"
      ? "var(--danger)"
      : telemetry.healthTier === "warm"
        ? "var(--warn)"
        : "var(--success)";

  const breadcrumbPrefix = linkedModule
    ? `Module ${linkedModule.moduleNumber}`
    : activeLesson
      ? `Layer ${activeLesson.layer}`
      : "Topology";

  const activeNodeUtil = selectedNode ? telemetry.nodeUtilization[selectedNode.id] : undefined;
  const activeNodeUtilPct = activeNodeUtil === undefined ? null : Math.round(activeNodeUtil * 100);

  return (
    <div className="spatial-lab-shell">
      {/* LAYER 0: diagram or sequence stage */}
      <div
        style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}
        onClick={() => {
          if (chaosMenuOpen) setChaosMenuOpen(false);
          if (telemetryOpen) setTelemetryOpen(false);
        }}
      >
        {loadingLesson || !activeLesson ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }} className="mono">
            Loading lesson…
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              paddingTop: 64,
              paddingBottom: effectiveTraceOpen ? 290 : 88,
              paddingLeft: 16,
              paddingRight: effectiveRightCardVisible ? 356 : 16,
              overflow: "hidden",
            }}
            className="blueprint-grid"
          >
            <IsometricCanvas
              nodes={activeLesson.nodes}
              edges={activeLesson.edges}
              steps={steps}
              activeStepIndex={activeStepIdx}
              playbackState={playbackState}
              flightProgress={flightProgress}
              selectedNodeId={selectedNodeId}
              faultNodeId={activeChaos?.targetNodeId ?? null}
              viewMode={viewMode === "iso" ? "network" : "sequence"}
              nodeUtilization={telemetry.nodeUtilization}
              onSelectNode={(nid) => {
                setSelectedNodeId(nid);
                setRightInspectNode(true);
                setRightCardCollapsed(false);
              }}
              onSelectStep={handleJumpToStep}
            />
          </div>
        )}
      </div>

      {/* FLOATING TOP BAR CLUSTERS (Top-Left Breadcrumb & Chaos | Top-Right Telemetry & Quick Note) */}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 16,
          right: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 10,
          flexWrap: "wrap",
          pointerEvents: "none",
          zIndex: 25,
        }}
      >
        {/* TOP-LEFT: Breadcrumb Capsule + Chaos Fault Pill + view switcher */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", pointerEvents: "auto", position: "relative" }}>
          <div className="hud-glass-pill" style={{ paddingRight: standaloneMode ? 8 : 13 }}>
            <button
              onClick={toggleLeftDrawer}
              className="mono"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "transparent",
                border: "none",
                color: "inherit",
                fontSize: 11.5,
                fontWeight: 700,
                cursor: "pointer",
                padding: 0,
              }}
              title="Browse lessons & hop timeline (L)"
            >
              <span style={{ color: "var(--accent)" }}>{breadcrumbPrefix}</span>
              <span style={{ opacity: 0.45 }}>/</span>
              <span>{truncateText(activeLesson?.title ?? "Loading...", 28)}</span>
              <ChevronDown
                size={13}
                style={{
                  transform: isLeftDrawerOpen ? "rotate(180deg)" : "none",
                  transition: "transform 0.18s ease",
                  opacity: 0.8,
                }}
              />
            </button>

            {standaloneMode && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 2, marginLeft: 4, paddingLeft: 6, borderLeft: "1px solid var(--border-soft)" }}>
                <button
                  onClick={() => prevLesson && onSelectLesson(prevLesson.id)}
                  disabled={!prevLesson}
                  className="hud-dock-btn"
                  style={{ width: 24, height: 24, padding: 0 }}
                  title={prevLesson ? `Previous: ${prevLesson.title}` : "First topic"}
                  aria-label="Previous lesson"
                >
                  <ArrowLeft size={11} />
                </button>
                <button
                  onClick={() => nextLesson && onSelectLesson(nextLesson.id)}
                  disabled={!nextLesson}
                  className="hud-dock-btn"
                  style={{ width: 24, height: 24, padding: 0 }}
                  title={nextLesson ? `Next: ${nextLesson.title}` : "Last topic"}
                  aria-label="Next lesson"
                >
                  <ArrowRight size={11} />
                </button>
              </div>
            )}
          </div>

          {/* Chaos Fault Toggle Capsule */}
          {activeLesson && (
            <div style={{ position: "relative" }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setTelemetryOpen(false);
                  setChaosMenuOpen((p) => !p);
                }}
                className={`hud-glass-pill mono ${activeChaos ? "active" : ""}`}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  borderColor: activeChaos ? "color-mix(in srgb, var(--danger) 72%, transparent)" : undefined,
                  color: activeChaos ? "var(--danger)" : undefined,
                }}
                title="Inject distributed systems chaos scenarios"
              >
                {activeChaos ? (
                  <>
                    <Flame size={13} color="var(--danger)" />
                    <span>Chaos: {truncateText(activeChaos.title.split("(")[0].trim(), 20)}</span>
                  </>
                ) : (
                  <>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--success)", boxShadow: "none" }} />
                    <span>Steady State</span>
                  </>
                )}
                <ChevronDown size={12} style={{ opacity: 0.75 }} />
              </button>

              <AnimatePresence>
                {chaosMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.14 }}
                    className="hud-popover"
                    style={{
                      position: "absolute",
                      top: 42,
                      left: 0,
                      width: 284,
                      padding: 6,
                      zIndex: 40,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => {
                        setChaosId(null);
                        setChaosMenuOpen(false);
                      }}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 10px",
                        borderRadius: 9,
                        border: "none",
                        background: !chaosId ? "var(--accent-soft)" : "transparent",
                        color: !chaosId ? "var(--accent)" : "var(--ink-primary)",
                        fontSize: 11.5,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                      className="mono"
                    >
                      <CheckCircle2 size={13} />
                      <span>Steady State (Happy Path)</span>
                    </button>

                    {activeLesson.chaosScenarios.map((cs) => (
                      <button
                        key={cs.id}
                        onClick={() => {
                          setChaosId(cs.id);
                          setChaosMenuOpen(false);
                        }}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                          padding: "8px 10px",
                          borderRadius: 9,
                          border: "none",
                          marginTop: 2,
                          background: chaosId === cs.id ? "var(--danger-bg)" : "transparent",
                          color: chaosId === cs.id ? "var(--danger)" : "var(--ink-primary)",
                          fontSize: 11.5,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                        className="mono"
                      >
                        <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} color="var(--danger)" />
                        <span>{cs.title}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Diagram / Sequence view switcher */}
          <div className="hud-segmented hud-glass-pill" style={{ padding: "3px 4px", minHeight: 34 }}>
            <button
              onClick={() => setViewMode("iso")}
              className={`hud-seg-btn ${viewMode === "iso" ? "active" : ""}`}
            >
              Diagram
            </button>
            <button
              onClick={() => setViewMode("sequence")}
              className={`hud-seg-btn ${viewMode === "sequence" ? "active" : ""}`}
            >
              Sequence
            </button>
          </div>
        </div>

        {/* TOP-RIGHT: Live Telemetry Readout Pill + Quick Note + Inspector Restore */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", pointerEvents: "auto", position: "relative" }}>
          <div style={{ position: "relative" }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setChaosMenuOpen(false);
                setTelemetryOpen((p) => !p);
              }}
              className="hud-glass-pill mono"
              style={{ fontSize: 11, fontWeight: 600, cursor: "pointer" }}
              title="Click for per-node saturation & bottleneck analysis"
            >
              <span className="telemetry-bars" aria-hidden="true">
                {[0.38, 0.56, 0.72, 0.88, 1].map((lvl, idx) => {
                  const activeBar = telemetry.bottleneckUtilization >= idx * 0.25;
                  const h = 4 + idx * 2;
                  return (
                    <span
                      key={lvl}
                      className="telemetry-bar"
                      style={{
                        height: h,
                        backgroundColor: activeBar ? tierColor : "var(--border)",
                        opacity: activeBar ? 1 : 0.45,
                      }}
                    />
                  );
                })}
              </span>
              <span>
                Ingress: <strong>{formatCompactRps(telemetry.ingressRps)} req/s</strong>
              </span>
              <span style={{ opacity: 0.4 }}>|</span>
              <span style={{ color: tierColor }}>
                Busiest: <strong>{Math.round(telemetry.bottleneckUtilization * 100)}%</strong>
              </span>
            </button>

            <AnimatePresence>
              {telemetryOpen && activeLesson && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.14 }}
                  className="hud-popover"
                  style={{
                    position: "absolute",
                    top: 42,
                    right: 0,
                    width: 280,
                    padding: 12,
                    zIndex: 40,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: tierColor, marginBottom: 6 }}>
                    SANDBOX LOAD ({telemetry.healthTier.toUpperCase()})
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-muted)", marginBottom: 8, lineHeight: 1.45 }}>
                    Illustrative: you set the ingress and the cache hit rate. Caches and CDNs pass on only their misses.
                  </div>
                  <label className="mono" style={{ fontSize: 9.5, color: "var(--ink-muted)", display: "block" }}>
                    CACHE / CDN HIT RATE · {Math.round(cacheHitRate * 100)}%
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={0.99}
                    step={0.01}
                    value={cacheHitRate}
                    onChange={(e) => setCacheHitRate(Number(e.target.value))}
                    aria-label="Cache and CDN hit rate"
                    style={{ width: "100%", marginBottom: 10 }}
                  />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11.5, marginBottom: 10 }}>
                    <div style={{ padding: "6px 8px", borderRadius: 8, background: "var(--bg-subtle)" }}>
                      <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-muted)" }}>TRACE LATENCY</div>
                      <div className="mono" style={{ fontWeight: 700 }}>{telemetry.traceLatencyMs} ms</div>
                      <div style={{ fontSize: 9.5, color: "var(--ink-muted)" }}>one request, this trace</div>
                    </div>
                    <div style={{ padding: "6px 8px", borderRadius: 8, background: "var(--bg-subtle)" }}>
                      <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-muted)" }}>BUSIEST PART</div>
                      <div className="mono" style={{ fontWeight: 700, color: tierColor }}>
                        {Math.round(telemetry.bottleneckUtilization * 100)}%
                      </div>
                      <div style={{ fontSize: 9.5, color: "var(--ink-muted)" }}>of one instance; target {Math.round(TARGET_UTILIZATION * 100)}%</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-secondary)", marginBottom: 8 }}>
                    Busiest part: <strong className="mono">{telemetry.bottleneckLabel}</strong>
                    {telemetry.bottleneckNodeId && (
                      <> at {formatCompactRps(telemetry.nodeRps[telemetry.bottleneckNodeId] ?? 0)} req/s</>
                    )}
                  </div>
                  {telemetry.bottleneckNodeId && (
                    <button
                      className="btn-secondary"
                      style={{ width: "100%", fontSize: 10.5 }}
                      onClick={() => {
                        setSelectedNodeId(telemetry.bottleneckNodeId);
                        setRightInspectNode(true);
                        setRightCardCollapsed(false);
                        setTelemetryOpen(false);
                      }}
                    >
                      Inspect the busiest part <ArrowRight size={11} />
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {standaloneMode && (
            <button
              onClick={() => setNotesOpen(true)}
              className="hud-glass-pill mono"
              title="Open Study Notes for this topic (N)"
              style={{ fontSize: 11, fontWeight: 600, cursor: "pointer" }}
            >
              <NotebookPen size={13} color="var(--accent)" />
              <span>Quick Note (N)</span>
            </button>
          )}

          {showRightPane && rightCardCollapsed && (
            <button
              onClick={() => setRightCardCollapsed(false)}
              className="hud-glass-pill mono"
              title="Show contextual inspector card"
              style={{ fontSize: 11, fontWeight: 600, cursor: "pointer" }}
            >
              <PanelRightOpen size={13} color="var(--accent)" />
              <span>Inspector</span>
            </button>
          )}
        </div>
      </div>

      {/* FLOATING LEFT CURRICULUM / FLOW TIMELINE POPOVER DRAWER */}
      <AnimatePresence>
        {isLeftDrawerOpen && (
          <motion.aside
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="hud-glass-card"
            style={{
              position: "absolute",
              top: 60,
              left: 16,
              width: "min(336px, calc(100vw - 32px))",
              maxHeight: "calc(100% - 148px)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              zIndex: 28,
            }}
          >
            <div className="pane-header">
              <span className="pane-title">{standaloneMode ? "HLD CURRICULUM" : "FLOW TIMELINE"}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="badge badge-accent">
                  {standaloneMode ? `${allReadyOrdered.length} TOPICS` : `${steps.length} HOPS`}
                </span>
                <button
                  className="icon-btn"
                  style={{ height: 24, padding: "0 6px" }}
                  onClick={toggleLeftDrawer}
                  aria-label="Close curriculum drawer"
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            {standaloneMode && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", borderBottom: "1px solid var(--border-soft)" }}>
                <div style={{ display: "flex", gap: 4 }}>
                  {FILTER_TABS.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setCatFilter(tab.key)}
                      className={`layer-pill ${catFilter === tab.key ? "active" : ""}`}
                      style={{ fontSize: 10 }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                {onSelectLayer && (
                  <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    <span className="mono" style={{ fontSize: 9.5, color: "var(--ink-muted)", fontWeight: 700, marginRight: 3 }}>
                      LAYER
                    </span>
                    <button
                      onClick={() => onSelectLayer(null)}
                      className={`layer-box ${selectedLayer === null ? "active" : ""}`}
                      style={{ width: "auto", padding: "0 6px", height: 22, fontSize: 9.5 }}
                    >
                      ALL
                    </button>
                    {[1, 2, 3, 4, 5, 6, 7].map((num) => (
                      <button
                        key={num}
                        onClick={() => onSelectLayer(num)}
                        className={`layer-box ${selectedLayer === num ? "active" : ""}`}
                        style={{ width: 22, height: 22, fontSize: 9.5 }}
                        title={`Filter Layer ${num}`}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="pane-scroll">
              {standaloneMode ? (
                <>
                  {readyLessons.map((item) => {
                    const isExpanded = item.id === activeLessonId;
                    const prog = progressByTopic[item.id];
                    const isDone = prog?.status === "completed";

                    return (
                      <div key={item.id} className={`proto-item ${isExpanded ? "expanded" : ""}`}>
                        <button
                          onClick={() => onSelectLesson(item.id)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "10px 12px",
                            background: "transparent",
                            border: "none",
                            color: "inherit",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 9,
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              flexShrink: 0,
                              background: isDone
                                ? "var(--success)"
                                : isExpanded
                                  ? "var(--accent)"
                                  : "var(--border)",
                            }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="mono" style={{ fontWeight: 700, fontSize: 12, color: "var(--ink-primary)" }}>
                              {item.title}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--ink-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              L{item.layer} · {item.subtitle}
                            </div>
                          </div>
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>

                        {isExpanded && activeLesson && (
                          <div style={{ padding: "4px 12px 10px 18px" }}>
                            {steps.map((st, idx) => {
                              const isActive = playbackState !== "idle" && idx === activeStepIdx;
                              const isCompleted =
                                playbackState === "completed" ||
                                (playbackState !== "idle" && idx < activeStepIdx);
                              return (
                                <button
                                  key={st.stepNo}
                                  onClick={() => handleJumpToStep(idx)}
                                  style={{
                                    width: "100%",
                                    textAlign: "left",
                                    padding: "5px 6px",
                                    borderRadius: 5,
                                    border: "none",
                                    background: isActive ? "var(--accent-soft)" : "transparent",
                                    color: isActive ? "var(--accent)" : "var(--ink-secondary)",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    cursor: "pointer",
                                    marginBottom: 2,
                                  }}
                                >
                                  <span
                                    className="mono"
                                    style={{
                                      width: 18,
                                      height: 18,
                                      borderRadius: "50%",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: 10,
                                      fontWeight: 700,
                                      flexShrink: 0,
                                      background: isCompleted
                                        ? "var(--success)"
                                        : isActive
                                          ? "var(--accent)"
                                          : "var(--bg-subtle)",
                                      color: isCompleted || isActive ? "#fff" : "var(--ink-muted)",
                                    }}
                                  >
                                    {isCompleted ? <Check size={11} /> : st.stepNo}
                                  </span>
                                  <span className="mono" style={{ fontSize: 11, fontWeight: isActive ? 700 : 500, flex: 1 }}>
                                    {st.phaseTitle}
                                  </span>
                                  {st.predictPrompt && <HelpCircle size={12} color="var(--warn)" />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {plannedLessons.length > 0 && (
                    <div style={{ padding: "8px 10px" }}>
                      <button
                        onClick={() => setShowPlanned((p) => !p)}
                        style={{
                          width: "100%",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "6px 8px",
                          borderRadius: 5,
                          border: "1px dashed var(--border)",
                          background: "transparent",
                          color: "var(--ink-muted)",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                        className="mono"
                      >
                        <span>Upcoming Roadmap ({plannedLessons.length})</span>
                        {showPlanned ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                      {showPlanned && (
                        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                          {plannedLessons.map((pl) => (
                            <div key={pl.id} style={{ padding: "5px 8px", fontSize: 11, color: "var(--ink-muted)" }}>
                              L{pl.layer} · {pl.title}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ padding: 10 }}>
                  <div style={{ marginBottom: 12 }}>
                    <button
                      onClick={() => setChaosId(null)}
                      className={!chaosId ? "btn-primary" : "btn-secondary"}
                      style={{ width: "100%", justifyContent: "flex-start", marginBottom: 6 }}
                    >
                      <CheckCircle2 size={13} /> Happy Path Flow
                    </button>
                    {activeLesson?.chaosScenarios.map((cs) => (
                      <button
                        key={cs.id}
                        onClick={() => setChaosId(cs.id)}
                        className="btn-secondary"
                        style={{
                          width: "100%",
                          justifyContent: "flex-start",
                          textAlign: "left",
                          marginBottom: 6,
                          borderColor: chaosId === cs.id ? "var(--danger)" : undefined,
                          background: chaosId === cs.id ? "var(--danger-bg)" : undefined,
                          color: chaosId === cs.id ? "var(--danger)" : undefined,
                        }}
                      >
                        <Flame size={13} /> {cs.title}
                      </button>
                    ))}
                  </div>
                  {steps.map((st, idx) => (
                    <button
                      key={st.stepNo}
                      onClick={() => handleJumpToStep(idx)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "6px 8px",
                        borderRadius: 5,
                        border: "none",
                        background: playbackState !== "idle" && idx === activeStepIdx ? "var(--accent-soft)" : "transparent",
                        color: "var(--ink-primary)",
                        cursor: "pointer",
                        marginBottom: 3,
                      }}
                    >
                      <div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{st.phaseTitle}</div>
                      <div className="mono" style={{ fontSize: 10, color: "var(--ink-muted)" }}>{st.protocol} · +{st.latencyDeltaMs}ms</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* FLOATING RIGHT CONTEXTUAL GLASS CARD */}
      <AnimatePresence>
        {effectiveRightCardVisible && activeLesson && (
          <motion.aside
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ type: "spring", stiffness: 360, damping: 32 }}
            className="hud-glass-card hud-right-floating"
            style={{
              position: "absolute",
              top: 62,
              right: 16,
              width: 328,
              maxHeight: "calc(100% - 148px)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              zIndex: 21,
            }}
          >
            {/* Slim Context Header */}
            <div
              style={{
                padding: "11px 14px",
                borderBottom: "1px solid var(--border-soft)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                flexShrink: 0,
              }}
            >
              <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.05em" }}>
                {rightInspectNode && selectedNode
                  ? "COMPONENT SPECS"
                  : playbackState === "completed"
                    ? "SIMULATION COMPLETE"
                    : playbackState !== "idle" && currentStep
                      ? `ACTIVE HOP #${activeStepIdx + 1} · ${truncateText(currentStep.phaseTitle, 20)}`
                      : `${activeLesson.difficulty} · OVERVIEW`}
              </span>
              <button
                onClick={() => setRightCardCollapsed(true)}
                className="icon-btn"
                style={{ height: 24, padding: "0 6px", borderRadius: 6 }}
                title="Collapse inspector card"
                aria-label="Collapse inspector card"
              >
                <Minimize2 size={11} />
              </button>
            </div>

            {/* Calm Scrollable Inspector Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
              {rightInspectNode && selectedNode ? (
                <div>
                  <button
                    className="hud-dock-btn"
                    style={{ height: 26, fontSize: 10, marginBottom: 10 }}
                    onClick={() => setRightInspectNode(false)}
                  >
                    <ChevronLeft size={12} /> Back to Overview
                  </button>
                  <h3 className="mono" style={{ margin: 0, fontSize: 16 }}>{selectedNode.label}</h3>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-muted)", marginTop: 2 }}>
                    {selectedNode.sublabel}
                  </div>
                  <p style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 10, color: "var(--ink-secondary)" }}>
                    {selectedNode.summary}
                  </p>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 10 }}>
                    <div style={{ padding: "7px 9px", borderRadius: 8, background: "var(--bg-subtle)" }}>
                      <div className="mono" style={{ fontSize: 9, color: "var(--ink-muted)" }}>PROTOCOL</div>
                      <div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{selectedNode.specs.protocol}</div>
                    </div>
                    <div style={{ padding: "7px 9px", borderRadius: 8, background: "var(--bg-subtle)" }}>
                      <div className="mono" style={{ fontSize: 9, color: "var(--ink-muted)" }}>BASE LATENCY</div>
                      <div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{selectedNode.specs.baseLatencyMs} ms</div>
                    </div>
                    <div style={{ padding: "7px 9px", borderRadius: 8, background: "var(--bg-subtle)" }}>
                      <div className="mono" style={{ fontSize: 9, color: "var(--ink-muted)" }}>CAP PROFILE</div>
                      <div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{selectedNode.specs.capProfile}</div>
                    </div>
                    <div style={{ padding: "7px 9px", borderRadius: 8, background: "var(--bg-subtle)" }}>
                      <div className="mono" style={{ fontSize: 9, color: "var(--ink-muted)" }}>LIVE LOAD</div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color:
                            activeNodeUtilPct === null
                              ? "var(--ink-muted)"
                              : activeNodeUtilPct >= 100
                                ? "var(--danger)"
                                : activeNodeUtilPct >= TARGET_UTILIZATION * 100
                                  ? "var(--warn)"
                                  : "var(--success)",
                        }}
                      >
                        {activeNodeUtilPct === null
                          ? `${formatCompactRps(telemetry.nodeRps[selectedNode.id] ?? 0)} req/s`
                          : `${activeNodeUtilPct}%`}
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 12, fontSize: 12 }}>
                    <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: "var(--success)", marginBottom: 4 }}>
                      WHEN TO USE
                    </div>
                    <ul style={{ margin: "0 0 10px 15px", padding: 0, lineHeight: 1.5, color: "var(--ink-secondary)" }}>
                      {selectedNode.whenToUse.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                    <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: "var(--danger)", marginBottom: 4 }}>
                      FAILURE MODES
                    </div>
                    <ul style={{ margin: "0 0 0 15px", padding: 0, lineHeight: 1.5, color: "var(--ink-secondary)" }}>
                      {selectedNode.failureModes.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  </div>
                </div>
              ) : playbackState === "completed" ? (
                <div>
                  <div className="badge badge-success" style={{ marginBottom: 8 }}>FLOW COMPLETE</div>
                  <h3 className="mono" style={{ margin: 0, fontSize: 16 }}>{activeLesson.title}</h3>
                  <p style={{ fontSize: 12.5, color: "var(--ink-secondary)", lineHeight: 1.55, marginTop: 8 }}>
                    {activeChaos ? activeChaos.mitigationSummary : activeLesson.keyTakeaways[0]}
                  </p>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 10 }}>
                    <div style={{ padding: "7px 9px", borderRadius: 8, background: "var(--bg-subtle)" }}>
                      <div className="mono" style={{ fontSize: 9, color: "var(--ink-muted)" }}>TOTAL HOPS</div>
                      <div className="mono" style={{ fontSize: 11.5, fontWeight: 700 }}>{steps.length}</div>
                    </div>
                    <div style={{ padding: "7px 9px", borderRadius: 8, background: "var(--bg-subtle)" }}>
                      <div className="mono" style={{ fontSize: 9, color: "var(--ink-muted)" }}>BASE SUM</div>
                      <div className="mono" style={{ fontSize: 11.5, fontWeight: 700 }}>{totalLatencyMs.toFixed(1)} ms</div>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
                    {standaloneMode && nextLesson && (
                      <button className="btn-primary" onClick={() => onSelectLesson(nextLesson.id)} title={nextLesson.title}>
                        Next: {truncateText(nextLesson.title, 22)} <ArrowRight size={13} />
                      </button>
                    )}
                    {standaloneMode && (
                      <button className="btn-secondary" onClick={() => onJumpToPractice(activeLesson.id)}>
                        Practice Quiz & Cards →
                      </button>
                    )}
                    <button
                      onClick={() => setDeepReadOpen(true)}
                      className="mono"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--accent)",
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: "pointer",
                        textAlign: "left",
                        padding: "4px 0",
                      }}
                    >
                      Open Deep Dive →
                    </button>
                  </div>
                </div>
              ) : playbackState !== "idle" && currentStep ? (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <button className="hud-dock-btn" style={{ height: 25, fontSize: 10 }} onClick={handleReset}>
                      <ChevronLeft size={12} /> Overview
                    </button>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <ReportIssueButton
                        topicId={activeLessonId}
                        blockId={chaosId ? `chaos:${chaosId}:step:${currentStep.stepNo}` : `step:${currentStep.stepNo}`}
                        blockLabel={`${chaosId ? `Chaos ${chaosId}, ` : ""}step ${currentStep.stepNo}: ${currentStep.phaseTitle}`}
                      />
                      <span className="badge badge-accent">{currentStep.protocol} · +{currentStep.latencyDeltaMs}ms</span>
                    </span>
                  </div>

                  <div className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-primary)", marginBottom: 6 }}>
                    {nodeLabel(currentStep.sourceNodeId)} → {nodeLabel(currentStep.targetNodeId)}
                  </div>

                  <p style={{ fontSize: 12.5, lineHeight: 1.56, color: "var(--ink-secondary)", margin: "0 0 12px" }}>
                    {renderInlineCode(currentStep.inspectorNote)}
                  </p>

                  {activeLesson.adaptiveLenses && (
                    <div style={{ paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
                      <div className="hud-segmented" style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
                        {LENS_META.map((m) => (
                          <button
                            key={m.key}
                            onClick={() => handleLensChange(m.key)}
                            className={`hud-seg-btn ${lens === m.key ? "active" : ""}`}
                            style={{ flex: 1 }}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                      <div style={{ fontSize: 12, lineHeight: 1.55, color: "var(--ink-primary)" }}>
                        {renderInlineCode(activeLesson.adaptiveLenses[lens])}
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <ReportIssueButton topicId={activeLessonId} blockId={`lens:${lens}`} blockLabel={`${lens} lens`} compact={false} />
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => setDeepReadOpen(true)}
                    className="mono"
                    style={{
                      marginTop: 12,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      background: "transparent",
                      border: "none",
                      color: "var(--accent)",
                      fontSize: 11.5,
                      fontWeight: 700,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    Open Deep Dive →
                  </button>
                </div>
              ) : (
                <div>
                  <h3 className="mono" style={{ margin: 0, fontSize: 17 }}>{activeLesson.title}</h3>
                  <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 3 }}>{activeLesson.subtitle}</div>
                  <p style={{ fontSize: 12.5, lineHeight: 1.58, color: "var(--ink-secondary)", marginTop: 10 }}>
                    {renderInlineCode(activeLesson.overview)}
                  </p>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                    <span className="badge">Layer {activeLesson.layer}</span>
                    <span className="badge">~{activeLesson.estimatedMinutes}m</span>
                    <span className="badge badge-purple">{activeLesson.ddiaAnchors?.[0]?.chapter ?? "DDIA Core"}</span>
                  </div>

                  {activeLesson.adaptiveLenses && (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-soft)" }}>
                      <div className="hud-segmented" style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
                        {LENS_META.map((m) => (
                          <button
                            key={m.key}
                            onClick={() => handleLensChange(m.key)}
                            className={`hud-seg-btn ${lens === m.key ? "active" : ""}`}
                            style={{ flex: 1 }}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.56, color: "var(--ink-primary)" }}>
                        {renderInlineCode(activeLesson.adaptiveLenses[lens])}
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <ReportIssueButton topicId={activeLessonId} blockId={`lens:${lens}`} blockLabel={`${lens} lens`} compact={false} />
                      </div>
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
                    <button
                      onClick={() => setDeepReadOpen(true)}
                      className="mono"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        background: "transparent",
                        border: "none",
                        color: "var(--accent)",
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      <BookOpen size={13} /> Open Deep Dive →
                    </button>
                    {standaloneMode && (
                      <button
                        className="btn-secondary"
                        style={{ padding: "4px 9px", fontSize: 10.5 }}
                        onClick={() => onJumpToPractice(activeLesson.id)}
                      >
                        Quiz →
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* FLOATING PAUSE & PREDICT CHECKPOINT TOAST */}
      <AnimatePresence>
        {playbackState !== "idle" && currentStep?.predictPrompt && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="hud-glass-card"
            style={{
              position: "absolute",
              left: 16,
              bottom: effectiveTraceOpen ? "calc(min(272px, 36vh) + 84px)" : 74,
              maxWidth: "min(620px, calc(100vw - 380px))",
              padding: "9px 14px",
              borderColor: "color-mix(in srgb, var(--warn) 55%, transparent)",
              zIndex: 23,
              fontSize: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <Lightbulb size={14} color="var(--warn)" style={{ flexShrink: 0 }} />
                <strong className="mono" style={{ color: "var(--warn)", fontSize: 10.5 }}>PREDICT:</strong>
                <span>{renderInlineCode(currentStep.predictPrompt.prompt)}</span>
              </div>
              <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                <button
                  className="hud-dock-btn"
                  style={{ height: 24, fontSize: 10 }}
                  onClick={() => setShowHint((p) => ({ ...p, [predictKey]: !p[predictKey] }))}
                >
                  {showHint[predictKey] ? "Hide Hint" : "Hint"}
                </button>
                <button
                  className="btn-primary"
                  style={{ padding: "3px 10px", fontSize: 10 }}
                  onClick={() => setRevealedPredicts((p) => ({ ...p, [predictKey]: !p[predictKey] }))}
                >
                  {revealedPredicts[predictKey] ? "Hide" : "Reveal"}
                </button>
              </div>
            </div>
            {showHint[predictKey] && !revealedPredicts[predictKey] && (
              <div style={{ marginTop: 5, fontSize: 11.5, color: "var(--ink-secondary)" }}>
                <strong>Hint:</strong> {renderInlineCode(currentStep.predictPrompt.hint)}
              </div>
            )}
            {revealedPredicts[predictKey] && (
              <div style={{ marginTop: 5, fontSize: 11.5, color: "var(--ink-primary)", fontWeight: 500 }}>
                <strong>Answer:</strong> {renderInlineCode(currentStep.predictPrompt.reveal)}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* COLLAPSIBLE TRACE WATERFALL BOTTOM GLASS DRAWER */}
      <TraceWaterfallDrawer
        open={effectiveTraceOpen}
        steps={steps}
        visibleTraceRows={visibleTraceRows}
        playbackState={playbackState}
        activeStepIdx={activeStepIdx}
        inspectedPacketIdx={inspectedPacketIdx}
        rightInsetPx={effectiveRightCardVisible ? 360 : 16}
        nodeLabel={nodeLabel}
        onInspectPacket={setInspectedPacketIdx}
        onJumpToStep={handleJumpToStep}
        onClose={() => setTraceDrawerOpen(false)}
      />

      {/* BOTTOM-CENTER UNIFIED MEDIA CONTROL DOCK */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 25,
        }}
      >
        <div className="hud-dock">
          <button
            className="hud-play-btn"
            onClick={handlePlayPause}
            title="Play / Pause simulation (Space)"
            aria-label={playbackState === "playing" ? "Pause flow" : "Play flow"}
          >
            {playbackState === "playing" ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: 1 }} />}
          </button>

          <button
            className="hud-dock-btn"
            style={{ width: 30, padding: 0 }}
            aria-label="Previous step"
            disabled={activeStepIdx <= 0}
            onClick={handlePrevStep}
            title="Previous step (←)"
          >
            <ChevronLeft size={13} />
          </button>

          <button
            className="hud-dock-btn"
            disabled={playbackState === "completed"}
            onClick={handleStepForward}
            title="Step forward one hop (S)"
          >
            <SkipForward size={12} />
            <span>Step</span>
          </button>

          <button
            className="hud-dock-btn"
            style={{ width: 30, padding: 0 }}
            onClick={handleReset}
            aria-label="Reset simulation"
            title="Reset simulation (Esc)"
          >
            <RotateCcw size={12} />
          </button>

          <button
            className="hud-dock-btn"
            onClick={cycleSpeed}
            title="Cycle playback speed"
            style={{ minWidth: 42 }}
          >
            {speed}×
          </button>

          {showBottomPane && (
            <button
              className={`hud-dock-btn ${traceDrawerOpen ? "active" : ""}`}
              onClick={() => setTraceDrawerOpen((p) => !p)}
              title="Toggle Request Flow Waterfall table"
            >
              <span>{traceDrawerOpen ? "Hide Trace Waterfall" : "Show Trace Waterfall"}</span>
              {traceDrawerOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            </button>
          )}

          {/* Ingress slider (log scale, 100 to 1M requests a second) driving node load */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              paddingLeft: 8,
              borderLeft: "1px solid var(--border-soft)",
            }}
            title="Requests a second entering at the client. Caches and CDNs pass on only their misses."
          >
            <label htmlFor="hud-qps-range" className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-muted)" }}>
              Ingress
            </label>
            <input
              id="hud-qps-range"
              type="range"
              min={2}
              max={6}
              step={0.05}
              value={Math.log10(ingressRps)}
              onChange={(e) => setIngressRps(Math.round(Math.pow(10, Number(e.target.value))))}
              className="hud-qps-slider"
              aria-label="Ingress requests per second"
            />
            <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: tierColor, minWidth: 54 }}>
              {formatCompactRps(ingressRps)}/s
            </span>
          </div>
        </div>
      </div>

      {/* SLIDE-OVER DEEP DIVE BLUEPRINT DRAWER */}
      <DeepDiveDrawer
        open={deepReadOpen}
        lesson={activeLesson}
        linkedModule={linkedModule}
        onClose={() => setDeepReadOpen(false)}
      />

      {/* SLIDE-OVER STUDY NOTES DRAWER */}
      {standaloneMode && activeLesson && (
        <NotesDrawer
          open={notesOpen}
          topicId={activeLesson.id}
          topicTitle={activeLesson.title}
          activeStepQuote={
            currentStep
              ? `> **Hop #${currentStep.stepNo} (${nodeLabel(currentStep.sourceNodeId)} -> ${nodeLabel(currentStep.targetNodeId)} · ${currentStep.protocol} +${currentStep.latencyDeltaMs}ms)**\n> ${currentStep.inspectorNote}`
              : null
          }
          onClose={() => setNotesOpen(false)}
          onNoteSaved={onNoteSaved}
        />
      )}
    </div>
  );
};
