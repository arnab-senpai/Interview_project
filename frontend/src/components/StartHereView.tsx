import React, { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Circle, CircleDashed, Clock, Lock } from "lucide-react";
import { api } from "../api/client";
import type { PathChapter, StudyPathResponse } from "../content/types";

interface StartHereViewProps {
  pathId?: string;
  /** Bumped by the parent after a chapter closes, so progress is re-read. */
  refreshKey?: number;
  onOpenChapter: (topicId: string) => void;
  onOpenSandboxLesson: (lessonId: string) => void;
}

function StatusIcon({ ch }: { ch: PathChapter }) {
  if (!ch.available) return <Lock size={14} style={{ color: "var(--ink-muted)" }} />;
  if (ch.status === "completed") return <CheckCircle2 size={14} style={{ color: "var(--success)" }} />;
  if (ch.status === "in_progress") return <CircleDashed size={14} style={{ color: "var(--accent)" }} />;
  return <Circle size={14} style={{ color: "var(--ink-muted)" }} />;
}

export const StartHereView: React.FC<StartHereViewProps> = ({ pathId = "start-here", refreshKey = 0, onOpenChapter, onOpenSandboxLesson }) => {
  const [path, setPath] = useState<StudyPathResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getPath(pathId).then(setPath).catch((e) => setError(e.message ?? String(e)));
  }, [pathId, refreshKey]);

  if (error) return <div className="card" style={{ margin: 32, padding: 16, color: "var(--danger)" }}>{error}</div>;
  if (!path) return <div style={{ padding: 32, color: "var(--ink-muted)" }}>Loading the path…</div>;

  const all = path.stages.flatMap((s) => s.chapters);
  const cont = all.find((c) => c.topicId === path.continueTopicId);
  const open = (ch: PathChapter) => {
    if (!ch.available) return;
    if (ch.format === "v2") onOpenChapter(ch.topicId);
    else onOpenSandboxLesson(ch.topicId);
  };
  const done = all.filter((c) => c.status === "completed").length;

  return (
    <div className="start-here">
      <header className="start-here-hero">
        <div>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-muted)", letterSpacing: 0.5, textTransform: "uppercase" }}>Learn</div>
          <h1 style={{ margin: "4px 0 6px", fontSize: 26, fontWeight: 700 }}>{path.title}</h1>
          <p style={{ margin: 0, color: "var(--ink-secondary)", maxWidth: 640, fontSize: 14, lineHeight: 1.55 }}>{path.summary}</p>
          <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 8 }}>
            {done} of {all.length} chapters done
          </div>
        </div>
        {cont && (
          <button className="btn-primary" style={{ padding: "10px 16px", fontSize: 13.5 }} onClick={() => open(cont)}>
            {cont.status === "not_started" && done === 0 ? "Begin" : "Continue"}: {cont.number}. {cont.title} <ArrowRight size={14} />
          </button>
        )}
      </header>

      {path.stages.map((stage) => (
        <section key={stage.id} className="start-here-stage">
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{stage.title}</h2>
            {stage.fixedOrder && <span className="badge">in order</span>}
          </div>
          <p style={{ margin: "4px 0 12px", fontSize: 13, color: "var(--ink-muted)" }}>{stage.summary}</p>
          <div className="start-here-grid">
            {stage.chapters.map((ch) => (
              <button
                key={ch.topicId}
                className="chapter-card"
                data-available={ch.available}
                data-continue={ch.topicId === path.continueTopicId}
                disabled={!ch.available}
                onClick={() => open(ch)}
                title={ch.available ? (ch.format === "v2" && !ch.legacy ? "" : "Preview: this chapter still uses the older lesson page") : "Coming soon"}
              >
                <span className="chapter-card-top">
                  <span className="mono chapter-card-num">{String(ch.number).padStart(2, "0")}</span>
                  <StatusIcon ch={ch} />
                </span>
                <span className="chapter-card-title">{ch.title}</span>
                {ch.summary && <span className="chapter-card-summary">{ch.summary}</span>}
                <span className="chapter-card-meta">
                  {ch.legacy ? (
                    <span className="pill-preview">Preview</span>
                  ) : ch.format === "v2" && ch.minutes ? (
                    <>
                      <Clock size={11} /> {ch.minutes} min
                    </>
                  ) : ch.format === "v1" ? (
                    <span className="pill-preview">Preview</span>
                  ) : (
                    "Coming soon"
                  )}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};
