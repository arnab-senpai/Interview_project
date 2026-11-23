import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, ChevronDown, Compass, Gauge, RotateCcw, Sparkles, X } from "lucide-react";
import { api } from "../../api/client";
import { inputDependencies, solveValues } from "../../content/formula";
import { firstUses } from "../../content/glossary";
import {
  computeFigureNumbers,
  diffFigure,
  formatValue,
  resolveFigure,
  TARGET_UTILIZATION,
  type Change,
} from "../../content/numbers";
import type { Block, LayerName, NumberInput, TopicProgressV2, TopicV2 } from "../../content/types";
import { BlockRenderer, type BlockContext } from "./ChapterBlocks";
import { LAYER_LABELS, PREVIEW_NOTE } from "../../copy";
import { renderMarkdown } from "../../utils/markdown";

const SECTION_TITLES: Record<string, string> = {
  problem: "The problem",
  clarify: "Clarify",
  numbers: "Numbers",
  deepDive: "Deep dive",
  remember: "Remember",
  check: "Check yourself",
};
const LAYER_TITLES = LAYER_LABELS as Record<LayerName, string>;

interface Step {
  key: string;
  title: string;
  kicker: string;
  layer: LayerName;
  blocks: Block[];
}

/** Content titles read "Step 3 · Many app servers"; the step list already shows the number. */
const stripStep = (t?: string) => (t ?? "").replace(/^Step\s+\d+\s*[·:.-]\s*/i, "");

/** Chapter steps: fixed sections, one step per design idea (its text and figures), then the later layers. */
export function buildSteps(topic: TopicV2): Step[] {
  if (topic.legacy) return buildPreviewSteps(topic);
  const steps: Step[] = [];
  let designN = 0;
  let current: Step | null = null;
  const push = (s: Step) => {
    steps.push(s);
    current = s;
  };
  for (const b of topic.blocks) {
    const cur = current as Step | null;
    if (b.section === "design") {
      // A design step is its text plus the figures that follow it.
      if (b.type === "prose" || !cur || !cur.key.startsWith("design-")) {
        designN += 1;
        push({ key: `design-${designN}`, kicker: `Step ${designN}`, title: stripStep(b.title), layer: b.layer, blocks: [b] });
      } else {
        cur.blocks.push(b);
        if (!cur.title && b.title) cur.title = stripStep(b.title);
      }
      continue;
    }
    const key = b.section ? `section-${b.section}` : `layer-${b.layer}`;
    if (cur && cur.key === key) {
      cur.blocks.push(b);
      continue;
    }
    const title = b.section ? SECTION_TITLES[b.section] ?? b.section : LAYER_TITLES[b.layer];
    push({ key, kicker: LAYER_TITLES[b.layer], title, layer: b.layer, blocks: [b] });
  }
  return steps;
}

/**
 * Older pages adapted into the reader have no chapter sections: each titled block becomes a step,
 * untitled blocks join the step before them, and the questions are gathered into Check yourself.
 */
function buildPreviewSteps(topic: TopicV2): Step[] {
  const steps: Step[] = [];
  const checks: Block[] = [];
  let n = 0;
  for (const b of topic.blocks) {
    if (b.checkable && !b.title) {
      checks.push(b);
      continue;
    }
    const last = steps[steps.length - 1];
    if (!b.title && last) {
      last.blocks.push(b);
      continue;
    }
    // A figure or a walk-through belongs with the explanation right before it.
    if ((b.type === "figure" || b.type === "trace") && last && last.blocks.length === 1 && last.blocks[0].type === "prose") {
      last.blocks.push(b);
      continue;
    }
    n += 1;
    steps.push({ key: `part-${n}`, kicker: LAYER_TITLES[b.layer], title: b.title ?? topic.title, layer: b.layer, blocks: [b] });
  }
  if (checks.length) steps.push({ key: "section-check", kicker: LAYER_TITLES.apply, title: SECTION_TITLES.check, layer: "apply", blocks: checks });
  return steps;
}

