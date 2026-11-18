import type { LessonNode, TraceStep } from "../types/hld";

export type HealthTier = "healthy" | "warm" | "saturated" | "fault";

export interface TopologyTelemetry {
  effectiveRps: number;
  bottleneckNodeId: string | null;
  bottleneckLabel: string;
  bottleneckUtilization: number;
  simulatedP99Ms: number;
  healthTier: HealthTier;
  nodeUtilization: Record<string, number>;
}

/**
 * Formats an integer throughput count cleanly for compact HUD pills.
 */
export function formatCompactRps(rps: number): string {
  if (rps >= 1_000_000) return `${(rps / 1_000_000).toFixed(1)}M`;
  if (rps >= 1_000) return `${Math.round(rps / 1_000)}k`;
  return String(Math.max(0, Math.round(rps)));
}

/**
 * Derives real-time per-node utilization hotspots, queuing p99 tail latency,
 * and bottleneck node identification from active topology node capacities and QPS multiplier.
 */
export function computeTopologyTelemetry(
  nodes: LessonNode[],
  steps: TraceStep[],
  qpsLoad: number,
  faultNodeId: string | null
): TopologyTelemetry {
  const infraNodes = nodes.filter((n) => n.kind !== "client" && n.kind !== "external");
  const capacityPool = infraNodes.length > 0 ? infraNodes : nodes;

  const positiveCaps = capacityPool
    .map((n) => n.specs.maxQpsPerNode)
    .filter((q): q is number => typeof q === "number" && q > 0);

  const tightestCap = positiveCaps.length > 0 ? Math.min(...positiveCaps) : 50_000;
  const nominalRps = Math.max(1_000, Math.round(tightestCap * 0.48));
  const clampedLoad = Math.max(0.35, Math.min(2.6, qpsLoad));
  const effectiveRps = Math.round(nominalRps * clampedLoad);

  const nodeUtilization: Record<string, number> = {};
  let bottleneckNodeId: string | null = null;
  let bottleneckLabel = "Topology";
  let maxUtil = 0;

  for (const node of nodes) {
    const isInitiator = node.kind === "client" || node.kind === "external";
    const cap = node.specs.maxQpsPerNode;
    let util =
      !isInitiator && typeof cap === "number" && cap > 0
        ? effectiveRps / cap
        : 0.22 * clampedLoad;

    if (faultNodeId === node.id) {
      util = Math.max(util, 1.3);
    }

    const boundedUtil = Math.min(1.6, Math.max(0.05, util));
    nodeUtilization[node.id] = boundedUtil;

    if (boundedUtil > maxUtil) {
      maxUtil = boundedUtil;
      bottleneckNodeId = node.id;
      bottleneckLabel = node.label;
    }
  }

  const baseLatencyMs = Math.max(
    4,
    steps.reduce((acc, st) => acc + st.latencyDeltaMs, 0)
  );
  // M/M/1-inspired nonlinear queuing inflation once utilization passes ~65%
  const overloadFactor =
    maxUtil > 0.65 ? Math.pow((maxUtil - 0.65) * 2.1, 2.05) : 0;
  const chaosMultiplier = faultNodeId ? 1.18 : 1.0;
  const simulatedP99Ms = Math.round(
    baseLatencyMs * (1 + overloadFactor) * chaosMultiplier
  );

  const healthTier: HealthTier = faultNodeId
    ? "fault"
    : maxUtil >= 0.95
    ? "saturated"
    : maxUtil >= 0.72
    ? "warm"
    : "healthy";

  return {
    effectiveRps,
    bottleneckNodeId,
    bottleneckLabel,
    bottleneckUtilization: maxUtil,
    simulatedP99Ms,
    healthTier,
    nodeUtilization,
  };
}
