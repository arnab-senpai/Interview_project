import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Box,
  Flame,
  Layers,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { api, authStorage, type AuthSessionResponse } from "../api/client";

interface AuthPortalModalProps {
  open: boolean;
  canDismiss: boolean;
  onClose: () => void;
  onAuthenticated: (session: AuthSessionResponse) => void;
  /** Which form shows when the modal opens: "register" for "Save your progress". */
  initialMode?: "login" | "register";
}

export const AuthPortalModal: React.FC<AuthPortalModalProps> = ({
  open,
  canDismiss,
  onClose,
  onAuthenticated,
  initialMode = "login",
}) => {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  useEffect(() => {
    if (open) setMode(initialMode);
  }, [open, initialMode]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [dailyGoal, setDailyGoal] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [guestsAllowed, setGuestsAllowed] = useState(false);
  useEffect(() => {
    if (!open) return;
    api
      .getSessionConfig()
      .then((c) => setGuestsAllowed(c.guestsAllowed))
      .catch(() => setGuestsAllowed(false));
  }, [open]);

  const continueAsGuest = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.startGuest();
      authStorage.setToken(null);
      authStorage.setGuest(true);
      onAuthenticated({ ...res, accessToken: "", tokenType: "cookie", expiresAt: "" });
    } catch (err: any) {
      setError(err?.message || "Could not start a guest session");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res =
        mode === "login"
          ? await api.login({ username, password })
          : await api.register({
              username,
              password,
              displayName: displayName || undefined,
              email: email || undefined,
              dailyGoal,
            });
      authStorage.setToken(res.accessToken);
      authStorage.setGuest(false);
      onAuthenticated(res);
      setPassword("");
    } catch (err: any) {
      setError(err?.message || "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={canDismiss ? onClose : undefined}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(3, 5, 14, 0.82)",
            backdropFilter: "blur(12px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(920px, 96vw)",
              display: "grid",
              gridTemplateColumns: "minmax(280px, 1.02fr) minmax(320px, 0.98fr)",
              borderRadius: 16,
              overflow: "hidden",
              border: "1px solid var(--border)",
              background: "var(--bg-surface-solid)",
              boxShadow: "var(--shadow-md)",
            }}
          >
            {/* Left: product summary panel */}
            <div
              style={{
                padding: "30px 28px",
                background: "var(--bg-subtle)",
                color: "var(--ink-primary)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                borderRight: "1px solid var(--border)",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                  <div className="brand-reticle">
                    <Box size={18} strokeWidth={1.9} />
                  </div>
                  <div>
                    <div className="mono" style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "0.08em" }}>
                      SYSTEMCRAFT
                    </div>
                    <div className="mono" style={{ fontSize: 9.5, color: "var(--accent)", letterSpacing: "0.09em" }}>
                      SYSTEM DESIGN, PRACTISED
                    </div>
                  </div>
                </div>

                <h2 className="mono" style={{ margin: "0 0 10px", fontSize: 21, lineHeight: 1.3 }}>
                  Learn system design one step at a time
                </h2>
                <p style={{ margin: 0, fontSize: 13, color: "var(--ink-secondary)", lineHeight: 1.6 }}>
                  20 short chapters that take you from one server to the designs interviewers ask for. Each step adds one part to the picture and shows the numbers behind it.
                </p>

                <div style={{ display: "grid", gap: 10, marginTop: 22 }}>
                  {[
                    { icon: Layers, color: "var(--accent)", label: "Read a step: one idea, one figure, a few minutes" },
                    { icon: BookOpen, color: "var(--accent)", label: "Check yourself before you move on" },
                    { icon: Flame, color: "var(--highlight)", label: "Review what you finished, spaced out over days" },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.label}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "8px 11px",
                          borderRadius: 8,
                          background: "var(--bg-surface)",
                          border: "1px solid var(--border)",
                          fontSize: 12,
                          color: "var(--ink-primary)",
                        }}
                      >
                        <Icon size={14} color={item.color} />
                        <span>{item.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-muted)", display: "flex", alignItems: "center", gap: 6, marginTop: 18 }}>
                <ShieldCheck size={13} color="var(--accent)" />
                <span>Your progress and notes are private to you.</span>
              </div>
            </div>

            {/* Right Sign In / Register Form */}
            <div style={{ padding: "26px 28px", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative" }}>
              {canDismiss && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Close login modal"
                  onClick={onClose}
                  style={{ position: "absolute", top: 14, right: 14 }}
                >
                  <X size={14} />
                </button>
              )}

              <div>
                <div className="nav-pills" style={{ width: "fit-content", marginBottom: 18 }}>
                  <button
                    type="button"
                    className={`nav-pill ${mode === "login" ? "active" : ""}`}
                    onClick={() => {
                      setMode("login");
                      setError(null);
                    }}
                  >
                    {mode === "login" && <span className="nav-pill-bg" />}
                    Sign In
                  </button>
                  <button
                    type="button"
                    className={`nav-pill ${mode === "register" ? "active" : ""}`}
                    onClick={() => {
                      setMode("register");
                      setError(null);
                    }}
                  >
                    {mode === "register" && <span className="nav-pill-bg" />}
                    Create Account
                  </button>
                </div>

                <h3 className="mono" style={{ margin: "0 0 4px", fontSize: 18 }}>
                  {mode === "login" ? "Welcome back" : "Save your progress"}
                </h3>
                <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "var(--ink-muted)" }}>
                  {mode === "login"
                    ? "Sign in to pick up where you left off."
                    : "An account keeps your progress, review cards and notes on any device."}
                </p>

                {error && (
                  <div
                    role="alert"
                    style={{
                      padding: "8px 11px",
                      borderRadius: 7,
                      background: "var(--danger-bg)",
                      border: "1px solid var(--danger)",
                      color: "var(--danger)",
                      fontSize: 12,
                      marginBottom: 12,
                    }}
                  >
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: "grid", gap: 11 }}>
                  <div>
                    <label htmlFor="auth-username" className="mono" style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--ink-muted)", marginBottom: 4 }}>
                      USERNAME
                    </label>
                    <input
                      id="auth-username"
                      name="username"
                      autoComplete="username"
                      required
                      minLength={3}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="e.g. priya"
                      style={{
                        width: "100%",
                        padding: "9px 11px",
                        borderRadius: 7,
                        border: "1px solid var(--border)",
                        background: "var(--bg-subtle)",
                        color: "var(--ink-primary)",
                        fontSize: 13,
                      }}
                    />
                  </div>

                  {mode === "register" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div>
                        <label htmlFor="auth-display-name" className="mono" style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--ink-muted)", marginBottom: 4 }}>
                          DISPLAY NAME
                        </label>
                        <input
                          id="auth-display-name"
                          name="displayName"
                          autoComplete="name"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="Alex"
                          style={{
                            width: "100%",
                            padding: "9px 11px",
                            borderRadius: 7,
                            border: "1px solid var(--border)",
                            background: "var(--bg-subtle)",
                            color: "var(--ink-primary)",
                            fontSize: 13,
                          }}
                        />
                      </div>
                      <div>
                        <label htmlFor="auth-daily-goal" className="mono" style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--ink-muted)", marginBottom: 4 }}>
                          DAILY GOAL (STEPS)
                        </label>
                        <input
                          id="auth-daily-goal"
                          name="dailyGoal"
                          type="number"
                          min={1}
                          max={25}
                          value={dailyGoal}
                          onChange={(e) => setDailyGoal(Math.max(1, Number(e.target.value) || 3))}
                          style={{
                            width: "100%",
                            padding: "9px 11px",
                            borderRadius: 7,
                            border: "1px solid var(--border)",
                            background: "var(--bg-subtle)",
                            color: "var(--ink-primary)",
                            fontSize: 13,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {mode === "register" && (
                    <div>
                      <label htmlFor="auth-email" className="mono" style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--ink-muted)", marginBottom: 4 }}>
                        EMAIL (OPTIONAL)
                      </label>
                      <input
                        id="auth-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="alex@example.dev"
                        style={{
                          width: "100%",
                          padding: "9px 11px",
                          borderRadius: 7,
                          border: "1px solid var(--border)",
                          background: "var(--bg-subtle)",
                          color: "var(--ink-primary)",
                          fontSize: 13,
                        }}
                      />
                    </div>
                  )}

                  <div>
                    <label htmlFor="auth-password" className="mono" style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--ink-muted)", marginBottom: 4 }}>
                      PASSWORD {mode === "register" ? "(MIN 6 CHARS)" : ""}
                    </label>
                    <input
                      id="auth-password"
                      name="password"
                      type="password"
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      required
                      minLength={mode === "register" ? 6 : 1}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      style={{
                        width: "100%",
                        padding: "9px 11px",
                        borderRadius: 7,
                        border: "1px solid var(--border)",
                        background: "var(--bg-subtle)",
                        color: "var(--ink-primary)",
                        fontSize: 13,
                      }}
                    />
                  </div>

                  <button type="submit" disabled={submitting} className="btn-primary" style={{ padding: "10px 14px", marginTop: 4 }}>
                    <Sparkles size={13} />
                    {submitting
                      ? "Signing in…"
                      : mode === "login"
                      ? "Sign in"
                      : "Create account"}
                    <ArrowRight size={13} />
                  </button>
                </form>
                {guestsAllowed && !authStorage.isGuest() && (
                  <button
                    type="button"
                    disabled={submitting}
                    className="btn-secondary"
                    style={{ padding: "9px 14px", marginTop: 10, width: "100%" }}
                    onClick={continueAsGuest}
                  >
                    Continue as guest
                  </button>
                )}
              </div>

              <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border-soft)", fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.5 }}>
                {guestsAllowed ? "A guest session keeps your progress on this browser until it sits unused for 30 days. Sign in or register later and it moves into your account." : "Sign in to keep your own progress, notes and quiz history. Accounts are private to each colleague."}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
