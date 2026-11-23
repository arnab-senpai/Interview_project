import React, { useState } from "react";
import { CheckCircle2, CircleAlert, RotateCcw, XCircle } from "lucide-react";
import { api } from "../../api/client";
import { formatValue } from "../../content/numbers";
import { solveValues } from "../../content/formula";
import type {
  AttemptResult,
  Block,
  BlockStatus,
  ChoiceBlock,
  DesignPromptBlock,
  EstimationWorksheetBlock,
  FigureBlock,
  LadderBlock,
  ProseBlock,
  RememberCardBlock,
  SpotTheBugBlock,
  StructuredTableBlock,
  TopicV2,
  TraceBlock,
} from "../../content/types";
import { renderMarkdown } from "../../utils/markdown";
import { ReportIssueButton } from "../ReportIssueButton";
import { ChapterFigure } from "./ChapterFigure";

export interface BlockContext {
  topic: TopicV2;
  env: Record<string, number>;
  changedIds: Set<string>;
  status: Record<string, BlockStatus>;
  onAttempt: (result: AttemptResult, blockId: string) => void;
}

const card: React.CSSProperties = { padding: 16, borderRadius: 12 };

function StatusBadge({ st }: { st?: BlockStatus }) {
  if (!st) return null;
  if (st.status === "passed") return <span className="badge badge-success">passed</span>;
  if (st.status === "recheck")
    return (
      <span className="badge badge-warn" title="You passed an earlier version; the question changed since. Your pass is kept.">
        re-check suggested
      </span>
    );
  if (st.status === "attempted") return <span className="badge">tried</span>;
  return null;
}

function BlockHeader({ block, ctx, label }: { block: Block; ctx: BlockContext; label?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      {label && <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-muted)", letterSpacing: 0.4 }}>{label}</span>}
      {block.title && <span style={{ fontWeight: 650, fontSize: 15 }}>{block.title}</span>}
      <span style={{ flex: 1 }} />
      <StatusBadge st={ctx.status[block.id]} />
      <ReportIssueButton topicId={ctx.topic.id} blockId={`chapter:${block.id}`} blockLabel={block.title ?? block.id} />
    </div>
  );
}

function useSubmit(ctx: BlockContext, block: Block) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const submit = async (response: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.submitAttempt({
        topicId: ctx.topic.id,
        blockId: block.id,
        gradingVersion: block.gradingVersion ?? 1,
        response,
      });
      setResult(res);
      ctx.onAttempt(res, block.id);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, result, setResult, submit };
}

// ---------------------------------------------------------------- prose and tables

function Prose({ block, ctx }: { block: ProseBlock; ctx: BlockContext }) {
  const isProblem = block.role === "problem";
  return (
    <section className="card" style={{ ...card, borderLeft: isProblem ? "3px solid var(--highlight)" : undefined }}>
      <BlockHeader block={block} ctx={ctx} />
      <div className="chapter-prose">{renderMarkdown(block.body ?? "")}</div>
      {block.why && (
        <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--accent)", fontWeight: 550 }}>{block.why}</p>
      )}
    </section>
  );
}

