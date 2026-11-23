import { evalFormula, inputDependencies } from "./formula";
import type { Arrow, Component, Metric, TopicV2 } from "./types";

/** Instances are sized so each runs at or below this share of its capacity. */
export const TARGET_UTILIZATION = 0.6;
/** A number has "changed" when it moved by more than this share. */
export const CHANGE_THRESHOLD = 0.1;

export interface ResolvedFigure {
  components: Component[];
  arrows: Arrow[];
  highlight: Set<string>;
}

export function resolveFigure(topic: TopicV2, figureId: string): ResolvedFigure | null {
  const st = topic.figures[figureId];
  if (!st) return null;
  const compById = new Map(topic.components.map((c) => [c.id, c]));
  const arrowById = new Map(topic.arrows.map((a) => [a.id, a]));
  const components = st.components
    .map((id) => compById.get(id))
    .filter((c): c is Component => Boolean(c))
    .map((c) => ({ ...c, ...(st.overrides[c.id] ?? {}) }) as Component);
  const arrows = st.arrows
    .map((id) => arrowById.get(id))
    .filter((a): a is Arrow => Boolean(a))
    .map((a) => ({ ...a, ...(st.arrowOverrides[a.id] ?? {}) }) as Arrow);
  return { components, arrows, highlight: new Set(st.highlight) };
}

export type PartState = "ok" | "warm" | "over" | "none";

export interface ComponentNumbers {
  load: number | null;
  capacity: number | null;
  /** Fixed count from the content, or the count needed at the target utilisation. */
  instances: number | null;
  autoSized: boolean;
  utilization: number | null;
  state: PartState;
  metrics: { label: string; value: number; unit: string; formula: string }[];
}

export interface FigureNumbers {
  components: Record<string, ComponentNumbers>;
  arrows: Record<string, number | null>;
}

