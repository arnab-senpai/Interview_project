import React, { useEffect, useMemo, useRef } from "react";
import type { LessonEdge, LessonNode, NodeKind, StepCategory, TraceStep } from "../types/hld";
import { truncateText } from "../utils/format";

export type PlaybackState = "idle" | "playing" | "paused" | "completed";

interface IsometricCanvasProps {
  nodes: LessonNode[];
  edges: LessonEdge[];
  steps: TraceStep[];
  activeStepIndex: number; // -1 when idle
  playbackState: PlaybackState;
  flightProgress: number; // 0..1 along active edge
  selectedNodeId: string | null;
  faultNodeId?: string | null;
  viewMode: "network" | "sequence";
  nodeUtilization?: Record<string, number>;
  onSelectNode: (nodeId: string) => void;
  onSelectStep: (stepIndex: number) => void;
}

// Category colours are referenced through CSS variables so both themes stay legible.
const CATEGORY_COLORS: Record<StepCategory, string> = {
  network: "var(--flow-network)",
  cache_hit: "var(--flow-hit)",
  cache_miss: "var(--flow-miss)",
  read: "var(--flow-read)",
  write: "var(--flow-write)",
  async: "var(--flow-async)",
  consensus: "var(--flow-consensus)",
  failover: "var(--flow-failover)",
  llm: "var(--flow-llm)",
};

const CATEGORY_KEYS = Object.keys(CATEGORY_COLORS) as StepCategory[];

/** Smooth start and stop so a hop reads as "travel", not a linear slide. */
function easeInOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

// Same thresholds as the chapter figures: 60% planning target, 100% = one instance can't keep up.
function utilColor(u: number): string {
  if (u >= 1) return "var(--danger)";
  if (u >= 0.6) return "var(--warn)";
  return "var(--success)";
}

function isoProject(gx: number, gy: number): { x: number; y: number } {
  // Wider tiles than before so labels have room and never collide with neighbours
  const tileW = 60;
  const tileH = 34;
  const x = (gx - gy) * tileW + 410;
  const y = (gx + gy) * tileH + 78;
  return { x, y };
}

function clipSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  padStart: number,
  padEnd: number
): { sx: number; sy: number; tx: number; ty: number; nx: number; ny: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const safePadStart = Math.min(padStart, dist * 0.35);
  const safePadEnd = Math.min(padEnd, dist * 0.35);
  return {
    sx: x1 + ux * safePadStart,
    sy: y1 + uy * safePadStart,
    tx: x2 - ux * safePadEnd,
    ty: y2 - uy * safePadEnd,
    nx: -uy,
    ny: ux,
  };
}

