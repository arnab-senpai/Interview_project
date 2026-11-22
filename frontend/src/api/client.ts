import type {
  FlashcardItem,
  HldCaseStudy,
  HldExplorerLesson,
  PatternPlaybook,
  QuizQuestion,
  QuizReveal,
} from "../types/hld";

export interface LayerMeta {
  layer: number;
  shortName: string;
  title: string;
  description: string;
}

export interface LessonIndexItem {
  id: string;
  layer: number;
  category: string;
  title: string;
  subtitle: string;
  difficulty: string;
  estimatedMinutes: number;
  status: "ready" | "planned";
  dataFile?: string;
}

export interface CaseStudyIndexItem {
  id: string;
  tier: number;
  title: string;
  levelTag: string;
  tags: string[];
  status: "ready" | "planned";
  dataFile?: string;
}

export interface TopicProgress {
  topicId: string;
  kind: "lesson" | "case_study";
  status: "not_started" | "in_progress" | "completed";
  completedSteps: number[];
  activeLens: "intuition" | "mechanics" | "staffTradeoffs";
  updatedAt: string;
}

export interface OverviewResponse {
  layers: LayerMeta[];
  lessons: LessonIndexItem[];
  caseStudies: CaseStudyIndexItem[];
  progressByTopic: Record<string, TopicProgress>;
}

export interface StreakDay {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  lessons: number;
  flashcards: number;
  quizzes: number;
  notes: number;
}

export interface StreakSummary {
  currentStreak: number;
  longestStreak: number;
  todayActions: number;
  dailyGoal: number;
  activeDays: number;
  heatmap: StreakDay[];
}

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  email: string;
  dailyGoal: number;
  preferredLens: "intuition" | "mechanics" | "staffTradeoffs";
  isGuest: boolean;
  isAdmin: boolean;
  createdAt: string;
}

export type FeedbackCategory = "wrong" | "unclear" | "outdated" | "typo" | "other";
export type FeedbackStatus = "open" | "resolved" | "wont_fix";

