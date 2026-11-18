import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { TraceStep } from "../types/hld";
import type { PlaybackState } from "./IsometricCanvas";
import { renderInlineCode } from "../utils/format";

interface TraceWaterfallDrawerProps {
  open: boolean;
  steps: TraceStep[];
  visibleTraceRows: TraceStep[];
  playbackState: PlaybackState;
  activeStepIdx: number;
  inspectedPacketIdx: number | null;
  rightInsetPx: number;
  nodeLabel: (id: string) => string;
  onInspectPacket: (idx: number | null) => void;
  onJumpToStep: (idx: number) => void;
  onClose: () => void;
}

/**
 * Progressive-disclosure bottom glass drawer housing the live Request Flow waterfall
 * table and inline frame payload inspector without permanently splitting the 3D viewport.
 */
export const TraceWaterfallDrawer: React.FC<TraceWaterfallDrawerProps> = ({
  open,
  steps,
  visibleTraceRows,
  playbackState,
  activeStepIdx,
  inspectedPacketIdx,
  rightInsetPx,
  nodeLabel,
  onInspectPacket,
  onJumpToStep,
  onClose,
}) => {
  const inspectedStep = inspectedPacketIdx !== null ? steps[inspectedPacketIdx] ?? null : null;
  const maxStepLatency = Math.max(1, ...steps.map((s) => s.latencyDeltaMs));

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ type: "spring", stiffness: 360, damping: 32 }}
          className="hud-glass-card"
          style={{
            position: "absolute",
            left: 16,
            right: rightInsetPx > 0 ? rightInsetPx : 16,
            bottom: 72,
            height: "min(272px, 36vh)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            zIndex: 20,
          }}
        >
          <div
            style={{
              height: 38,
              padding: "0 14px",
              borderBottom: "1px solid var(--border-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="pane-title">REQUEST FLOW WATERFALL</span>
              <span className="badge badge-accent">
                {playbackState === "idle" ? `${steps.length} HOPS PREVIEW` : `${visibleTraceRows.length}/${steps.length} HOPS`}
              </span>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-muted)" }}>
                Click any row to inspect packet payload
              </span>
            </div>

            <button
              className="hud-dock-btn"
              onClick={onClose}
              style={{ height: 24, fontSize: 10, padding: "0 9px" }}
              title="Collapse trace waterfall"
            >
              Hide <ChevronDown size={12} />
            </button>
          </div>

          <AnimatePresence>
            {inspectedStep && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                style={{
                  borderBottom: "1px solid var(--accent)",
                  background: "var(--bg-subtle)",
                  padding: "8px 14px",
                  overflowY: "auto",
                  maxHeight: 138,
                  flexShrink: 0,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="badge badge-accent">HOP {inspectedStep.stepNo}</span>
                    <span className="mono" style={{ fontSize: 11, fontWeight: 700 }}>
                      {nodeLabel(inspectedStep.sourceNodeId)} → {nodeLabel(inspectedStep.targetNodeId)}
                    </span>
                    <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-muted)" }}>
                      {(inspectedStep.timestampMs / 1000).toFixed(3)}s · {inspectedStep.protocol} · {inspectedStep.payloadSize}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      className="icon-btn"
                      aria-label="Previous packet"
                      disabled={inspectedPacketIdx === 0}
                      onClick={() => onInspectPacket(inspectedPacketIdx !== null ? Math.max(0, inspectedPacketIdx - 1) : 0)}
                    >
                      <ChevronLeft size={12} />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label="Next packet"
                      disabled={inspectedPacketIdx === steps.length - 1}
                      onClick={() =>
                        onInspectPacket(inspectedPacketIdx !== null ? Math.min(steps.length - 1, inspectedPacketIdx + 1) : 0)
                      }
                    >
                      <ChevronRight size={12} />
                    </button>
                    <button className="icon-btn" aria-label="Close frame inspector" onClick={() => onInspectPacket(null)}>
                      <X size={12} />
                    </button>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <pre
                    className="mono"
                    style={{
                      margin: 0,
                      padding: 7,
                      borderRadius: 6,
                      background: "var(--bg-surface-solid)",
                      fontSize: 10.5,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {inspectedStep.payloadInspector}
                  </pre>
                  <div style={{ fontSize: 11.5, color: "var(--ink-secondary)", lineHeight: 1.48 }}>
                    <strong className="mono" style={{ fontSize: 10, color: "var(--accent)", display: "block", marginBottom: 2 }}>
                      WHY THIS HAPPENS
                    </strong>
                    {renderInlineCode(inspectedStep.inspectorNote)}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div style={{ flex: 1, overflow: "auto" }}>
            <table className="trace-table">
              <thead>
                <tr>
                  <th>NO.</th>
                  <th>TIME</th>
                  <th>SOURCE</th>
                  <th>TARGET</th>
                  <th>PROTOCOL</th>
                  <th>INFO</th>
                  <th>SPAN / DELTA</th>
                  <th>SIZE</th>
                </tr>
              </thead>
              <tbody>
                {visibleTraceRows.map((st, idx) => {
                  const isActive = playbackState !== "idle" && idx === activeStepIdx;
                  const isInspected = idx === inspectedPacketIdx;
                  const latPct = Math.max(8, Math.round((st.latencyDeltaMs / maxStepLatency) * 100));
                  const barColor =
                    st.category === "failover"
                      ? "var(--danger)"
                      : st.category === "cache_miss"
                      ? "var(--warn)"
                      : st.category === "cache_hit"
                      ? "var(--success)"
                      : "var(--accent-gradient)";
                  return (
                    <tr
                      key={st.stepNo}
                      onClick={() => {
                        onInspectPacket(idx === inspectedPacketIdx ? null : idx);
                        if (playbackState !== "idle") onJumpToStep(idx);
                      }}
                      className={`trace-row ${isActive ? "active" : ""} ${isInspected ? "inspected" : ""}`}
                    >
                      <td style={{ fontWeight: 700 }}>{st.stepNo}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{(st.timestampMs / 1000).toFixed(3)}s</td>
                      <td>{nodeLabel(st.sourceNodeId)}</td>
                      <td>{nodeLabel(st.targetNodeId)}</td>
                      <td>
                        <span
                          className={`badge ${
                            st.category === "failover"
                              ? "badge-danger"
                              : st.category === "cache_hit"
                              ? "badge-success"
                              : st.category === "cache_miss"
                              ? "badge-warn"
                              : st.category === "llm" || st.category === "write"
                              ? "badge-purple"
                              : "badge-accent"
                          }`}
                        >
                          {st.protocol}
                        </span>
                      </td>
                      <td style={{ fontFamily: "var(--font-sans)" }}>{renderInlineCode(st.info)}</td>
                      <td style={{ minWidth: 112 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ flex: 1, height: 5, borderRadius: 99, background: "var(--bg-subtle)", overflow: "hidden" }}>
                            <div style={{ width: `${latPct}%`, height: "100%", background: barColor, borderRadius: 99 }} />
                          </div>
                          <span style={{ fontSize: 10, color: "var(--ink-muted)", width: 34, textAlign: "right", whiteSpace: "nowrap" }}>
                            +{st.latencyDeltaMs}ms
                          </span>
                        </div>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{st.payloadSize}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
