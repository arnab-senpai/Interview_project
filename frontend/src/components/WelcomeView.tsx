import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { api, type Goal, type LearnerProfile, type StartLevel } from "../api/client";

interface WelcomeViewProps {
  /** Present when the learner comes back to change their plan; answers start filled in. */
  profile: LearnerProfile | null;
  /** Called after saving. `start` is true when the learner chose to begin chapter 1 now. */
  onDone: (profile: LearnerProfile | null, start: boolean) => void;
}

const GOALS: Array<{ id: Goal; label: string; note: string; ready: boolean }> = [
  { id: "hld", label: "System design", note: "Design a service end to end: servers, databases, caches, queues.", ready: true },
  { id: "lld", label: "Object-oriented design", note: "Classes and interfaces for one component. Path coming later.", ready: false },
  { id: "coding", label: "Coding rounds", note: "Data structures and algorithms. Path coming later.", ready: false },
];

const LEVELS: Array<{ id: StartLevel; label: string; note: string }> = [
  { id: "new", label: "New to this", note: "I haven't designed a system before. Start from the very beginning." },
  { id: "built_apps", label: "I've built apps", note: "I've shipped code, but not designed anything at large scale." },
  { id: "experienced", label: "I design systems at work", note: "I mostly need practice explaining designs in an interview." },
];

const HOURS = [2, 5, 8, 12];

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Three short questions, each one skippable. The answers only shape the plan on Learn; nothing is locked. */
export const WelcomeView: React.FC<WelcomeViewProps> = ({ profile, onDone }) => {
  const returning = Boolean(profile?.onboarded);
  const [step, setStep] = useState(0);
  const [goals, setGoals] = useState<Goal[]>(profile?.goals?.length ? profile.goals : ["hld"]);
  const [level, setLevel] = useState<StartLevel | null>(profile?.startLevel ?? null);
  const [noDate, setNoDate] = useState<boolean>(returning && !profile?.interviewDate);
  const [date, setDate] = useState<string>(profile?.interviewDate ?? "");
  const [hoursPerWeek, setHoursPerWeek] = useState<number>(profile?.hoursPerWeek ?? 5);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!returning) api.sendEvents([{ kind: "onboarding_started" }]);
  }, [returning]);

  useEffect(() => {
    headRef.current?.focus();
  }, [step]);

  const save = async (opts: { skipped: boolean; start: boolean }) => {
    setSaving(true);
    setError(null);
    const tz = browserTimeZone();
    const payload: Parameters<typeof api.saveProfile>[0] = { ...(tz ? { timezone: tz } : {}) };
    if (!opts.skipped || step > 0) payload.goals = goals.length ? goals : ["hld"];
    if (level) payload.startLevel = level;
    if (noDate) payload.clearInterviewDate = true;
    else if (date) payload.interviewDate = date;
    if (!opts.skipped || step >= 2) payload.hoursPerWeek = hoursPerWeek;
    try {
      const saved = await api.saveProfile(payload);
      api.sendEvents([{ kind: "onboarding_finished", props: { skipped: opts.skipped, atQuestion: step + 1, level, hasDate: Boolean(date && !noDate) } }]);
      onDone(saved, opts.start);
    } catch (e: any) {
      // A failed save never blocks learning: carry on without a plan.
      setError(e?.message ?? String(e));
      setSaving(false);
    }
  };

  const toggleGoal = (g: Goal) => setGoals((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  const minutesPerDay = Math.round((hoursPerWeek * 60) / 7);
  const last = step === 2;

  return (
    <div className="welcome">
      <div className="welcome-card card">
        <div className="welcome-top">
          <span className="welcome-count">
            Question {step + 1} of 3
          </span>
          <span className="welcome-dots" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} data-on={i <= step} />
            ))}
          </span>
          <button className="link-btn" disabled={saving} onClick={() => save({ skipped: true, start: !returning })}>
            {returning ? "Cancel" : "Skip for now"}
          </button>
        </div>

        {step === 0 && (
          <fieldset className="welcome-q">
            <legend>
              <h1 ref={headRef} tabIndex={-1}>What are you preparing for?</h1>
              <p>Pick all that apply. System design is ready today; the others are on the way and we'll keep your answer.</p>
            </legend>
            <div className="welcome-options">
              {GOALS.map((g) => (
                <label key={g.id} className="welcome-option" data-checked={goals.includes(g.id)}>
                  <input type="checkbox" checked={goals.includes(g.id)} onChange={() => toggleGoal(g.id)} />
                  <span className="welcome-option-text">
                    <b>{g.label}</b>
                    <span>{g.note}</span>
                  </span>
                  {goals.includes(g.id) && <Check size={14} className="welcome-tick" aria-hidden />}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {step === 1 && (
          <fieldset className="welcome-q">
            <legend>
              <h1 ref={headRef} tabIndex={-1}>How much do you know already?</h1>
              <p>Everyone starts at chapter 1, which is short. This only changes how much we explain on the way.</p>
            </legend>
            <div className="welcome-options" role="radiogroup">
              {LEVELS.map((l) => (
                <label key={l.id} className="welcome-option" data-checked={level === l.id}>
                  <input type="radio" name="start-level" checked={level === l.id} onChange={() => setLevel(l.id)} />
                  <span className="welcome-option-text">
                    <b>{l.label}</b>
                    <span>{l.note}</span>
                  </span>
                  {level === l.id && <Check size={14} className="welcome-tick" aria-hidden />}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {step === 2 && (
          <fieldset className="welcome-q">
            <legend>
              <h1 ref={headRef} tabIndex={-1}>When is your interview?</h1>
              <p>We use this to pace the path. You can change it any time from Learn.</p>
            </legend>
            <div className="welcome-date">
              <label className="welcome-field">
                <span>Interview date</span>
                <input
                  type="date"
                  min={todayIso()}
                  value={noDate ? "" : date}
                  disabled={noDate}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label className="welcome-check">
                <input type="checkbox" checked={noDate} onChange={(e) => setNoDate(e.target.checked)} />
                <span>No date yet</span>
              </label>
            </div>
            <div className="welcome-field">
              <span id="welcome-hours">Time you can give it each week</span>
              <div className="welcome-chips" role="radiogroup" aria-labelledby="welcome-hours">
                {HOURS.map((h) => (
                  <button key={h} role="radio" aria-checked={hoursPerWeek === h} className="chip-btn" data-active={hoursPerWeek === h} onClick={() => setHoursPerWeek(h)}>
                    {h} h
                  </button>
                ))}
              </div>
              <span className="welcome-hint">About {minutesPerDay} minutes a day.</span>
            </div>
          </fieldset>
        )}

        {error && <div className="welcome-error">Could not save your plan ({error}). You can still start learning.</div>}

        <div className="welcome-nav">
          {step > 0 ? (
            <button className="btn-secondary" disabled={saving} onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft size={13} /> Back
            </button>
          ) : (
            <span />
          )}
          {last ? (
            <button className="btn-primary" disabled={saving} onClick={() => save({ skipped: false, start: !returning })}>
              {returning ? "Save plan" : "Start chapter 1"} <ArrowRight size={14} />
            </button>
          ) : (
            <button className="btn-primary" onClick={() => setStep((s) => s + 1)}>
              {(step === 0 && goals.length) || (step === 1 && level) ? "Next" : "Skip this one"} <ArrowRight size={14} />
            </button>
          )}
        </div>
        {error && (
          <button className="link-btn welcome-anyway" onClick={() => onDone(null, !returning)}>
            Continue without saving
          </button>
        )}
      </div>
    </div>
  );
};
