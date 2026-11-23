/**
 * Learner-facing words in one place. Name things by what the learner does, not by how we built them:
 * no algorithm names (SM-2), no auth details, no internal layer numbers.
 */

/** Content levels are written Junior / Mid / Senior / Staff; learners see three plain words. */
export function levelLabel(level?: string | null): string {
  const l = (level ?? "").toLowerCase();
  if (!l) return "";
  if (l.startsWith("junior") || l.startsWith("beginner")) return "Beginner";
  if (l.startsWith("mid") || l.startsWith("intermediate")) return "Intermediate";
  if (l.startsWith("senior") || l.startsWith("staff") || l.startsWith("principal") || l.startsWith("advanced")) return "Advanced";
  return level ?? "";
}

/** Chapter layers: what the learner is doing in that part of the chapter. */
export const LAYER_LABELS: Record<string, string> = {
  understand: "Learn it",
  apply: "Use it",
  defend: "Explain it",
  practice: "Practise",
  cheatSheet: "Reference",
};

export const NAV = {
  learn: "Learn",
  review: "Review",
  library: "Library",
  notes: "Notes",
  feedback: "Feedback",
} as const;

export const LIBRARY_TABS = {
  topics: "Topics",
  designs: "Guided designs",
  reading: "Reading list",
  playground: "Playground",
} as const;

export const PREVIEW_NOTE = "Preview: this chapter still uses the older lesson page.";
