import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Copy,
  KeyRound,
  LogOut,
  Plus,
  Save,
  Shield,
  Trash2,
  User,
  X,
} from "lucide-react";
import {
  api,
  authStorage,
  type PersonalTokenItem,
  type StreakSummary,
  type UserProfile,
} from "../api/client";
import { StreakHeatmapCard } from "./StreakHeatmapCard";

interface AccountModalProps {
  open: boolean;
  user: UserProfile | null;
  streak: StreakSummary | null;
  onClose: () => void;
  onOpenAuthModal: () => void;
  onProfileUpdated: (user: UserProfile, streak: StreakSummary) => void;
  onLogout: () => void;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  open,
  user,
  streak,
  onClose,
  onOpenAuthModal,
  onProfileUpdated,
  onLogout,
}) => {
  const [displayName, setDisplayName] = useState("");
  const [dailyGoal, setDailyGoal] = useState(3);
  const [lens, setLens] = useState<"intuition" | "mechanics" | "staffTradeoffs">("intuition");
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);

  const [tokens, setTokens] = useState<PersonalTokenItem[]>([]);
  const [tokLabel, setTokLabel] = useState("");
  const [tokExpiry, setTokExpiry] = useState<number>(90);
  const [newlyCreatedToken, setNewlyCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user) return;
    setDisplayName(user.displayName);
    setDailyGoal(user.dailyGoal);
    setLens(user.preferredLens);
    setPrefsSaved(false);
    setError(null);
    if (!user.isGuest) {
      api
        .listTokens()
        .then((res) => setTokens(res.tokens))
        .catch(() => {});
    } else {
      setTokens([]);
    }
  }, [open, user]);

  const handleSavePrefs = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPrefs(true);
    setError(null);
    try {
      const res = await api.updatePreferences({
        displayName,
        dailyGoal,
        preferredLens: lens,
      });
      onProfileUpdated(res.user, res.streak);
      setPrefsSaved(true);
      window.setTimeout(() => setPrefsSaved(false), 1800);
    } catch (err: any) {
      setError(err?.message || "Failed to update preferences");
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleGenerateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokLabel.trim()) return;
    setError(null);
    try {
      const created = await api.createToken({
        label: tokLabel.trim(),
        expiresDays: tokExpiry > 0 ? tokExpiry : null,
      });
      setNewlyCreatedToken(created.rawToken);
      setCopied(false);
      setTokLabel("");
      setTokens((prev) => [created.token, ...prev]);
    } catch (err: any) {
      setError(err?.message || "Failed to generate token");
    }
  };

  const handleRevoke = async (id: number) => {
    try {
      await api.revokeToken(id);
      setTokens((prev) => prev.map((t) => (t.id === id ? { ...t, revoked: true } : t)));
    } catch (err: any) {
      setError(err?.message || "Failed to revoke token");
    }
  };

  const handleCopyToken = async () => {
    if (!newlyCreatedToken) return;
    try {
      await navigator.clipboard.writeText(newlyCreatedToken);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard restrictions
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 75,
            background: "rgba(3, 5, 14, 0.76)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(760px, 95vw)",
              maxHeight: "90vh",
              overflowY: "auto",
              borderRadius: 14,
              background: "var(--bg-surface-solid)",
              border: "1px solid var(--border)",
              boxShadow: "0 24px 72px rgba(0, 0, 0, 0.55)",
              padding: "22px 24px",
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="brand-reticle" style={{ width: 38, height: 38 }}>
                  <User size={18} />
                </div>
                <div>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 700 }}>
                    {user?.displayName ?? "Local Guest"}
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>
                    @{user?.username ?? "guest"} · {user?.isGuest ? "GUEST WORKSPACE" : "JWT AUTHENTICATED"}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {user?.isGuest ? (
                  <button
                    className="btn-primary"
                    onClick={() => {
                      onClose();
                      onOpenAuthModal();
                    }}
                  >
                    Sign In / Create Account
                  </button>
                ) : (
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      authStorage.setToken(null);
                      onLogout();
                      onClose();
                    }}
                  >
                    <LogOut size={12} /> Sign Out
                  </button>
                )}
                <button className="icon-btn" aria-label="Close account modal" onClick={onClose}>
                  <X size={14} />
                </button>
              </div>
            </div>

            {error && (
              <div style={{ padding: "8px 11px", borderRadius: 7, background: "var(--danger-bg)", color: "var(--danger)", fontSize: 12 }}>
                {error}
              </div>
            )}

            {/* 12-week Streak & Goal Overview */}
            <StreakHeatmapCard streak={streak} compact />

            {/* Profile & Daily Goal Preferences */}
            <form onSubmit={handleSavePrefs} className="card" style={{ display: "grid", gap: 12 }}>
              <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)" }}>
                PERSONALIZATION & DAILY TARGET
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 170px", gap: 10, alignItems: "end" }}>
                <div>
                  <label htmlFor="pref-display-name" className="mono" style={{ display: "block", fontSize: 10, color: "var(--ink-muted)", marginBottom: 4 }}>
                    DISPLAY NAME
                  </label>
                  <input
                    id="pref-display-name"
                    name="prefDisplayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "7px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "var(--bg-subtle)",
                      color: "var(--ink-primary)",
                      fontSize: 12.5,
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="pref-daily-goal" className="mono" style={{ display: "block", fontSize: 10, color: "var(--ink-muted)", marginBottom: 4 }}>
                    DAILY ACTIONS GOAL
                  </label>
                  <input
                    id="pref-daily-goal"
                    name="prefDailyGoal"
                    type="number"
                    min={1}
                    max={50}
                    value={dailyGoal}
                    onChange={(e) => setDailyGoal(Math.max(1, Number(e.target.value) || 3))}
                    style={{
                      width: "100%",
                      padding: "7px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "var(--bg-subtle)",
                      color: "var(--ink-primary)",
                      fontSize: 12.5,
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="pref-lens" className="mono" style={{ display: "block", fontSize: 10, color: "var(--ink-muted)", marginBottom: 4 }}>
                    DEFAULT LENS
                  </label>
                  <select
                    id="pref-lens"
                    name="prefLens"
                    value={lens}
                    onChange={(e) => setLens(e.target.value as any)}
                    style={{
                      width: "100%",
                      padding: "7px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "var(--bg-subtle)",
                      color: "var(--ink-primary)",
                      fontSize: 12.5,
                    }}
                  >
                    <option value="intuition">Analogy / Intuition</option>
                    <option value="mechanics">Production Mechanics</option>
                    <option value="staffTradeoffs">Staff Edge</option>
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
                {prefsSaved && (
                  <span className="mono" style={{ fontSize: 11, color: "var(--success)" }}>
                    Saved ✓
                  </span>
                )}
                <button type="submit" disabled={savingPrefs} className="btn-primary">
                  <Save size={12} /> {savingPrefs ? "Saving..." : "Save Preferences"}
                </button>
              </div>
            </form>

            {/* Personal Study API Token Generator */}
            <div className="card" style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--purple)", display: "flex", alignItems: "center", gap: 6 }}>
                  <KeyRound size={13} /> PERSONAL STUDY API TOKENS (sc_live_*)
                </span>
                <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-muted)" }}>
                  Use as Bearer or X-Study-Token
                </span>
              </div>

              {user?.isGuest ? (
                <div style={{ fontSize: 12.5, color: "var(--ink-secondary)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <span>Create a free local account to generate revocable personal tokens for CLI sync or external clients.</span>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      onClose();
                      onOpenAuthModal();
                    }}
                  >
                    <Shield size={12} /> Sign In / Register
                  </button>
                </div>
              ) : (
                <>
                  <form onSubmit={handleGenerateToken} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input
                      id="new-token-label"
                      name="newTokenLabel"
                      aria-label="Personal token label"
                      required
                      value={tokLabel}
                      onChange={(e) => setTokLabel(e.target.value)}
                      placeholder="Token label (e.g. CLI Backup / Tablet)"
                      style={{
                        flex: 1,
                        minWidth: 200,
                        padding: "7px 10px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "var(--bg-subtle)",
                        color: "var(--ink-primary)",
                        fontSize: 12.5,
                      }}
                    />
                    <select
                      id="new-token-expiry"
                      name="newTokenExpiry"
                      aria-label="Token expiry days"
                      value={tokExpiry}
                      onChange={(e) => setTokExpiry(Number(e.target.value))}
                      style={{
                        padding: "7px 10px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "var(--bg-subtle)",
                        color: "var(--ink-primary)",
                        fontSize: 12,
                      }}
                    >
                      <option value={30}>30 days</option>
                      <option value={90}>90 days</option>
                      <option value={365}>1 year</option>
                      <option value={0}>No expiry</option>
                    </select>
                    <button type="submit" className="btn-primary">
                      <Plus size={13} /> Generate Token
                    </button>
                  </form>

                  {newlyCreatedToken && (
                    <div
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        background: "var(--success-bg)",
                        border: "1px solid var(--success)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--success)" }}>
                          COPY TOKEN NOW — ONLY SHOWN ONCE
                        </div>
                        <div className="mono" style={{ fontSize: 12, marginTop: 2, wordBreak: "break-all" }}>
                          {newlyCreatedToken}
                        </div>
                      </div>
                      <button type="button" className="btn-secondary" onClick={handleCopyToken}>
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                  )}

                  {tokens.length === 0 ? (
                    <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>
                      No personal tokens created yet.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 6 }}>
                      {tokens.map((t) => (
                        <div
                          key={t.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "8px 10px",
                            borderRadius: 7,
                            border: "1px solid var(--border-soft)",
                            background: "var(--bg-subtle)",
                            opacity: t.revoked ? 0.55 : 1,
                          }}
                        >
                          <div>
                            <div className="mono" style={{ fontSize: 12, fontWeight: 700 }}>
                              {t.label}{" "}
                              <span className="badge" style={{ marginLeft: 6 }}>
                                {t.tokenPrefix}••••
                              </span>
                            </div>
                            <div className="mono" style={{ fontSize: 10, color: "var(--ink-muted)", marginTop: 2 }}>
                              Created {t.createdAt.slice(0, 10)} · {t.lastUsedAt ? `Last used ${t.lastUsedAt.slice(0, 10)}` : "Never used"}
                            </div>
                          </div>
                          {t.revoked ? (
                            <span className="badge badge-danger">REVOKED</span>
                          ) : (
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={`Revoke token ${t.label}`}
                              onClick={() => handleRevoke(t.id)}
                              style={{ color: "var(--danger)" }}
                            >
                              <Trash2 size={12} /> Revoke
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