export function IsometricNodeGlyph({
  kind,
  active,
  faulted,
  completedClient,
}: {
  kind: NodeKind;
  active: boolean;
  faulted: boolean;
  completedClient: boolean;
}) {
  const stroke = faulted ? "var(--danger)" : active ? "var(--accent-bright)" : "var(--accent)";
  const topFill = faulted ? "var(--danger-bg)" : "var(--bg-surface)";
  const midFill = faulted ? "var(--danger-bg)" : "var(--iso-fill)";
  const sideFill = faulted ? "var(--danger-bg)" : "var(--iso-side)";
  const sw = active || faulted ? 1.85 : 1.35;

  return (
    <g>
      {/* Grounded isometric shadow */}
      <ellipse cx={0} cy={18} rx={30} ry={11} fill="var(--accent)" opacity={active ? 0.14 : 0.06} />

      {kind === "client" && (
        <g>
          {/* Base laptop deck */}
          <polygon points="-24,6 4,-5 28,6 0,18" fill={midFill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <polygon points="-24,6 0,18 0,22 -24,10" fill={sideFill} stroke={stroke} strokeWidth={1.15} strokeLinejoin="round" />
          <polygon points="0,18 28,6 28,10 0,22" fill={topFill} stroke={stroke} strokeWidth={1.15} strokeLinejoin="round" />
          {/* Keyboard rows */}
          <line x1="-13" y1="6" x2="4" y2="-1" stroke={stroke} strokeWidth={0.85} opacity={0.6} />
          <line x1="-9" y1="9" x2="8" y2="2" stroke={stroke} strokeWidth={0.85} opacity={0.6} />
          <line x1="-5" y1="12" x2="12" y2="5" stroke={stroke} strokeWidth={0.85} opacity={0.6} />
          {/* Tilted display lid */}
          <polygon points="-24,6 -20,-22 8,-33 4,-5" fill={topFill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <polygon points="-21,3 -18,-19 5,-28 2,-6" fill={completedClient ? "var(--success-bg)" : midFill} stroke={stroke} strokeWidth={0.95} />
          {completedClient && (
            <g>
              <line x1="-15" y1="-15" x2="0" y2="-21" stroke="var(--success)" strokeWidth={1.5} />
              <line x1="-15" y1="-10" x2="-3" y2="-15" stroke="var(--success)" strokeWidth={1.2} />
            </g>
          )}
        </g>
      )}

      {(kind === "load_balancer" || kind === "api_gateway") && (
        <g>
          {/* Dual router antennas */}
          <line x1="-10" y1="-12" x2="-10" y2="-28" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />
          <circle cx={-10} cy={-29} r={2} fill={stroke} />
          <line x1="8" y1="-17" x2="8" y2="-33" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />
          <circle cx={8} cy={-34} r={2} fill={stroke} />
          {/* Bevelled 3D gateway chassis */}
          <polygon points="0,-16 26,-5 0,7 -26,-5" fill={topFill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <polygon points="-26,-5 0,7 0,17 -26,5" fill={sideFill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <polygon points="0,7 26,-5 26,5 0,17" fill={midFill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          {/* Status port LEDs */}
          <circle cx={-16} cy={5} r={1.6} fill="var(--success)" />
          <circle cx={-10} cy={8} r={1.6} fill={stroke} />
          <circle cx={-4} cy={11} r={1.6} fill={stroke} />
          <text x={13} y={5} textAnchor="middle" className="mono" fontSize="7.5" fontWeight="700" fill={stroke} transform="skewY(-22)">
            {kind === "load_balancer" ? "LB" : "GW"}
          </text>
        </g>
      )}

      {kind === "dns" && (
        <g>
          {/* 3-tier vertical DNS tower */}
          <polygon points="0,-32 20,-23 0,-14 -20,-23" fill={topFill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <polygon points="-20,-23 0,-14 0,16 -20,7" fill={sideFill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <polygon points="0,-14 20,-23 20,7 0,16" fill={midFill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          {[-7, 2, 10].map((dy, idx) => (
            <g key={idx}>
              <line x1="-16" y1={dy - 6} x2="-3" y2={dy} stroke={stroke} strokeWidth={1.1} />
              <line x1="3" y1={dy} x2="16" y2={dy - 6} stroke={stroke} strokeWidth={1.1} />
              <circle cx={-15} cy={dy - 9} r={1.3} fill="var(--success)" />
            </g>
          ))}
        </g>
      )}

      {(kind === "compute" || kind === "search_index" || kind === "gpu_cluster") && (
        <g>
          {/* Dual-bay isometric server rack */}
          <polygon points="0,-34 22,-24 0,-14 -22,-24" fill={topFill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <polygon points="-22,-24 0,-14 0,17 -22,7" fill={sideFill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <polygon points="0,-14 22,-24 22,7 0,17" fill={midFill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          {/* Rack blade slots */}
          {[-15, -9, -3, 3].map((yOff, i) => (
            <line key={i} x1="-17" y1={yOff} x2="-4" y2={yOff + 6} stroke={stroke} strokeWidth={1.15} />
          ))}
          <circle cx={6} cy={-10} r={1.8} fill={kind === "gpu_cluster" ? "var(--purple)" : "var(--success)"} />
          <circle cx={12} cy={-13} r={1.8} fill={stroke} />
          {kind === "gpu_cluster" && (
            <text x={11} y={4} textAnchor="middle" className="mono" fontSize="7.5" fontWeight="700" fill="var(--purple)">
              GPU
            </text>
          )}
        </g>
      )}

      {kind === "cache" && (
        <g>
          {/* Low-profile high-speed RAM cache blade */}
          <polygon points="0,-18 27,-6 0,6 -27,-6" fill={topFill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <polygon points="-27,-6 0,6 0,15 -27,3" fill={sideFill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <polygon points="0,6 27,-6 27,3 0,15" fill={midFill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <text x={0} y={-4} textAnchor="middle" className="mono" fontSize="8" fontWeight="700" fill={stroke}>
            RAM
          </text>
          <circle cx={-17} cy={4} r={1.5} fill="var(--success)" />
          <circle cx={-11} cy={7} r={1.5} fill="var(--success)" />
        </g>
      )}

      {(kind === "db_sql" || kind === "db_nosql" || kind === "vector_db" || kind === "object_store") && (
        <g>
          <path
            d="M -21 -16 L -21 10 A 21 9 0 0 0 21 10 L 21 -16 Z"
            fill={sideFill}
            stroke={stroke}
            strokeWidth={sw}
          />
          <ellipse cx={0} cy={-16} rx={21} ry={9} fill={topFill} stroke={stroke} strokeWidth={sw} />
          <path d="M -21 -6 A 21 8.5 0 0 0 21 -6" fill="none" stroke={stroke} strokeWidth={1.1} opacity={0.75} />
          <path d="M -21 3 A 21 8.5 0 0 0 21 3" fill="none" stroke={stroke} strokeWidth={1.1} opacity={0.75} />
          {kind === "vector_db" && (
            <text x={0} y={-13} textAnchor="middle" className="mono" fontSize="7" fontWeight="700" fill="var(--purple)">
              HNSW
            </text>
          )}
          {kind === "object_store" && (
            <text x={0} y={-13} textAnchor="middle" className="mono" fontSize="7.5" fontWeight="700" fill={stroke}>
              S3
            </text>
          )}
        </g>
      )}

      {(kind === "cdn" || kind === "external") && (
        <g>
          <path
            d="M -22 7 C -31 7 -33 -7 -21 -10 C -19 -22 -1 -24 5 -16 C 16 -22 29 -15 26 -4 C 34 -1 33 11 21 11 L -20 11 Z"
            fill={topFill}
            stroke={stroke}
            strokeWidth={sw}
          />
          {/* Subtle wireframe globe inside cloud */}
          <circle cx={0} cy={-3} r={9.5} fill={midFill} stroke={stroke} strokeWidth={1} opacity={0.85} />
          <ellipse cx={0} cy={-3} rx={4.5} ry={9.5} fill="none" stroke={stroke} strokeWidth={0.85} opacity={0.75} />
          <line x1="-9.5" y1="-3" x2="9.5" y2="-3" stroke={stroke} strokeWidth={0.85} opacity={0.75} />
        </g>
      )}

      {kind === "queue" && (
        <g>
          {/* Partitioned append-log stream block */}
          <polygon points="-28,-4 10,-20 30,-7 -8,9" fill={topFill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <polygon points="-28,-4 -8,9 -8,18 -28,5" fill={sideFill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <polygon points="-8,9 30,-7 30,2 -8,18" fill={midFill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <line x1="-15" y1="-9" x2="1" y2="3" stroke={stroke} strokeWidth={1.15} />
          <line x1="-2" y1="-14" x2="14" y2="-2" stroke={stroke} strokeWidth={1.15} />
          <line x1="11" y1="-19" x2="26" y2="-8" stroke={stroke} strokeWidth={1.15} />
        </g>
      )}
    </g>
  );
}

export const IsometricCanvas: React.FC<IsometricCanvasProps> = ({
  nodes,
  edges,
  steps,
  activeStepIndex,
  playbackState,
  flightProgress,
  selectedNodeId,
  faultNodeId,
  viewMode,
  nodeUtilization,
  onSelectNode,
  onSelectStep,
}) => {
  const seqContainerRef = useRef<HTMLDivElement | null>(null);
  const activeStep = activeStepIndex >= 0 ? steps[activeStepIndex] ?? null : null;
  const isFlowActive = playbackState !== "idle" && activeStep !== null;

  const projected = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      map.set(n.id, isoProject(n.gridPos.gx, n.gridPos.gy));
    }
    return map;
  }, [nodes]);

  // Determine smart label placement opposite connected edge attachment vectors
  const labelOffsets = useMemo(() => {
    const offsets = new Map<string, { dx: number; dy: number; anchor: "middle" | "start" | "end" }>();
    for (const n of nodes) {
      const p = projected.get(n.id)!;
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      for (const e of edges) {
        if (e.from === n.id) {
          const other = projected.get(e.to);
          if (other) {
            sumX += other.x - p.x;
            sumY += other.y - p.y;
            count++;
          }
        } else if (e.to === n.id) {
          const other = projected.get(e.from);
          if (other) {
            sumX += other.x - p.x;
            sumY += other.y - p.y;
            count++;
          }
        }
      }
      if (count > 0 && sumY / count > 24 && Math.abs(sumX / count) < 40) {
        // Edges attach predominantly downward -> place label safely ABOVE icon
        offsets.set(n.id, { dx: 0, dy: -48, anchor: "middle" });
      } else {
        // Default crisp bottom placement with safe gap below floor shadow
        offsets.set(n.id, { dx: 0, dy: 38, anchor: "middle" });
      }
    }
    return offsets;
  }, [nodes, edges, projected]);

  const viewBox = useMemo(() => {
    if (nodes.length === 0) return "0 0 820 440";
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      const p = isoProject(n.gridPos.gx, n.gridPos.gy);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const padX = 110;
    const padY = 80;
    return `${minX - padX} ${minY - padY} ${Math.max(540, maxX - minX + padX * 2)} ${Math.max(300, maxY - minY + padY * 2)}`;
  }, [nodes]);

  useEffect(() => {
    if (viewMode === "sequence" && activeStepIndex >= 0 && seqContainerRef.current) {
      const targetEl = seqContainerRef.current.querySelector(`[data-seq-step="${activeStepIndex}"]`);
      if (targetEl) {
        targetEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [viewMode, activeStepIndex]);

  // SEQUENCE DIAGRAM VIEW (Protocol Explorer slanted arrows + left timestamps)
  if (viewMode === "sequence") {
    const colWidth = Math.max(138, Math.min(176, 820 / Math.max(1, nodes.length)));
    const leftMargin = 68;
    const svgWidth = Math.max(700, leftMargin + nodes.length * colWidth + 40);
    const svgHeight = Math.max(290, steps.length * 58 + 90);
    const nodeColX = new Map<string, number>();
    nodes.forEach((n, idx) => nodeColX.set(n.id, leftMargin + colWidth / 2 + idx * colWidth));

    return (
      <div ref={seqContainerRef} style={{ flex: 1, overflow: "auto", padding: "12px 14px" }} className="blueprint-grid">
        <svg width={svgWidth} height={svgHeight} style={{ display: "block", margin: "0 auto" }}>
          <defs>
            <marker id="seq-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--accent)" />
            </marker>
          </defs>

          {/* Participant columns & lifelines */}
          {nodes.map((node) => {
            const x = nodeColX.get(node.id) ?? 0;
            const isSel = selectedNodeId === node.id;
            return (
              <g key={node.id} onClick={() => onSelectNode(node.id)} style={{ cursor: "pointer" }}>
                <rect
                  x={x - 62}
                  y={8}
                  width={124}
                  height={38}
                  rx={4}
                  fill={isSel ? "var(--accent-soft)" : "var(--bg-surface)"}
                  stroke={isSel ? "var(--accent)" : "var(--border)"}
                  strokeWidth={1.3}
                />
                <text x={x} y={24} textAnchor="middle" fontSize="10" fontWeight="700" className="mono" fill="var(--ink-primary)">
                  {truncateText(node.label, 18)}
                </text>
                <text x={x} y={37} textAnchor="middle" fontSize="8.5" className="mono" fill="var(--ink-muted)">
                  {truncateText(node.sublabel, 20)}
                </text>
                <line x1={x} y1={48} x2={x} y2={svgHeight - 16} stroke="var(--border)" strokeDasharray="4 4" />
              </g>
            );
          })}

          {steps.map((step, idx) => {
            const yTop = 76 + idx * 56;
            const yEnd = yTop + 16;
            const sx = nodeColX.get(step.sourceNodeId) ?? leftMargin;
            const tx = nodeColX.get(step.targetNodeId) ?? leftMargin;
            const isActive = isFlowActive && idx === activeStepIndex;
            const isPast = isFlowActive && idx < activeStepIndex;
            const color = CATEGORY_COLORS[step.category] ?? "var(--accent)";
            const sameNode = sx === tx;

            const animProgress = isActive ? flightProgress : 1;
            const curX = sx + (tx - sx) * animProgress;
            const curY = yTop + (yEnd - yTop) * animProgress;

            return (
              <g
                key={step.stepNo}
                data-seq-step={idx}
                onClick={() => onSelectStep(idx)}
                style={{ cursor: "pointer" }}
                opacity={!isFlowActive || isActive || isPast ? 1 : 0.42}
              >
                {/* Left-margin timestamp */}
                <text x={8} y={yTop + 4} fontSize="10" className="mono" fill={isActive ? color : "var(--ink-muted)"} fontWeight={isActive ? "700" : "500"}>
                  {(step.timestampMs / 1000).toFixed(3)}s
                </text>

                {/* Sender lifeline dot */}
                <circle cx={sx} cy={yTop} r={3.5} fill={color} />

                {sameNode ? (
                  <path
                    d={`M ${sx} ${yTop} C ${sx + 44} ${yTop - 8}, ${sx + 44} ${yEnd + 8}, ${sx + 4} ${yEnd}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={isActive ? 2.4 : 1.5}
                    markerEnd="url(#seq-arrow)"
                  />
                ) : (
                  <>
                    <line
                      x1={sx}
                      y1={yTop}
                      x2={tx}
                      y2={yEnd}
                      stroke={color}
                      strokeWidth={1.3}
                      opacity={0.28}
                    />
                    <line
                      x1={sx}
                      y1={yTop}
                      x2={curX}
                      y2={curY}
                      stroke={color}
                      strokeWidth={isActive ? 2.5 : 1.7}
                      markerEnd="url(#seq-arrow)"
                    />
                  </>
                )}

                <rect
                  x={(sx + tx) / 2 - 140}
                  y={yTop - 16}
                  width={280}
                  height={16}
                  rx={3}
                  fill="var(--bg-surface)"
                  stroke={isActive ? color : "var(--border-soft)"}
                  strokeWidth={isActive ? 1.2 : 0.7}
                />
                <text
                  x={(sx + tx) / 2}
                  y={yTop - 5}
                  textAnchor="middle"
                  fontSize="9.5"
                  fontWeight={isActive ? "700" : "500"}
                  className="mono"
                  fill={isActive ? color : "var(--ink-primary)"}
                >
                  {truncateText(`${step.protocol} · ${step.info}`, 40)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  // NETWORK ISOMETRIC TOPOLOGY VIEW
  const easedProgress = easeInOutCubic(flightProgress);
  const traversedEdgeIds = new Set<string>();
  if (isFlowActive) {
    const upto = playbackState === "completed" ? steps.length : activeStepIndex;
    for (let i = 0; i < upto; i++) {
      const eid = steps[i]?.edgeId;
      if (eid) traversedEdgeIds.add(eid);
    }
  }

  let activePacketOverlay: React.ReactNode = null;
  let arrivalPulse: React.ReactNode = null;

  return (
    <div style={{ flex: 1, position: "relative", overflow: "hidden" }} className="flow-canvas">
      <svg viewBox={viewBox} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Architecture request flow diagram">
        <defs>
          <marker id="arrow-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto">
            <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="var(--edge-strong)" />
          </marker>
          <marker id="arrow-trail" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto">
            <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="var(--accent)" />
          </marker>
          {CATEGORY_KEYS.map((k) => (
            <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 1 L 10 5 L 0 9 z" fill={CATEGORY_COLORS[k]} />
            </marker>
          ))}
          <filter id="pkt-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
        </defs>

        {/* Edges: visible base wire, accent trail for hops already taken, live flow on the active hop */}
        {edges.map((edge) => {
          const p1 = projected.get(edge.from);
          const p2 = projected.get(edge.to);
          if (!p1 || !p2) return null;

          const isActiveEdge = isFlowActive && activeStep?.edgeId === edge.id;
          const reverseDirection = isActiveEdge && activeStep?.sourceNodeId === edge.to;
          const wasTraversed = traversedEdgeIds.has(edge.id);

          const rawStart = reverseDirection ? p2 : p1;
          const rawEnd = reverseDirection ? p1 : p2;
          const { sx, sy, tx, ty, nx, ny } = clipSegment(rawStart.x, rawStart.y, rawEnd.x, rawEnd.y, 44, 46);
          const isAsync = edge.transport === "async";

          if (isActiveEdge && activeStep) {
            const color = CATEGORY_COLORS[activeStep.category] ?? "var(--accent)";
            const pktX = sx + (tx - sx) * easedProgress;
            const pktY = sy + (ty - sy) * easedProgress;
            const tailT = Math.max(0, easedProgress - 0.24);
            const tailX = sx + (tx - sx) * tailT;
            const tailY = sy + (ty - sy) * tailT;
            const midX = (sx + tx) / 2 + nx * 26;
            const midY = (sy + ty) / 2 + ny * 26 - 10;
            const pillLabel = `${activeStep.protocol} · +${activeStep.latencyDeltaMs}ms`;
            const pillWidth = Math.max(104, pillLabel.length * 6.4 + 40);
            // A hop is a "response" when it retraces an earlier hop in the opposite direction
            const isResponse = steps
              .slice(0, activeStepIndex)
              .some((st) => st.sourceNodeId === activeStep.targetNodeId && st.targetNodeId === activeStep.sourceNodeId);
            const inFlight = flightProgress > 0 && flightProgress < 1;

            activePacketOverlay = (
              <g style={{ pointerEvents: "none" }}>
                {inFlight && (
                  <>
                    <line
                      x1={tailX}
                      y1={tailY}
                      x2={pktX}
                      y2={pktY}
                      stroke={color}
                      strokeWidth={4}
                      strokeLinecap="round"
                      opacity={0.35}
                    />
                    <circle cx={pktX} cy={pktY} r={9} fill={color} opacity={0.45} filter="url(#pkt-glow)" />
                    {isResponse ? (
                      <rect
                        x={pktX - 5}
                        y={pktY - 5}
                        width={10}
                        height={10}
                        rx={2.5}
                        fill="var(--bg-surface-solid)"
                        stroke={color}
                        strokeWidth={2.2}
                      />
                    ) : (
                      <circle cx={pktX} cy={pktY} r={5.5} fill={color} stroke="var(--bg-surface-solid)" strokeWidth={2} />
                    )}
                  </>
                )}
                <g transform={`translate(${midX}, ${midY})`} className="flow-pill">
                  <rect
                    x={-pillWidth / 2}
                    y={-12}
                    width={pillWidth}
                    height={24}
                    rx={12}
                    fill="var(--bg-surface-solid)"
                    stroke={color}
                    strokeWidth={1.2}
                  />
                  <circle cx={-pillWidth / 2 + 13} cy={0} r={8} fill={color} />
                  <text x={-pillWidth / 2 + 13} y={3.2} textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--bg-surface-solid)" className="mono">
                    {activeStepIndex + 1}
                  </text>
                  <text x={10} y={3.6} textAnchor="middle" fontSize="10" fontWeight="600" className="mono" fill="var(--ink-primary)">
                    {pillLabel}
                  </text>
                </g>
              </g>
            );

            // Receiving node "catches" the packet: a single ring that expands and fades on arrival
            if (flightProgress >= 0.82 && flightProgress < 1) {
              const target = projected.get(activeStep.targetNodeId);
              if (target) {
                const t = (flightProgress - 0.82) / 0.18;
                arrivalPulse = (
                  <ellipse
                    cx={target.x}
                    cy={target.y + 16}
                    rx={30 + t * 22}
                    ry={11 + t * 8}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    opacity={0.7 * (1 - t)}
                    style={{ pointerEvents: "none" }}
                  />
                );
              }
            }

            return (
              <g key={edge.id}>
                <line x1={sx} y1={sy} x2={tx} y2={ty} stroke={color} strokeWidth={6} opacity={0.12} strokeLinecap="round" />
                <line
                  x1={sx}
                  y1={sy}
                  x2={tx}
                  y2={ty}
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray="7 6"
                  className="flow-dash"
                  markerEnd={`url(#arrow-${activeStep.category})`}
                />
              </g>
            );
          }

          return (
            <g key={edge.id}>
              <line
                x1={sx}
                y1={sy}
                x2={tx}
                y2={ty}
                stroke={wasTraversed ? "var(--accent)" : "var(--edge-strong)"}
                strokeWidth={wasTraversed ? 1.8 : 1.4}
                strokeDasharray={isAsync ? "4 5" : undefined}
                strokeLinecap="round"
                markerEnd={wasTraversed ? "url(#arrow-trail)" : "url(#arrow-muted)"}
                opacity={wasTraversed ? 0.7 : isFlowActive ? 0.55 : 0.9}
                style={{ transition: "stroke 300ms ease, opacity 300ms ease" }}
              />
            </g>
          );
        })}

        {arrivalPulse}

        {/* Isometric infrastructure nodes */}
        {nodes.map((node) => {
          const pt = projected.get(node.id);
          if (!pt) return null;
          const isEndpoint =
            isFlowActive &&
            (activeStep?.sourceNodeId === node.id || activeStep?.targetNodeId === node.id);
          const isSelected = selectedNodeId === node.id;
          const isFaulted = faultNodeId === node.id;
          const isDimmed = isFlowActive && !isEndpoint && !isSelected && !isFaulted;
          const lbl = labelOffsets.get(node.id) ?? { dx: 0, dy: 38, anchor: "middle" as const };
          const completedClient = playbackState === "completed" && node.kind === "client";
          const util = nodeUtilization?.[node.id];

          return (
            <g
              key={node.id}
              transform={`translate(${pt.x}, ${pt.y})`}
              onClick={() => onSelectNode(node.id)}
              className={`iso-node ${isDimmed ? "dimmed" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`${node.label}, ${node.sublabel}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectNode(node.id);
                }
              }}
            >
              {(isSelected || isEndpoint || isFaulted) && (
                <ellipse
                  cx={0}
                  cy={17}
                  rx={40}
                  ry={15}
                  fill={isFaulted ? "var(--danger-bg)" : "var(--accent-soft)"}
                  stroke={isFaulted ? "var(--danger)" : "var(--accent)"}
                  strokeWidth={1.2}
                  opacity={isSelected || isFaulted ? 1 : 0.75}
                />
              )}

              <g className="iso-glyph">
                <IsometricNodeGlyph
                  kind={node.kind}
                  active={isSelected || isEndpoint}
                  faulted={isFaulted}
                  completedClient={completedClient}
                />
              </g>

              {isFaulted && (
                <g transform="translate(26, -32)">
                  <rect x={-20} y={-9} width={44} height={17} rx={8.5} fill="var(--danger)" />
                  <text x={2} y={3} textAnchor="middle" fontSize="8.5" fontWeight="700" className="mono" fill="#fff">
                    FAULT
                  </text>
                </g>
              )}

              {(() => {
                const labelText = truncateText(node.label, 30);
                const subText = truncateText(node.sublabel, 32);
                const boxW = Math.max(96, Math.max(labelText.length * 6.3, subText.length * 5.5) + 20);
                const boxX = lbl.anchor === "start" ? -8 : lbl.anchor === "end" ? -boxW + 8 : -boxW / 2;
                const showUtil = typeof util === "number" && util > 0;
                const boxH = showUtil ? 38 : 32;
                const highlighted = isSelected || isEndpoint;
                return (
                  <g transform={`translate(${lbl.dx}, ${lbl.dy})`}>
                    <title>{`${node.label} — ${node.sublabel}`}</title>
                    <rect
                      x={boxX}
                      y={-14}
                      width={boxW}
                      height={boxH}
                      rx={7}
                      fill="var(--bg-surface-solid)"
                      stroke={highlighted ? "var(--accent)" : "var(--border)"}
                      strokeWidth={1}
                    />
                    <text
                      x={0}
                      y={0}
                      textAnchor={lbl.anchor}
                      fontSize="11"
                      fontWeight="600"
                      fill={highlighted ? "var(--accent)" : "var(--ink-primary)"}
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {labelText}
                    </text>
                    <text x={0} y={12} textAnchor={lbl.anchor} fontSize="9" className="mono" fill="var(--ink-muted)">
                      {subText}
                    </text>
                    {showUtil && (
                      <g transform={`translate(${boxX + 10}, 18)`}>
                        <rect x={0} y={0} width={boxW - 20} height={2.5} rx={1.25} fill="var(--border-soft)" />
                        <rect
                          x={0}
                          y={0}
                          width={(boxW - 20) * Math.min(1, util!)}
                          height={2.5}
                          rx={1.25}
                          fill={utilColor(util!)}
                          style={{ transition: "width 400ms ease" }}
                        />
                      </g>
                    )}
                  </g>
                );
              })()}
            </g>
          );
        })}

        {/* Packet and hop label render above nodes so they are never hidden */}
        {activePacketOverlay}
      </svg>

      <div className="flow-legend" aria-hidden="true">
        <span><i className="lg-dot" /> request</span>
        <span><i className="lg-square" /> response</span>
        <span><i className="lg-dash" /> async</span>
      </div>
    </div>
  );
};
