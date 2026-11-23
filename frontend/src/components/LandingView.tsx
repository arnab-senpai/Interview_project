import React, { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Gauge, Layers } from "lucide-react";
import { api, authStorage, type AuthSessionResponse } from "../api/client";

interface LandingViewProps {
  onAuthenticated: (session: AuthSessionResponse, opts: { guest: boolean }) => void;
  /** Open the sign-in form; "register" when guests are not allowed and the learner wants to start. */
  onOpenAuth: (mode: "login" | "register") => void;
}

const POINTS = [
  { icon: Layers, title: "One path, in order", text: "Twenty short chapters, from one server to the designs interviewers ask for. Each uses only what came before." },
  { icon: Gauge, title: "Pictures with real numbers", text: "Every step adds one box to the design, and the numbers update as you change the traffic." },
  { icon: BookOpen, title: "Review that fits in a coffee", text: "When you finish a chapter, its key points come back as a few cards over the next days." },
];

/** What a signed-out visitor sees: what this is, and one button to start. No account needed for chapter 1. */
export const LandingView: React.FC<LandingViewProps> = ({ onAuthenticated, onOpenAuth }) => {
  const [guestsAllowed, setGuestsAllowed] = useState<boolean | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSessionConfig()
      .then((c) => setGuestsAllowed(c.guestsAllowed))
      .catch(() => setGuestsAllowed(false));
  }, []);

  const start = async () => {
    if (!guestsAllowed) {
      onOpenAuth("register");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const res = await api.startGuest();
      authStorage.setToken(null);
      authStorage.setGuest(true);
      onAuthenticated({ ...res, accessToken: "", tokenType: "cookie", expiresAt: "" }, { guest: true });
    } catch (e: any) {
      setError(e?.message ?? "Could not start");
      setStarting(false);
    }
  };

  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="landing-kicker">System design, from zero</div>
        <h1>Learn to design systems the way interviews ask, one small step at a time.</h1>
        <p>
          No background needed. Start with what a design question even is, then build up servers, caches, databases and queues until you can walk an
          interviewer through a whole design.
        </p>
        <div className="landing-actions">
          <button className="btn-primary landing-start" onClick={start} disabled={starting || guestsAllowed === null}>
            {starting ? "Starting…" : "Start chapter 1"} <ArrowRight size={15} />
          </button>
          <button className="btn-secondary" onClick={() => onOpenAuth("login")}>
            I have an account
          </button>
        </div>
        <p className="landing-small">
          {guestsAllowed === false
            ? "Create a free account to start. It takes a minute."
            : "Free, and no account needed to start. Your progress stays on this browser until you save it to an account."}
        </p>
        {error && <p className="landing-error">{error}</p>}
      </section>

      <section className="landing-points" aria-label="How it works">
        {POINTS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="landing-point">
            <Icon size={16} aria-hidden />
            <b>{title}</b>
            <span>{text}</span>
          </div>
        ))}
      </section>
    </div>
  );
};
