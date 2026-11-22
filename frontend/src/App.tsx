import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookMarked,
  BookOpen,
  Box,
  Calculator,
  Compass,
  Flame,
  Keyboard,
  Layers,
  Map,
  Maximize2,
  Moon,
  NotebookPen,
  Search,
  Sun,
  User,
  X,
} from "lucide-react";
import {
  api,
  authStorage,
  type AuthSessionResponse,
  type HldModuleItem,
  type OverviewResponse,
  type ProgressSummary,
  type SearchHit,
  type StreakSummary,
  type UserProfile,
} from "./api/client";
import { AccountModal } from "./components/AccountModal";
import { AuthPortalModal } from "./components/AuthPortalModal";
import { CapacityLabView, type CapacityPresetInput } from "./components/CapacityLabView";
import { CaseStudiesView } from "./components/CaseStudiesView";
import { ExplorerWorkspace } from "./components/ExplorerWorkspace";
import { ModulesView } from "./components/ModulesView";
import { NotesVaultView } from "./components/NotesVaultView";
import { PracticeAndDdiaView } from "./components/PracticeAndDdiaView";
import { RoadmapView } from "./components/RoadmapView";
import { SearchModal } from "./components/SearchModal";
import type { HldCaseStudy, HldExplorerLesson, PatternPlaybook } from "./types/hld";

type MainView = "roadmap" | "modules" | "explorer" | "cases" | "notes" | "capacity" | "practice";

