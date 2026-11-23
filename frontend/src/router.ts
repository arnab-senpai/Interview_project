import { useCallback, useEffect, useState } from "react";

/**
 * A small History API router. The backend already serves index.html for unknown paths,
 * so every screen gets a real URL: refresh keeps your place, Back works, steps can be shared.
 *
 *   /learn                         the path (home)
 *   /learn/:topicId[/:stepKey]     a chapter, optionally at one step
 *   /review                        review cards and checks
 *   /library[/:tab]                topics | designs | reading | playground
 *   /library/designs/:id           one guided design (case study)
 *   /library/playground/:lessonId  the simulator on one lesson
 *   /notes, /feedback
 */
export type LibraryTab = "topics" | "designs" | "reading" | "playground";

export type Route =
  | { name: "learn" }
  | { name: "chapter"; topicId: string; stepKey?: string }
  | { name: "review"; topicId?: string }
  | { name: "library"; tab: LibraryTab; id?: string }
  | { name: "notes" }
  | { name: "feedback" };

const LIBRARY_TABS: LibraryTab[] = ["topics", "designs", "reading", "playground"];

export function parseRoute(pathname: string, search = ""): Route {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [head, a, b] = parts;
  switch (head) {
    case undefined:
    case "learn":
      return a ? { name: "chapter", topicId: a, stepKey: b } : { name: "learn" };
    case "review": {
      const topicId = new URLSearchParams(search).get("topic") ?? undefined;
      return { name: "review", topicId };
    }
    case "library": {
      const tab = (LIBRARY_TABS as string[]).includes(a ?? "") ? (a as LibraryTab) : "topics";
      return { name: "library", tab, id: b };
    }
    case "notes":
      return { name: "notes" };
    case "feedback":
      return { name: "feedback" };
    default:
      return { name: "learn" };
  }
}

export function routeToPath(r: Route): string {
  const enc = encodeURIComponent;
  switch (r.name) {
    case "learn":
      return "/learn";
    case "chapter":
      return `/learn/${enc(r.topicId)}${r.stepKey ? `/${enc(r.stepKey)}` : ""}`;
    case "review":
      return r.topicId ? `/review?topic=${enc(r.topicId)}` : "/review";
    case "library":
      return `/library/${r.tab}${r.id ? `/${enc(r.id)}` : ""}`;
    case "notes":
      return "/notes";
    case "feedback":
      return "/feedback";
  }
}

/** The tab a route belongs to, for the top navigation. */
export function navKey(r: Route): "learn" | "review" | "library" | "notes" | "feedback" {
  if (r.name === "chapter") return "learn";
  return r.name;
}

export function useRoute(): [Route, (r: Route, opts?: { replace?: boolean }) => void] {
  const read = () => parseRoute(window.location.pathname, window.location.search);
  const [route, setRoute] = useState<Route>(read);

  useEffect(() => {
    const onPop = () => setRoute(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((r: Route, opts?: { replace?: boolean }) => {
    const path = routeToPath(r);
    const current = window.location.pathname + window.location.search;
    if (path !== current) {
      if (opts?.replace) window.history.replaceState(null, "", path);
      else window.history.pushState(null, "", path);
    }
    setRoute(r);
  }, []);

  return [route, navigate];
}