export interface FeedbackItem {
  id: number;
  userId: string;
  topicId: string;
  blockId: string;
  contentVersion: string;
  category: FeedbackCategory;
  message: string;
  pageUrl: string;
  status: FeedbackStatus;
  adminNote: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AdminFeedbackItem extends FeedbackItem {
  reporter: string;
  isCurrentVersion: boolean;
  issueUrl: string | null;
}

export interface AuthSessionResponse {
  accessToken: string;
  tokenType: string;
  expiresAt: string;
  user: UserProfile;
  streak: StreakSummary;
}

export interface PersonalTokenItem {
  id: number;
  label: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
}

export interface StudyNote {
  id: number;
  topicId: string;
  title: string;
  contentMd: string;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HldModuleItem {
  id: string;
  moduleNumber: number;
  title: string;
  ddiaSources: string[];
  tppSources: string[];
  linkedLessonIds: string[];
  linkedCaseStudyIds: string[];
  deepDiveFoundations: {
    heading: string;
    corePrinciple: string;
    mechanicsAndConstraints: string;
    tppApplication: string;
    keyMetricsOrFormulas: string[];
  }[];
  tradeoffsMatrix: {
    option: string;
    pros: string;
    consBottlenecks: string;
    idealWorkload: string;
  }[];
  caseStudy: {
    systemName: string;
    problemStatement: string;
    functionalRequirements: string[];
    nonFunctionalRequirements: string[];
    trafficSummary: string;
    estimates: { label: string; calculation: string; result: string }[];
    architectureFlow: string;
    services: { name: string; responsibility: string; technologyChoice: string }[];
    dataModelAndStorage: string;
    deepDives: {
      title: string;
      failureScenario: string;
      mitigationMechanics: string;
      etcTradeoff: string;
    }[];
  };
  candidateRubric: {
    juniorMid: { summary: string; signals: string[] };
    senior: { summary: string; signals: string[] };
    staffPrincipal: { summary: string; signals: string[] };
  };
}

export interface ProgressSummary {
  completedLessons: number;
  readyLessons: number;
  completedCaseStudies: number;
  readyCaseStudies: number;
  totalFlashcards: number;
  dueFlashcards: number;
  quizzesAnswered: number;
  quizzesCorrect: number;
  totalQuizzes: number;
  progressByTopic: Record<string, TopicProgress>;
  streak?: {
    currentStreak: number;
    longestStreak: number;
    todayActions: number;
    dailyGoal: number;
  };
}

export interface FlashcardWithSm2 extends FlashcardItem {
  sm2: {
    repetitions: number;
    intervalDays: number;
    easinessFactor: number;
    nextReviewDate: string;
    lastRating: string;
  };
  isDue: boolean;
}

export interface QuizAnswerResult extends QuizReveal {
  questionId: string;
  selectedIndex: number;
  isCorrect: boolean;
  answeredAt: string;
}

export interface QuizWithAttempt extends QuizQuestion {
  lastAttempt?: (QuizReveal & {
    selectedIndex: number;
    isCorrect: boolean;
    answeredAt: string;
  }) | null;
}

export interface CapacityResult {
  metrics: Record<string, number>;
  workedSteps: { label: string; formula: string; result: string }[];
}

export interface SearchHit {
  kind: "lesson" | "case_study" | "pattern" | "ddia";
  id: string;
  title: string;
  subtitle: string;
  layer?: number;
  tier?: number;
  status: string;
}

const AUTH_TOKEN_STORAGE_KEY = "systemcraft_auth_token";

/** Fired when the API answers 401: the token is missing, expired or revoked. */
export const SIGNED_OUT_EVENT = "systemcraft:signed-out";

export const authStorage = {
  getToken: () => window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY),
  setToken: (token: string | null) => {
    if (token) window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  },
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const token = authStorage.getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(url, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.detail) msg = String(parsed.detail);
    } catch {
      // plain error text
    }
    // Sign-in is required for the alpha. A 401 on anything except the sign-in
    // calls themselves means the session is gone, so send the person back to sign in.
    if (res.status === 401 && !url.startsWith("/api/auth/login") && !url.startsWith("/api/auth/register")) {
      authStorage.setToken(null);
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    }
    throw new Error(msg || `API ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  reportIssue: (payload: {
    topicId: string;
    blockId: string;
    category: FeedbackCategory;
    message: string;
    pageUrl?: string;
  }) =>
    fetchJson<{ feedback: FeedbackItem }>("/api/feedback", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  adminListFeedback: (status: FeedbackStatus | "all" = "open") =>
    fetchJson<{ feedback: AdminFeedbackItem[]; countsByTopic: Record<string, Record<FeedbackStatus, number>> }>(
      `/api/admin/feedback?status=${status}`
    ),
  adminUpdateFeedback: (id: number, status: FeedbackStatus, adminNote = "") =>
    fetchJson<{ feedback: FeedbackItem }>(`/api/admin/feedback/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, adminNote }),
    }),
  getOverview: () => fetchJson<OverviewResponse>("/api/hld/overview"),
  getModules: () => fetchJson<{ version: string; modules: HldModuleItem[] }>("/api/hld/modules"),
  getLesson: (id: string) => fetchJson<HldExplorerLesson>(`/api/hld/lessons/${id}`),
  getCaseStudy: (id: string) => fetchJson<HldCaseStudy>(`/api/hld/case-studies/${id}`),
  getPatterns: () => fetchJson<{ version: string; patterns: PatternPlaybook[] }>("/api/hld/patterns"),
  getFoundations: () => fetchJson<any>("/api/hld/foundations"),
  getReference: () => fetchJson<any>("/api/hld/reference"),
  getTracks: () => fetchJson<any>("/api/tracks"),
  search: (q: string) =>
    fetchJson<{ query: string; results: SearchHit[] }>(`/api/hld/search?q=${encodeURIComponent(q)}`),
  getProgressSummary: () => fetchJson<ProgressSummary>("/api/progress/summary"),
  saveProgress: (
    topicId: string,
    payload: {
      kind: "lesson" | "case_study";
      status: "not_started" | "in_progress" | "completed";
      completedSteps: number[];
      activeLens: "intuition" | "mechanics" | "staffTradeoffs";
    }
  ) =>
    fetchJson<TopicProgress>(`/api/progress/lessons/${topicId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getFlashcards: (params?: { topicId?: string; dueOnly?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.topicId) qs.set("topic_id", params.topicId);
    if (params?.dueOnly) qs.set("due_only", "true");
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return fetchJson<{ flashcards: FlashcardWithSm2[] }>(`/api/flashcards${suffix}`);
  },
  reviewFlashcard: (cardId: string, rating: "again" | "hard" | "good" | "easy") =>
    fetchJson<{ cardId: string; sm2: FlashcardWithSm2["sm2"] }>(`/api/flashcards/${cardId}/review`, {
      method: "POST",
      body: JSON.stringify({ rating }),
    }),
  getQuizzes: (topicId?: string) => {
    const suffix = topicId ? `?topic_id=${encodeURIComponent(topicId)}` : "";
    return fetchJson<{ quizzes: QuizWithAttempt[] }>(`/api/quizzes${suffix}`);
  },
  answerQuiz: (questionId: string, selectedIndex: number) =>
    fetchJson<QuizAnswerResult>(`/api/quizzes/${questionId}/answer`, {
      method: "POST",
      body: JSON.stringify({ selectedIndex }),
    }),
  calculateCapacity: (payload: {
    title: string;
    dau: number;
    actionsPerUserPerDay: number;
    peakMultiplier: number;
    avgPayloadBytes: number;
    retentionYears: number;
    readSharePercent: number;
    replicationFactor: number;
    saveRun?: boolean;
  }) =>
    fetchJson<CapacityResult>("/api/estimator/calculate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getEstimatorRuns: () => fetchJson<{ runs: any[] }>("/api/estimator/runs"),
  getRubric: (caseStudyId: string) =>
    fetchJson<{ caseStudyId: string; checkedCriteria: string[]; notes: string; score: number }>(
      `/api/case-studies/${caseStudyId}/rubric`
    ),
  saveRubric: (
    caseStudyId: string,
    payload: { checkedCriteria: string[]; notes: string; score: number }
  ) =>
    fetchJson(`/api/case-studies/${caseStudyId}/rubric`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  register: (payload: {
    username: string;
    password: string;
    displayName?: string;
    email?: string;
    dailyGoal?: number;
  }) =>
    fetchJson<AuthSessionResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  login: (payload: { username: string; password: string }) =>
    fetchJson<AuthSessionResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getMe: () =>
    fetchJson<{ authenticated: boolean; user: UserProfile; streak: StreakSummary }>("/api/auth/me"),
  updatePreferences: (payload: {
    displayName?: string;
    dailyGoal?: number;
    preferredLens?: "intuition" | "mechanics" | "staffTradeoffs";
  }) =>
    fetchJson<{ user: UserProfile; streak: StreakSummary }>("/api/auth/preferences", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  listTokens: () => fetchJson<{ tokens: PersonalTokenItem[] }>("/api/auth/tokens"),
  createToken: (payload: { label: string; expiresDays?: number | null }) =>
    fetchJson<{ rawToken: string; token: PersonalTokenItem }>("/api/auth/tokens", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  revokeToken: (tokenId: number) =>
    fetchJson<{ revoked: boolean; id: number }>(`/api/auth/tokens/${tokenId}`, {
      method: "DELETE",
    }),
  getStreak: () => fetchJson<StreakSummary>("/api/progress/streak"),
  listNotes: (params?: { topicId?: string; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.topicId) qs.set("topic_id", params.topicId);
    if (params?.q) qs.set("q", params.q);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return fetchJson<{ notes: StudyNote[] }>(`/api/notes${suffix}`);
  },
  getNote: (topicId: string) =>
    fetchJson<{ exists: boolean; note: StudyNote }>(`/api/notes/${encodeURIComponent(topicId)}`),
  saveNote: (
    topicId: string,
    payload: { title: string; contentMd: string; tags: string[]; pinned: boolean }
  ) =>
    fetchJson<{ note: StudyNote }>(`/api/notes/${encodeURIComponent(topicId)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteNote: (topicId: string) =>
    fetchJson<{ deleted: boolean; topicId: string }>(`/api/notes/${encodeURIComponent(topicId)}`, {
      method: "DELETE",
    }),
};
