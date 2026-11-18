import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, Layers, Sparkles, X } from "lucide-react";
import type { HldModuleItem } from "../api/client";
import type { HldExplorerLesson } from "../types/hld";
import { renderInlineCode } from "../utils/format";

interface DeepDiveDrawerProps {
  open: boolean;
  lesson: HldExplorerLesson | null;
  linkedModule?: HldModuleItem | null;
  onClose: () => void;
}

/**
 * Slide-over architectural reference sheet pairing topic-level DDIA/first-principles notes
 * with the linked Staff-level HLD module foundations and candidate rubric.
 */
export const DeepDiveDrawer: React.FC<DeepDiveDrawerProps> = ({
  open,
  lesson,
  linkedModule,
  onClose,
}) => {
  const [tab, setTab] = useState<"topic" | "module">("topic");

  const activeTab = linkedModule ? tab : "topic";

  return (
    <AnimatePresence>
      {open && lesson && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(3, 5, 14, 0.68)",
            backdropFilter: "blur(6px)",
            zIndex: 60,
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(600px, 94vw)",
              height: "100%",
              background: "var(--bg-surface-solid)",
              borderLeft: "1px solid var(--border)",
              padding: "22px 26px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--accent)" }}>
                  {linkedModule
                    ? `MODULE ${linkedModule.moduleNumber} · FIRST-PRINCIPLES & DDIA BLUEPRINT`
                    : "FIRST-PRINCIPLES & DDIA STUDY NOTES"}
                </div>
                <h2 className="mono" style={{ margin: "2px 0 0", fontSize: 18 }}>
                  {lesson.title}
                </h2>
              </div>
              <button className="icon-btn" aria-label="Close deep read drawer" onClick={onClose}>
                <X size={15} />
              </button>
            </div>

            {linkedModule && (
              <div className="hud-segmented" style={{ alignSelf: "flex-start" }}>
                <button
                  onClick={() => setTab("topic")}
                  className={`hud-seg-btn ${activeTab === "topic" ? "active" : ""}`}
                >
                  <BookOpen size={11} style={{ marginRight: 5, verticalAlign: -1 }} />
                  Topic Story & Trade-Offs
                </button>
                <button
                  onClick={() => setTab("module")}
                  className={`hud-seg-btn ${activeTab === "module" ? "active" : ""}`}
                >
                  <Layers size={11} style={{ marginRight: 5, verticalAlign: -1 }} />
                  Module {linkedModule.moduleNumber} Staff Blueprint
                </button>
              </div>
            )}

            {activeTab === "topic" ? (
              <>
                {lesson.firstPrinciplesStory && (
                  <div className="card" style={{ borderLeft: "3px solid var(--accent)" }}>
                    <div className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--accent)", marginBottom: 6 }}>
                      WHY THIS EXISTS (FAILURE-FIRST STORY)
                    </div>
                    <div style={{ fontSize: 13.5, lineHeight: 1.65 }}>
                      {renderInlineCode(lesson.firstPrinciplesStory)}
                    </div>
                  </div>
                )}

                <div className="card">
                  <div className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--accent)", marginBottom: 6 }}>
                    KEY TAKEAWAYS
                  </div>
                  <ul style={{ margin: "0 0 0 18px", padding: 0, fontSize: 13, lineHeight: 1.6 }}>
                    {lesson.keyTakeaways.map((kt, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        {renderInlineCode(kt)}
                      </li>
                    ))}
                  </ul>
                </div>

                {lesson.ddiaAnchors?.map((anc, i) => (
                  <div key={i} className="card">
                    <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--purple)" }}>
                      {anc.chapter}
                    </div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                      <strong>{anc.concept}:</strong> {renderInlineCode(anc.whyItMatters)}
                    </div>
                  </div>
                ))}

                {lesson.pragmaticTips?.map((tip, i) => (
                  <div key={i} className="card">
                    <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--success)" }}>
                      {tip.principle}
                    </div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>{renderInlineCode(tip.tip)}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 4 }}>
                      Applied: {renderInlineCode(tip.application)}
                    </div>
                  </div>
                ))}

                {lesson.tradeoffs.map((t, i) => (
                  <div key={i} className="card">
                    <div className="mono" style={{ fontWeight: 700, fontSize: 13 }}>
                      {renderInlineCode(t.option)}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--accent)", marginTop: 2 }}>
                      Best for: {renderInlineCode(t.bestFor)}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12.5 }}>
                      <strong style={{ color: "var(--success)" }}>Pros:</strong>{" "}
                      {renderInlineCode(t.pros.join(" · "))}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12.5 }}>
                      <strong style={{ color: "var(--danger)" }}>Cons:</strong>{" "}
                      {renderInlineCode(t.cons.join(" · "))}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              linkedModule && (
                <>
                  <div className="card" style={{ borderLeft: "3px solid var(--purple)" }}>
                    <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--purple)" }}>
                      <Sparkles size={12} style={{ marginRight: 5, verticalAlign: -2 }} />
                      {linkedModule.title}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 6 }}>
                      {linkedModule.ddiaSources.join(" · ")} | {linkedModule.tppSources.join(" · ")}
                    </div>
                  </div>

                  {linkedModule.deepDiveFoundations.map((sec, idx) => (
                    <div key={idx} className="card">
                      <div className="mono" style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)" }}>
                        {sec.heading}
                      </div>
                      <p style={{ fontSize: 13, lineHeight: 1.55, margin: "6px 0" }}>
                        {renderInlineCode(sec.corePrinciple)}
                      </p>
                      <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-secondary)" }}>
                        <strong>Mechanics:</strong> {renderInlineCode(sec.mechanicsAndConstraints)}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--success)", marginTop: 6 }}>
                        <strong>Pragmatic Principle:</strong> {renderInlineCode(sec.tppApplication)}
                      </div>
                    </div>
                  ))}

                  {linkedModule.tradeoffsMatrix.map((row, idx) => (
                    <div key={idx} className="card">
                      <div className="mono" style={{ fontSize: 12.5, fontWeight: 700 }}>
                        {renderInlineCode(row.option)}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--accent)", marginTop: 3 }}>
                        Ideal Workload: {renderInlineCode(row.idealWorkload)}
                      </div>
                      <div style={{ fontSize: 12.5, marginTop: 5 }}>
                        <strong style={{ color: "var(--success)" }}>Strengths:</strong> {renderInlineCode(row.pros)}
                      </div>
                      <div style={{ fontSize: 12.5, marginTop: 3 }}>
                        <strong style={{ color: "var(--danger)" }}>Bottlenecks:</strong>{" "}
                        {renderInlineCode(row.consBottlenecks)}
                      </div>
                    </div>
                  ))}

                  <div className="card">
                    <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 8 }}>
                      STAFF CANDIDATE EVALUATION RUBRIC
                    </div>
                    <div style={{ fontSize: 12.5, marginBottom: 8 }}>
                      <strong className="mono" style={{ color: "var(--ink-muted)" }}>Junior/Mid:</strong>{" "}
                      {renderInlineCode(linkedModule.candidateRubric.juniorMid.summary)}
                    </div>
                    <div style={{ fontSize: 12.5, marginBottom: 8 }}>
                      <strong className="mono" style={{ color: "var(--accent)" }}>Senior:</strong>{" "}
                      {renderInlineCode(linkedModule.candidateRubric.senior.summary)}
                    </div>
                    <div style={{ fontSize: 12.5 }}>
                      <strong className="mono" style={{ color: "var(--purple)" }}>Staff / Principal:</strong>{" "}
                      {renderInlineCode(linkedModule.candidateRubric.staffPrincipal.summary)}
                    </div>
                  </div>
                </>
              )
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