function safeEval(src: string | number | undefined, env: Record<string, number>): number | null {
  if (src === undefined || src === null || src === "auto") return null;
  try {
    const v = evalFormula(src, env);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export function computeFigureNumbers(fig: ResolvedFigure, env: Record<string, number>): FigureNumbers {
  const components: Record<string, ComponentNumbers> = {};
  for (const c of fig.components) {
    const load = safeEval(c.load, env);
    const capacity = typeof c.capacity === "number" ? c.capacity : null;
    const autoSized = c.instances === undefined || c.instances === "auto";
    let instances: number | null = null;
    let utilization: number | null = null;
    let state: PartState = "none";
    if (load !== null && capacity) {
      if (autoSized) {
        instances = Math.max(1, Math.ceil(load / (capacity * TARGET_UTILIZATION)));
        utilization = load / (capacity * instances);
        state = "ok";
      } else {
        instances = Math.max(1, Math.round(safeEval(c.instances, env) ?? 1));
        utilization = load / (capacity * instances);
        state = utilization >= 1 ? "over" : utilization >= TARGET_UTILIZATION ? "warm" : "ok";
      }
    }
    const metrics = (c.metrics ?? []).map((m: Metric) => ({
      label: m.label,
      value: safeEval(m.value, env) ?? NaN,
      unit: m.unit,
      formula: m.value,
    }));
    components[c.id] = { load, capacity, instances, autoSized, utilization, state, metrics };
  }
  const arrows: Record<string, number | null> = {};
  for (const a of fig.arrows) arrows[a.id] = safeEval(a.rate, env);
  return { components, arrows };
}

export interface Change {
  id: string;
  label: string;
  what: string;
  before: number;
  after: number;
  unit: string;
  because: string[];
}

function moved(before: number | null, after: number | null): boolean {
  if (before === null || after === null) return false;
  if (before === after) return false;
  const base = Math.max(Math.abs(before), Math.abs(after));
  return base > 0 && Math.abs(after - before) / base > CHANGE_THRESHOLD;
}

/**
 * Parts whose numbers moved by more than 10% between two input sets, with the
 * inputs that caused it (the inputs their formulas depend on that changed).
 */
export function diffFigure(
  topic: TopicV2,
  fig: ResolvedFigure,
  before: FigureNumbers,
  after: FigureNumbers,
  changedInputs: Set<string>
): Change[] {
  const inputIds = new Set(topic.numbers.inputs.map((i) => i.id));
  const inputLabel = new Map(topic.numbers.inputs.map((i) => [i.id, i.label]));
  const because = (src: string | number | undefined) =>
    src === undefined || src === "auto"
      ? []
      : [...inputDependencies(src, topic.numbers.values, inputIds)].filter((i) => changedInputs.has(i)).map((i) => inputLabel.get(i) ?? i);
  const out: Change[] = [];
  for (const c of fig.components) {
    const b = before.components[c.id];
    const a = after.components[c.id];
    if (!b || !a) continue;
    if (moved(b.load, a.load)) {
      out.push({ id: c.id, label: c.label, what: "load", before: b.load!, after: a.load!, unit: c.loadUnit, because: because(c.load) });
    }
    if (a.autoSized && b.instances !== null && a.instances !== null && b.instances !== a.instances) {
      out.push({ id: c.id, label: c.label, what: "instances", before: b.instances, after: a.instances, unit: "instances", because: because(c.load) });
    }
    a.metrics.forEach((m, i) => {
      const bm = b.metrics[i];
      if (bm && moved(bm.value, m.value)) {
        out.push({ id: c.id, label: c.label, what: m.label, before: bm.value, after: m.value, unit: m.unit, because: because(m.formula) });
      }
    });
  }
  for (const arrow of fig.arrows) {
    if (moved(before.arrows[arrow.id], after.arrows[arrow.id])) {
      out.push({
        id: arrow.id,
        label: arrow.label,
        what: "rate",
        before: before.arrows[arrow.id]!,
        after: after.arrows[arrow.id]!,
        unit: "req/s",
        because: because(arrow.rate),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- formatting

function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(abs >= 1e13 ? 0 : 1)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  if (abs >= 10) return String(Math.round(n));
  if (abs >= 1) return n.toFixed(1).replace(/\.0$/, "");
  if (abs === 0) return "0";
  return n.toPrecision(2);
}

/** Decimal byte units, as storage is sold: 1 GB = 10^9 bytes. */
export function formatBytes(n: number, perSecond = false): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB"];
  let v = n;
  let i = 0;
  while (Math.abs(v) >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  const s = Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, "");
  return `${s} ${units[i]}${perSecond ? "/s" : ""}`;
}

export function formatValue(n: number | null | undefined, unit: string): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  if (unit === "B") return formatBytes(n);
  if (unit === "B/s") return formatBytes(n, true);
  if (unit === "%") return `${(n * 100).toFixed(n * 100 >= 10 || Number.isInteger(n * 100) ? 0 : 1)}%`;
  if (unit === "×") return `${n.toFixed(1).replace(/\.0$/, "")}×`;
  if (unit === "ms" || unit === "s") return `${compact(n)} ${unit}`;
  if (!unit) return compact(n);
  if (unit.includes("/s")) return `${compact(n)}/s`;
  return `${compact(n)} ${unit}`;
}

export function formatRate(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : `${compact(n)}/s`;
}

export function formulaText(src: string | number | undefined, env: Record<string, number>, topic: TopicV2): string {
  if (src === undefined) return "";
  const labels = new Map<string, { label: string; unit: string }>([
    ...topic.numbers.inputs.map((i) => [i.id, { label: i.label, unit: i.unit }] as const),
    ...topic.numbers.values.map((v) => [v.id, { label: v.label, unit: v.unit }] as const),
  ]);
  const name = typeof src === "string" ? labels.get(src.trim()) : undefined;
  if (name) {
    const val = topic.numbers.values.find((v) => v.id === String(src).trim());
    return `${name.label} = ${val ? val.formula : src} = ${formatValue(env[String(src).trim()], name.unit)}`;
  }
  return `${src} = ${formatValue(safeEval(src, env), "")}`;
}
