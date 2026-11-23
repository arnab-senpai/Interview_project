import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, BookOpen, CalendarClock, CheckCircle2, Circle, CircleDot, Clock, Flame, Lock, RefreshCw, SkipForward } from "lucide-react";
import { api, type TodayCard, type TodayChapter, type TodayResponse } from "../api/client";
import { LAYER_LABELS } from "../copy";

interface LearnHomeProps {
  /** Bumped by the parent after a chapter closes, so the plan is re-read. */
  refreshKey?: number;
  isGuest: boolean;
  /** The learner answered (or skipped) the three onboarding questions. */
  onboarded: boolean;
  onOpenChapter: (topicId: string, stepKey?: string | null) => void;
  onOpenReview: () => void;
  onOpenPlan: () => void;
  onSaveProgress: () => void;
  /** "I already know this" for one stage. */
  onTestOut: (stageId: string) => void;
  /** A repair card's five-minute refresher on one chapter. */
  onDrill: (topicId: string) => void;
}

const STATE_LABEL: Record<TodayChapter["state"], string> = {
  done: "Done",
  current: "Up next",
  preview: "Preview",
  open: "",
  soon: "Coming soon",
  placed_out: "Skipped, you know this",
};

function StateIcon({ state }: { state: TodayChapter["state"] }) {
  if (state === "done") return <CheckCircle2 size={15} className="learn-ch-icon" data-state="done" aria-hidden />;
  if (state === "current") return <CircleDot size={15} className="learn-ch-icon" data-state="current" aria-hidden />;
  if (state === "soon") return <Lock size={13} className="learn-ch-icon" data-state="soon" aria-hidden />;
  if (state === "placed_out") return <SkipForward size={14} className="learn-ch-icon" data-state="placed_out" aria-hidden />;
  return <Circle size={15} className="learn-ch-icon" aria-hidden />;
}

function formatDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function daysUntil(iso: string): number {
  const d = new Date(`${iso}T00:00:00`);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86_400_000);
}

function hours(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 6) / 10;
  return `${h % 1 === 0 ? h.toFixed(0) : h} h`;
}

