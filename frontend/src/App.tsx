import { useEffect, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
  BookOpen,
  Box,
  Flag,
  Keyboard,
  LibraryBig,
  Map,
  Maximize2,
  MessageSquareWarning,
  Moon,
  NotebookPen,
  Search,
  Sun,
  User,
  X,
} from "lucide-react";
import {
  SIGNED_OUT_EVENT,
  api,
  authStorage,
  type AuthSessionResponse,
  type HldModuleItem,
  type LearnerProfile,
  type OverviewResponse,
  type ProgressSummary,
  type SearchHit,
  type StreakSummary,
  type UserProfile,
} from "./api/client";
import { AccountModal } from "./components/AccountModal";
import { AdminFeedbackView } from "./components/AdminFeedbackView";
import { AuthPortalModal } from "./components/AuthPortalModal";
import { CaseStudiesView } from "./components/CaseStudiesView";
import { ChapterView } from "./components/chapter/ChapterView";
import { ExplorerWorkspace } from "./components/ExplorerWorkspace";
import { LibraryView } from "./components/LibraryView";
import { ModulesView } from "./components/ModulesView";
import { NotesVaultView } from "./components/NotesVaultView";
import { PracticeAndDdiaView } from "./components/PracticeAndDdiaView";
import { SearchModal } from "./components/SearchModal";
import { LandingView } from "./components/LandingView";
import { LearnHome } from "./components/LearnHome";
import { QuickCheckView } from "./components/QuickCheckView";
import { ReviewView } from "./components/ReviewView";
import { WelcomeView } from "./components/WelcomeView";
import type { HldCaseStudy, HldExplorerLesson, PatternPlaybook } from "./types/hld";
import { NAV } from "./copy";
import { navKey, useRoute, type LibraryTab, type Route } from "./router";

type NavKey = "learn" | "review" | "library" | "notes" | "feedback";

/** Chapter 3 holds what the Capacity Lab used to: the estimator inputs and the reference tables. */
const NUMBERS_CHAPTER = "numbers-that-matter";
const FIRST_CHAPTER = "how-to-approach-a-design-question";

const NAV_ITEMS: Array<{ key: NavKey; label: string; icon: typeof Map; route: Route }> = [
  { key: "learn", label: NAV.learn, icon: Flag, route: { name: "learn" } },
  { key: "review", label: NAV.review, icon: BookOpen, route: { name: "review" } },
  { key: "library", label: NAV.library, icon: LibraryBig, route: { name: "library", tab: "topics" } },
  { key: "notes", label: NAV.notes, icon: NotebookPen, route: { name: "notes" } },
];