function sliderToValue(inp: NumberInput, t: number): number {
  if (inp.scale === "log" && inp.min > 0) {
    const v = Math.exp(Math.log(inp.min) + t * (Math.log(inp.max) - Math.log(inp.min)));
    const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1);
    return Math.round(v / mag) * mag;
  }
  const raw = inp.min + t * (inp.max - inp.min);
  const step = inp.step ?? (inp.max - inp.min) / 100;
  return Math.round(raw / step) * step;
}
function valueToSlider(inp: NumberInput, v: number): number {
  if (inp.scale === "log" && inp.min > 0) return (Math.log(Math.max(v, inp.min)) - Math.log(inp.min)) / (Math.log(inp.max) - Math.log(inp.min));
  return (v - inp.min) / (inp.max - inp.min || 1);
}

interface ChapterViewProps {
  topicId: string;
  track?: string;
  /** Inputs to start with, e.g. a case study's estimation preset. */
  initialInputs?: Record<string, number> | null;
  initialLabel?: string | null;
  /** The step in the URL, e.g. "design-3"; the chapter opens there. */
  stepKey?: string | null;
  onStepChange?: (stepKey: string) => void;
  onBack: () => void;
  onOpenSandbox?: (lessonId: string) => void;
  /** Open another chapter (the next one on the path). */
  onOpenChapter?: (topicId: string) => void;
  /** Open review filtered to this chapter. */
  onOpenReview?: (topicId: string) => void;
}

/** Step key of the end-of-chapter screen, so it has its own URL. */
export const DONE_STEP = "done";

const NUMBERS_OPEN_KEY = "systemcraft.numbersOpen";
function readNumbersOpen(): boolean {
  try {
    const v = window.localStorage.getItem(NUMBERS_OPEN_KEY);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* fall through */
  }
  return window.matchMedia?.("(min-width: 1280px)").matches ?? false;
}

interface StepFigureNote {
  tone: "over" | "warm";
  text: string;
}


