import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, SkipForward, XCircle } from "lucide-react";
import { api, type QuizQuestionItem, type StageCheckResult } from "../api/client";
import type { StudyPathResponse } from "../content/types";
import { renderInlineCode } from "../utils/format";

type Mode = { kind: "check"; pathId: string; stageId: string } | { kind: "drill"; topicId: string };

interface QuickCheckViewProps {
  mode: Mode;
  onDone: () => void;
  onOpenChapter: (topicId: string) => void;
}

interface Feedback {
  correct: boolean;
  correctIndex: number;
  explanation: string | null;
}

/**
 * Two short question runs that share one screen:
 *  - the stage test-out ("I already know this"): chapters answered right are marked as known; two misses end it;
 *  - the repair drill: up to three checks from one chapter, before the chapter that builds on it.
 */
export const QuickCheckView: React.FC<QuickCheckViewProps> = ({ mode, onDone, onOpenChapter }) => {
  const [path, setPath] = useState<StudyPathResponse | null>(null);
  const [started, setStarted] = useState(mode.kind === "drill");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<QuizQuestionItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [total, setTotal] = useState(0);
  const [question, setQuestion] = useState<QuizQuestionItem | null>(null);
  const [nextQuestion, setNextQuestion] = useState<QuizQuestionItem | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [result, setResult] = useState<StageCheckResult | null>(null);
  const [drillRight, setDrillRight] = useState(0);
  const [drillTitle, setDrillTitle] = useState("");
  const [finished, setFinished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getPath(mode.kind === "check" ? mode.pathId : "start-here").then(setPath).catch(() => setPath(null));
  }, [mode.kind === "check" ? mode.pathId : ""]);

  useEffect(() => {
    if (mode.kind !== "drill") return;
    api
      .getDrill(mode.topicId)
      .then((d) => {
        setDrillTitle(d.chapterTitle);
        setItems(d.items);
        setTotal(d.items.length);
        setQuestion(d.items[0] ?? null);
        if (!d.items.length) setFinished(true);
      })
      .catch((e) => setError(e.message ?? String(e)));
  }, [mode.kind === "drill" ? mode.topicId : ""]);

  useEffect(() => {
    cardRef.current?.focus();
  }, [question]);

  const stage = mode.kind === "check" ? path?.stages.find((s) => s.id === mode.stageId) : undefined;
  const titleOf = (topicId: string) => path?.stages.flatMap((s) => s.chapters).find((c) => c.topicId === topicId)?.title ?? topicId;
  const stageName = stage?.title.replace(/^Stage \d+\s*·\s*/, "") ?? "this stage";

  const start = async () => {
    if (mode.kind !== "check") return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.startStageCheck(mode.pathId, mode.stageId);
      setSessionId(s.sessionId);
      setTotal(s.total);
      setQuestion(s.question);
      setStarted(true);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (i: number) => {
    if (!question || feedback || busy) return;
    setChoice(i);
    setBusy(true);
    try {
      if (mode.kind === "check" && sessionId) {
        const r = await api.answerStageCheck(sessionId, i);
        setFeedback({ correct: r.correct, correctIndex: r.correctIndex, explanation: r.explanation });
        if (r.finished && r.result) setResult(r.result);
        setNextQuestion(r.question ?? null);
      } else if (mode.kind === "drill") {
        const r = await api.submitAttempt({
          topicId: mode.topicId,
          blockId: question.blockId,
          gradingVersion: question.gradingVersion ?? 1,
          response: { choice: i },
          source: "drill",
        });
        const correctIndex = r.reveal?.correctIndex ?? -1;
        const explanation = Array.isArray(r.reveal?.explanations) ? r.reveal.explanations[i] ?? null : null;
        setFeedback({ correct: r.passed, correctIndex, explanation });
        if (r.passed) setDrillRight((n) => n + 1);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setFeedback(null);
    setChoice(null);
    if (mode.kind === "check") {
      if (result || !nextQuestion) {
        setFinished(true);
        setQuestion(null);
      } else {
        setQuestion(nextQuestion);
        setIdx((n) => n + 1);
      }
    } else {
      const n = idx + 1;
      if (n >= items.length) {
        setFinished(true);
        setQuestion(null);
      } else {
        setIdx(n);
        setQuestion(items[n]);
      }
    }
  };

  // 1-9 pick an answer, Enter moves on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!question) return;
      if (!feedback && /^[1-9]$/.test(e.key) && Number(e.key) <= question.options.length) pick(Number(e.key) - 1);
      else if (feedback && e.key === "Enter") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const heading = mode.kind === "check" ? `Test out of ${stageName}` : `Refresher: ${drillTitle || "…"}`;

  return (
    <div className="review-shell quick-check">
      <div className="review-head">
        <div>
          <button className="link-btn" onClick={onDone}>
            <ArrowLeft size={12} /> Learn
          </button>
          <h1 className="review-title">{heading}</h1>
          {!finished && (
            <p className="review-sub">
              {mode.kind === "check"
                ? "Answer a few questions from each chapter. Get a chapter's questions right and it is marked as known, so the path skips it."
                : "Three quick questions from a chapter the next one builds on. It takes about five minutes."}
            </p>
          )}
        </div>
      </div>

      {error ? (
        <div className="card review-empty" role="alert">
          <b>That didn't work</b>
          <p>{error}</p>
          <div className="review-empty-actions">
            <button className="btn-primary" onClick={onDone}>
              Back to Learn
            </button>
          </div>
        </div>
      ) : !started ? (
        <div className="card quick-intro">
          <ul>
            <li>Questions come from the chapters in {stageName} you have not finished{stage ? `: ${stage.chapters.filter((c) => c.available && c.status !== "completed" && c.status !== "placed_out").length} chapters` : ""}.</li>
            <li>Two wrong answers end the check. Nothing you have done is lost.</li>
            <li>Chapters you pass are marked as known, and their key points come back in Review in two weeks.</li>
          </ul>
          <div className="review-empty-actions" style={{ justifyContent: "flex-start" }}>
            <button className="btn-primary" disabled={busy} onClick={start}>
              Start the check <ArrowRight size={13} />
            </button>
            <button className="btn-secondary" onClick={onDone}>
              Not now
            </button>
          </div>
        </div>
      ) : finished ? (
        mode.kind === "check" && result ? (
          <div className="card quick-result">
            <b className="quick-result-head">
              {result.placedOut.length > 0
                ? `${result.placedOut.length} chapter${result.placedOut.length === 1 ? "" : "s"} marked as known`
                : "No chapters marked as known this time"}
            </b>
            <p className="quick-result-sub">
              {result.correct} of {result.answered} right{result.stoppedEarly ? ". The check stopped after two misses." : "."}
            </p>
            {result.placedOut.length > 0 && (
              <ResultList icon={<SkipForward size={13} />} label="Skipped on the path" ids={result.placedOut} titleOf={titleOf} />
            )}
            {result.needsStudy.length > 0 && (
              <ResultList icon={<XCircle size={13} />} label="Worth reading" ids={result.needsStudy} titleOf={titleOf} onOpen={onOpenChapter} />
            )}
            {result.notChecked.length > 0 && (
              <ResultList icon={<ArrowRight size={13} />} label="Not checked yet" ids={result.notChecked} titleOf={titleOf} onOpen={onOpenChapter} />
            )}
            <div className="review-empty-actions" style={{ justifyContent: "flex-start" }}>
              <button className="btn-primary" onClick={onDone}>
                Back to Learn <ArrowRight size={13} />
              </button>
            </div>
          </div>
        ) : (
          <div className="card review-empty">
            <CheckCircle2 size={20} style={{ color: "var(--success)" }} aria-hidden />
            <b>{total === 0 ? "Nothing to refresh here" : `${drillRight} of ${total} right`}</b>
            <p>
              {total === 0
                ? "This chapter has no quick questions yet."
                : drillRight === total
                ? "That still holds. On to the next chapter."
                : "The ones you missed will come up again in Review. Rereading that chapter's last part helps too."}
            </p>
            <div className="review-empty-actions">
              <button className="btn-primary" onClick={onDone}>
                Back to Learn <ArrowRight size={13} />
              </button>
              {mode.kind === "drill" && drillRight < total && (
                <button className="btn-secondary" onClick={() => onOpenChapter(mode.topicId)}>
                  Open the chapter
                </button>
              )}
            </div>
          </div>
        )
      ) : question ? (
        <div className="review-session">
          <div className="review-progress" aria-label={`Question ${idx + 1} of ${total}`}>
            <span className="review-progress-text">
              Question {idx + 1} of {total}
            </span>
            <span className="review-progress-bar">
              <span style={{ width: `${(idx / Math.max(1, total)) * 100}%` }} />
            </span>
          </div>
          <div className="card review-card" ref={cardRef} tabIndex={-1} aria-live="polite">
            {question.chapterTitle && (
              <div className="review-card-meta">
                <span className="review-card-chapter">{question.chapterTitle}</span>
              </div>
            )}
            <div className="review-prompt">{renderInlineCode(question.prompt)}</div>
            <div className="review-options" role="group" aria-label="Answers">
              {question.options.map((opt, i) => {
                const state = !feedback ? undefined : i === feedback.correctIndex ? "right" : i === choice ? "wrong" : "other";
                return (
                  <button key={i} className="review-option" data-state={state} disabled={Boolean(feedback) || busy} onClick={() => pick(i)}>
                    <span className="review-option-key mono">{i + 1}</span>
                    <span>{renderInlineCode(opt)}</span>
                    {state === "right" && <CheckCircle2 size={14} aria-label="correct answer" />}
                    {state === "wrong" && <XCircle size={14} aria-label="your answer" />}
                  </button>
                );
              })}
            </div>
            {feedback && (
              <div className="review-feedback" data-ok={feedback.correct}>
                <b>{feedback.correct ? "Right." : "Not quite."}</b> {feedback.explanation ? renderInlineCode(feedback.explanation) : null}
                <div className="review-feedback-foot">
                  <span>{mode.kind === "check" && result ? "That was the last question." : ""}</span>
                  <button className="btn-primary" onClick={next}>
                    {(mode.kind === "check" && (result || !nextQuestion)) || (mode.kind === "drill" && idx + 1 >= items.length) ? "See the result" : "Next"}{" "}
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="review-loading">Loading…</div>
      )}
    </div>
  );
};

function ResultList({
  icon,
  label,
  ids,
  titleOf,
  onOpen,
}: {
  icon: React.ReactNode;
  label: string;
  ids: string[];
  titleOf: (id: string) => string;
  onOpen?: (id: string) => void;
}) {
  return (
    <div className="quick-result-group">
      <div className="quick-result-label">
        {icon} {label}
      </div>
      <ul>
        {ids.map((id) => (
          <li key={id}>
            {onOpen ? (
              <button className="link-btn" onClick={() => onOpen(id)}>
                {titleOf(id)}
              </button>
            ) : (
              titleOf(id)
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