function Table({ block, ctx }: { block: StructuredTableBlock; ctx: BlockContext }) {
  return (
    <section className="card" style={card}>
      <BlockHeader block={block} ctx={ctx} />
      <div style={{ overflowX: "auto" }}>
        <table className="spec-table chapter-table">
          <thead>
            <tr>
              {block.columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i}>
                {block.columns.map((c) => (
                  <td key={c.key}>{String(row[c.key] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.caption && <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--ink-secondary)" }}>{block.caption}</p>}
    </section>
  );
}

function Figure({ block, ctx }: { block: FigureBlock; ctx: BlockContext }) {
  return (
    <section className="card" style={card}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: -24 }}>
        <ReportIssueButton topicId={ctx.topic.id} blockId={`chapter:${block.id}`} blockLabel={`Figure: ${block.title}`} />
      </div>
      <ChapterFigure topic={ctx.topic} block={block} env={ctx.env} changedIds={ctx.changedIds} />
      {block.whatIf && (
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--ink-secondary)" }}>
          <strong>What if?</strong> {block.whatIf} <span style={{ color: "var(--ink-muted)" }}>Predict first, then move the slider on the right.</span>
        </p>
      )}
    </section>
  );
}

function Trace({ block, ctx }: { block: TraceBlock; ctx: BlockContext }) {
  const label = (id: string) => ctx.topic.components.find((c) => c.id === id)?.label ?? id;
  return (
    <section className="card" style={card}>
      <BlockHeader block={block} ctx={ctx} label="ONE REQUEST, IN ORDER" />
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.6 }}>
        {block.steps.map((s, i) => (
          <li key={i}>
            <strong>{label(s.from)}</strong> → <strong>{label(s.to)}</strong>: {s.label}
            {s.latencyMs !== undefined && <span className="mono" style={{ color: "var(--ink-muted)" }}> · {s.latencyMs} ms</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------- checks

function Choice({ block, ctx }: { block: ChoiceBlock; ctx: BlockContext }) {
  const [picked, setPicked] = useState<number | null>(null);
  const { busy, error, result, setResult, submit } = useSubmit(ctx, block);
  const fig = block.aboutFigure ? (ctx.topic.blocks.find((b) => b.id === block.aboutFigure) as FigureBlock | undefined) : undefined;
  const reveal = result?.reveal;
  const isPredict = block.type === "predict";
  return (
    <section className="card" style={{ ...card, borderLeft: isPredict ? "3px solid var(--accent)" : undefined }}>
      <BlockHeader block={block} ctx={ctx} label={isPredict ? "PREDICT BEFORE YOU READ ON" : "CHECK"} />
      <p style={{ margin: "0 0 10px", fontSize: 14.5, fontWeight: 550 }}>{block.prompt}</p>
      {fig && (
        <div style={{ marginBottom: 10 }}>
          <ChapterFigure topic={ctx.topic} block={fig} env={ctx.env} compact showLegend={false} />
        </div>
      )}
      <div style={{ display: "grid", gap: 6 }}>
        {block.options.map((o, i) => {
          const isRight = reveal && reveal.correctIndex === i;
          const isWrongPick = reveal && picked === i && !isRight;
          return (
            <button
              key={i}
              type="button"
              disabled={Boolean(result) || busy}
              onClick={() => setPicked(i)}
              className="chapter-option"
              data-picked={picked === i || undefined}
              data-right={isRight || undefined}
              data-wrong={isWrongPick || undefined}
            >
              <span style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                {isRight ? <CheckCircle2 size={15} color="var(--success)" /> : isWrongPick ? <XCircle size={15} color="var(--danger)" /> : <span className="chapter-radio" />}
                <span>
                  {o.text}
                  {reveal && (picked === i || isRight) && (
                    <span style={{ display: "block", fontSize: 12.5, color: "var(--ink-secondary)", marginTop: 3 }}>{reveal.explanations[i]}</span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        {!result ? (
          <button className="btn-primary" disabled={picked === null || busy} onClick={() => submit({ choice: picked })}>
            {isPredict ? "Commit my prediction" : "Check"}
          </button>
        ) : (
          <>
            <span style={{ fontWeight: 650, color: result.passed ? "var(--success)" : "var(--danger)" }}>{result.passed ? "Right." : "Not quite."}</span>
            <button className="btn-secondary" onClick={() => { setResult(null); setPicked(null); }}>
              <RotateCcw size={12} /> Try again
            </button>
          </>
        )}
        {error && <span style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</span>}
      </div>
      {reveal?.reveal && <div className="chapter-reveal">{renderMarkdown(reveal.reveal)}</div>}
    </section>
  );
}

function Worksheet({ block, ctx }: { block: EstimationWorksheetBlock; ctx: BlockContext }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const { busy, error, result, setResult, submit } = useSubmit(ctx, block);
  const preset = block.preset ? ctx.topic.numbers.presets.find((p) => p.id === block.preset) : undefined;
  const unitOf = (id: string) =>
    ctx.topic.numbers.values.find((v) => v.id === id)?.unit ?? ctx.topic.numbers.inputs.find((v) => v.id === id)?.unit ?? "";
  const formulaOf = (id: string) => ctx.topic.numbers.values.find((v) => v.id === id)?.formula;
  const parse = (s: string) => {
    const t = s.replace(/[, _]/g, "").trim().toLowerCase();
    const m = t.match(/^([0-9.]+(?:e[+-]?\d+)?)([kmbt]?)$/);
    if (!m) return NaN;
    const mult = { "": 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2] as "" | "k" | "m" | "b" | "t"];
    return Number(m[1]) * mult;
  };
  const defaults = Object.fromEntries(ctx.topic.numbers.inputs.map((i) => [i.id, i.default]));
  const workedEnv = solveValues({ ...defaults, ...(preset?.inputs ?? {}) }, ctx.topic.numbers.values);
  const ready = block.lines.every((ln) => Number.isFinite(parse(answers[ln.value] ?? "")));
  return (
    <section className="card" style={card}>
      <BlockHeader block={block} ctx={ctx} label="ESTIMATE" />
      <p style={{ margin: "0 0 10px", fontSize: 13.5, color: "var(--ink-secondary)" }}>
        {block.prompt}
        {preset && <> Uses the <strong>{preset.label}</strong> inputs.</>} Shorthand like 14k or 1.2e9 works.
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        {block.lines.map((ln, i) => {
          const line = result?.reveal?.lines?.[i];
          return (
            <div key={ln.value} className="worksheet-line">
              <label style={{ fontSize: 13.5 }}>
                {ln.prompt}
                {ln.hint && <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-muted)" }}>{ln.hint}</span>}
              </label>
              <input
                className="worksheet-input mono"
                inputMode="decimal"
                value={answers[ln.value] ?? ""}
                disabled={Boolean(result)}
                onChange={(e) => setAnswers((a) => ({ ...a, [ln.value]: e.target.value }))}
                aria-label={ln.prompt}
              />
              {line && (
                <span style={{ fontSize: 12.5, color: line.withinTolerance ? "var(--success)" : "var(--danger)" }}>
                  {line.withinTolerance ? "within 2×" : "off by more than 2×"} · worked: {formatValue(workedEnv[ln.value] ?? line.expected, unitOf(ln.value))}
                  {formulaOf(ln.value) && <span className="mono" style={{ display: "block", color: "var(--ink-muted)", fontSize: 11 }}>{formulaOf(ln.value)}</span>}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        {!result ? (
          <button
            className="btn-primary"
            disabled={!ready || busy}
            onClick={() => submit({ answers: Object.fromEntries(block.lines.map((ln) => [ln.value, parse(answers[ln.value] ?? "")])) })}
          >
            Show the worked numbers
          </button>
        ) : (
          <>
            <span style={{ fontWeight: 650, color: result.passed ? "var(--success)" : "var(--warn)" }}>
              {result.passed ? "All within 2×." : "Some lines were more than 2× off. Check the formula under each."}
            </span>
            <button className="btn-secondary" onClick={() => { setResult(null); setAnswers({}); }}>
              <RotateCcw size={12} /> Try again
            </button>
          </>
        )}
        {error && <span style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</span>}
      </div>
    </section>
  );
}

function SpotTheBug({ block, ctx }: { block: SpotTheBugBlock; ctx: BlockContext }) {
  const [choices, setChoices] = useState<(number | null)[]>(block.steps.map(() => null));
  const { busy, error, result, setResult, submit } = useSubmit(ctx, block);
  const current = choices.findIndex((c) => c === null);
  return (
    <section className="card" style={card}>
      <BlockHeader block={block} ctx={ctx} label="SPOT THE BUG" />
      <p style={{ margin: "0 0 8px", fontSize: 14 }}>{block.prompt}</p>
      <pre className="code chapter-code">{block.code}</pre>
      {block.steps.map((st, si) => {
        if (!result && si > (current === -1 ? block.steps.length : current)) return null;
        const rev = result?.reveal?.steps?.[si];
        return (
          <div key={si} style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>
              {si + 1}. {st.prompt}
            </div>
            <div style={{ display: "grid", gap: 5 }}>
              {st.options.map((o, oi) => (
                <button
                  key={oi}
                  type="button"
                  className="chapter-option"
                  disabled={Boolean(result) || busy}
                  data-picked={choices[si] === oi || undefined}
                  data-right={rev && rev.correctIndex === oi ? true : undefined}
                  data-wrong={rev && choices[si] === oi && rev.correctIndex !== oi ? true : undefined}
                  onClick={() => setChoices((c) => c.map((v, i) => (i === si ? oi : i > si ? null : v)))}
                >
                  {o}
                </button>
              ))}
            </div>
            {rev && <div style={{ fontSize: 12.5, color: "var(--ink-secondary)", marginTop: 4 }}>{rev.explanation}</div>}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        {!result ? (
          <button className="btn-primary" disabled={choices.some((c) => c === null) || busy} onClick={() => submit({ choices })}>
            Check all three
          </button>
        ) : (
          <>
            <span style={{ fontWeight: 650, color: result.passed ? "var(--success)" : "var(--warn)" }}>
              {Math.round(result.score * block.steps.length)} of {block.steps.length} right
            </span>
            <button className="btn-secondary" onClick={() => { setResult(null); setChoices(block.steps.map(() => null)); }}>
              <RotateCcw size={12} /> Try again
            </button>
          </>
        )}
        {error && <span style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</span>}
      </div>
    </section>
  );
}

function Ladder({ block, ctx }: { block: LadderBlock; ctx: BlockContext }) {
  const [choices, setChoices] = useState<number[]>([]);
  const { busy, error, result, setResult, submit } = useSubmit(ctx, block);
  const shown = result ? block.rungs.length : Math.min(block.rungs.length, choices.length + 1);
  return (
    <section className="card" style={card}>
      <BlockHeader block={block} ctx={ctx} label="FOLLOW-UP LADDER" />
      <p style={{ margin: "0 0 8px", fontSize: 13.5, color: "var(--ink-secondary)" }}>{block.prompt}</p>
      {block.rungs.slice(0, shown).map((r, ri) => {
        const rev = result?.reveal?.rungs?.[ri];
        const committed = choices[ri] !== undefined;
        return (
          <div key={ri} style={{ marginTop: 10, paddingLeft: 10, borderLeft: "2px solid var(--border)" }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>
              {ri + 1}. {r.constraint}
            </div>
            <div style={{ display: "grid", gap: 5 }}>
              {r.options.map((o, oi) => (
                <button
                  key={oi}
                  type="button"
                  className="chapter-option"
                  disabled={committed || busy}
                  data-picked={choices[ri] === oi || undefined}
                  data-right={rev && rev.correctIndex === oi ? true : undefined}
                  data-wrong={rev && choices[ri] === oi && rev.correctIndex !== oi ? true : undefined}
                  onClick={() => setChoices((c) => [...c.slice(0, ri), oi])}
                >
                  {o}
                </button>
              ))}
            </div>
            {rev && <div style={{ fontSize: 12.5, color: "var(--ink-secondary)", marginTop: 4 }}><strong>Strong answer:</strong> {rev.strongAnswer}</div>}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        {!result && choices.length === block.rungs.length && (
          <button className="btn-primary" disabled={busy} onClick={() => submit({ choices })}>
            See the strong answers
          </button>
        )}
        {result && (
          <>
            <span style={{ fontWeight: 650 }}>{Math.round(result.score * block.rungs.length)} of {block.rungs.length} matched</span>
            <button className="btn-secondary" onClick={() => { setResult(null); setChoices([]); }}>
              <RotateCcw size={12} /> Start over
            </button>
          </>
        )}
        {error && <span style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</span>}
      </div>
    </section>
  );
}

function DesignPrompt({ block, ctx }: { block: DesignPromptBlock; ctx: BlockContext }) {
  const [text, setText] = useState("");
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const { busy, error, result, submit } = useSubmit(ctx, block);
  return (
    <section className="card" style={card}>
      <BlockHeader block={block} ctx={ctx} label="DEFEND YOUR DESIGN" />
      <p style={{ margin: "0 0 8px", fontSize: 14 }}>{block.prompt}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={Boolean(result)}
        rows={6}
        className="chapter-textarea"
        placeholder="Write your answer as you would say it in the interview."
        aria-label="Your answer"
      />
      {!result ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <button className="btn-primary" disabled={text.trim().length < 40 || busy} onClick={() => submit({ text })}>
            Compare with model answers
          </button>
          <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>Self-scored for now; AI grading arrives in Phase 4.</span>
          {error && <span style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</span>}
        </div>
      ) : (
        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          <div>
            <div className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-muted)", marginBottom: 4 }}>TICK WHAT YOUR ANSWER COVERED</div>
            {result.reveal.rubric.map((r: string, i: number) => (
              <label key={i} style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 4 }}>
                <input type="checkbox" checked={ticked.has(i)} onChange={() => setTicked((t) => { const n = new Set(t); n.has(i) ? n.delete(i) : n.add(i); return n; })} />
                {r}
              </label>
            ))}
          </div>
          {result.reveal.modelAnswers.map((m: { level: string; answer: string }) => (
            <div key={m.level} style={{ padding: 10, borderRadius: 8, background: "var(--bg-subtle)" }}>
              <div className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--accent)" }}>{m.level.toUpperCase()}</div>
              <div style={{ fontSize: 13.5, marginTop: 4 }}>{m.answer}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RememberCard({ block, ctx }: { block: RememberCardBlock; ctx: BlockContext }) {
  const fig = ctx.topic.blocks.find((b) => b.id === block.figure) as FigureBlock | undefined;
  return (
    <section className="card remember-card" style={card}>
      <BlockHeader block={block} ctx={ctx} label="REMEMBER" />
      <div className="remember-grid">
        {fig && (
          <div className="remember-figure">
            <ChapterFigure topic={ctx.topic} block={fig} env={ctx.topic.defaults} compact showLegend={false} />
          </div>
        )}
        <div>
          <ul className="remember-facts">
            {block.facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <div className="remember-number">
            <span className="mono">{block.number.value}</span> {block.number.unit} <span style={{ color: "var(--ink-muted)" }}>{block.number.label}</span>
          </div>
          <div style={{ fontSize: 13.5, marginTop: 8 }}>
            <strong>{block.tradeoff.choice}</strong> buys you {block.tradeoff.buys}, and costs you {block.tradeoff.costs}.
          </div>
          <blockquote className="remember-say">“{block.sayIt}”</blockquote>
        </div>
      </div>
    </section>
  );
}

export function BlockRenderer({ block, ctx }: { block: Block; ctx: BlockContext }) {
  switch (block.type) {
    case "prose":
      return <Prose block={block} ctx={ctx} />;
    case "structuredTable":
      return <Table block={block} ctx={ctx} />;
    case "figure":
      return <Figure block={block} ctx={ctx} />;
    case "trace":
      return <Trace block={block} ctx={ctx} />;
    case "quiz":
    case "predict":
      return <Choice block={block} ctx={ctx} />;
    case "estimationWorksheet":
      return <Worksheet block={block} ctx={ctx} />;
    case "spotTheBug":
      return <SpotTheBug block={block} ctx={ctx} />;
    case "ladder":
      return <Ladder block={block} ctx={ctx} />;
    case "designPrompt":
      return <DesignPrompt block={block} ctx={ctx} />;
    case "rememberCard":
      return <RememberCard block={block} ctx={ctx} />;
    default:
      // An unknown block type from newer content renders quietly instead of breaking the page.
      return (
        <div className="card" style={{ ...card, color: "var(--ink-muted)", fontSize: 13 }}>
          <CircleAlert size={14} /> This part needs a newer version of the app.
        </div>
      );
  }
}
