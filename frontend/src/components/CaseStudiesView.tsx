import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Layers,
  Network,
  NotebookPen,
  Server,
} from "lucide-react";
import { api, type CaseStudyIndexItem, type TopicProgress } from "../api/client";
import type { HldCaseStudy } from "../types/hld";
import { humanizeKey, renderInlineCode } from "../utils/format";
import { ExplorerWorkspace } from "./ExplorerWorkspace";
import { NotesDrawer } from "./NotesDrawer";
import { ReportIssueButton } from "./ReportIssueButton";

interface CaseStudiesViewProps {
  caseStudiesIndex: CaseStudyIndexItem[];
  activeCaseId: string;
  onSelectCaseId: (id: string) => void;
  onLoadPresetInEstimator: (preset: HldCaseStudy["estimationPreset"], title: string) => void;
  progressByTopic: Record<string, TopicProgress>;
  theme?: "light" | "dark";
  onNoteSaved?: () => void;
  onUpdateProgress: (
    topicId: string,
    payload: {
      kind: "lesson" | "case_study";
      status: "not_started" | "in_progress" | "completed";
      completedSteps: number[];
      activeLens: "intuition" | "mechanics" | "staffTradeoffs";
    }
  ) => void;
}

export const CaseStudiesView: React.FC<CaseStudiesViewProps> = ({
  caseStudiesIndex,
  activeCaseId,
  onSelectCaseId,
  onLoadPresetInEstimator,
  progressByTopic,
  theme = "dark",
  onNoteSaved,
  onUpdateProgress,
}) => {
  const [tierFilter, setTierFilter] = useState<number | null>(null);
  const [showPlannedCases, setShowPlannedCases] = useState(false);
  const [caseStudy, setCaseStudy] = useState<HldCaseStudy | null>(null);
  const [tab, setTab] = useState<"topology" | "spec" | "deepdives">("topology");
  const [checkedCriteria, setCheckedCriteria] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [savingRubric, setSavingRubric] = useState(false);
  const [drawerNotesOpen, setDrawerNotesOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getCaseStudy(activeCaseId).then((cs) => {
      if (!cancelled) setCaseStudy(cs);
    });
    api.getRubric(activeCaseId).then((r) => {
      if (!cancelled) {
        setCheckedCriteria(r.checkedCriteria ?? []);
        setNotes(r.notes ?? "");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeCaseId]);

  const computedScore = React.useMemo(() => {
    if (!caseStudy) return 0;
    let total = 0;
    for (const sec of caseStudy.rubricChecklist) {
      const hit = sec.criteria.filter((c) => checkedCriteria.includes(c)).length;
      if (sec.criteria.length > 0) {
        total += Math.round((hit / sec.criteria.length) * sec.weight);
      }
    }
    return total;
  }, [caseStudy, checkedCriteria]);

  const handleToggleCriterion = async (criterion: string) => {
    if (!caseStudy) return;
    const next = checkedCriteria.includes(criterion)
      ? checkedCriteria.filter((c) => c !== criterion)
      : [...checkedCriteria, criterion];
    setCheckedCriteria(next);

    let nextScore = 0;
    for (const sec of caseStudy.rubricChecklist) {
      const hit = sec.criteria.filter((c) => next.includes(c)).length;
      if (sec.criteria.length > 0) nextScore += Math.round((hit / sec.criteria.length) * sec.weight);
    }

    setSavingRubric(true);
    try {
      await api.saveRubric(caseStudy.id, { checkedCriteria: next, notes, score: nextScore });
      onUpdateProgress(caseStudy.id, {
        kind: "case_study",
        status: nextScore >= 80 ? "completed" : "in_progress",
        completedSteps: [],
        activeLens: "mechanics",
      });
    } finally {
      setSavingRubric(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!caseStudy) return;
    setSavingRubric(true);
    try {
      await api.saveRubric(caseStudy.id, { checkedCriteria, notes, score: computedScore });
    } finally {
      setSavingRubric(false);
    }
  };

  const filteredReady = caseStudiesIndex.filter(
    (c) => c.status === "ready" && (tierFilter === null ? true : c.tier === tierFilter)
  );
  const filteredPlanned = caseStudiesIndex.filter(
    (c) => c.status === "planned" && (tierFilter === null ? true : c.tier === tierFilter)
  );
  const allReadyCases = caseStudiesIndex.filter((c) => c.status === "ready");
  const curCaseIdx = allReadyCases.findIndex((c) => c.id === activeCaseId);
  const prevCase = curCaseIdx > 0 ? allReadyCases[curCaseIdx - 1] : null;
  const nextCase =
    curCaseIdx >= 0 && curCaseIdx < allReadyCases.length - 1 ? allReadyCases[curCaseIdx + 1] : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "288px 1fr", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Left Case Study Catalog */}
      <aside className="pane pane-left">
        <div className="pane-header">
          <span className="pane-title">Case Studies</span>
          <span className="badge badge-accent">{allReadyCases.length} INTERACTIVE</span>
        </div>
        <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--border-soft)", display: "flex", gap: 3 }}>
          <button onClick={() => setTierFilter(null)} className={`layer-pill ${tierFilter === null ? "active" : ""}`}>
            ALL
          </button>
          {[1, 2, 3, 4, 5].map((t) => (
            <button key={t} onClick={() => setTierFilter(t)} className={`layer-pill ${tierFilter === t ? "active" : ""}`}>
              T{t}
            </button>
          ))}
        </div>
        <div className="pane-scroll">
          {filteredReady.map((cs) => {
            const isSel = cs.id === activeCaseId;
            const prog = progressByTopic[cs.id];
            return (
              <div key={cs.id} className={`proto-item ${isSel ? "expanded" : ""}`}>
                <button
                  onClick={() => onSelectCaseId(cs.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    background: "transparent",
                    border: "none",
                    color: "var(--ink-primary)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)" }}>
                      TIER {cs.tier} · {cs.levelTag}
                    </span>
                    {prog?.status === "completed" && <span className="badge badge-success">DONE</span>}
                  </div>
                  <div className="mono" style={{ fontWeight: 700, fontSize: 12, marginTop: 3 }}>
                    {cs.title}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>
                    {cs.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="badge" style={{ fontSize: 9.5 }}>{tag}</span>
                    ))}
                  </div>
                </button>
              </div>
            );
          })}

          {filteredPlanned.length > 0 && (
            <div style={{ padding: "8px 10px" }}>
              <button
                onClick={() => setShowPlannedCases((p) => !p)}
                style={{
                  width: "100%",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 8px",
                  borderRadius: 5,
                  border: "1px dashed var(--border)",
                  background: "transparent",
                  color: "var(--ink-muted)",
                  fontSize: 11,
                  cursor: "pointer",
                }}
                className="mono"
              >
                <span>Upcoming Roadmap ({filteredPlanned.length})</span>
                {showPlannedCases ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
              {showPlannedCases && (
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                  {filteredPlanned.map((pl) => (
                    <div key={pl.id} style={{ padding: "4px 8px", fontSize: 11, color: "var(--ink-muted)" }}>
                      T{pl.tier} · {pl.title}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div
          style={{
            padding: "8px 10px",
            borderTop: "1px solid var(--border-soft)",
            display: "flex",
            justifyContent: "space-between",
            gap: 6,
            background: "var(--bg-subtle)",
          }}
        >
          <button
            className="btn-secondary"
            disabled={!prevCase}
            onClick={() => prevCase && onSelectCaseId(prevCase.id)}
            style={{ flex: 1, fontSize: 10.5 }}
          >
            <ArrowLeft size={12} /> Prev
          </button>
          <button
            className="btn-secondary"
            disabled={!nextCase}
            onClick={() => nextCase && onSelectCaseId(nextCase.id)}
            style={{ flex: 1, fontSize: 10.5 }}
          >
            Next <ArrowRight size={12} />
          </button>
        </div>
      </aside>

      {/* Main Case Study Workspace */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
        {!caseStudy ? (
          <div style={{ padding: 32 }} className="mono">Loading case study...</div>
        ) : (
          <>
            {/* Case Header & Section Tabs */}
            <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div className="mono" style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700 }}>
                  TIER {caseStudy.tier} CASE STUDY · {caseStudy.levelTag} · ~{caseStudy.estimatedMinutes} MIN INTERVIEW
                </div>
                <h1 className="mono" style={{ margin: "2px 0", fontSize: 18 }}>{caseStudy.title}</h1>
                <div style={{ fontSize: 12.5, color: "var(--ink-secondary)" }}>{caseStudy.subtitle}</div>
                <ReportIssueButton
                  topicId={caseStudy.id}
                  blockId={tab === "topology" ? "topology" : `section:${tab}`}
                  blockLabel={`${tab} section`}
                  compact={false}
                />
              </div>

              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button onClick={() => setTab("spec")} className={tab === "spec" ? "btn-primary" : "btn-secondary"}>
                  <Server size={13} /> 1. REQ & APIs
                </button>
                <button onClick={() => setTab("topology")} className={tab === "topology" ? "btn-primary" : "btn-secondary"}>
                  <Network size={13} /> 2. INTERACTIVE FLOW
                </button>
                <button onClick={() => setTab("deepdives")} className={tab === "deepdives" ? "btn-primary" : "btn-secondary"}>
                  <ClipboardCheck size={13} /> 3. DEEP DIVES & RUBRIC ({computedScore}/100)
                </button>
                <button onClick={() => setDrawerNotesOpen(true)} className="btn-secondary" title="Open Case Study Markdown Notebook">
                  <NotebookPen size={13} /> Notes
                </button>
              </div>
            </div>

            {tab === "topology" ? (
              <ExplorerWorkspace
                lessonsIndex={[]}
                selectedLayer={null}
                activeLessonId={caseStudy.id}
                activeLesson={caseStudy.explorerTopology}
                loadingLesson={false}
                progressByTopic={progressByTopic}
                theme={theme}
                onSelectLesson={() => {}}
                onUpdateProgress={onUpdateProgress}
                onJumpToPractice={() => {}}
                standaloneMode={false}
              />
            ) : tab === "spec" ? (
              <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 1200 }}>
                  <div className="card">
                    <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 8 }}>
                      FUNCTIONAL REQUIREMENTS
                    </div>
                    <ul style={{ margin: "0 0 0 18px", padding: 0, fontSize: 13, lineHeight: 1.6 }}>
                      {caseStudy.functionalReqs.map((r, i) => <li key={i} style={{ marginBottom: 4 }}>{renderInlineCode(r)}</li>)}
                    </ul>
                  </div>

                  <div className="card">
                    <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--purple)", marginBottom: 8 }}>
                      NON-FUNCTIONAL TARGETS (NFRs)
                    </div>
                    {caseStudy.nonFunctionalReqs.map((nfr, i) => (
                      <div key={i} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid var(--border-soft)", fontSize: 12.5 }}>
                        <div className="mono" style={{ fontWeight: 700 }}>{nfr.metric}: <span style={{ color: "var(--accent)" }}>{nfr.target}</span></div>
                        <div style={{ color: "var(--ink-secondary)", marginTop: 2 }}>{renderInlineCode(nfr.rationale)}</div>
                      </div>
                    ))}
                  </div>

                  <div className="card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--success)" }}>
                        BACK-OF-THE-ENVELOPE WORKED ESTIMATE
                      </span>
                      <button
                        className="btn-primary"
                        style={{ fontSize: 10.5 }}
                        onClick={() => onLoadPresetInEstimator(caseStudy.estimationPreset, caseStudy.title)}
                      >
                        <Calculator size={12} /> Work the numbers in chapter 3
                      </button>
                    </div>
                    {Object.entries(caseStudy.estimationPreset.workedSummary).map(([k, v]) => (
                      <div key={k} style={{ marginBottom: 6, fontSize: 12.5 }}>
                        <strong className="mono">{humanizeKey(k)}:</strong> {renderInlineCode(v)}
                      </div>
                    ))}
                  </div>

                  <div className="card">
                    <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 8 }}>
                      <Layers size={12} style={{ marginRight: 5 }} /> CORE ENTITIES & SHARDING
                    </div>
                    {caseStudy.coreEntities.map((ent, i) => (
                      <div key={i} style={{ marginBottom: 10, fontSize: 12.5 }}>
                        <div className="mono" style={{ fontWeight: 700 }}>{ent.name} · <span style={{ color: "var(--accent)" }}>{ent.storageEngine}</span></div>
                        <div className="mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>Partition Key: {ent.partitionKey}</div>
                        <div className="mono" style={{ fontSize: 11, marginTop: 3 }}>Fields: {ent.keyFields.join(", ")}</div>
                      </div>
                    ))}
                  </div>

                  <div className="card" style={{ gridColumn: "1 / -1" }}>
                    <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 8 }}>
                      API CONTRACTS
                    </div>
                    {caseStudy.apiContracts.map((ep, i) => (
                      <div key={i} style={{ padding: 10, background: "var(--bg-subtle)", borderRadius: 6, marginBottom: 8 }}>
                        <div className="mono" style={{ fontWeight: 700, fontSize: 12.5 }}>
                          <span className="badge badge-accent" style={{ marginRight: 8 }}>{ep.method}</span>
                          {ep.path}
                          {ep.idempotent && <span className="badge badge-success" style={{ marginLeft: 8 }}>IDEMPOTENT</span>}
                        </div>
                        <div style={{ fontSize: 12.5, marginTop: 4 }}>{renderInlineCode(ep.purpose)}</div>
                        {ep.samplePayload && (
                          <pre className="mono" style={{ margin: "6px 0 0", fontSize: 11, color: "var(--ink-secondary)", whiteSpace: "pre-wrap" }}>
                            {ep.samplePayload}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 16, maxWidth: 1200 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="mono" style={{ fontSize: 12, fontWeight: 700 }}>SENIOR / STAFF DEEP DIVES</div>
                    {caseStudy.deepDives.map((dd, i) => (
                      <div key={i} className="card">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                          <h3 className="mono" style={{ margin: "0 0 6px", fontSize: 14, color: "var(--accent)" }}>{dd.title}</h3>
                          <ReportIssueButton topicId={caseStudy.id} blockId={`deepDive:${i}`} blockLabel={`Deep dive: ${dd.title}`} />
                        </div>
                        <div style={{ fontSize: 12.5, marginBottom: 5 }}>
                          <strong style={{ color: "var(--danger)" }}>Bottleneck:</strong> {renderInlineCode(dd.bottleneck)}
                        </div>
                        <div style={{ fontSize: 12.5, marginBottom: 5 }}>
                          <strong style={{ color: "var(--success)" }}>Solution:</strong> {renderInlineCode(dd.solution)}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--ink-secondary)" }}>
                          <strong>Trade-off:</strong> {renderInlineCode(dd.tradeoff)}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>
                        <CheckSquare size={14} style={{ marginRight: 5, verticalAlign: -2 }} />
                        INTERVIEW RUBRIC SELF-GRADER
                      </span>
                      <span className={`badge ${computedScore >= 80 ? "badge-success" : "badge-accent"}`}>
                        SCORE: {computedScore} / 100
                      </span>
                    </div>

                    {caseStudy.rubricChecklist.map((sec, i) => (
                      <div key={i} style={{ marginBottom: 12 }}>
                        <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-muted)", marginBottom: 5 }}>
                          {sec.phase} ({sec.weight} pts)
                        </div>
                        {sec.criteria.map((c, cIdx) => (
                          <label
                            key={c}
                            style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, marginBottom: 5, cursor: "pointer" }}
                          >
                            <input
                              id={`rubric-${i}-${cIdx}`}
                              name={`rubric-${i}-${cIdx}`}
                              type="checkbox"
                              checked={checkedCriteria.includes(c)}
                              onChange={() => handleToggleCriterion(c)}
                            />
                            <span>{renderInlineCode(c)}</span>
                          </label>
                        ))}
                      </div>
                    ))}

                    <div style={{ marginTop: 10 }}>
                      <label htmlFor="case-rubric-notes" className="mono" style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--ink-muted)", marginBottom: 4 }}>
                        YOUR DESIGN NOTES
                      </label>
                      <textarea
                        id="case-rubric-notes"
                        name="caseRubricNotes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={4}
                        placeholder="Write trade-offs you'd emphasize in a 45-min mock..."
                        style={{
                          width: "100%",
                          padding: 8,
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "var(--bg-subtle)",
                          color: "var(--ink-primary)",
                          fontFamily: "var(--font-sans)",
                          fontSize: 12.5,
                        }}
                      />
                      <button
                        className="btn-primary"
                        style={{ marginTop: 8 }}
                        onClick={handleSaveNotes}
                        disabled={savingRubric}
                      >
                        {savingRubric ? "Saving..." : "Save Rubric & Notes to SQLite"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {caseStudy && (
        <NotesDrawer
          open={drawerNotesOpen}
          topicId={caseStudy.id}
          topicTitle={caseStudy.title}
          onClose={() => setDrawerNotesOpen(false)}
          onNoteSaved={onNoteSaved}
        />
      )}
    </div>
  );
};