/** The home page: one next step at the top, today's small extras beside it, the whole path below. */
export const LearnHome: React.FC<LearnHomeProps> = ({ refreshKey = 0, isGuest, onboarded, onOpenChapter, onOpenReview, onOpenPlan, onSaveProgress, onTestOut, onDrill }) => {
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testOut, setTestOut] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    api
      .getToday("hld")
      .then((t) => !cancelled && setToday(t))
      .catch((e) => !cancelled && setError(e.message ?? String(e)));
    // Which stages still offer a test-out.
    api
      .getPath("start-here")
      .then((p) => !cancelled && setTestOut(new Set(p.stages.filter((st) => st.testOutAvailable).map((st) => st.id))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const stages = useMemo(() => {
    const out: Array<{ id: string; title: string; chapters: TodayChapter[] }> = [];
    for (const c of today?.chapters ?? []) {
      let st = out.find((s) => s.id === c.stageId);
      if (!st) {
        st = { id: c.stageId, title: c.stageTitle, chapters: [] };
        out.push(st);
      }
      st.chapters.push(c);
    }
    return out;
  }, [today]);

  if (error) return <div className="card" style={{ margin: 32, padding: 16, color: "var(--danger)" }}>Could not load your plan: {error}</div>;
  if (!today) return <div className="learn-home"><div className="learn-loading">Loading your plan…</div></div>;

  const chapters = today.chapters;
  const done = chapters.filter((c) => c.state === "done" || c.state === "placed_out").length;
  const available = chapters.filter((c) => c.state !== "soon").length;
  const cont = today.continue;
  const contCard = today.cards.find((c) => c.kind === "continue");
  const extras = today.cards.filter((c) => c.kind !== "continue");
  const contChapter = cont ? chapters.find((c) => c.topicId === cont.topicId) : undefined;
  // Nothing read yet: the first step of chapter 1 and the planner hasn't seen a start.
  const fresh = done === 0 && cont?.number === 1 && contCard?.reason !== "Pick up where you stopped";
  const layerLabel = cont?.layer ? LAYER_LABELS[cont.layer] : null;
  const pace = today.pace;
  const streak = today.streak;
  const showSave = isGuest && chapters.some((c) => c.state === "done");

  const openCard = (card: TodayCard) => {
    if (card.kind === "review") onOpenReview();
    else if (card.kind === "repair" && card.drill && card.topicId) onDrill(card.topicId);
    else if (card.topicId) onOpenChapter(card.topicId, card.stepKey ?? null);
  };

  return (
    <div className="learn-home">
      <div className="learn-top">
        <section className="learn-next card" aria-labelledby="learn-next-title">
          {cont ? (
            <>
              <div className="learn-kicker">
                {fresh ? "Start here" : "Up next"} · Chapter {cont.number}
                {layerLabel ? ` · ${layerLabel}` : ""}
                {contChapter?.legacy ? <span className="pill-preview">Preview</span> : null}
              </div>
              <h1 id="learn-next-title" className="learn-next-title">{cont.title}</h1>
              <p className="learn-next-reason">
                {fresh
                  ? "No background needed. Each step is one short idea with a picture, and the numbers update as you go."
                  : contCard?.reason ?? "Next chapter on your path"}
              </p>
              <div className="learn-next-actions">
                <button className="btn-primary learn-next-btn" onClick={() => onOpenChapter(cont.topicId, cont.stepKey)}>
                  {fresh ? "Start chapter 1" : "Continue"} <ArrowRight size={15} />
                </button>
                {contCard && (
                  <span className="learn-next-time">
                    <Clock size={12} /> about {contCard.minutes} min
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="learn-kicker">All caught up</div>
              <h1 id="learn-next-title" className="learn-next-title">You have finished every chapter that is ready</h1>
              <p className="learn-next-reason">New chapters are on the way. Review keeps what you learned fresh in the meantime.</p>
              <div className="learn-next-actions">
                <button className="btn-primary learn-next-btn" onClick={onOpenReview}>
                  Go to Review <ArrowRight size={15} />
                </button>
              </div>
            </>
          )}
            {extras.length > 0 && (
              <div className="learn-extras" aria-label="Also today" role="group">
                <div className="learn-extras-head">Also today</div>
                {extras.map((c) => (
                  <button key={`${c.kind}:${c.topicId ?? ""}`} className="learn-extra" data-kind={c.kind} onClick={() => openCard(c)}>
                    {c.kind === "review" ? <BookOpen size={14} /> : c.kind === "repair" ? <RefreshCw size={14} /> : <ArrowRight size={14} />}
                    <span className="learn-extra-text">
                      <span className="learn-extra-title">{c.kind === "next" ? `Then: ${c.title}` : c.kind === "review" ? `Review ${today.review.due} card${today.review.due === 1 ? "" : "s"}` : c.title}</span>
                      <span className="learn-extra-reason">{c.kind === "repair" ? "A five-minute refresher before the next chapter" : c.reason}</span>
                    </span>
                    <span className="learn-extra-time">{c.minutes} min</span>
                  </button>
                ))}
              </div>
            )}
        </section>

        <aside className="learn-side" aria-label="Today">
          <div className="learn-side-card card">
            <div className="learn-side-head">
              <BookOpen size={13} /> Review
            </div>
            {today.review.due > 0 ? (
              <>
                <div className="learn-side-big">{today.review.due} card{today.review.due === 1 ? "" : "s"} due</div>
                <button className="btn-secondary" onClick={onOpenReview}>
                  Review now <ArrowRight size={12} />
                </button>
              </>
            ) : (
              <p className="learn-side-note">
                {today.review.newToday > 0
                  ? `${today.review.newToday} card${today.review.newToday === 1 ? "" : "s"} added today. The first ones come back tomorrow.`
                  : "Nothing to review yet. Cards arrive when you finish a chapter."}
              </p>
            )}
          </div>

          <div className="learn-side-card card">
            <div className="learn-side-head">
              <CalendarClock size={13} /> Your plan
            </div>
            {pace.interviewDate ? (
              <>
                <div className="learn-side-big">
                  Interview {formatDay(pace.interviewDate)}
                  {daysUntil(pace.interviewDate) >= 0 ? <span className="learn-side-sub"> · in {daysUntil(pace.interviewDate)} days</span> : null}
                </div>
                <p className="learn-side-note" data-tone={pace.onTrack === false ? "warn" : undefined}>
                  {pace.chaptersLeft === 0
                    ? "Every ready chapter is done."
                    : pace.onTrack === false
                    ? `At ${pace.hoursPerWeek} h a week you finish ${formatDay(pace.finishBy)}, after the interview. More time a week, or skim the Preview chapters.`
                    : `At ${pace.hoursPerWeek} h a week you finish ${formatDay(pace.finishBy)}. On track.`}
                </p>
              </>
            ) : (
              <p className="learn-side-note">
                {pace.chaptersLeft} chapters left, about {hours(pace.minutesLeft)}. At {pace.hoursPerWeek} h a week that is done by {formatDay(pace.finishBy)}.
              </p>
            )}
            <button className="link-btn" onClick={onOpenPlan}>
              {onboarded ? "Change your plan" : "Set your plan"}
            </button>
          </div>

          <div className="learn-side-card card learn-streak">
            <Flame size={15} color="var(--highlight)" aria-hidden />
            <span className="streak-hand">{streak.currentStreak}-day streak</span>
            <span className="learn-side-sub">
              · today {Math.min(streak.todayActions, streak.dailyGoal)} of {streak.dailyGoal} steps
            </span>
          </div>
        </aside>
      </div>

      {showSave && (
        <div className="learn-save card" role="note">
          <div>
            <b>Save your progress</b>
            <span> It lives on this browser for now. An account keeps it on every device.</span>
          </div>
          <button className="btn-secondary" onClick={onSaveProgress}>
            Create an account
          </button>
        </div>
      )}

      <section className="learn-path" aria-labelledby="learn-path-title">
        <div className="learn-path-head">
          <h2 id="learn-path-title">The path</h2>
          <span className="learn-path-count">
            {done} of {available} chapters done
          </span>
        </div>
        <div className="learn-path-bar" role="progressbar" aria-valuemin={0} aria-valuemax={available} aria-valuenow={done} aria-label="Chapters done">
          <span style={{ width: `${available ? (done / available) * 100 : 0}%` }} />
        </div>
        <p className="learn-path-intro">
          In order, from one server to the designs interviewers ask for. Each chapter only uses what came before, but you can open any ready one.
          {chapters.length > available ? ` ${chapters.length - available} more are being written.` : ""}
        </p>

        {stages.map((st) => (
          <div key={st.id} className="learn-stage">
            <div className="learn-stage-head">
              <h3 className="learn-stage-title">{st.title.replace(/^Stage \d+\s*·\s*/, "")}</h3>
              {testOut.has(st.id) && (
                <button className="link-btn" onClick={() => onTestOut(st.id)}>
                  Know this already? Test out
                </button>
              )}
            </div>
            <ol className="learn-chapters">
              {st.chapters.map((c) => {
                const label = STATE_LABEL[c.state];
                return (
                  <li key={c.topicId}>
                    <button
                      className="learn-ch"
                      data-state={c.state}
                      disabled={c.state === "soon"}
                      aria-current={c.state === "current" ? "step" : undefined}
                      onClick={() => onOpenChapter(c.topicId, c.state === "current" ? cont?.stepKey : null)}
                    >
                      <StateIcon state={c.state} />
                      <span className="learn-ch-num mono">{String(c.number).padStart(2, "0")}</span>
                      <span className="learn-ch-title">{c.title}</span>
                      <span className="learn-ch-meta">
                        {c.state === "preview" ? (
                          <span className="pill-preview">Preview</span>
                        ) : label ? (
                          <span className="learn-ch-state">{label}</span>
                        ) : null}
                        {c.minutes && c.state !== "soon" ? <span className="learn-ch-min">{c.minutes} min</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </section>
    </div>
  );
};
