import React, { useMemo, useState } from "react";
import {
  Award,
  BookOpen,
  Compass,
  Download,
  Layers,
  NotebookPen,
  Server,
  ShieldAlert,
} from "lucide-react";
import type { HldModuleItem } from "../api/client";
import { renderInlineCode } from "../utils/format";
import { NotesDrawer } from "./NotesDrawer";

interface ModulesViewProps {
  modules: HldModuleItem[];
  topicMetaById: Record<string, { title: string; ready: boolean; kind: "lesson" | "case_study" }>;
  onOpenTopic: (topicId: string) => void;
  onNoteSaved?: () => void;
}

function buildModuleMarkdown(mod: HldModuleItem): string {
  const lines: string[] = [];
  lines.push(`# Module ${mod.moduleNumber}: ${mod.title}`);
  lines.push("");
  lines.push(`**Sources:** ${mod.ddiaSources.join(" · ")} | ${mod.tppSources.join(" · ")}`);
  lines.push("");
  lines.push("## 1. Deep-Dive Theoretical Foundations");
  for (const f of mod.deepDiveFoundations) {
    lines.push(`\n### ${f.heading}`);
    lines.push(`- **Core Principle:** ${f.corePrinciple}`);
    lines.push(`- **Mechanics & Constraints:** ${f.mechanicsAndConstraints}`);
    lines.push(`- **Pragmatic Application:** ${f.tppApplication}`);
    if (f.keyMetricsOrFormulas.length > 0) {
      lines.push(`- **Key Metrics & Formulas:** ${f.keyMetricsOrFormulas.join(" | ")}`);
    }
  }
  lines.push("");
  lines.push("## 2. Core Architectural Trade-offs Matrix");
  lines.push("| Option / Technique | Pros | Cons / Bottlenecks | Ideal Workload / Use Case |");
  lines.push("| :--- | :--- | :--- | :--- |");
  for (const r of mod.tradeoffsMatrix) {
    lines.push(`| ${r.option} | ${r.pros} | ${r.consBottlenecks} | ${r.idealWorkload} |`);
  }
  lines.push("");
  lines.push(`## 3. High-Level Design Case Study: ${mod.caseStudy.systemName}`);
  lines.push(`\n> ${mod.caseStudy.problemStatement}`);
  lines.push("\n### Requirements (Functional & Non-Functional)");
  mod.caseStudy.functionalRequirements.forEach((r) => lines.push(`- **Functional:** ${r}`));
  mod.caseStudy.nonFunctionalRequirements.forEach((r) => lines.push(`- **Non-Functional:** ${r}`));
  lines.push("\n### Traffic, Storage & Throughput Estimates");
  lines.push(`${mod.caseStudy.trafficSummary}\n`);
  mod.caseStudy.estimates.forEach((e) => lines.push(`- **${e.label}:** ${e.calculation} → **${e.result}**`));
  lines.push("\n### High-Level Component Architecture (Data Flow & Services)");
  lines.push(`\`${mod.caseStudy.architectureFlow}\`\n`);
  mod.caseStudy.services.forEach((s) => lines.push(`- **${s.name}** (${s.technologyChoice}): ${s.responsibility}`));
  lines.push("\n### Data Model & Storage Engine Choices");
  lines.push(mod.caseStudy.dataModelAndStorage);
  lines.push("\n### Detailed Design: Deep Dives into Bottlenecks & Edge Cases");
  for (const dd of mod.caseStudy.deepDives) {
    lines.push(`\n#### ${dd.title}`);
    lines.push(`- **Failure Scenario:** ${dd.failureScenario}`);
    lines.push(`- **Mitigation Mechanics:** ${dd.mitigationMechanics}`);
    lines.push(`- **ETC Trade-off:** ${dd.etcTradeoff}`);
  }
  lines.push("");
  lines.push("## 4. Candidate Interview Rubric & Scoring Guide");
  lines.push(`\n- **Level 1 (Junior / Mid-level):** ${mod.candidateRubric.juniorMid.summary}`);
  mod.candidateRubric.juniorMid.signals.forEach((s) => lines.push(`  - ${s}`));
  lines.push(`\n- **Level 2 (Senior):** ${mod.candidateRubric.senior.summary}`);
  mod.candidateRubric.senior.signals.forEach((s) => lines.push(`  - ${s}`));
  lines.push(`\n- **Level 3 (Staff / Principal):** ${mod.candidateRubric.staffPrincipal.summary}`);
  mod.candidateRubric.staffPrincipal.signals.forEach((s) => lines.push(`  - ${s}`));
  lines.push("");
  return lines.join("\n");
}