export const ChapterView: React.FC<ChapterViewProps> = ({
  topicId,
  track = "hld",
  initialInputs,
  initialLabel,
  stepKey,
  onStepChange,
  onBack,
  onOpenSandbox,
  onOpenChapter,
  onOpenReview,
}) => {
  const [topic, setTopic] = useState<TopicV2 | null>(null);
  const [progress, setProgress] = useState<TopicProgressV2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [finished, setFinished] = useState(false);
  const [inputs, setInputs] = useState<Record<string, number>>({});
  const [prevInputs, setPrevInputs] = useState<Record<string, number> | null>(null);
  const [lastChanged, setLastChanged] = useState<Set<string>>(new Set());
  const [presetLabel, setPresetLabel] = useState<string | null>(null);
  const [numbersOpen, setNumbersOpen] = useState<boolean>(readNumbersOpen);
  const [moreInputs, setMoreInputs] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [nextChapter, setNextChapter] = useState<{ topicId: string; number: number; title: string } | null>(null);
  const [chapterNumber, setChapterNumber] = useState<number | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setTopic(null);
    setError(null);
    api
      .getTopicV2(track, topicId)
      .then(({ topic: t, progress: p }) => {
        if (cancelled) return;
        setTopic(t);
        setProgress(p);
        const defaults = Object.fromEntries(t.numbers.inputs.map((i) => [i.id, i.default]));
        const start = { ...defaults };
        if (initialInputs) for (const [k, v] of Object.entries(initialInputs)) if (k in start && Number.isFinite(v)) start[k] = v;
        setInputs(start);
        setPrevInputs(null);
        setLastChanged(new Set());
        setPresetLabel(initialInputs ? initialLabel ?? "Your inputs" : null);
      })
      .catch((e) => !cancelled && setError(e.message ?? String(e)));
    return () => {
      cancelled = true;
    };
  }, [track, topicId, initialInputs, initialLabel]);

  // Funnel events for the admin view (best effort).
  useEffect(() => {
    if (!topic) return;
    api.sendEvents([{ kind: topic.legacy ? "preview_opened" : "chapter_opened", topicId: topic.id }]);
  }, [topic]);

  // Where this chapter sits on the path, for "Chapter N" and the next chapter button.
  useEffect(() => {
    let cancelled = false;
    api
      .getPath("start-here")
      .then((p) => {
        if (cancelled) return;
        const all = p.stages.flatMap((s) => s.chapters);
        const i = all.findIndex((c) => c.topicId === topicId);
        setChapterNumber(i >= 0 ? all[i].number : null);
        const next = i >= 0 ? all.slice(i + 1).find((c) => c.available) : undefined;
        setNextChapter(next ? { topicId: next.topicId, number: next.number, title: next.title } : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [topicId]);

  const steps = useMemo(() => (topic ? buildSteps(topic) : []), [topic]);
  const designSteps = useMemo(() => steps.filter((s) => s.key.startsWith("design-")), [steps]);

  // The URL owns the step: follow it (Back and Forward), and write it when the learner moves.
  useEffect(() => {
    if (!steps.length) return;
    if (stepKey === DONE_STEP) {
      setFinished(true);
      setStepIdx(steps.length - 1);
      return;
    }
    setFinished(false);
    const i = stepKey ? steps.findIndex((s) => s.key === stepKey) : 0;
    setStepIdx(i >= 0 ? i : 0);
  }, [steps, stepKey]);
  const goStep = (i: number) => {
    const next = Math.max(0, Math.min(steps.length - 1, i));
    setFinished(false);
    setStepIdx(next);
    setRailOpen(false);
    // On a phone the numbers are a bottom sheet: close it when the learner moves on so it never covers a new step.
    if (window.matchMedia?.("(max-width: 760px)").matches) setNumbersOpen(false);
    if (steps[next]) onStepChange?.(steps[next].key);
  };
  const finish = () => {
    setFinished(true);
    onStepChange?.(DONE_STEP);
    mainRef.current?.scrollTo({ top: 0 });
  };

  const step = steps[Math.min(stepIdx, Math.max(0, steps.length - 1))];
  const env = useMemo(() => (topic ? solveValues(inputs, topic.numbers.values) : {}), [topic, inputs]);
  const prevEnv = useMemo(() => (topic && prevInputs ? solveValues(prevInputs, topic.numbers.values) : null), [topic, prevInputs]);

  // Record views for the blocks on the current step.
  useEffect(() => {
    if (!topic || !step || finished) return;
    const ids = step.blocks.map((b) => b.id);
    api
      .saveBlockViews(topic.id, ids)
      .then((r) => setProgress(r.progress))
      .catch(() => undefined);
    mainRef.current?.scrollTo({ top: 0 });
  }, [topic, step, finished]);

  // Glossary: underline a term the first time this step uses it.
  const terms = useMemo(() => {
    if (!step) return new Map<string, Set<string>>();
    return firstUses(step.blocks.filter((b) => b.type === "prose").map((b) => ({ key: b.id, text: (b as { body?: string }).body ?? "" })));
  }, [step]);

  // The numbers only make sense once the chapter has introduced them: the drawer appears from the Numbers section on.
  const numbersFrom = useMemo(() => {
    const i = steps.findIndex((s) => s.key === "section-numbers");
    if (i >= 0) return i;
    const d = steps.findIndex((s) => s.key.startsWith("design-"));
    return d >= 0 ? d : steps.length;
  }, [steps]);
  const hasNumbers = (topic?.numbers.inputs.length ?? 0) > 0;
  const numbersAvailable = hasNumbers && !finished && stepIdx >= numbersFrom;
  const showNumbers = numbersAvailable && numbersOpen;
  const toggleNumbers = () => {
    const next = !numbersOpen;
    setNumbersOpen(next);
    try {
      window.localStorage.setItem(NUMBERS_OPEN_KEY, next ? "1" : "0");
    } catch {
      /* the choice lasts for this visit */
    }
  };

  const stepFigures = useMemo(() => {
    if (!topic || !step) return [];
    return step.blocks
      .filter((b) => b.type === "figure")
      .map((b) => resolveFigure(topic, b.id))
      .filter((f): f is NonNullable<typeof f> => Boolean(f));
  }, [topic, step]);

  // Inputs this step's figures depend on come first; the rest sit behind "More inputs".
  const keyInputIds = useMemo(() => {
    if (!topic) return [] as string[];
    const inputIds = new Set(topic.numbers.inputs.map((i) => i.id));
    const used = new Set<string>();
    for (const fig of stepFigures) {
      for (const c of fig.components) if (c.load) for (const d of inputDependencies(c.load, topic.numbers.values, inputIds)) used.add(d);
      for (const a of fig.arrows) if (a.rate) for (const d of inputDependencies(a.rate, topic.numbers.values, inputIds)) used.add(d);
    }
    const ordered = topic.numbers.inputs.map((i) => i.id);
    const firstUsed = ordered.filter((id) => used.has(id));
    return (firstUsed.length ? firstUsed : ordered).slice(0, 2);
  }, [topic, stepFigures]);

  // One plain sentence under the figure about the part that is over (or close to) its capacity.
  const figureNote = useMemo<StepFigureNote | null>(() => {
    let worst: { label: string; load: number; capacity: number; util: number; unit: string } | null = null;
    for (const fig of stepFigures) {
      const nums = computeFigureNumbers(fig, env);
      for (const c of fig.components) {
        const n = nums.components[c.id];
        if (!n || n.autoSized || n.utilization === null || n.load === null || !n.capacity) continue;
        if (!worst || n.utilization > worst.util)
          worst = { label: c.label, load: n.load, capacity: n.capacity * (n.instances ?? 1), util: n.utilization, unit: c.loadUnit || "req/s" };
      }
    }
    if (!worst || worst.util < TARGET_UTILIZATION) return null;
    const pct = Math.round(worst.util * 100);
    const load = formatValue(worst.load, worst.unit);
    const cap = formatValue(worst.capacity, worst.unit);
    if (worst.util >= 1)
      return { tone: "over", text: `${worst.label} is over capacity: ${load} against about ${cap} it can serve (${pct}%). This is the part to fix next.` };
    return { tone: "warm", text: `${worst.label} is at ${pct}% of what it can serve (${load} of about ${cap}). Fine for now, but it has little room left.` };
  }, [stepFigures, env]);

  // What changed on this step's figures since the last input change, one line per part.
  const changes = useMemo<Change[]>(() => {
    if (!topic || !step || !prevEnv) return [];
    const out: Change[] = [];
    const seen = new Set<string>();
    for (const fig of stepFigures) {
      const before = computeFigureNumbers(fig, prevEnv);
      const after = computeFigureNumbers(fig, env);
      for (const c of diffFigure(topic, fig, before, after, lastChanged)) {
        if (seen.has(c.id)) {
          // Prefer the instance count when a part has several changes: it is the decision the learner makes.
          if (c.what === "instances") {
            const i = out.findIndex((o) => o.id === c.id);
            if (i >= 0) out[i] = c;
          }
          continue;
        }
        seen.add(c.id);
        out.push(c);
      }
    }
    return out;
  }, [topic, step, stepFigures, env, prevEnv, lastChanged]);
  const changedIds = useMemo(() => new Set(changes.map((c) => c.id)), [changes]);
  const changedBecause = useMemo(() => [...new Set(changes.flatMap((c) => c.because))], [changes]);

  const valueChanges = useMemo(() => {
    if (!topic || !prevEnv) return new Set<string>();
    return new Set(
      topic.numbers.values
        .filter((v) => {
          const a = prevEnv[v.id];
          const b = env[v.id];
          const base = Math.max(Math.abs(a), Math.abs(b));
          return base > 0 && Math.abs(a - b) / base > 0.1;
        })
        .map((v) => v.id)
    );
  }, [topic, env, prevEnv]);

  if (error) {
    return (
      <div style={{ padding: 32 }}>
        <button className="btn-secondary" onClick={onBack}>
          <ArrowLeft size={13} /> Back
        </button>
        <div className="card" style={{ marginTop: 16, padding: 16, color: "var(--danger)" }}>{error}</div>
      </div>
    );
  }
  if (!topic || !step) return <div style={{ padding: 32, color: "var(--ink-muted)" }}>Loading chapter…</div>;

  const setInput = (id: string, value: number) => {
    setPrevInputs(inputs);
    setLastChanged(new Set([id]));
    setInputs({ ...inputs, [id]: value });
    setPresetLabel(null);
  };
  const applyPreset = (label: string, values: Record<string, number>) => {
    const next = { ...inputs, ...values };
    setPrevInputs(inputs);
    setLastChanged(new Set(Object.keys(values).filter((k) => values[k] !== inputs[k])));
    setInputs(next);
    setPresetLabel(label);
  };
  const resetInputs = () => applyPreset("Chapter defaults", Object.fromEntries(topic.numbers.inputs.map((i) => [i.id, i.default])));

  const ctx: BlockContext = {
    topic,
    env,
    changedIds,
    terms,
    status: progress?.blocks ?? {},
    onAttempt: (res, blockId) =>
      setProgress((p) =>
        p ? { status: res.progress.status, layers: res.progress.layers, blocks: { ...p.blocks, [blockId]: res.blockStatus } } : p
      ),
  };

  const isDesign = step.key.startsWith("design-");
  const designPos = isDesign ? designSteps.findIndex((s) => s.key === step.key) : -1;
  const layerProgress = new Map((progress?.layers ?? []).map((l) => [l.name, l]));
  const kicker = finished
    ? "Chapter done"
    : isDesign
    ? `Step ${designPos + 1} of ${designSteps.length}`
    : LAYER_TITLES[step.layer];
  const stepTitle = finished ? topic.title : step.title;
  const seenCount = steps.filter((s) => s.blocks.every((b) => progress?.blocks[b.id] && progress.blocks[b.id].status !== "new")).length;

  const visibleInputs = moreInputs ? topic.numbers.inputs : topic.numbers.inputs.filter((i) => keyInputIds.includes(i.id));
  const hiddenInputs = topic.numbers.inputs.length - visibleInputs.length;
  const remember = topic.blocks.find((b) => b.type === "rememberCard");
  const checks = (progress?.layers ?? []).reduce((acc, l) => ({ n: acc.n + l.checks, ok: acc.ok + l.checksPassed }), { n: 0, ok: 0 });
  const checkBlocks = topic.blocks.filter((b) => b.checkable);
  const tried = checkBlocks.filter((b) => (progress?.blocks[b.id]?.attempts ?? 0) > 0).length;
  const checkStepIdx = steps.findIndex((s) => s.key === "section-check");
  const chapterLabel = chapterNumber ? `Chapter ${chapterNumber}` : "Chapter";

  return (
    <div className="chapter-shell" data-numbers={showNumbers}>
      {/* Steps */}
      <nav className="chapter-steps" aria-label="Chapter steps" data-open={railOpen}>
        <button className="btn-secondary chapter-back" onClick={onBack}>
          <ArrowLeft size={12} /> Learn
        </button>
        <div className="chapter-rail-head">
          <div className="chapter-rail-kicker">{chapterLabel}</div>
          <div className="chapter-rail-title">{topic.title}</div>
          <div className="chapter-rail-progress" aria-label={`${seenCount} of ${steps.length} parts read`}>
            <span style={{ width: `${Math.round((seenCount / Math.max(1, steps.length)) * 100)}%` }} />
          </div>
          <div className="chapter-rail-layers">
            {topic.layers.map((l) => {
              const lp = layerProgress.get(l.name);
              return (
                <span key={l.name} className={`layer-chip${lp?.passed ? " layer-chip-done" : ""}`} title={l.goal ?? ""}>
                  {LAYER_TITLES[l.name]} · {l.minutes} min{lp?.passed ? " · done" : ""}
                </span>
              );
            })}
          </div>
        </div>
        <button className="chapter-rail-toggle" aria-expanded={railOpen} onClick={() => setRailOpen((o) => !o)}>
          <span>
            {kicker}: {stepTitle}
          </span>
          <ChevronDown size={14} />
        </button>
        <ol className="chapter-step-list">
          {steps.map((s, i) => {
            const seen = s.blocks.every((b) => progress?.blocks[b.id] && progress.blocks[b.id].status !== "new");
            return (
              <li key={s.key}>
                <button data-active={!finished && i === stepIdx} data-seen={seen} aria-current={!finished && i === stepIdx ? "step" : undefined} onClick={() => goStep(i)}>
                  <span className="chapter-step-kicker">{s.key.startsWith("design-") ? s.kicker : LAYER_TITLES[s.layer]}</span>
                  <span className="chapter-step-title">
                    {seen && <CheckCircle2 size={11} className="chapter-step-done" aria-label="read" />}
                    {s.title}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {topic.sandboxLessonId && onOpenSandbox && (
          <button className="btn-secondary chapter-try" onClick={() => onOpenSandbox(topic.sandboxLessonId!)}>
            <Compass size={12} /> Try it in the playground
          </button>
        )}
        <div className="chapter-rail-foot">
          Checked {topic.lastVerified} · {topic.appliesTo}
        </div>
      </nav>

      {/* Reading column */}
      <main className="chapter-main" ref={mainRef}>
        <div className="chapter-head">
          <div>
            <div className="chapter-kicker">{kicker}</div>
            <h2 className="chapter-title">{stepTitle}</h2>
          </div>
          {numbersAvailable && (
            <button className="btn-secondary chapter-numbers-toggle" aria-expanded={numbersOpen} aria-controls="chapter-numbers" onClick={toggleNumbers}>
              <Gauge size={13} /> {numbersOpen ? "Hide numbers" : "Numbers"}
            </button>
          )}
        </div>

        {topic.legacy && !finished && stepIdx === 0 && (
          <div className="chapter-preview-banner" role="note">
            <span className="pill-preview">Preview</span>
            <span>
              {PREVIEW_NOTE} It covers the topic, but it doesn't build the design step by step with live numbers yet.
              {topic.sandboxLessonId && onOpenSandbox ? " You can also open it in the playground." : ""}
            </span>
          </div>
        )}

        {finished ? (
          <div className="chapter-done">
            {remember && <BlockRenderer block={remember} ctx={ctx} />}
            <section className="card chapter-done-card">
              <div className="chapter-done-row">
                <CheckCircle2 size={16} style={{ color: "var(--success)" }} />
                <b>
                  {checks.n === 0
                    ? "You have read every part of this chapter"
                    : tried === 0
                    ? `${checks.n} checks to try`
                    : `${checks.ok} of ${checks.n} checks right`}
                </b>
              </div>
              <p>
                {checks.n > 0 && tried === 0
                  ? "Answering the checks is the fastest way to find what didn't stick. They take a few minutes."
                  : checks.n > 0 && checks.ok < checks.n
                  ? "The checks you missed are worth another look. Open Check yourself again, or review this chapter."
                  : "Short review sessions over the next days are what make this stick."}
              </p>
              <div className="chapter-done-actions">
                {checks.n > 0 && tried < checkBlocks.length && checkStepIdx >= 0 && (
                  <button className="btn-secondary" onClick={() => goStep(checkStepIdx)}>
                    <CheckCircle2 size={13} /> Check yourself
                  </button>
                )}
                {nextChapter && onOpenChapter ? (
                  <button className="btn-primary" onClick={() => onOpenChapter(nextChapter.topicId)}>
                    Next: {nextChapter.number}. {nextChapter.title} <ArrowRight size={13} />
                  </button>
                ) : (
                  <button className="btn-primary" onClick={onBack}>
                    Back to Learn <ArrowRight size={13} />
                  </button>
                )}
                {onOpenReview && (
                  <button className="btn-secondary" onClick={() => onOpenReview(topic.id)}>
                    <BookOpen size={13} /> Review this chapter
                  </button>
                )}
                {topic.sandboxLessonId && onOpenSandbox && (
                  <button className="btn-secondary" onClick={() => onOpenSandbox(topic.sandboxLessonId!)}>
                    <Compass size={13} /> Try it in the playground
                  </button>
                )}
              </div>
            </section>
            {(topic.furtherReading?.length ?? 0) > 0 && (
              <section className="chapter-further">
                <div className="chapter-further-head">Go deeper</div>
                <div className="chapter-further-essays">
                  {topic.furtherReading!.map((r) => (
                    <details key={r.title} className="card chapter-essay">
                      <summary>{r.title.replace(/^Module \d+:\s*\d+(\.\d+)*\s*/, "")}</summary>
                      {r.body && <div className="chapter-prose">{renderMarkdown(r.body)}</div>}
                    </details>
                  ))}
                </div>
              </section>
            )}
            {topic.sources.length > 0 && (
              <section className="chapter-further">
                <div className="chapter-further-head">Further reading</div>
                <ul>
                  {topic.sources.map((s) => (
                    <li key={s.title}>
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.title}
                        </a>
                      ) : (
                        s.title
                      )}
                      {s.note ? <span> · {s.note}</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="chapter-nav">
              <button className="btn-secondary" onClick={() => goStep(steps.length - 1)}>
                <ArrowLeft size={13} /> {steps[steps.length - 1].title}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="chapter-blocks">
              {step.blocks.map((b) => (
                <BlockRenderer key={b.id} block={b.type === "prose" && stripStep(b.title) === step.title ? { ...b, title: undefined } : b} ctx={ctx} />
              ))}
            </div>

            {isDesign && (figureNote || designSteps.length > 1) && (
              <div className="chapter-figure-foot">
                {figureNote && (
                  <p className="chapter-figure-note" data-tone={figureNote.tone}>
                    {figureNote.text}
                  </p>
                )}
                {designSteps.length > 1 && (
                  <div className="chapter-strip" role="group" aria-label="How the design grew, step by step">
                    {designSteps.map((s, i) => (
                      <button
                        key={s.key}
                        data-active={s.key === step.key}
                        aria-current={s.key === step.key ? "step" : undefined}
                        title={`Step ${i + 1}: ${s.title}`}
                        onClick={() => goStep(steps.indexOf(s))}
                      >
                        <span className="chapter-strip-n">{i + 1}</span>
                        <span className="chapter-strip-t">{s.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="chapter-nav">
              <button className="btn-secondary" disabled={stepIdx === 0} onClick={() => goStep(stepIdx - 1)}>
                <ArrowLeft size={13} /> Previous
              </button>
              {stepIdx < steps.length - 1 ? (
                <button className="btn-primary" onClick={() => goStep(stepIdx + 1)}>
                  Next: {steps[stepIdx + 1].title} <ArrowRight size={13} />
                </button>
              ) : (
                <button className="btn-primary" onClick={finish}>
                  Finish chapter <ArrowRight size={13} />
                </button>
              )}
            </div>
          </>
        )}
      </main>

      {/* Numbers drawer */}
      {showNumbers && (
        <aside className="chapter-numbers" id="chapter-numbers" aria-label="Numbers">
          <div className="chapter-numbers-head">
            <span style={{ fontWeight: 700, fontSize: 13 }}>Numbers</span>
            <span style={{ flex: 1 }} />
            <button className="icon-btn" title="Back to the chapter's numbers" aria-label="Reset the numbers" onClick={resetInputs}>
              <RotateCcw size={12} />
            </button>
            <button className="icon-btn" aria-label="Hide numbers" onClick={toggleNumbers}>
              <X size={12} />
            </button>
          </div>
          <div className="numbers-lede">
            {presetLabel ? `Using: ${presetLabel}. ` : ""}Move a slider and watch which parts of the figure change.
          </div>
          {topic.numbers.presets.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {topic.numbers.presets.map((p) => (
                <button key={p.id} className="chip-btn" data-active={presetLabel === p.label} title={p.note ?? ""} onClick={() => applyPreset(p.label, p.inputs)}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
          {visibleInputs.map((inp) => (
            <label key={inp.id} className="number-input" title={inp.help ?? ""}>
              <span className="number-input-row">
                <span>{inp.label}</span>
                <span className="mono" data-changed={lastChanged.has(inp.id) && prevInputs !== null}>
                  {formatValue(inputs[inp.id], inp.unit)}
                </span>
              </span>
              <input
                id={`num-${inp.id}`}
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={valueToSlider(inp, inputs[inp.id] ?? inp.default)}
                onChange={(e) => setInput(inp.id, sliderToValue(inp, Number(e.target.value)))}
              />
            </label>
          ))}
          {(hiddenInputs > 0 || moreInputs) && (
            <button className="link-btn" onClick={() => setMoreInputs((m) => !m)}>
              {moreInputs ? "Fewer inputs" : `More inputs (${hiddenInputs})`}
            </button>
          )}

          <div className="numbers-subhead">What changed</div>
          {!prevEnv ? (
            <div className="numbers-empty">Move a slider to see which parts change.</div>
          ) : stepFigures.length === 0 ? (
            <div className="numbers-empty">This step has no figure. The next design step will show what moved.</div>
          ) : changes.length === 0 ? (
            <div className="numbers-empty">Nothing on this figure moved by more than 10%.</div>
          ) : (
            <>
              {changedBecause.length > 0 && <div className="changes-cause">You changed {changedBecause.join(" and ")}.</div>}
              <ul className="changes-list">
                {changes.map((c) => (
                  <li key={c.id}>
                    <Sparkles size={11} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />
                    <span>
                      <b>{c.label}</b>{" "}
                      <span className="mono">
                        {formatValue(c.before, c.unit)} → {formatValue(c.after, c.unit)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <details className="numbers-all">
            <summary>All values</summary>
            <table className="numbers-values">
              <tbody>
                {topic.numbers.values.slice(0, 12).map((v) => (
                  <tr key={v.id} data-changed={valueChanges.has(v.id)} title={`${v.formula}${v.explain ? `\n${v.explain}` : ""}`}>
                    <td>{v.label}</td>
                    <td className="mono">{formatValue(env[v.id], v.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 10.5, color: "var(--ink-muted)", marginTop: 8 }}>Hover a value for its formula. Units are decimal: 1 GB = 10⁹ bytes.</div>
          </details>
        </aside>
      )}
    </div>
  );
};
