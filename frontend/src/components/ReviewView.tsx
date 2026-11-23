import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, BookOpen, CheckCircle2, Eye, Layers, X, XCircle } from "lucide-react";
import { api, type ReviewItem, type ReviewRating } from "../api/client";
import { renderMarkdown } from "../utils/markdown";
import { renderInlineCode } from "../utils/format";

interface ReviewViewProps {
  /** "due" shows today's queue; "all" hosts the full card bank (children). */
  all: boolean;
  topicFilter: string | null;
  topicTitle?: string | null;
  onTab: (all: boolean) => void;
  onClearTopic: () => void;
  onContinueLearning: () => void;
  /** Called after each answer, so the header streak and Learn stay in step. */
  onReviewed?: () => void;
  children?: React.ReactNode;
}

const RATINGS: Array<{ id: ReviewRating; label: string; hint: string }> = [
  { id: "again", label: "Forgot", hint: "Back tomorrow" },
  { id: "hard", label: "Hard", hint: "Back soon" },
  { id: "good", label: "Got it", hint: "Back in a few days" },
  { id: "easy", label: "Easy", hint: "Back much later" },
];

interface Outcome {
  itemRef: string;
  ok: boolean;
}

function whenNext(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "later today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/** Review: only cards from chapters the learner finished, a few at a time. The full bank stays under "All cards". */
export const ReviewView: React.FC<ReviewViewProps> = ({ all, topicFilter, topicTitle, onTab, onClearTopic, onContinueLearning, onReviewed, children }) => {
  const [queue, setQueue] = useState<ReviewItem[] | null>(null);
  const [due, setDue] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [choice, setChoice] = useState<number | null>(null);
  const [answer, setAnswer] = useState<{ correct: boolean; correctIndex: number; explanation: string | null; nextDueAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [lastNext, setLastNext] = useState<string | null>(null);
  const sent = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (all) return;
    let cancelled = false;
    setQueue(null);
    api
      .getReviewQueue(30)
      .then((q) => {
        if (cancelled) return;
        setDue(q.due);
        setQueue(topicFilter ? q.items.filter((i) => i.topicId === topicFilter) : q.items);
        setIdx(0);
        setOutcomes([]);
        sent.current = false;
      })
      .catch((e) => !cancelled && setError(e.message ?? String(e)));
    return () => {
      cancelled = true;
    };
  }, [all, topicFilter]);

  const item = queue?.[idx];
  const finished = Boolean(queue && queue.length > 0 && idx >= queue.length);

  useEffect(() => {
    setRevealed(false);
    setChoice(null);
    setAnswer(null);
    cardRef.current?.focus();
  }, [idx]);

  // One event per session, when the last card is done (or the learner leaves partway).
  const sendSession = (list: Outcome[]) => {
    if (sent.current || list.length === 0) return;
    sent.current = true;
    api.sendEvents([{ kind: "review_session", props: { cards: list.length, right: list.filter((o) => o.ok).length, topicId: topicFilter } }]);
  };
  const outcomesRef = useRef(outcomes);
  outcomesRef.current = outcomes;
  useEffect(() => () => sendSession(outcomesRef.current), []);
  useEffect(() => {
    if (finished) sendSession(outcomes);
  }, [finished]);

  const pick = async (i: number) => {
    if (!item || answer || busy) return;
    setChoice(i);
    setBusy(true);
    try {
      const res = await api.answerReviewItem(item.itemRef, i);
      setAnswer(res);
      setLastNext(res.nextDueAt);
      setOutcomes((o) => [...o, { itemRef: item.itemRef, ok: res.correct }]);
      onReviewed?.();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const rate = async (r: ReviewRating) => {
    if (!item || busy) return;
    setBusy(true);
    try {
      const res = await api.gradeReviewItem(item.itemRef, r);
      setLastNext(res.nextDueAt);
      setOutcomes((o) => [...o, { itemRef: item.itemRef, ok: r !== "again" }]);
      onReviewed?.();
      setIdx((n) => n + 1);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  // Keyboard: Space shows the answer, 1-4 rate a recall card or pick an option, Enter moves on.
  useEffect(() => {
    if (all || !item) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (item.kind === "recall") {
        if (!revealed && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          setRevealed(true);
        } else if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
          rate(RATINGS[Number(e.key) - 1].id);
        }
      } else if (!answer && item.options && /^[1-9]$/.test(e.key) && Number(e.key) <= item.options.length) {
        pick(Number(e.key) - 1);
      } else if (answer && e.key === "Enter") {
        e.preventDefault();
        setIdx((n) => n + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const right = useMemo(() => outcomes.filter((o) => o.ok).length, [outcomes]);

  return (
    <div className="review-shell">
      <div className="review-head">
        <div>
          <h1 className="review-title">Review</h1>
          <p className="review-sub">A few minutes a day keeps what you learned. Cards come only from chapters you have finished.</p>
        </div>
        <div className="review-tabs" role="tablist" aria-label="Review sections">
          <button role="tab" aria-selected={!all} className="chip-btn" data-active={!all} onClick={() => onTab(false)}>
            <BookOpen size={12} /> Due now{!all && queue ? ` · ${Math.max(0, (topicFilter ? queue.length : due) - outcomes.length)}` : ""}
          </button>
          <button role="tab" aria-selected={all} className="chip-btn" data-active={all} onClick={() => onTab(true)}>
            <Layers size={12} /> All cards
          </button>
        </div>
      </div>

      {topicFilter && (
        <div className="review-filter">
          <span>
            Only <b>{topicTitle ?? topicFilter}</b>
          </span>
          <button className="icon-btn" onClick={onClearTopic} aria-label="Show every chapter">
            <X size={12} /> Every chapter
          </button>
        </div>
      )}

      {all ? (
        <div className="review-all">{children}</div>
      ) : error ? (
        <div className="card review-empty" role="alert">
          Could not load your review: {error}
        </div>
      ) : !queue ? (
        <div className="review-loading">Loading your cards…</div>
      ) : queue.length === 0 ? (
        <div className="card review-empty">
          <CheckCircle2 size={20} style={{ color: "var(--success)" }} aria-hidden />
          <b>{due > 0 && topicFilter ? "Nothing due from this chapter" : "Nothing to review right now"}</b>
          <p>
            {due > 0 && topicFilter
              ? `There ${due === 1 ? "is 1 card" : `are ${due} cards`} due from other chapters.`
              : "When you finish a chapter, its key points come back here as a few cards over the next days. Nothing to do until then."}
          </p>
          <div className="review-empty-actions">
            {due > 0 && topicFilter ? (
              <button className="btn-primary" onClick={onClearTopic}>
                Review every chapter <ArrowRight size={13} />
              </button>
            ) : (
              <button className="btn-primary" onClick={onContinueLearning}>
                Continue learning <ArrowRight size={13} />
              </button>
            )}
            <button className="btn-secondary" onClick={() => onTab(true)}>
              Browse all cards
            </button>
          </div>
        </div>
      ) : finished ? (
        <div className="card review-empty">
          <CheckCircle2 size={20} style={{ color: "var(--success)" }} aria-hidden />
          <b>Done for now</b>
          <p>
            {outcomes.length} card{outcomes.length === 1 ? "" : "s"}, {right} remembered.
            {lastNext ? ` The next ones come back ${whenNext(lastNext)}.` : ""}
            {due > queue.length ? ` ${due - queue.length} more are due; they are spread over the next sessions so no day gets heavy.` : ""}
          </p>
          <div className="review-empty-actions">
            <button className="btn-primary" onClick={onContinueLearning}>
              Continue learning <ArrowRight size={13} />
            </button>
          </div>
        </div>
      ) : item ? (
        <div className="review-session">
          <div className="review-progress" aria-label={`Card ${idx + 1} of ${queue.length}`}>
            <span className="review-progress-text">
              Card {idx + 1} of {queue.length}
            </span>
            <span className="review-progress-bar">
              <span style={{ width: `${(idx / queue.length) * 100}%` }} />
            </span>
          </div>

          <div className="card review-card" ref={cardRef} tabIndex={-1} aria-live="polite">
            <div className="review-card-meta">
              <span className="review-card-chapter">{item.chapterTitle}</span>
              {item.isNew && <span className="badge">First review</span>}
              {item.changedSinceLastSeen && <span className="badge">Updated since you saw it</span>}
            </div>
            <div className="review-prompt">{renderInlineCode(item.prompt)}</div>

            {item.kind === "choice" && item.options ? (
              <>
                <div className="review-options" role="group" aria-label="Answers">
                  {item.options.map((opt, i) => {
                    const state = !answer ? undefined : i === answer.correctIndex ? "right" : i === choice ? "wrong" : "other";
                    return (
                      <button key={i} className="review-option" data-state={state} disabled={Boolean(answer) || busy} onClick={() => pick(i)}>
                        <span className="review-option-key mono">{i + 1}</span>
                        <span>{renderInlineCode(opt)}</span>
                        {state === "right" && <CheckCircle2 size={14} aria-label="correct answer" />}
                        {state === "wrong" && <XCircle size={14} aria-label="your answer" />}
                      </button>
                    );
                  })}
                </div>
                {answer && (
                  <div className="review-feedback" data-ok={answer.correct}>
                    <b>{answer.correct ? "Right." : "Not quite."}</b> {answer.explanation ? renderInlineCode(answer.explanation) : null}
                    <div className="review-feedback-foot">
                      <span>Back {whenNext(answer.nextDueAt)}</span>
                      <button className="btn-primary" onClick={() => setIdx((n) => n + 1)}>
                        Next <ArrowRight size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : !revealed ? (
              <div className="review-recall">
                <p className="review-recall-hint">Say the answer out loud or in your head first, then check.</p>
                <button className="btn-primary" onClick={() => setRevealed(true)}>
                  <Eye size={13} /> Show answer
                </button>
              </div>
            ) : (
              <>
                <div className="review-back chapter-prose">{renderMarkdown(item.back ?? "")}</div>
                <div className="review-rate">
                  <span className="review-rate-q">How well did you remember it?</span>
                  <div className="review-rate-btns">
                    {RATINGS.map((r, i) => (
                      <button key={r.id} className="review-rate-btn" data-rating={r.id} disabled={busy} onClick={() => rate(r.id)}>
                        <b>{r.label}</b>
                        <span>{r.hint}</span>
                        <span className="review-option-key mono" aria-hidden>
                          {i + 1}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};
