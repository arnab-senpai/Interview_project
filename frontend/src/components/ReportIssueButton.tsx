import React, { useState } from "react";
import { Flag, X } from "lucide-react";
import { api, type FeedbackCategory } from "../api/client";

interface ReportIssueButtonProps {
  /** Lesson, case study or module id the block belongs to. */
  topicId: string;
  /** Stable id of the block on the page, e.g. "step:3", "lens:mechanics", "quiz:q-cache-1". */
  blockId: string;
  /** Short human label for the block, shown in the dialog. */
  blockLabel?: string;
  compact?: boolean;
}

const CATEGORIES: Array<{ key: FeedbackCategory; label: string }> = [
  { key: "wrong", label: "Wrong" },
  { key: "unclear", label: "Unclear" },
  { key: "outdated", label: "Outdated" },
  { key: "typo", label: "Typo" },
  { key: "other", label: "Other" },
];

/** "Report an issue" for one content block. Reports go to the feedback table for review. */
export const ReportIssueButton: React.FC<ReportIssueButtonProps> = ({ topicId, blockId, blockLabel, compact = true }) => {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("wrong");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    if (state === "sent") {
      setMessage("");
      setState("idle");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim().length < 3) return;
    setState("sending");
    setError(null);
    try {
      await api.reportIssue({ topicId, blockId, category, message: message.trim(), pageUrl: window.location.href });
      setState("sent");
    } catch (err: any) {
      setError(err?.message || "Could not send the report");
      setState("error");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="Report an issue with this part"
        aria-label="Report an issue with this part"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: "transparent",
          border: "none",
          color: "var(--ink-muted)",
          fontSize: 11,
          cursor: "pointer",
          padding: "2px 4px",
        }}
      >
        <Flag size={11} />
        {!compact && <span>Report an issue</span>}
      </button>

      {open && (
        <div
          onClick={close}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 90,
            background: "rgba(7, 13, 24, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
            className="card"
            style={{ width: "min(440px, 100%)", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Report an issue</span>
              <button type="button" className="icon-btn" onClick={close} aria-label="Close">
                <X size={13} />
              </button>
            </div>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>
              {topicId} · {blockLabel ?? blockId}
            </div>

            {state === "sent" ? (
              <>
                <p style={{ margin: 0, fontSize: 13 }}>Thanks. Your report was saved and will be reviewed.</p>
                <button type="button" className="btn-primary" onClick={close}>
                  Done
                </button>
              </>
            ) : (
              <>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setCategory(c.key)}
                      className={`badge ${category === c.key ? "badge-accent" : ""}`}
                      style={{ cursor: "pointer", border: "1px solid var(--border)" }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What is wrong or unclear? A source or a suggested fix helps."
                  rows={5}
                  maxLength={4000}
                  autoFocus
                  style={{
                    width: "100%",
                    padding: "9px 11px",
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    background: "var(--bg-subtle)",
                    color: "var(--ink-primary)",
                    fontSize: 13,
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                />
                {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}
                <button type="submit" className="btn-primary" disabled={state === "sending" || message.trim().length < 3}>
                  {state === "sending" ? "Sending…" : "Send report"}
                </button>
              </>
            )}
          </form>
        </div>
      )}
    </>
  );
};
