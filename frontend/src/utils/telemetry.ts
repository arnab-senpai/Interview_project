import type { LessonEdge, LessonNode, NodeKind, TraceStep } from "../types/hld";

export type HealthTier = "healthy" | "warm" | "saturated" | "fault";

export interface TopologyTelemetry {
  /** Requests a second entering at the client nodes, as set by the learner. */
  ingressRps: number;
  /** Requests a second each node receives after caches and CDNs absorb their hits. */
  nodeRps: Record<string, number>;
  /** load ÷ one instance's capacity, only for nodes with a known capacity. */
  nodeUtilization: Record<string, number>;
  bottleneckNodeId: string | null;
  bottleneckLabel: string;
  bottleneckUtilization: number;
  /** Sum of the trace's step latencies: one request on this trace, not a percentile. */
  traceLatencyMs: number;
  healthTier: HealthTier;
}

/** Planning target: above this a part is "warm"; at 100% one instance can't keep up. */
export const TARGET_UTILIZATION = 0.6;

const ABSORBING: NodeKind[] = ["cache", "cdn"];
const INITIATORS: NodeKind[] = ["client", "external"];

export function formatCompactRps(rps: number): string {
  if (rps >= 1_000_000) return `${(rps / 1_000_000).toFixed(1)}M`;
  if (rps >= 10_000) return `${Math.round(rps / 1_000)}k`;
  if (rps >= 1_000) return `${(rps / 1_000).toFixed(1)}k`;
  return String(Math.max(0, Math.round(rps)));
}

/**
 * Pushes the ingress rate through the topology along its edges.
 *
 * Fixes from the Phase 1 numbers audit:
 * - Ingress is an input, not 48% of the smallest node's capacity, so utilisation
 *   depends on the design instead of reading 48% in every lesson.
 * - Caches and CDNs absorb their hits: what they pass on, and what their
 *   siblings behind a cache-aside call receive, is scaled by (1 − hit rate). An
 *   origin behind a CDN is no longer named the busiest part.
 * - The fake p99 is gone; the HUD shows the trace's summed latency and says so.
 *
 * Rules: edges into a client are responses and are skipped. Children of the same
 * kind split their parent's load evenly (replicas behind a balancer); children
 * of different kinds each see the full load. Edges that would close a cycle are
 * ignored.
 */
export function computeTopologyTelemetry(
  nodes: LessonNode[],
  edges: LessonEdge[],
  steps: TraceStep[],
  ingressRps: number,
  cacheHitRate: number,
  faultNodeId: string | null
): TopologyTelemetry {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hit = Math.max(0, Math.min(0.999, cacheHitRate));
  const forward = edges.filter((e) => {
    const target = byId.get(e.to);
    return byId.has(e.from) && target && !INITIATORS.includes(target.kind);
  });

  // Topological order from the initiators; drop edges that close a cycle.
  const children = new Map<string, LessonEdge[]>();
  const state = new Map<string, 1 | 2>();
  const order: string[] = [];
  const outgoing = (id: string) => forward.filter((e) => e.from === id);
  const visit = (id: string) => {
    state.set(id, 1);
    const kept: LessonEdge[] = [];
    for (const e of outgoing(id)) {
      if (state.get(e.to) === 1) continue; // back edge
      kept.push(e);
      if (!state.has(e.to)) visit(e.to);
    }
    children.set(id, kept);
    state.set(id, 2);
    order.push(id);
  };
  const roots = nodes.filter((n) => INITIATORS.includes(n.kind)).map((n) => n.id);
  for (const r of roots) if (!state.has(r)) visit(r);
  for (const n of nodes) if (!state.has(n.id)) visit(n.id);
  order.reverse();

  const load = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const rootShare = roots.length > 0 ? ingressRps / roots.length : 0;
  for (const r of roots) load.set(r, rootShare);

  for (const id of order) {
    const node = byId.get(id);
    if (!node) continue;
    const incoming = load.get(id) ?? 0;
    const kids = children.get(id) ?? [];
    if (kids.length === 0 || incoming === 0) continue;
    const parentAbsorbs = ABSORBING.includes(node.kind);
    const hasCacheChild = kids.some((e) => ABSORBING.includes(byId.get(e.to)!.kind));
    const sameKindCount = new Map<NodeKind, number>();
    for (const e of kids) {
      const k = byId.get(e.to)!.kind;
      sameKindCount.set(k, (sameKindCount.get(k) ?? 0) + 1);
    }
    for (const e of kids) {
      const child = byId.get(e.to)!;
      let share = incoming / (sameKindCount.get(child.kind) ?? 1);
      if (parentAbsorbs) share *= 1 - hit; // a cache or CDN only passes on its misses
      else if (hasCacheChild && !ABSORBING.includes(child.kind) && e.transport === "sync") share *= 1 - hit; // cache-aside
      load.set(child.id, (load.get(child.id) ?? 0) + share);
    }
  }

  const nodeRps: Record<string, number> = {};
  const nodeUtilization: Record<string, number> = {};
  let bottleneckNodeId: string | null = null;
  let bottleneckLabel = "None";
  let maxUtil = 0;
  for (const node of nodes) {
    const rps = load.get(node.id) ?? 0;
    nodeRps[node.id] = rps;
    const cap = node.specs.maxQpsPerNode;
    if (INITIATORS.includes(node.kind) || typeof cap !== "number" || cap <= 0) continue;
    let util = rps / cap;
    if (faultNodeId === node.id) util = Math.max(util, 1.3);
    nodeUtilization[node.id] = util;
    if (util > maxUtil) {
      maxUtil = util;
      bottleneckNodeId = node.id;
      bottleneckLabel = node.label;
    }
  }

  const traceLatencyMs = Math.round(steps.reduce((acc, st) => acc + st.latencyDeltaMs, 0) * 10) / 10;
  const healthTier: HealthTier = faultNodeId
    ? "fault"
    : maxUtil >= 1
      ? "saturated"
      : maxUtil >= TARGET_UTILIZATION
        ? "warm"
        : "healthy";

  return {
    ingressRps,
    nodeRps,
    nodeUtilization,
    bottleneckNodeId,
    bottleneckLabel,
    bottleneckUtilization: maxUtil,
    traceLatencyMs,
    healthTier,
  };
}