const NAV_ITEMS: Array<{ key: MainView; label: string; icon: typeof Map }> = [
  { key: "roadmap", label: "Roadmap", icon: Map },
  { key: "modules", label: "Modules", icon: BookMarked },
  { key: "explorer", label: "Explorer", icon: Compass },
  { key: "cases", label: "Case Studies", icon: Layers },
  { key: "notes", label: "Notes", icon: NotebookPen },
  { key: "capacity", label: "Capacity Lab", icon: Calculator },
  { key: "practice", label: "Practice", icon: BookOpen },
];

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [view, setView] = useState<MainView>("roadmap");
  const [selectedLayer, setSelectedLayer] = useState<number | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [modules, setModules] = useState<HldModuleItem[]>([]);
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [streak, setStreak] = useState<StreakSummary | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(
    () => !authStorage.getToken() && !authStorage.isGuestEntered()
  );
  const [accountModalOpen, setAccountModalOpen] = useState<boolean>(false);
  const [patterns, setPatterns] = useState<PatternPlaybook[]>([]);
  const [foundations, setFoundations] = useState<any>(null);
  const [referenceData, setReferenceData] = useState<any>(null);

  const [activeLessonId, setActiveLessonId] = useState<string>("dns-and-cdn");
  const [activeLesson, setActiveLesson] = useState<HldExplorerLesson | null>(null);
  const [loadingLesson, setLoadingLesson] = useState<boolean>(false);

  const [activeCaseId, setActiveCaseId] = useState<string>("url-shortener");
  const [estimatorPreset, setEstimatorPreset] = useState<CapacityPresetInput | null>(null);
  const [practiceTopicFilter, setPracticeTopicFilter] = useState<string | null>(null);

  const [showLeftPane, setShowLeftPane] = useState<boolean>(false);
  const [diagramOnly, setDiagramOnly] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [shortcutsOpen, setShortcutsOpen] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
        return;
      }
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "?") {
        setShortcutsOpen((prev) => !prev);
      } else if (view === "explorer" && e.key.toLowerCase() === "l") {
        setDiagramOnly(false);
        setShowLeftPane((p) => !p);
      } else if (view === "explorer" && e.key.toLowerCase() === "d") {
        setDiagramOnly((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  const refreshSummary = async () => {
    const [ov, sum, me] = await Promise.all([api.getOverview(), api.getProgressSummary(), api.getMe()]);
    setOverview(ov);
    setSummary(sum);
    setCurrentUser(me.user);
    setStreak(me.streak);
  };

  useEffect(() => {
    Promise.all([
      api.getOverview(),
      api.getModules(),
      api.getProgressSummary(),
      api.getMe(),
      api.getPatterns(),
      api.getFoundations(),
      api.getReference(),
    ])
      .then(([ov, mods, sum, me, pats, fnd, ref]) => {
        setOverview(ov);
        setModules(mods.modules);
        setSummary(sum);
        setCurrentUser(me.user);
        setStreak(me.streak);
        if (!me.authenticated && authStorage.getToken()) {
          authStorage.setToken(null);
        }
        setPatterns(pats.patterns);
        setFoundations(fnd);
        setReferenceData(ref);
      })
      .catch((err) => setErrorMsg(err.message));
  }, []);

  const handleAuthenticatedSession = async (session: AuthSessionResponse) => {
    setCurrentUser(session.user);
    setStreak(session.streak);
    setAuthModalOpen(false);
    await refreshSummary();
  };

  const handleLogoutSession = async () => {
    await refreshSummary();
    setAuthModalOpen(true);
  };

  useEffect(() => {
    let cancelled = false;
    setLoadingLesson(true);
    api
      .getLesson(activeLessonId)
      .then((l) => {
        if (!cancelled) {
          setActiveLesson(l);
          setLoadingLesson(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadingLesson(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeLessonId]);

  const handleLayerSelect = (layer: number | null) => {
    setSelectedLayer(layer);
    setView("explorer");
    if (layer !== null && overview) {
      const match = overview.lessons.find((l) => l.layer === layer && l.status === "ready");
      if (match) setActiveLessonId(match.id);
    }
  };

  const handleUpdateProgress = async (
    topicId: string,
    payload: {
      kind: "lesson" | "case_study";
      status: "not_started" | "in_progress" | "completed";
      completedSteps: number[];
      activeLens: "intuition" | "mechanics" | "staffTradeoffs";
    }
  ) => {
    await api.saveProgress(topicId, payload);
    await refreshSummary();
  };

  const handleSearchHit = (hit: SearchHit) => {
    if (hit.kind === "lesson" && hit.status === "ready") {
      setActiveLessonId(hit.id);
      setView("explorer");
    } else if (hit.kind === "case_study" && hit.status === "ready") {
      setActiveCaseId(hit.id);
      setView("cases");
    } else if (hit.kind === "pattern" || hit.kind === "ddia") {
      setPracticeTopicFilter(null);
      setView("practice");
    }
  };

  const handleLoadCasePreset = (preset: HldCaseStudy["estimationPreset"], title: string) => {
    const rwParts = preset.readWriteRatio.split(":");
    const r = Number(rwParts[0]) || 90;
    const w = Number(rwParts[1]) || 10;
    const readShare = Math.round((r / Math.max(1, r + w)) * 100);
    setEstimatorPreset({
      title,
      dau: preset.dau,
      actionsPerUserPerDay: preset.actionsPerUserPerDay,
      peakMultiplier: preset.peakMultiplier,
      avgPayloadBytes: preset.avgPayloadBytes,
      retentionYears: preset.retentionYears,
      readSharePercent: readShare,
    });
    setView("capacity");
  };

  const activeLayerNum = activeLesson?.layer ?? selectedLayer ?? 1;
  void activeLayerNum;

  return (
    <>
      <div className="app-shell">
        {/* Studio 1 Frosted Glass Command Top Bar */}
        <header className="top-bar">
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div className="brand-block" onClick={() => setView("roadmap")} title="Back to Learning Path Roadmap">
              <div className="brand-reticle">
                <Box size={18} strokeWidth={1.9} />
              </div>
              <div>
                <div className="brand-title">SystemCraft</div>
                <div className="brand-sub">System design, practised</div>
              </div>
            </div>

            <nav className="nav-pills">
              {NAV_ITEMS.map((item) => {
                const isActive = view === item.key;
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    onClick={() => setView(item.key)}
                    className={`nav-pill ${isActive ? "active" : ""}`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="top-nav-pill"
                        className="nav-pill-bg"
                        transition={{ type: "spring", stiffness: 440, damping: 32 }}
                      />
                    )}
                    <Icon size={14} strokeWidth={1.8} /> <span className="nav-label">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Right Controls: Search + Diagram Focus + Theme + Profile */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button className="icon-btn" onClick={() => setSearchOpen(true)} title="Search (Ctrl+K)" style={{ whiteSpace: "nowrap" }}>
              <Search size={13} />
              <span>Search</span>
              <span className="badge" style={{ fontSize: 9.5 }}>Ctrl K</span>
            </button>

            {view === "explorer" && (
              <button
                className={`icon-btn ${diagramOnly ? "active" : ""}`}
                onClick={() => setDiagramOnly((p) => !p)}
                aria-label="Toggle diagram focus mode"
                title="Diagram focus mode (D)"
              >
                <Maximize2 size={13} />
              </button>
            )}

            <button className="icon-btn" aria-label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)} title="Keyboard shortcuts (?)">
              <Keyboard size={13} />
            </button>

            <button
              className="icon-btn"
              aria-label="Toggle Light or Dark Blueprint theme"
              onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
              title="Toggle Light / Dark Blueprint"
            >
              {theme === "light" ? <Moon size={13} /> : <Sun size={13} />}
            </button>

            {/* Daily Streak + Account Pill */}
            <button
              className="icon-btn"
              onClick={() => (currentUser?.isGuest ? setAuthModalOpen(true) : setAccountModalOpen(true))}
              aria-label="Open study profile, streak and API tokens"
              title={currentUser?.isGuest ? "Sign in / Personalize workspace" : "Account, Streak & Study Tokens"}
              style={{
                borderColor: currentUser && !currentUser.isGuest ? "color-mix(in srgb, var(--accent) 48%, transparent)" : undefined,
                background: currentUser && !currentUser.isGuest ? "var(--accent-soft)" : undefined,
              }}
            >
              <Flame size={12} color="var(--highlight)" />
              <span className="streak-hand">{streak?.currentStreak ?? 0}d</span>
              <span style={{ opacity: 0.45 }}>|</span>
              <User size={12} />
              <span>{currentUser && !currentUser.isGuest ? currentUser.displayName : "Sign In"}</span>
            </button>

            {currentUser && (
              <button
                className="icon-btn"
                onClick={() => setAccountModalOpen(true)}
                aria-label="Manage daily goals and API tokens"
                title="Streak Settings & Personal API Tokens"
                style={{ padding: "0 8px" }}
              >
                <span>
                  {Math.min(streak?.todayActions ?? 0, streak?.dailyGoal ?? 3)}/{streak?.dailyGoal ?? 3}
                </span>
              </button>
            )}
          </div>
        </header>

        {errorMsg && (
          <div style={{ padding: "8px 16px", background: "var(--danger-bg)", color: "var(--danger)", fontSize: 12 }} className="mono">
            API connection error: {errorMsg}
          </div>
        )}

        {!overview ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }} className="mono">
            Loading your workspace…
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}
            >
              {view === "roadmap" ? (
                <RoadmapView
                  layers={overview.layers}
                  lessons={overview.lessons}
                  caseStudies={overview.caseStudies}
                  modules={modules}
                  progressByTopic={overview.progressByTopic}
                  summary={summary}
                  streak={streak}
                  theme={theme}
                  onStartLesson={(id) => {
                    setSelectedLayer(null);
                    setActiveLessonId(id);
                    setView("explorer");
                  }}
                  onOpenCaseStudy={(cid) => {
                    setActiveCaseId(cid);
                    setView("cases");
                  }}
                  onOpenCapacityLab={() => setView("capacity")}
                  onOpenModules={() => setView("modules")}
                  onOpenPractice={() => {
                    setPracticeTopicFilter(null);
                    setView("practice");
                  }}
                />
              ) : view === "modules" ? (
                <ModulesView
                  modules={modules}
                  topicMetaById={Object.fromEntries([
                    ...overview.lessons.map((l) => [l.id, { title: l.title, ready: l.status === "ready", kind: "lesson" as const }]),
                    ...overview.caseStudies.map((c) => [c.id, { title: c.title, ready: c.status === "ready", kind: "case_study" as const }]),
                  ])}
                  onNoteSaved={refreshSummary}
                  onOpenTopic={(id) => {
                    const lesson = overview.lessons.find((l) => l.id === id && l.status === "ready");
                    if (lesson) {
                      setActiveLessonId(lesson.id);
                      setView("explorer");
                      return;
                    }
                    const cs = overview.caseStudies.find((c) => c.id === id && c.status === "ready");
                    if (cs) {
                      setActiveCaseId(cs.id);
                      setView("cases");
                    }
                  }}
                />
              ) : view === "explorer" ? (
                <ExplorerWorkspace
                  lessonsIndex={overview.lessons}
                  selectedLayer={selectedLayer}
                  activeLessonId={activeLessonId}
                  activeLesson={activeLesson}
                  linkedModule={modules.find((m) => m.linkedLessonIds.includes(activeLessonId)) ?? null}
                  loadingLesson={loadingLesson}
                  progressByTopic={overview.progressByTopic}
                  theme={theme}
                  showLeftPane={showLeftPane && !diagramOnly}
                  showRightPane={!diagramOnly}
                  showBottomPane={!diagramOnly}
                  onToggleLeftPane={() => {
                    setDiagramOnly(false);
                    setShowLeftPane((p) => !p);
                  }}
                  onSelectLayer={handleLayerSelect}
                  onSelectLesson={setActiveLessonId}
                  onUpdateProgress={handleUpdateProgress}
                  onNoteSaved={refreshSummary}
                  onJumpToPractice={(topicId) => {
                    setPracticeTopicFilter(topicId);
                    setView("practice");
                  }}
                />
              ) : view === "cases" ? (
                <CaseStudiesView
                  key={currentUser?.id ?? "guest"}
                  caseStudiesIndex={overview.caseStudies}
                  activeCaseId={activeCaseId}
                  onSelectCaseId={setActiveCaseId}
                  onLoadPresetInEstimator={handleLoadCasePreset}
                  progressByTopic={overview.progressByTopic}
                  theme={theme}
                  onNoteSaved={refreshSummary}
                  onUpdateProgress={handleUpdateProgress}
                />
              ) : view === "notes" ? (
                <NotesVaultView
                  key={currentUser?.id ?? "guest"}
                  streak={streak}
                  topicMetaById={Object.fromEntries([
                    ...overview.lessons.map((l) => [l.id, { title: l.title, ready: l.status === "ready", kind: "lesson" as const }]),
                    ...overview.caseStudies.map((c) => [c.id, { title: c.title, ready: c.status === "ready", kind: "case_study" as const }]),
                  ])}
                  onDataChanged={refreshSummary}
                  onOpenTopic={(id) => {
                    const lesson = overview.lessons.find((l) => l.id === id && l.status === "ready");
                    if (lesson) {
                      setActiveLessonId(lesson.id);
                      setView("explorer");
                      return;
                    }
                    const cs = overview.caseStudies.find((c) => c.id === id && c.status === "ready");
                    if (cs) {
                      setActiveCaseId(cs.id);
                      setView("cases");
                    }
                  }}
                />
              ) : view === "capacity" ? (
                <CapacityLabView referenceData={referenceData} initialPreset={estimatorPreset} />
              ) : (
                <PracticeAndDdiaView
                  key={currentUser?.id ?? "guest"}
                  topicFilter={practiceTopicFilter}
                  onClearTopicFilter={() => setPracticeTopicFilter(null)}
                  patterns={patterns}
                  foundations={foundations}
                  topicMetaById={Object.fromEntries([
                    ...overview.lessons.map((l) => [l.id, { title: l.title, ready: l.status === "ready" }]),
                    ...overview.caseStudies.map((c) => [c.id, { title: c.title, ready: c.status === "ready" }]),
                  ])}
                  onPracticeUpdated={refreshSummary}
                  onOpenTopic={(id) => {
                    const lesson = overview.lessons.find((l) => l.id === id && l.status === "ready");
                    if (lesson) {
                      setActiveLessonId(lesson.id);
                      setView("explorer");
                      return;
                    }
                    const cs = overview.caseStudies.find((c) => c.id === id && c.status === "ready");
                    if (cs) {
                      setActiveCaseId(cs.id);
                      setView("cases");
                    }
                  }}
                />
              )}
            </motion.div>
          </AnimatePresence>
        )}

        <SearchModal
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onSelectHit={handleSearchHit}
        />

        {shortcutsOpen && (
          <div
            onClick={() => setShortcutsOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(7, 13, 24, 0.55)",
              zIndex: 60,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(440px, 92vw)", padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Keyboard shortcuts</span>
                <button className="icon-btn" onClick={() => setShortcutsOpen(false)}><X size={13} /></button>
              </div>
              <table className="spec-table">
                <tbody>
                  <tr><td>Space</td><td>Play / Pause packet flow</td></tr>
                  <tr><td>S</td><td>Step forward one hop</td></tr>
                  <tr><td>←</td><td>Previous step</td></tr>
                  <tr><td>Esc</td><td>Reset simulation to Overview</td></tr>
                  <tr><td>L / D</td><td>Toggle Lesson list / Diagram focus</td></tr>
                  <tr><td>N</td><td>Open Markdown Study Notes drawer</td></tr>
                  <tr><td>Ctrl + K</td><td>Quick jump search across HLD</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        <AuthPortalModal
          open={authModalOpen}
          canDismiss={Boolean(overview)}
          onClose={() => {
            authStorage.setGuestEntered(true);
            setAuthModalOpen(false);
          }}
          onAuthenticated={handleAuthenticatedSession}
          onContinueAsGuest={() => setAuthModalOpen(false)}
        />

        <AccountModal
          open={accountModalOpen}
          user={currentUser}
          streak={streak}
          onClose={() => setAccountModalOpen(false)}
          onOpenAuthModal={() => setAuthModalOpen(true)}
          onProfileUpdated={(u, s) => {
            setCurrentUser(u);
            setStreak(s);
          }}
          onLogout={handleLogoutSession}
        />
      </div>
    </>
  );
}

export default App;
