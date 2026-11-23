import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Compass, RotateCcw, Sparkles } from "lucide-react";
import { api } from "../../api/client";
import { solveValues } from "../../content/formula";
import { computeFigureNumbers, diffFigure, formatValue, resolveFigure, type Change } from "../../content/numbers";
import type { Block, LayerName, NumberInput, TopicProgressV2, TopicV2 } from "../../content/types";
import { BlockRenderer, type BlockContext } from "./ChapterBlocks";
import { LAYER_LABELS, levelLabel } from "../../copy";

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
}

export const ChapterView: React.FC<ChapterViewProps> = ({ topicId, track = "hld", initialInputs, initialLabel, stepKey, onStepChange, onBack, onOpenSandbox }) => {
  const [topic, setTopic] = useState<TopicV2 | null>(null);
  const [progress, setProgress] = useState<TopicProgressV2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [inputs, setInputs] = useState<Record<string, number>>({});
  const [prevInputs, setPrevInputs] = useState<Record<string, number> | null>(null);
  const [lastChanged, setLastChanged] = useState<Set<string>>(new Set());
  const [presetLabel, setPresetLabel] = useState<string | null>(null);
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

  const steps = useMemo(() => (topic ? buildSteps(topic) : []), [topic]);

  // The URL owns the step: follow it (Back and Forward), and write it when the learner moves.
  useEffect(() => {
    if (!steps.length) return;
    const i = stepKey ? steps.findIndex((s) => s.key === stepKey) : 0;
    setStepIdx(i >= 0 ? i : 0);
  }, [steps, stepKey]);
  const goStep = (i: number) => {
    const next = Math.max(0, Math.min(steps.length - 1, i));
    setStepIdx(next);
    if (steps[next]) onStepChange?.(steps[next].key);
  };
  const step = steps[Math.min(stepIdx, Math.max(0, steps.length - 1))];
  const env = useMemo(() => (topic ? solveValues(inputs, topic.numbers.values) : {}), [topic, inputs]);
  const prevEnv = useMemo(() => (topic && prevInputs ? solveValues(prevInputs, topic.numbers.values) : null), [topic, prevInputs]);

  // Record views for the blocks on the current step.
  useEffect(() => {
    if (!topic || !step) return;
    const ids = step.blocks.map((b) => b.id);
    api
      .saveBlockViews(topic.id, ids)
      .then((r) => setProgress(r.progress))
      .catch(() => undefined);
    mainRef.current?.scrollTo({ top: 0 });
  }, [topic, step]);

  // What changed on this step's figures since the last input change.
  const changes = useMemo<Change[]>(() => {
    if (!topic || !step || !prevEnv) return [];
    const out: Change[] = [];
    const seen = new Set<string>();
    for (const b of step.blocks) {
      if (b.type !== "figure") continue;
      const fig = resolveFigure(topic, b.id);
      if (!fig) continue;
      const before = computeFigureNumbers(fig, prevEnv);
      const after = computeFigureNumbers(fig, env);
      for (const c of diffFigure(topic, fig, before, after, lastChanged)) {
        const k = `${c.id}:${c.what}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(c);
      }
    }
    return out;
  }, [topic, step, env, prevEnv, lastChanged]);
  const changedIds = useMemo(() => new Set(changes.map((c) => c.id)), [changes]);

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
    status: progress?.blocks ?? {},
    onAttempt: (res, blockId) =>
      setProgress((p) =>
        p ? { status: res.progress.status, layers: res.progress.layers, blocks: { ...p.blocks, [blockId]: res.blockStatus } } : p
      ),
  };

  const stepHasFigure = step.blocks.some((b) => b.type === "figure" || (b.type === "quiz" && (b as any).aboutFigure));
  const keyValues = topic.numbers.values.slice(0, 10);
  const layerProgress = new Map((progress?.layers ?? []).map((l) => [l.name, l]));

  return (
    <div className="chapter-shell">
      {/* Steps */}
      <nav className="chapter-steps">
        <button className="btn-secondary" style={{ fontSize: 11.5, marginBottom: 12 }} onClick={onBack}>
          <ArrowLeft size={12} /> Learn
        </button>
        <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{topic.title}</div>
        <div style={{ fontSize: 12, color: "var(--ink-muted)", margin: "4px 0 12px" }}>{topic.summary}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {topic.layers.map((l) => {
            const lp = layerProgress.get(l.name);
            return (
              <span key={l.name} className={`layer-chip${lp?.passed ? " layer-chip-done" : ""}`} title={l.goal ?? ""}>
                {LAYER_TITLES[l.name]} · {levelLabel(l.level)} · {l.minutes} min
                {lp?.passed ? " · done" : lp && lp.checks > 0 ? ` · ${lp.checksPassed} of ${lp.checks} checks` : ""}
              </span>
            );
          })}
        </div>
        <ol className="chapter-step-list">
          {steps.map((s, i) => {
            const seen = s.blocks.every((b) => progress?.blocks[b.id] && progress.blocks[b.id].status !== "new");
            return (
              <li key={s.key}>
                <button data-active={i === stepIdx} data-seen={seen} onClick={() => goStep(i)}>
                  <span className="mono chapter-step-kicker">{s.key.startsWith("design-") ? s.kicker : LAYER_TITLES[s.layer]}</span>
                  <span>{s.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
        {topic.sandboxLessonId && onOpenSandbox && (
          <button className="btn-secondary" style={{ marginTop: 14, fontSize: 11.5, width: "100%" }} onClick={() => onOpenSandbox(topic.sandboxLessonId!)}>
            <Compass size={12} /> Try it in the playground
          </button>
        )}
        <div style={{ fontSize: 10.5, color: "var(--ink-muted)", marginTop: 14 }}>
          Checked {topic.lastVerified} · {topic.appliesTo}
        </div>
      </nav>

      {/* Blocks */}
      <main className="chapter-main" ref={mainRef}>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-muted)", letterSpacing: 0.5, textTransform: "uppercase" }}>
          {step.key.startsWith("design-") ? `${step.kicker} of ${steps.filter((s) => s.key.startsWith("design-")).length}` : LAYER_TITLES[step.layer]}
        </div>
        <h2 style={{ margin: "2px 0 16px", fontSize: 22, fontWeight: 700 }}>{step.title}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {step.blocks.map((b) => (
            <BlockRenderer key={b.id} block={b.type === "prose" && stripStep(b.title) === step.title ? { ...b, title: undefined } : b} ctx={ctx} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28, paddingBottom: 40 }}>
          <button className="btn-secondary" disabled={stepIdx === 0} onClick={() => goStep(stepIdx - 1)}>
            <ArrowLeft size={13} /> Previous
          </button>
          {stepIdx < steps.length - 1 ? (
            <button className="btn-primary" onClick={() => goStep(stepIdx + 1)}>
              Next: {steps[stepIdx + 1].title} <ArrowRight size={13} />
            </button>
          ) : (
            <button className="btn-primary" onClick={onBack}>
              Back to Learn <ArrowRight size={13} />
            </button>
          )}
        </div>
      </main>

      {/* Numbers */}
      {topic.numbers.inputs.length > 0 && (
        <aside className="chapter-numbers">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>Numbers</span>
            <span style={{ flex: 1 }} />
            <button className="icon-btn" title="Back to the chapter's defaults" onClick={resetInputs}>
              <RotateCcw size={12} />
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-muted)", margin: "2px 0 10px" }}>
            {presetLabel ? `Using: ${presetLabel}. ` : ""}Move a slider: the figures update and the parts that moved light up.
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
          {topic.numbers.inputs.map((inp) => (
            <label key={inp.id} className="number-input" title={inp.help ?? ""}>
              <span className="number-input-row">
                <span>{inp.label}</span>
                <span className="mono" data-changed={lastChanged.has(inp.id) && prevInputs !== null}>
                  {formatValue(inputs[inp.id], inp.unit)}
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={valueToSlider(inp, inputs[inp.id] ?? inp.default)}
                onChange={(e) => setInput(inp.id, sliderToValue(inp, Number(e.target.value)))}
              />
            </label>
          ))}

          <div className="numbers-subhead">What changed</div>
          {!prevEnv ? (
            <div className="numbers-empty">Change an input to see which parts move and why.</div>
          ) : !stepHasFigure ? (
            <div className="numbers-empty">This step has no figure. Open a design step to see parts move.</div>
          ) : changes.length === 0 ? (
            <div className="numbers-empty">Nothing on this step moved by more than 10%.</div>
          ) : (
            <ul className="changes-list">
              {changes.map((c) => (
                <li key={`${c.id}:${c.what}`}>
                  <Sparkles size={11} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />
                  <span>
                    <b>{c.label}</b> {c.what}: <span className="mono">{formatValue(c.before, c.unit)} → {formatValue(c.after, c.unit)}</span>
                    {c.because.length > 0 && <span className="changes-why"> because {c.because.join(" and ")} changed</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="numbers-subhead">Key values</div>
          <table className="numbers-values">
            <tbody>
              {keyValues.map((v) => (
                <tr key={v.id} data-changed={valueChanges.has(v.id)} title={`${v.formula}${v.explain ? `\n${v.explain}` : ""}`}>
                  <td>{v.label}</td>
                  <td className="mono">{formatValue(env[v.id], v.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 10.5, color: "var(--ink-muted)", marginTop: 8 }}>Hover a value for its formula. Units are decimal: 1 GB = 10⁹ bytes.</div>
        </aside>
      )}
    </div>
  );
};