export const ModulesView: React.FC<ModulesViewProps> = ({
  modules,
  topicMetaById,
  onOpenTopic,
  onNoteSaved,
}) => {
  const [selectedId, setSelectedId] = useState<string>(() => modules[0]?.id ?? "module-1");
  const [notesOpen, setNotesOpen] = useState(false);

  const activeModule = useMemo(
    () => modules.find((m) => m.id === selectedId) ?? modules[0] ?? null,
    [modules, selectedId]
  );

  const handleExportMd = () => {
    if (!activeModule) return;
    const md = buildModuleMarkdown(activeModule);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeModule.id}-${activeModule.caseStudy.systemName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!activeModule) {
    return (
      <div className="mono" style={{ padding: 32, color: "var(--ink-muted)" }}>
        Loading HLD Mastery Modules...
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "310px 1fr", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Left Curriculum Module Selector */}
      <aside className="pane pane-left">
        <div className="pane-header">
          <span className="pane-title">PRINCIPAL HLD MODULES</span>
          <span className="badge badge-accent">{modules.length} MODULES</span>
        </div>

        <div className="pane-scroll">
          {modules.map((mod) => {
            const isSel = mod.id === activeModule.id;
            return (
              <div key={mod.id} className={`proto-item ${isSel ? "expanded" : ""}`}>
                <button
                  type="button"
                  onClick={() => setSelectedId(mod.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 14px",
                    border: "none",
                    background: "transparent",
                    color: "var(--ink-primary)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--accent)" }}>
                      MODULE {mod.moduleNumber}
                    </span>
                    <span className="badge badge-purple" style={{ fontSize: 9.5 }}>
                      {mod.ddiaSources.map((s) => s.split(":")[0].replace("DDIA ", "")).join(" · ")}
                    </span>
                  </div>
                  <div className="mono" style={{ fontWeight: 700, fontSize: 12.5, marginTop: 4, lineHeight: 1.35 }}>
                    {mod.title}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 4 }}>
                    Case Study: {mod.caseStudy.systemName}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Right Full 4-Part Principal Blueprint View */}
      <div style={{ flex: 1, overflowY: "auto", padding: "22px 26px" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", display: "flex", flexDirection: "column", gap: 22 }}>
          {/* Module Hero Header */}
          <div className="card hero-nebula-card" style={{ padding: "20px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 280 }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {activeModule.ddiaSources.map((src) => (
                    <span key={src} className="badge badge-purple">{src}</span>
                  ))}
                  {activeModule.tppSources.map((tpp) => (
                    <span key={tpp} className="badge badge-success">{tpp}</span>
                  ))}
                </div>
                <h1 className="mono" style={{ margin: 0, fontSize: 21 }}>
                  Module {activeModule.moduleNumber}: {activeModule.title}
                </h1>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn-secondary" onClick={() => setNotesOpen(true)}>
                  <NotebookPen size={13} /> Study Note
                </button>
                <button type="button" className="btn-primary" onClick={handleExportMd}>
                  <Download size={13} /> Export Markdown (.md)
                </button>
              </div>
            </div>

            {/* Interactive Links into 3D Nebula Explorer Lessons & Case Studies */}
            {(activeModule.linkedLessonIds.length > 0 || activeModule.linkedCaseStudyIds.length > 0) && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-soft)", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-muted)" }}>
                  INTERACTIVE 3D LABS:
                </span>
                {activeModule.linkedLessonIds.map((lid) => {
                  const meta = topicMetaById[lid];
                  return (
                    <button
                      key={lid}
                      type="button"
                      disabled={!meta?.ready}
                      className="btn-secondary"
                      style={{ fontSize: 11, padding: "4px 10px" }}
                      onClick={() => onOpenTopic(lid)}
                    >
                      <Compass size={12} /> {meta?.title ?? lid}
                    </button>
                  );
                })}
                {activeModule.linkedCaseStudyIds.map((cid) => {
                  const meta = topicMetaById[cid];
                  return (
                    <button
                      key={cid}
                      type="button"
                      disabled={!meta?.ready}
                      className="btn-secondary"
                      style={{ fontSize: 11, padding: "4px 10px", borderColor: "rgba(56, 189, 248, 0.4)" }}
                      onClick={() => onOpenTopic(cid)}
                    >
                      <Layers size={12} /> {meta?.title ?? cid}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* SECTION 1: Deep-Dive Theoretical Foundations */}
          <section>
            <h2 className="mono" style={{ margin: "0 0 12px", fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
              <BookOpen size={15} color="var(--accent)" />
              1. Deep-Dive Theoretical Foundations
            </h2>
            <div style={{ display: "grid", gap: 12 }}>
              {activeModule.deepDiveFoundations.map((sec) => (
                <div key={sec.heading} className="card">
                  <div className="mono" style={{ fontSize: 13.5, fontWeight: 700, color: "var(--accent)", marginBottom: 8 }}>
                    {sec.heading}
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8, lineHeight: 1.55 }}>
                    {renderInlineCode(sec.corePrinciple)}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink-secondary)", lineHeight: 1.62, marginBottom: 8 }}>
                    <strong className="mono" style={{ fontSize: 10.5, color: "var(--ink-primary)" }}>MECHANICS & CONSTRAINTS: </strong>
                    {renderInlineCode(sec.mechanicsAndConstraints)}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--success)", lineHeight: 1.55, marginBottom: 8 }}>
                    <strong className="mono" style={{ fontSize: 10.5 }}>PRAGMATIC HEURISTIC: </strong>
                    {renderInlineCode(sec.tppApplication)}
                  </div>
                  {sec.keyMetricsOrFormulas.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                      {sec.keyMetricsOrFormulas.map((m) => (
                        <span key={m} className="badge badge-accent" style={{ fontSize: 10.5 }}>
                          {renderInlineCode(m)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* SECTION 2: Core Architectural Trade-offs Matrix */}
          <section>
            <h2 className="mono" style={{ margin: "0 0 12px", fontSize: 15 }}>
              2. Core Architectural Trade-offs Matrix
            </h2>
            <div className="card" style={{ padding: 0, overflowX: "auto" }}>
              <table className="trace-table">
                <thead>
                  <tr>
                    <th style={{ width: "22%" }}>Option / Technique</th>
                    <th style={{ width: "28%" }}>Pros</th>
                    <th style={{ width: "28%" }}>Cons / Bottlenecks</th>
                    <th style={{ width: "22%" }}>Ideal Workload / Use Case</th>
                  </tr>
                </thead>
                <tbody>
                  {activeModule.tradeoffsMatrix.map((row) => (
                    <tr key={row.option}>
                      <td style={{ fontWeight: 700, color: "var(--accent)", verticalAlign: "top" }}>{renderInlineCode(row.option)}</td>
                      <td style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, lineHeight: 1.5, verticalAlign: "top" }}>{renderInlineCode(row.pros)}</td>
                      <td style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-secondary)", verticalAlign: "top" }}>{renderInlineCode(row.consBottlenecks)}</td>
                      <td style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, lineHeight: 1.5, verticalAlign: "top" }}>{renderInlineCode(row.idealWorkload)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* SECTION 3: High-Level Design Case Study Blueprint */}
          <section>
            <h2 className="mono" style={{ margin: "0 0 12px", fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
              <Server size={15} color="var(--purple)" />
              3. High-Level Design Case Study: {activeModule.caseStudy.systemName}
            </h2>

            <div style={{ display: "grid", gap: 14 }}>
              <div className="card" style={{ borderLeft: "3px solid var(--purple)" }}>
                <div className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--purple)", marginBottom: 4 }}>
                  CANONICAL INTERVIEW SCENARIO
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{renderInlineCode(activeModule.caseStudy.problemStatement)}</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div className="card">
                  <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 8 }}>
                    REQUIREMENTS (FUNCTIONAL & NON-FUNCTIONAL)
                  </div>
                  <ul style={{ margin: "0 0 10px 18px", padding: 0, fontSize: 12.5, lineHeight: 1.55 }}>
                    {activeModule.caseStudy.functionalRequirements.map((r) => (
                      <li key={r} style={{ marginBottom: 4 }}><strong>Functional:</strong> {renderInlineCode(r)}</li>
                    ))}
                  </ul>
                  <ul style={{ margin: "0 0 0 18px", padding: 0, fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-secondary)" }}>
                    {activeModule.caseStudy.nonFunctionalRequirements.map((r) => (
                      <li key={r} style={{ marginBottom: 4 }}><strong>SLA / NFR:</strong> {renderInlineCode(r)}</li>
                    ))}
                  </ul>
                </div>

                <div className="card">
                  <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--success)", marginBottom: 6 }}>
                    TRAFFIC, STORAGE & THROUGHPUT ESTIMATES
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-secondary)", marginBottom: 10 }}>
                    {renderInlineCode(activeModule.caseStudy.trafficSummary)}
                  </div>
                  {activeModule.caseStudy.estimates.map((e) => (
                    <div key={e.label} style={{ padding: "6px 0", borderTop: "1px solid var(--border-soft)", fontSize: 12 }}>
                      <div className="mono" style={{ fontWeight: 700, color: "var(--ink-primary)" }}>{e.label}: <span style={{ color: "var(--accent)" }}>{e.result}</span></div>
                      <div style={{ color: "var(--ink-muted)", marginTop: 2 }}>{renderInlineCode(e.calculation)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 8 }}>
                  HIGH-LEVEL COMPONENT ARCHITECTURE & STORAGE ENGINE CHOICES
                </div>
                <div className="mono" style={{ padding: "8px 12px", borderRadius: 6, background: "var(--bg-subtle)", fontSize: 11.5, marginBottom: 12 }}>
                  {activeModule.caseStudy.architectureFlow}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10, marginBottom: 12 }}>
                  {activeModule.caseStudy.services.map((svc) => (
                    <div key={svc.name} style={{ padding: 10, borderRadius: 8, background: "var(--bg-subtle)", border: "1px solid var(--border-soft)" }}>
                      <div className="mono" style={{ fontWeight: 700, fontSize: 12 }}>{svc.name}</div>
                      <div className="mono" style={{ fontSize: 10.5, color: "var(--accent)", marginTop: 2 }}>{svc.technologyChoice}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-secondary)", marginTop: 5, lineHeight: 1.5 }}>{renderInlineCode(svc.responsibility)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.6, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
                  <strong className="mono" style={{ fontSize: 10.5, color: "var(--purple)" }}>DATA MODEL & STORAGE: </strong>
                  {renderInlineCode(activeModule.caseStudy.dataModelAndStorage)}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {activeModule.caseStudy.deepDives.map((dd) => (
                  <div key={dd.title} className="card">
                    <div className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--accent)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                      <ShieldAlert size={13} color="var(--warn)" /> {dd.title}
                    </div>
                    <div style={{ fontSize: 12.5, marginBottom: 6 }}>
                      <strong style={{ color: "var(--danger)" }}>Failure Mode:</strong> {renderInlineCode(dd.failureScenario)}
                    </div>
                    <div style={{ fontSize: 12.5, marginBottom: 6 }}>
                      <strong style={{ color: "var(--success)" }}>Mitigation:</strong> {renderInlineCode(dd.mitigationMechanics)}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-secondary)" }}>
                      <strong>ETC Trade-off:</strong> {renderInlineCode(dd.etcTradeoff)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* SECTION 4: Candidate Interview Rubric & Scoring Guide */}
          <section>
            <h2 className="mono" style={{ margin: "0 0 12px", fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
              <Award size={15} color="var(--success)" />
              4. Candidate Interview Rubric & Scoring Guide
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
              <div className="card" style={{ borderTop: "3px solid var(--warn)" }}>
                <span className="badge badge-warn">LEVEL 1 · JUNIOR / MID</span>
                <div style={{ fontSize: 12.5, fontWeight: 600, margin: "8px 0" }}>{renderInlineCode(activeModule.candidateRubric.juniorMid.summary)}</div>
                <ul style={{ margin: "0 0 0 16px", padding: 0, fontSize: 12, lineHeight: 1.55, color: "var(--ink-secondary)" }}>
                  {activeModule.candidateRubric.juniorMid.signals.map((s) => (
                    <li key={s} style={{ marginBottom: 5 }}>{renderInlineCode(s)}</li>
                  ))}
                </ul>
              </div>

              <div className="card" style={{ borderTop: "3px solid var(--accent)" }}>
                <span className="badge badge-accent">LEVEL 2 · SENIOR</span>
                <div style={{ fontSize: 12.5, fontWeight: 600, margin: "8px 0" }}>{renderInlineCode(activeModule.candidateRubric.senior.summary)}</div>
                <ul style={{ margin: "0 0 0 16px", padding: 0, fontSize: 12, lineHeight: 1.55, color: "var(--ink-secondary)" }}>
                  {activeModule.candidateRubric.senior.signals.map((s) => (
                    <li key={s} style={{ marginBottom: 5 }}>{renderInlineCode(s)}</li>
                  ))}
                </ul>
              </div>

              <div className="card" style={{ borderTop: "3px solid var(--success)" }}>
                <span className="badge badge-success">LEVEL 3 · STAFF / PRINCIPAL</span>
                <div style={{ fontSize: 12.5, fontWeight: 600, margin: "8px 0" }}>{renderInlineCode(activeModule.candidateRubric.staffPrincipal.summary)}</div>
                <ul style={{ margin: "0 0 0 16px", padding: 0, fontSize: 12, lineHeight: 1.55, color: "var(--ink-secondary)" }}>
                  {activeModule.candidateRubric.staffPrincipal.signals.map((s) => (
                    <li key={s} style={{ marginBottom: 5 }}>{renderInlineCode(s)}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </div>
      </div>

      <NotesDrawer
        open={notesOpen}
        topicId={activeModule.id}
        topicTitle={`Module ${activeModule.moduleNumber}: ${activeModule.title}`}
        onClose={() => setNotesOpen(false)}
        onNoteSaved={onNoteSaved}
      />
    </div>
  );
};
