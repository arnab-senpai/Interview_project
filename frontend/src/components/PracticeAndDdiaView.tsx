import { levelLabel } from "../copy";
import React, { useEffect, useState } from "react";
import { BookMarked, CheckCircle2, Compass, Layers, RotateCw, XCircle } from "lucide-react";
import { api, type FlashcardWithSm2, type QuizAnswerResult, type QuizWithAttempt } from "../api/client";
import type { PatternPlaybook } from "../types/hld";
import { humanizeKey, renderInlineCode } from "../utils/format";
import { ReportIssueButton } from "./ReportIssueButton";

interface PracticeAndDdiaViewProps {
  topicFilter: string | null;
  onClearTopicFilter: () => void;
  patterns: PatternPlaybook[];
  foundations: any;
  topicMetaById: Record<string, { title: string; ready: boolean }>;
  onPracticeUpdated: () => void;
  onOpenTopic: (topicId: string) => void;
}

export const PracticeAndDdiaView: React.FC<PracticeAndDdiaViewProps> = ({
  topicFilter,
  onClearTopicFilter,
  patterns,
  foundations,
  topicMetaById,
  onPracticeUpdated,
  onOpenTopic,
}) => {
  const [subtab, setSubtab] = useState<"flashcards" | "quizzes" | "ddia" | "patterns">(
    topicFilter ? "quizzes" : "flashcards"
  );
  const [cards, setCards] = useState<FlashcardWithSm2[]>([]);
  const [cardIdx, setCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [dueOnly, setDueOnly] = useState(false);

  const [quizzes, setQuizzes] = useState<QuizWithAttempt[]>([]);
  const [quizFeedback, setQuizFeedback] = useState<Record<string, QuizAnswerResult>>({});

  useEffect(() => {
    if (topicFilter) setSubtab("quizzes");
  }, [topicFilter]);

  const loadPractice = async () => {
    const [fcRes, qRes] = await Promise.all([
      api.getFlashcards({ topicId: topicFilter ?? undefined, dueOnly }),
      api.getQuizzes(topicFilter ?? undefined),
    ]);
    setCards(fcRes.flashcards);
    setCardIdx(0);
    setFlipped(false);
    setQuizzes(qRes.quizzes);
  };

  useEffect(() => {
    loadPractice();
  }, [topicFilter, dueOnly]);

  const activeCard = cards[cardIdx] ?? null;

  const handleRateCard = async (rating: "again" | "hard" | "good" | "easy") => {
    if (!activeCard) return;
    await api.reviewFlashcard(activeCard.id, rating);
    onPracticeUpdated();
    setFlipped(false);
    if (cardIdx < cards.length - 1) {
      setCardIdx((i) => i + 1);
    } else {
      await loadPractice();
    }
  };

  const handleAnswerQuiz = async (qId: string, optionIdx: number) => {
    const res = await api.answerQuiz(qId, optionIdx);
    setQuizFeedback((prev) => ({ ...prev, [qId]: res }));
    onPracticeUpdated();
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
      <div style={{ maxWidth: 1220, margin: "0 auto" }}>
        {/* Sub-nav */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => setSubtab("flashcards")} className={subtab === "flashcards" ? "btn-primary" : "btn-secondary"}>
              <RotateCw size={13} /> Cards ({cards.length})
            </button>
            <button onClick={() => setSubtab("quizzes")} className={subtab === "quizzes" ? "btn-primary" : "btn-secondary"}>
              <CheckCircle2 size={13} /> Quick checks ({quizzes.length})
            </button>
            <button onClick={() => setSubtab("ddia")} className={subtab === "ddia" ? "btn-primary" : "btn-secondary"}>
              <BookMarked size={13} /> Reading notes
            </button>
            <button onClick={() => setSubtab("patterns")} className={subtab === "patterns" ? "btn-primary" : "btn-secondary"}>
              <Layers size={13} /> Patterns
            </button>
          </div>

          {topicFilter && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="badge badge-accent">Showing: {topicMetaById[topicFilter]?.title ?? humanizeKey(topicFilter)}</span>
              <button className="btn-secondary" onClick={onClearTopicFilter}>Show All Topics</button>
            </div>
          )}
        </div>

        {/* FLASHCARDS */}
        {subtab === "flashcards" && (
          <div style={{ maxWidth: 740, margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span className="mono" style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                Card {cards.length === 0 ? 0 : cardIdx + 1} of {cards.length}
              </span>
              <label htmlFor="fc-due-only" className="mono" style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input id="fc-due-only" name="dueOnly" type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} />
                Due cards only
              </label>
            </div>

            {!activeCard ? (
              <div className="card" style={{ textAlign: "center", padding: 36 }}>
                <div className="mono" style={{ fontWeight: 700, fontSize: 15 }}>All caught up</div>
                <p style={{ color: "var(--ink-secondary)", fontSize: 13 }}>Untick "Due cards only" to go through every card.</p>
              </div>
            ) : (
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span className="badge badge-accent">{topicMetaById[activeCard.topicId]?.title ?? humanizeKey(activeCard.topicId)} · {levelLabel(activeCard.difficulty)}</span>
                    <ReportIssueButton topicId={activeCard.topicId} blockId={`flashcard:${activeCard.id}`} blockLabel={`Flashcard ${activeCard.id}`} />
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>
                    {activeCard.sm2.intervalDays > 0 ? `Next review in ${activeCard.sm2.intervalDays} day${activeCard.sm2.intervalDays === 1 ? "" : "s"}` : "New card"}
                  </span>
                </div>

                <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.5, minHeight: 74 }}>
                  {renderInlineCode(activeCard.front)}
                </div>

                {flipped ? (
                  <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border-soft)" }}>
                    <div className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--success)", marginBottom: 6 }}>
                      ANSWER
                    </div>
                    <div style={{ fontSize: 14, lineHeight: 1.6 }}>{renderInlineCode(activeCard.back)}</div>

                    <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
                      <button className="btn-secondary" style={{ borderColor: "var(--danger)", color: "var(--danger)" }} onClick={() => handleRateCard("again")}>
                        Again
                      </button>
                      <button className="btn-secondary" style={{ borderColor: "var(--warn)", color: "var(--warn)" }} onClick={() => handleRateCard("hard")}>
                        Hard
                      </button>
                      <button className="btn-primary" onClick={() => handleRateCard("good")}>
                        Got it
                      </button>
                      <button className="btn-secondary" style={{ borderColor: "var(--success)", color: "var(--success)" }} onClick={() => handleRateCard("easy")}>
                        Easy
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => setFlipped(true)}>
                    Show answer
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* QUIZZES */}
        {subtab === "quizzes" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {quizzes.map((q, qIdx) => {
              const fb = quizFeedback[q.id];
              return (
                <div key={q.id} className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)" }}>
                      Question {qIdx + 1} · {topicMetaById[q.topicId]?.title ?? humanizeKey(q.topicId)} · {levelLabel(q.difficulty)}
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {q.lastAttempt && !fb && (
                        <span className={`badge ${q.lastAttempt.isCorrect ? "badge-success" : "badge-warn"}`}>
                          Last try: {q.lastAttempt.isCorrect ? "Correct" : "Needs review"}
                        </span>
                      )}
                      <ReportIssueButton topicId={q.topicId} blockId={`quiz:${q.id}`} blockLabel={`Quiz ${q.id}`} />
                    </span>
                  </div>
                  <div style={{ padding: 10, borderRadius: 6, background: "var(--bg-subtle)", fontSize: 13, marginBottom: 10 }}>
                    {renderInlineCode(q.scenario)}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>{renderInlineCode(q.question)}</div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {q.options.map((opt, idx) => {
                      const isPicked = fb?.selectedIndex === idx;
                      const isRight = fb?.correctIndex === idx;
                      let border = "var(--border-soft)";
                      let bg = "var(--bg-surface)";
                      if (fb) {
                        if (isRight) {
                          border = "var(--success)";
                          bg = "var(--success-bg)";
                        } else if (isPicked) {
                          border = "var(--danger)";
                          bg = "var(--danger-bg)";
                        }
                      }
                      return (
                        <button
                          key={idx}
                          onClick={() => handleAnswerQuiz(q.id, idx)}
                          style={{
                            textAlign: "left",
                            padding: "9px 12px",
                            borderRadius: 6,
                            border: `1px solid ${border}`,
                            background: bg,
                            color: "var(--ink-primary)",
                            fontSize: 13,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span className="mono" style={{ fontWeight: 700 }}>{String.fromCharCode(65 + idx)}.</span>
                          <span>{renderInlineCode(opt)}</span>
                        </button>
                      );
                    })}
                  </div>

                  {fb && (
                    <div style={{ marginTop: 10, padding: 10, borderRadius: 6, background: fb.isCorrect ? "var(--success-bg)" : "var(--danger-bg)", fontSize: 12.5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, marginBottom: 4 }}>
                        {fb.isCorrect ? <CheckCircle2 size={15} color="var(--success)" /> : <XCircle size={15} color="var(--danger)" />}
                        {fb.isCorrect ? "Spot on!" : "Not quite — here is why:"}
                      </div>
                      {renderInlineCode(fb.explanation)}
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                        {q.options.map((_, idx) => {
                          const why = fb.optionExplanations[idx];
                          if (!why) return null;
                          const tag = idx === fb.correctIndex ? "Answer" : idx === fb.selectedIndex ? "Your pick" : null;
                          return (
                            <div key={idx} style={{ display: "flex", gap: 6, opacity: tag ? 1 : 0.75 }}>
                              <span className="mono" style={{ fontWeight: 700, minWidth: 18 }}>{String.fromCharCode(65 + idx)}.</span>
                              <span>
                                {tag && <strong>{tag}: </strong>}
                                {renderInlineCode(why)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* DDIA & PRAGMATIC */}
        {subtab === "ddia" && foundations && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div className="card" style={{ borderLeft: "4px solid var(--accent)" }}>
              <div className="mono" style={{ fontWeight: 700, fontSize: 13, color: "var(--accent)" }}>
                {foundations.pedagogicalDesign.title}
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 13 }}>{foundations.pedagogicalDesign.description}</p>
            </div>

            <div>
              <h2 className="mono" style={{ fontSize: 14, marginBottom: 10 }}>PRAGMATIC PROGRAMMER CRAFT PRINCIPLES</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
                {foundations.pragmaticPrinciples.map((p: any) => (
                  <div key={p.id} className="card">
                    <div className="mono" style={{ fontWeight: 700, color: "var(--success)", fontSize: 13 }}>{p.name}</div>
                    <p style={{ fontSize: 12.5, margin: "6px 0" }}>{p.coreIdea}</p>
                    <div style={{ fontSize: 12, color: "var(--ink-secondary)" }}><strong>HLD:</strong> {p.hldApplication}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 4 }}><strong>LLD:</strong> {p.lldApplication}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h2 className="mono" style={{ fontSize: 14, marginBottom: 10 }}>DESIGNING DATA-INTENSIVE APPLICATIONS (12 CHAPTERS)</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
                {foundations.ddiaChapterMap.map((ch: any) => (
                  <div key={ch.chapter} className="card">
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--purple)", fontWeight: 700 }}>
                      CHAPTER {ch.chapter} · {ch.part}
                    </div>
                    <div className="mono" style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>{ch.title}</div>
                    <ul style={{ margin: "8px 0 10px 16px", padding: 0, fontSize: 12.5, lineHeight: 1.55 }}>
                      {ch.coreMentalModels.map((m: string, i: number) => <li key={i}>{m}</li>)}
                    </ul>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {ch.linkedTopicIds.map((tid: string) => {
                        const meta = topicMetaById[tid];
                        const isReady = meta?.ready ?? false;
                        return (
                          <button
                            key={tid}
                            className={`badge ${isReady ? "badge-accent" : ""}`}
                            style={{ cursor: isReady ? "pointer" : "default", opacity: isReady ? 1 : 0.65 }}
                            disabled={!isReady}
                            onClick={() => isReady && onOpenTopic(tid)}
                          >
                            <Compass size={10} /> {meta?.title ?? humanizeKey(tid)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 12 PATTERN PLAYBOOKS */}
        {subtab === "patterns" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 14 }}>
            {patterns.map((p) => (
              <div key={p.id} className="card">
                <span className="badge badge-accent">{p.category}</span>
                <h3 className="mono" style={{ margin: "6px 0", fontSize: 14.5 }}>{p.name}</h3>
                <p style={{ fontSize: 12.5, color: "var(--ink-secondary)", margin: "0 0 8px" }}>{p.summary}</p>
                <div style={{ fontSize: 12, marginBottom: 6 }}>
                  <strong className="mono" style={{ fontSize: 10.5 }}>TRIGGERS:</strong> {p.triggerSignals.join(" · ")}
                </div>
                <div style={{ fontSize: 12, marginBottom: 6 }}>
                  <strong className="mono" style={{ fontSize: 10.5, color: "var(--success)" }}>COMPONENTS:</strong> {p.coreComponents.join(" → ")}
                </div>
                <div style={{ fontSize: 12, color: "var(--danger)" }}>
                  <strong className="mono" style={{ fontSize: 10.5 }}>AVOID:</strong> {p.commonPitfalls.join(" | ")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