const THEME_KEY = "systemcraft.theme";
type Theme = "light" | "dark";
/** An explicit choice is remembered; otherwise the theme follows the system setting. */
function readThemeChoice(): Theme | null {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}
function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function App() {
  const [themeChoice, setThemeChoice] = useState<Theme | null>(readThemeChoice);
  const [sysTheme, setSysTheme] = useState<Theme>(systemTheme);
  const theme: Theme = themeChoice ?? sysTheme;
  const [route, navigate] = useRoute();
  const isPlayground = route.name === "library" && route.tab === "playground";
  const [v2TopicIds, setV2TopicIds] = useState<Set<string>>(new Set());
  const [selectedLayer, setSelectedLayer] = useState<number | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [modules, setModules] = useState<HldModuleItem[]>([]);
  const [, setSummary] = useState<ProgressSummary | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [streak, setStreak] = useState<StreakSummary | null>(null);
  // The alpha requires sign-in: nothing loads until there is a token, and any 401 signs the person out.
  const [signedIn, setSignedIn] = useState<boolean>(() => authStorage.hasSession());
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [accountModalOpen, setAccountModalOpen] = useState<boolean>(false);
  const [patterns, setPatterns] = useState<PatternPlaybook[]>([]);
  const [foundations, setFoundations] = useState<any>(null);

  const activeLessonId = route.name === "library" && route.tab === "playground" && route.id ? route.id : "dns-and-cdn";
  const [activeLesson, setActiveLesson] = useState<HldExplorerLesson | null>(null);
  const [loadingLesson, setLoadingLesson] = useState<boolean>(false);

  const activeCaseId = route.name === "library" && route.tab === "designs" && route.id ? route.id : "url-shortener";
  const [chapterInputs, setChapterInputs] = useState<{ inputs: Record<string, number>; label: string } | null>(null);
  const [pathRefresh, setPathRefresh] = useState(0);

  const [showLeftPane, setShowLeftPane] = useState<boolean>(false);
  const [diagramOnly, setDiagramOnly] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [shortcutsOpen, setShortcutsOpen] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => setSysTheme(mq.matches ? "dark" : "light");
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // Screen readers hear the new page: a title per screen, and focus moves to the content when the screen changes.
  const screenKey = route.name === "library" ? `library:${route.tab}` : route.name === "chapter" ? `chapter:${route.topicId}` : route.name;
  useEffect(() => {
    const titles: Record<string, string> = {
      learn: "Learn", chapter: "Chapter", welcome: "Your plan", check: "Test out", drill: "Refresher",
      review: "Review", library: "Library", notes: "Notes", feedback: "Feedback",
    };
    document.title = `${titles[route.name] ?? "SystemCraft"} · SystemCraft`;
    const main = document.getElementById("main-content");
    if (main && document.activeElement && document.activeElement !== document.body) main.focus({ preventScroll: true });
  }, [screenKey]);

  const toggleTheme = () => {
    const next: Theme = theme === "light" ? "dark" : "light";
    setThemeChoice(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
  };

  const setActiveLessonId = (id: string) => navigate({ name: "library", tab: "playground", id });
  const setActiveCaseId = (id: string) => navigate({ name: "library", tab: "designs", id });
  const goLibrary = (tab: LibraryTab) => navigate({ name: "library", tab });

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
      } else if (isPlayground && e.key.toLowerCase() === "l") {
        setDiagramOnly(false);
        setShowLeftPane((p) => !p);
      } else if (isPlayground && e.key.toLowerCase() === "d") {
        setDiagramOnly((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPlayground]);

  const refreshSummary = async () => {
    const [ov, sum, me] = await Promise.all([api.getOverview(), api.getProgressSummary(), api.getMe()]);
    setOverview(ov);
    setSummary(sum);
    setCurrentUser(me.user);
    setStreak(me.streak);
  };

  useEffect(() => {
    const onSignedOut = () => {
      setSignedIn(false);
      setAuthModalOpen(false);
      setAccountModalOpen(false);
      setCurrentUser(null);
      setOverview(null);
      setSummary(null);
      setProfile(null);
    };
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    setErrorMsg(null);
    Promise.all([
      api.getOverview(),
      api.getModules(),
      api.getProgressSummary(),
      api.getMe(),
      api.getPatterns(),
      api.getFoundations(),
    ])
      .then(([ov, mods, sum, me, pats, fnd]) => {
        setOverview(ov);
        setModules(mods.modules);
        setSummary(sum);
        setCurrentUser(me.user);
        setStreak(me.streak);
        setPatterns(pats.patterns);
        setFoundations(fnd);
      })
      .catch((err) => setErrorMsg(err.message));
    api
      .getProfile()
      .then(setProfile)
      .catch(() => setProfile(null));
    api
      .getPath("start-here")
      .then((p) => setV2TopicIds(new Set(p.stages.flatMap((st) => st.chapters.filter((c) => c.format === "v2").map((c) => c.topicId)))))
      .catch(() => undefined);
  }, [signedIn]);

  const handleAuthenticatedSession = async (session: AuthSessionResponse) => {
    setCurrentUser(session.user);
    setStreak(session.streak);
    setAuthModalOpen(false);
    if (signedIn) {
      await refreshSummary();
      api.getProfile().then(setProfile).catch(() => undefined);
      setPathRefresh((n) => n + 1);
    } else {
      setSignedIn(true);
    }
  };

  const openAuth = (mode: "login" | "register") => {
    setAuthMode(mode);
    setAuthModalOpen(true);
  };

  // New learners answer three short questions once. Skipping counts as answering, so this never nags.
  useEffect(() => {
    if (profile && !profile.onboarded && route.name === "learn") navigate({ name: "welcome" }, { replace: true });
  }, [profile, route.name]);

  /** "Start chapter 1" after onboarding opens wherever the plan says to begin. */
  const startLearning = async () => {
    setPathRefresh((n) => n + 1);
    try {
      const t = await api.getToday("hld");
      if (t.continue) {
        navigate({ name: "chapter", topicId: t.continue.topicId, stepKey: t.continue.stepKey ?? undefined });
        return;
      }
    } catch {
      /* fall through to chapter 1 */
    }
    navigate({ name: "chapter", topicId: FIRST_CHAPTER });
  };

  const handleLogoutSession = async () => {
    authStorage.setToken(null);
    authStorage.setGuest(false);
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  };

  useEffect(() => {
    if (!signedIn) return;
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
  }, [activeLessonId, signedIn]);

  const handleLayerSelect = (layer: number | null) => {
    setSelectedLayer(layer);
    const match = layer !== null && overview ? overview.lessons.find((l) => l.layer === layer && l.status === "ready") : null;
    navigate({ name: "library", tab: "playground", id: match?.id ?? activeLessonId });
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
    if (hit.kind === "chapter") {
      openChapter(hit.id);
      return;
    }
    if (hit.kind === "lesson" && hit.status === "ready") {
      openTopic(hit.id);
    } else if (hit.kind === "case_study" && hit.status === "ready") {
      setActiveCaseId(hit.id);
    } else if (hit.kind === "pattern" || hit.kind === "ddia") {
      navigate({ name: "review" });
    }
  };

  const openChapter = (topicId: string, inputs: { inputs: Record<string, number>; label: string } | null = null) => {
    setChapterInputs(inputs);
    navigate({ name: "chapter", topicId });
  };

  /** Chapters in the new format open in the reader; older lessons still open in the playground. */
  const openTopic = (id: string) => {
    if (v2TopicIds.has(id)) {
      openChapter(id);
      return;
    }
    const cs = overview?.caseStudies.find((c) => c.id === id);
    if (cs) setActiveCaseId(id);
    else setActiveLessonId(id);
  };

  /** A case study's estimation preset opens chapter 3 with those inputs (it replaced the Capacity Lab). */
  const handleLoadCasePreset = (preset: HldCaseStudy["estimationPreset"], title: string) => {
    const rwParts = preset.readWriteRatio.split(":");
    const r = Number(rwParts[0]) || 90;
    const w = Number(rwParts[1]) || 10;
    openChapter(NUMBERS_CHAPTER, {
      label: title,
      inputs: {
        dau: preset.dau,
        actions: preset.actionsPerUserPerDay,
        peak: preset.peakMultiplier,
        payload_bytes: preset.avgPayloadBytes,
        retention_years: preset.retentionYears,
        read_share: r / Math.max(1, r + w),
      },
    });
  };

  const openReadyTopic = (id: string) => {
    if (!overview) return;
    const ready = overview.lessons.some((l) => l.id === id && l.status === "ready") || overview.caseStudies.some((c) => c.id === id && c.status === "ready");
    if (ready || v2TopicIds.has(id)) openTopic(id);
  };

  const topicMeta = Object.fromEntries([
    ...(overview?.lessons ?? []).map((l) => [l.id, { title: l.title, ready: l.status === "ready", kind: "lesson" as const }]),
    ...(overview?.caseStudies ?? []).map((c) => [c.id, { title: c.title, ready: c.status === "ready", kind: "case_study" as const }]),
  ]);

  return (
    <>
      <MotionConfig reducedMotion="user">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="app-shell">
        {/* Studio 1 Frosted Glass Command Top Bar */}
        <header className="top-bar">
          <div className="top-bar-left" style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button className="brand-block" onClick={() => navigate({ name: "learn" })} title="Back to Learn" aria-label="SystemCraft, back to Learn">
              <span className="brand-reticle">
                <Box size={18} strokeWidth={1.9} />
              </span>
              <span>
                <span className="brand-title">SystemCraft</span>
                <span className="brand-sub">System design, practised</span>
              </span>
            </button>

            <nav className="nav-pills" aria-label="Main" style={signedIn ? undefined : { display: "none" }}>
              {(currentUser?.isAdmin
                ? [...NAV_ITEMS, { key: "feedback" as NavKey, label: NAV.feedback, icon: MessageSquareWarning, route: { name: "feedback" } as Route }]
                : NAV_ITEMS
              ).map((item) => {
                const isActive = navKey(route) === item.key;
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => navigate(item.route)}
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
          <div className="top-bar-right" style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button className="icon-btn" onClick={() => setSearchOpen(true)} title="Search (Ctrl+K)" aria-label="Search" style={{ whiteSpace: "nowrap" }}>
              <Search size={13} />
              <span className="hide-narrow">Search</span>
              <span className="badge hide-narrow" style={{ fontSize: 9.5 }}>Ctrl K</span>
            </button>

            {isPlayground && (
              <button
                className={`icon-btn ${diagramOnly ? "active" : ""}`}
                onClick={() => setDiagramOnly((p) => !p)}
                aria-label="Toggle diagram focus mode"
                title="Diagram focus mode (D)"
              >
                <Maximize2 size={13} />
              </button>
            )}

            <button className="icon-btn hide-narrow" aria-label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)} title="Keyboard shortcuts (?)">
              <Keyboard size={13} />
            </button>

            <button
              className="icon-btn"
              aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
              onClick={toggleTheme}
              title={theme === "light" ? "Dark theme" : "Light theme"}
            >
              {theme === "light" ? <Moon size={13} /> : <Sun size={13} />}
            </button>

            {/* Account. The streak lives on Learn now, next to the plan. */}
            {signedIn && (
              <button
                className="icon-btn"
                data-tone={currentUser?.isGuest ? "accent" : undefined}
                onClick={() => (currentUser?.isGuest ? openAuth("register") : setAccountModalOpen(true))}
                aria-label={currentUser?.isGuest ? "Save your progress to an account" : "Account"}
                title={currentUser?.isGuest ? "Save your progress to an account" : "Account"}
              >
                <User size={12} />
                <span>{currentUser && !currentUser.isGuest ? currentUser.displayName : <>Save<span className="hide-narrow"> progress</span></>}</span>
              </button>
            )}
            {!signedIn && (
              <button className="icon-btn" onClick={() => openAuth("login")}>
                <User size={12} /> <span>Sign in</span>
              </button>
            )}
          </div>
        </header>

        {errorMsg && (
          <div style={{ padding: "8px 16px", background: "var(--danger-bg)", color: "var(--danger)", fontSize: 12 }} className="mono">
            Could not reach the server: {errorMsg}. Check your connection and reload.
          </div>
        )}

        {!signedIn ? (
          <LandingView
            onOpenAuth={openAuth}
            onAuthenticated={(session) => {
              navigate({ name: "welcome" }, { replace: true });
              handleAuthenticatedSession(session);
            }}
          />
        ) : !overview ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }} className="mono">
            Loading…
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.main
              id="main-content"
              tabIndex={-1}
              key={route.name === "library" ? `library:${route.tab}` : route.name}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}
            >
              {route.name === "learn" ? (
                <LearnHome
                  refreshKey={pathRefresh}
                  isGuest={Boolean(currentUser?.isGuest)}
                  onboarded={Boolean(profile?.onboarded)}
                  onOpenChapter={(id, stepKey) => {
                    setChapterInputs(null);
                    navigate({ name: "chapter", topicId: id, stepKey: stepKey ?? undefined });
                  }}
                  onOpenReview={() => navigate({ name: "review" })}
                  onOpenPlan={() => navigate({ name: "welcome" })}
                  onSaveProgress={() => openAuth("register")}
                  onTestOut={(stageId) => navigate({ name: "check", stageId })}
                  onDrill={(topicId) => navigate({ name: "drill", topicId })}
                />
              ) : route.name === "check" || route.name === "drill" ? (
                <QuickCheckView
                  key={route.name === "check" ? `check:${route.stageId}` : `drill:${route.topicId}`}
                  mode={route.name === "check" ? { kind: "check", pathId: "start-here", stageId: route.stageId } : { kind: "drill", topicId: route.topicId }}
                  onDone={() => {
                    setPathRefresh((n) => n + 1);
                    navigate({ name: "learn" });
                  }}
                  onOpenChapter={(id) => navigate({ name: "chapter", topicId: id })}
                />
              ) : route.name === "welcome" ? (
                <WelcomeView
                  key={profile?.onboarded ? "edit" : "new"}
                  profile={profile}
                  onDone={(saved, start) => {
                    if (saved) setProfile(saved);
                    else setProfile((p) => (p ? { ...p, onboarded: true } : p));
                    if (start) startLearning();
                    else {
                      setPathRefresh((n) => n + 1);
                      navigate({ name: "learn" });
                    }
                  }}
                />
              ) : route.name === "chapter" ? (
                <ChapterView
                  key={route.topicId}
                  topicId={route.topicId}
                  stepKey={route.stepKey ?? null}
                  onStepChange={(stepKey) => navigate({ name: "chapter", topicId: route.topicId, stepKey }, { replace: true })}
                  initialInputs={chapterInputs?.inputs ?? null}
                  initialLabel={chapterInputs?.label ?? null}
                  onBack={() => {
                    setPathRefresh((n) => n + 1);
                    navigate({ name: "learn" });
                  }}
                  onOpenSandbox={(lessonId) => setActiveLessonId(lessonId)}
                  onOpenChapter={(id) => {
                    setPathRefresh((n) => n + 1);
                    openTopic(id);
                  }}
                  onOpenReview={(id) => navigate({ name: "review", topicId: id, all: true })}
                  isGuest={Boolean(currentUser?.isGuest)}
                  onSaveProgress={() => openAuth("register")}
                />
              ) : route.name === "library" ? (
                <LibraryView
                  tab={route.tab}
                  onTab={goLibrary}
                  lessons={overview.lessons}
                  caseStudies={overview.caseStudies}
                  onOpenChapter={openTopic}
                  onOpenDesign={setActiveCaseId}
                >
                  {route.tab === "reading" ? (
                    <ModulesView
                      modules={modules}
                      topicMetaById={topicMeta}
                      onNoteSaved={refreshSummary}
                      onOpenTopic={openReadyTopic}
                    />
                  ) : route.tab === "playground" ? (
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
                      onJumpToPractice={(topicId) => navigate({ name: "review", topicId })}
                    />
                  ) : route.tab === "designs" && route.id ? (
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
                  ) : null}
                </LibraryView>
              ) : route.name === "notes" ? (
                <NotesVaultView
                  key={currentUser?.id ?? "guest"}
                  topicMetaById={topicMeta}
                  onDataChanged={refreshSummary}
                  onOpenTopic={openReadyTopic}
                />
              ) : route.name === "feedback" && currentUser?.isAdmin ? (
                <AdminFeedbackView
                  topicTitleById={Object.fromEntries([
                    ...overview.lessons.map((l) => [l.id, l.title]),
                    ...overview.caseStudies.map((c) => [c.id, c.title]),
                    ...modules.map((m) => [m.id, m.title]),
                  ])}
                />
              ) : route.name === "review" ? (
                <ReviewView
                  key={currentUser?.id ?? "guest"}
                  all={Boolean(route.all)}
                  topicFilter={route.topicId ?? null}
                  topicTitle={route.topicId ? topicMeta[route.topicId]?.title ?? null : null}
                  onTab={(all) => navigate({ name: "review", topicId: route.topicId, all })}
                  onClearTopic={() => navigate({ name: "review", all: route.all })}
                  onContinueLearning={() => {
                    setPathRefresh((n) => n + 1);
                    navigate({ name: "learn" });
                  }}
                >
                  {route.all && (
                    <PracticeAndDdiaView
                      key={`${currentUser?.id ?? "guest"}:${route.topicId ?? ""}`}
                      topicFilter={route.topicId ?? null}
                      onClearTopicFilter={() => navigate({ name: "review", all: true })}
                      patterns={patterns}
                      foundations={foundations}
                      topicMetaById={topicMeta}
                      onPracticeUpdated={refreshSummary}
                      onOpenTopic={openReadyTopic}
                    />
                  )}
                </ReviewView>
              ) : null}
            </motion.main>
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
                  <tr><td>Space</td><td>Play or pause requests (playground)</td></tr>
                  <tr><td>S</td><td>Move one hop forward</td></tr>
                  <tr><td>←</td><td>Previous step</td></tr>
                  <tr><td>Esc</td><td>Reset the playground</td></tr>
                  <tr><td>L / D</td><td>Show the lesson list / show only the diagram</td></tr>
                  <tr><td>N</td><td>Open notes</td></tr>
                  <tr><td>Ctrl + K</td><td>Search</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        <AuthPortalModal
          open={authModalOpen}
          canDismiss
          initialMode={authMode}
          onClose={() => setAuthModalOpen(false)}
          onAuthenticated={handleAuthenticatedSession}
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
      </MotionConfig>
    </>
  );
}

export default App;
